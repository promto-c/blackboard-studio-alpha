import {
  AnyNode,
  FlowEdge,
  ImageFitMode,
  NodeType,
  ReformatNode,
  type ImageTransform,
  type Flow,
  type SceneNode,
  ViewerSlot,
  ViewerSlotAssignments,
  VIEWER_SLOTS,
} from '@blackboard/types';
import { getOutputPipeEdge, isFlowOutputDetached, OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { isSourceNodeType, usesImplicitPipelineInput } from '@/utils/nodePredicates';

export const VIEWER_SLOT_ORDER: ViewerSlot[] = [...VIEWER_SLOTS];

const getValidNodeIds = (nodes: AnyNode[]) => new Set(nodes.map((node) => node.id));

const getValidViewerTargetIds = (nodes: AnyNode[]) => {
  const validTargetIds = getValidNodeIds(nodes);
  validTargetIds.add(OUTPUT_NODE_ID);
  return validTargetIds;
};

const withoutDetachedFromPipe = (node: AnyNode): AnyNode => {
  const { detachedFromPipe: _detachedFromPipe, ...rest } = node as AnyNode & {
    detachedFromPipe?: boolean;
  };
  return rest as AnyNode;
};

const isDetachedFromPipe = (node: AnyNode): boolean =>
  (node as { detachedFromPipe?: boolean }).detachedFromPipe === true;

const getNodeOutputSize = (node: AnyNode): { width: number; height: number } | null => {
  const sourceNode = node as AnyNode & { width?: unknown; height?: unknown };
  if (typeof sourceNode.width !== 'number' || typeof sourceNode.height !== 'number') return null;
  if (!Number.isFinite(sourceNode.width) || !Number.isFinite(sourceNode.height)) return null;
  if (sourceNode.width <= 0 || sourceNode.height <= 0) return null;
  return {
    width: Math.round(sourceNode.width),
    height: Math.round(sourceNode.height),
  };
};

const hasOutputSizeSceneMode = (node: AnyNode): boolean =>
  (node as AnyNode & { useOutputSizeAsScene?: boolean }).useOutputSizeAsScene === true;

const isReformatNode = (node: AnyNode): boolean => node.type === NodeType.REFORMAT;

const resolveOutputDisplayWindow = (sceneNode: AnyNode, formatNode: AnyNode): AnyNode => {
  const outputSize = getNodeOutputSize(formatNode);
  if (!outputSize || sceneNode.type !== NodeType.SCENE) return sceneNode;
  return { ...(sceneNode as SceneNode), ...outputSize };
};

const resolveSourceOutputTransform = (node: AnyNode): AnyNode => {
  if (!('transform' in node)) return node;
  const transform = node.transform as ImageTransform;
  return {
    ...node,
    transform: {
      ...transform,
      fitMode: ImageFitMode.NONE,
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    },
  } as AnyNode;
};

const isEnabledFormatNode = (node: AnyNode): boolean =>
  node.enabled !== false && isReformatNode(node) && !!getNodeOutputSize(node);

const resolveRenderFormatNodes = (renderNodes: AnyNode[]): AnyNode[] => {
  const sceneIndex = renderNodes.findIndex((node) => node.type === NodeType.SCENE);
  if (sceneIndex < 0) return renderNodes;

  const sceneNode = renderNodes[sceneIndex];
  let currentFormat = getNodeOutputSize(sceneNode);
  let reformatNode: AnyNode | undefined;
  const nodesWithFormatMetadata = renderNodes.map((node) => {
    if (!isEnabledFormatNode(node)) return node;

    const sourceFormat = currentFormat;
    const outputFormat = getNodeOutputSize(node);
    reformatNode = node;
    currentFormat = outputFormat;

    if (!sourceFormat) return node;
    return {
      ...(node as ReformatNode),
      sourceWidth: sourceFormat.width,
      sourceHeight: sourceFormat.height,
    } as AnyNode;
  });

  const matchOutputSource = [...nodesWithFormatMetadata]
    .reverse()
    .find((node) => isSourceNodeType(node.type) && hasOutputSizeSceneMode(node));
  const outputSizeSource = reformatNode ? null : matchOutputSource;
  const formatNode = reformatNode ?? outputSizeSource;

  if (!formatNode || !getNodeOutputSize(formatNode)) {
    return nodesWithFormatMetadata;
  }

  return nodesWithFormatMetadata.map((node, index) => {
    if (index === sceneIndex) {
      return resolveOutputDisplayWindow(node, formatNode);
    }
    if (outputSizeSource && node.id === outputSizeSource.id) {
      return resolveSourceOutputTransform(node);
    }
    return node;
  });
};

const getFlowInputEdgesForNode = (flow: Flow | null, nodeId: string): FlowEdge[] =>
  flow?.edges.filter((edge) => edge.targetNodeId === nodeId) ?? [];

const getNodeInputEdges = (
  node: AnyNode,
  flow: Flow | null,
): Array<Pick<FlowEdge, 'sourceNodeId' | 'sourcePort' | 'targetPort'>> => {
  const flowEdges = getFlowInputEdgesForNode(flow, node.id);
  if (flowEdges.length > 0) {
    return flowEdges;
  }

  return Object.entries(node.inputs ?? {}).map(([targetPort, sourceNodeId]) => ({
    sourceNodeId,
    sourcePort: node.inputSourcePorts?.[targetPort] ?? 'output',
    targetPort,
  }));
};

const getNodeInputSourceForPort = (
  node: AnyNode,
  flow: Flow | null,
  portName: string,
): string | null =>
  getNodeInputEdges(node, flow).find((edge) => edge.targetPort === portName)?.sourceNodeId ?? null;

const projectNodeInputsFromFlow = (node: AnyNode, flow: Flow | null): AnyNode => {
  if (!flow) return node;

  const inputEdges = getFlowInputEdgesForNode(flow, node.id);
  const {
    inputs: _inputs,
    inputSourcePorts: _inputSourcePorts,
    ...rest
  } = node as AnyNode & {
    inputs?: Record<string, string>;
    inputSourcePorts?: Record<string, string>;
  };

  if (inputEdges.length === 0) {
    return rest as AnyNode;
  }

  const inputs: Record<string, string> = {};
  const inputSourcePorts: Record<string, string> = {};

  for (const edge of inputEdges) {
    inputs[edge.targetPort] = edge.sourceNodeId;
    if (edge.sourcePort !== 'output') {
      inputSourcePorts[edge.targetPort] = edge.sourcePort;
    }
  }

  return {
    ...rest,
    inputs,
    ...(Object.keys(inputSourcePorts).length > 0 ? { inputSourcePorts } : {}),
  } as AnyNode;
};

const resolveRenderBranchNodes = (
  nodes: AnyNode[],
  flow: Flow | null,
  targetNodeId: string,
): AnyNode[] => {
  const usesCanonicalFlow = flow !== null;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const orderedNodes: AnyNode[] = [];
  const includedIds = new Set<string>();
  const visitingIds = new Set<string>();

  const sceneNodes = nodes.filter((node) => node.type === NodeType.SCENE);

  const addNode = (node: AnyNode, options: { forceVisible?: boolean } = {}) => {
    if (node.type === NodeType.SCENE || node.type === NodeType.OUTPUT) return;
    if (includedIds.has(node.id)) return;
    const projectedNode = projectNodeInputsFromFlow(node, flow);
    orderedNodes.push(
      options.forceVisible ? withoutDetachedFromPipe(projectedNode) : projectedNode,
    );
    includedIds.add(node.id);
  };

  const includeExplicitInputDependencies = (node: AnyNode, exceptPortName?: string) => {
    const hiddenPorts = new Set(
      (node as { hiddenInputPortIds?: string[] }).hiddenInputPortIds ?? [],
    );
    for (const edge of getNodeInputEdges(node, flow)) {
      if (edge.targetPort === exceptPortName) continue;
      if (hiddenPorts.has(edge.targetPort)) continue;
      includeNodeOutput(edge.sourceNodeId);
    }
  };

  const includeImplicitPrefixThrough = (targetIndex: number) => {
    for (let index = 0; index <= targetIndex; index += 1) {
      const node = nodes[index];
      if (!node || node.type === NodeType.SCENE || node.type === NodeType.OUTPUT) continue;

      const explicitPipeSourceNodeId = getNodeInputSourceForPort(node, flow, 'pipe');
      if (explicitPipeSourceNodeId) {
        includeNodeOutput(explicitPipeSourceNodeId);
      }

      includeExplicitInputDependencies(node, 'pipe');
      addNode(node);
    }
  };

  function includeNodeOutput(nodeId: string) {
    const node = nodesById.get(nodeId);
    if (!node || includedIds.has(node.id) || visitingIds.has(node.id)) return;

    const nodeIndex = indexById.get(node.id);
    if (nodeIndex === undefined) return;

    visitingIds.add(node.id);
    const explicitPipeSourceNodeId = getNodeInputSourceForPort(node, flow, 'pipe');

    if (explicitPipeSourceNodeId) {
      includeNodeOutput(explicitPipeSourceNodeId);
      includeExplicitInputDependencies(node, 'pipe');
      addNode(node);
    } else if (
      !usesCanonicalFlow &&
      usesImplicitPipelineInput(node.type) &&
      !isDetachedFromPipe(node)
    ) {
      includeImplicitPrefixThrough(nodeIndex);
    } else {
      includeExplicitInputDependencies(node);
      addNode(node);
    }

    visitingIds.delete(node.id);
  }

  const targetNode = nodesById.get(targetNodeId);
  if (!targetNode) return nodes;

  const explicitPipeSourceNodeId = getNodeInputSourceForPort(targetNode, flow, 'pipe');
  if (explicitPipeSourceNodeId) {
    includeNodeOutput(explicitPipeSourceNodeId);
    includeExplicitInputDependencies(targetNode, 'pipe');
    addNode(targetNode, { forceVisible: isDetachedFromPipe(targetNode) });
  } else {
    const targetIndex = indexById.get(targetNode.id);
    if (targetIndex === undefined) return nodes;
    if (isDetachedFromPipe(targetNode)) {
      includeExplicitInputDependencies(targetNode);
      addNode(targetNode, { forceVisible: true });
    } else if (!usesCanonicalFlow && usesImplicitPipelineInput(targetNode.type)) {
      includeImplicitPrefixThrough(targetIndex);
    } else {
      includeExplicitInputDependencies(targetNode);
      addNode(targetNode);
    }
  }

  return resolveRenderFormatNodes([...sceneNodes, ...orderedNodes]);
};

const resolveViewerRenderTargetNodeId = (viewerNodeId: string): string | null => {
  if (viewerNodeId === OUTPUT_NODE_ID) return null;
  return viewerNodeId;
};

export const getNodeInputRenderNodes = (
  nodes: AnyNode[],
  targetNodeId: string,
  portName: string,
  flow: Flow | null = null,
): AnyNode[] => {
  const targetNode = nodes.find((node) => node.id === targetNodeId);
  if (!targetNode) {
    return nodes.filter((node) => node.type === NodeType.SCENE);
  }

  const sourceNodeId = getNodeInputSourceForPort(targetNode, flow, portName);
  if (!sourceNodeId) {
    return resolveRenderFormatNodes(nodes.filter((node) => node.type === NodeType.SCENE));
  }

  const sourceIndex = nodes.findIndex((node) => node.id === sourceNodeId);
  const sourceNode = sourceIndex >= 0 ? nodes[sourceIndex] : null;
  if (sourceNode && isSourceNodeType(sourceNode.type)) {
    const sceneNodes = nodes.slice(0, sourceIndex).filter((node) => node.type === NodeType.SCENE);
    const renderSourceNode = isDetachedFromPipe(sourceNode)
      ? withoutDetachedFromPipe(sourceNode)
      : sourceNode;
    return resolveRenderFormatNodes([...sceneNodes, renderSourceNode]);
  }

  return resolveRenderBranchNodes(nodes, flow, sourceNodeId);
};

export const getViewerRenderNodes = (
  nodes: AnyNode[],
  viewerNodeId: string | null | undefined,
  flow: Flow | null = null,
): AnyNode[] => {
  if (!viewerNodeId) return nodes;

  const renderTargetNodeId = resolveViewerRenderTargetNodeId(viewerNodeId);
  if (!renderTargetNodeId) return nodes;

  const viewerIndex = nodes.findIndex((node) => node.id === renderTargetNodeId);
  if (viewerIndex < 0) return nodes;

  const viewerNode = nodes[viewerIndex];
  if (isSourceNodeType(viewerNode.type)) {
    // Source nodes like Comfy can have explicit input ports connected to
    // upstream image sources (workflow input images). When these exist,
    // use resolveRenderBranchNodes to include them as backdrop so the
    // inputs are visible behind the node's own output in the viewport.
    const explicitInputs = getNodeInputEdges(viewerNode, flow).filter(
      (edge) => edge.targetPort !== 'pipe',
    );
    if (explicitInputs.length > 0) {
      return resolveRenderBranchNodes(nodes, flow, renderTargetNodeId);
    }

    const sceneNodes = nodes.slice(0, viewerIndex).filter((node) => node.type === NodeType.SCENE);
    const renderViewerNode = (viewerNode as { detachedFromPipe?: boolean }).detachedFromPipe
      ? withoutDetachedFromPipe(viewerNode)
      : viewerNode;
    return resolveRenderFormatNodes([...sceneNodes, renderViewerNode]);
  }

  return resolveRenderBranchNodes(nodes, flow, renderTargetNodeId);
};

/** Resolves a Scene 3D node itself, rather than its backdrop-only editor branch. */
export const getScene3DProjectionRenderNodes = (
  nodes: AnyNode[],
  scene3DNodeId: string,
  flow: Flow | null = null,
): AnyNode[] => getViewerRenderNodes(nodes, scene3DNodeId, flow);

export const getOutputRenderNodes = (nodes: AnyNode[], flow: Flow | null): AnyNode[] => {
  const outputEdge = getOutputPipeEdge(flow);
  if (!outputEdge) {
    return resolveRenderFormatNodes(
      isFlowOutputDetached(flow) ? nodes.filter((node) => node.type === NodeType.SCENE) : nodes,
    );
  }

  const sourceIndex = nodes.findIndex((node) => node.id === outputEdge.sourceNodeId);
  if (sourceIndex < 0) return nodes;

  return resolveRenderBranchNodes(nodes, flow, outputEdge.sourceNodeId);
};

export const getViewportRenderNodes = (
  nodes: AnyNode[],
  viewerNodeId: string | null | undefined,
  flow: Flow | null,
): AnyNode[] => {
  if (!viewerNodeId || viewerNodeId === OUTPUT_NODE_ID) {
    return getOutputRenderNodes(nodes, flow);
  }

  return getViewerRenderNodes(nodes, viewerNodeId, flow);
};

export const getViewerTargetLabel = (
  viewerNodeId: string | null | undefined,
  nodes: AnyNode[],
): string => {
  if (!viewerNodeId || viewerNodeId === OUTPUT_NODE_ID) {
    return 'Output';
  }

  const node = nodes.find((entry) => entry.id === viewerNodeId);
  if (node) {
    return node.name;
  }

  return 'Missing Node';
};

export const getViewerSlotsForNode = (
  viewerSlots: ViewerSlotAssignments | undefined,
  nodeId: string,
): ViewerSlot[] => {
  if (!viewerSlots) return [];
  return VIEWER_SLOT_ORDER.filter((slot) => viewerSlots[slot] === nodeId);
};

export const assignViewerSlotToNode = (
  viewerSlots: ViewerSlotAssignments | undefined,
  slot: ViewerSlot,
  nodeId: string,
): ViewerSlotAssignments => {
  const nextSlots: ViewerSlotAssignments = { ...viewerSlots };

  for (const existingSlot of VIEWER_SLOT_ORDER) {
    if (existingSlot !== slot && nextSlots[existingSlot] === nodeId) {
      delete nextSlots[existingSlot];
    }
  }

  nextSlots[slot] = nodeId;
  return nextSlots;
};

export const sanitizeViewerSlots = (
  viewerSlots: ViewerSlotAssignments | undefined,
  nodes: AnyNode[],
): ViewerSlotAssignments => {
  const validTargetIds = getValidViewerTargetIds(nodes);
  const nextSlots: ViewerSlotAssignments = {};
  const assignedNodeIds = new Set<string>();

  for (const slot of VIEWER_SLOT_ORDER) {
    const nodeId = viewerSlots?.[slot];
    if (!nodeId || !validTargetIds.has(nodeId) || assignedNodeIds.has(nodeId)) {
      continue;
    }

    nextSlots[slot] = nodeId;
    assignedNodeIds.add(nodeId);
  }

  return nextSlots;
};

export const sanitizeViewerNodeId = (
  viewerNodeId: string | null | undefined,
  nodes: AnyNode[],
): string | null => {
  if (!viewerNodeId) return null;
  const validTargetIds = getValidViewerTargetIds(nodes);
  return validTargetIds.has(viewerNodeId) ? viewerNodeId : null;
};

export const sanitizeActiveViewerSlot = (
  activeViewerSlot: ViewerSlot | null | undefined,
  viewerSlots: ViewerSlotAssignments,
  viewerNodeId: string | null,
): ViewerSlot | null => {
  if (!activeViewerSlot) return null;
  if (!viewerNodeId) return null;
  return viewerSlots[activeViewerSlot] === viewerNodeId ? activeViewerSlot : null;
};
