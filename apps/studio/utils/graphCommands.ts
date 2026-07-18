import {
  AnyNode,
  BlendMode,
  EditorTab,
  Flow,
  FlowEdge,
  FlowId,
  FlowStack,
  GroupNode,
  ImageFitMode,
  ImageSequenceNode,
  type ImageSequencePlate,
  ImageTransform,
  InputNode,
  MediaSourceNode,
  NodeKind,
  NodePositions,
  NodeType,
  SceneNode,
  ViewerSlot,
  ViewerSlotAssignments,
  validateRootFlow,
} from '@blackboard/types';
import {
  ColorManagementDefaults,
  createProjectDefaultMediaColorManagement,
  createUnassignedMediaColorManagement,
  getMediaSourceColorSpace,
} from '@/color-management';
import { nodeRegistry } from '@/nodes/registry';
import { getDefaultViewportTool, getInputPorts, nodeFlags } from '@/nodes/helpers';
import { getNodeCount } from '@/state/editor/selectors';
import { canConnectNodeProcessingDomains } from '@/utils/nodeProcessingDomains';
import {
  buildFlowFromNodes,
  createOutputNode,
  getFlowEdgeId,
  getNodePositionsForFlow,
  getOrderedNodesFromFlow,
  getRootFlow,
  getSelectedNodeIdsForGrouping,
  isInputNode,
  isOutputNode,
  isSceneNode,
  OUTPUT_NODE_ID,
  replaceFlowNodeInput,
  replaceFlowNodes,
  setNodePositionsForFlow,
} from '@/state/editor/flowModel';
import { isSourceNodeType, usesPipelineInput } from '@/utils/nodePredicates';
import {
  getSingleOutgoingEdge,
  getOutputInputEdge,
  isNodeConnectedToOutput,
  PIPE_INPUT_PORT,
} from '@/utils/flowTopology';
import { buildNodeStacks, getStackedGroupEndIndex } from '@/utils/nodeStacks';
import { cleanDanglingNodeInputs, wouldCreateCycle } from '@/utils/connectionGraph';
import {
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';
import { placeNewMergeSourceBranch } from '@/utils/autoLayoutGraph';
import {
  NODE_CLIPBOARD_KIND,
  NODE_CLIPBOARD_VERSION,
  type NodeClipboardPayload,
} from '@/utils/nodeClipboard';
import { createUniqueItemNameAssigner } from '@/utils/uniqueItemName';
import { deepClone } from '@/utils/deepClone';
// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface DocumentPatch {
  nodes?: AnyNode[];
  flows?: Record<FlowId, Flow>;
  viewerSlots?: ViewerSlotAssignments;
  viewerNodeId?: string | null;
  activeViewerSlot?: ViewerSlot | null;
}

interface SelectionPatch {
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  activeTab?: EditorTab;
  activeViewportTool?: string;
}

interface LayoutPatch {
  nodePositionsByFlow?: Record<FlowId, NodePositions>;
}

export interface GraphCommandResult {
  documentPatch: DocumentPatch;
  selectionPatch: SelectionPatch;
  layoutPatch: LayoutPatch;
  historyLabel: string;
}

interface GraphCommandState {
  nodes: AnyNode[];
  flows: Record<FlowId, Flow>;
  activeFlowId: FlowId | null;
  rootFlowId: FlowId | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  nodePositionsByFlow: Record<FlowId, NodePositions>;
  viewerSlots: ViewerSlotAssignments;
  viewerNodeId: string | null;
  activeViewerSlot: ViewerSlot | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CHANNEL_PORTS = ['r', 'g', 'b', 'a'] as const;

/** Find the scene node using registry flags instead of hardcoded NodeType check. */
export const findSceneNode = (nodes: AnyNode[]): SceneNode | undefined =>
  nodes.find((n) => nodeFlags(n.type).isSceneLike) as SceneNode | undefined;

const getSceneFormat = (nodes: AnyNode[]): { width: number; height: number } | null => {
  const sceneNode = nodes.find((node) => nodeFlags(node.type).isSceneLike) as
    | (AnyNode & { width?: unknown; height?: unknown })
    | undefined;
  if (typeof sceneNode?.width !== 'number' || typeof sceneNode.height !== 'number') {
    return null;
  }
  if (!Number.isFinite(sceneNode.width) || !Number.isFinite(sceneNode.height)) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(sceneNode.width)),
    height: Math.max(1, Math.round(sceneNode.height)),
  };
};

const getInitialNodeData = (
  nodeType: NodeType,
  currentNodes: AnyNode[],
  initialProps: Record<string, unknown>,
): Record<string, unknown> => {
  if (nodeType !== NodeType.REFORMAT) return initialProps;
  const sceneFormat = getSceneFormat(currentNodes);
  if (!sceneFormat) return initialProps;
  return {
    ...initialProps,
    width: sceneFormat.width,
    height: sceneFormat.height,
  };
};

function assignNodeInput(
  node: AnyNode,
  portName: string,
  sourceNodeId: string,
  sourcePortName = 'output',
): AnyNode {
  const inputs = { ...(node.inputs ?? {}), [portName]: sourceNodeId };
  const inputSourcePorts = { ...(node.inputSourcePorts ?? {}) };
  if (sourcePortName === 'output') {
    delete inputSourcePorts[portName];
  } else {
    inputSourcePorts[portName] = sourcePortName;
  }
  return {
    ...node,
    inputs,
    inputSourcePorts: Object.keys(inputSourcePorts).length > 0 ? inputSourcePorts : undefined,
  } as AnyNode;
}

function getDownstreamPipeTarget(
  flow: Flow | null,
  nodeId: string,
): Pick<FlowEdge, 'sourceNodeId' | 'sourcePort' | 'targetNodeId' | 'targetPort'> | null {
  return getSingleOutgoingEdge(flow, nodeId, PIPE_INPUT_PORT);
}

/**
 * Replace the output node's primary input with a real graph edge.
 */
function connectOutputPipe(
  flows: Record<FlowId, Flow>,
  flowId: FlowId,
  newNodeId: string,
): Record<FlowId, Flow> {
  return replaceFlowNodeInput(flows, flowId, OUTPUT_NODE_ID, PIPE_INPUT_PORT, newNodeId) ?? flows;
}

/**
 * Rebuild a flow from the given nodes, optionally redirecting the output
 * pipe to a new node, and sync the nodes array back from the rebuilt flow
 * for consistency.  Returns the next flows and the synced node list.
 */
function rebuildFlow(
  flows: Record<FlowId, Flow>,
  flowId: FlowId,
  nodes: AnyNode[],
  connectToOutput?: string,
): { flows: Record<FlowId, Flow>; nodes: AnyNode[] } {
  let nextFlows = replaceFlowNodes(flows, flowId, nodes);

  if (connectToOutput) {
    nextFlows = connectOutputPipe(nextFlows, flowId, connectToOutput);
  }

  const rebuiltFlow = nextFlows[flowId];
  return {
    flows: nextFlows,
    nodes: rebuiltFlow ? getOrderedNodesFromFlow(rebuiltFlow) : nodes,
  };
}

const getPrimaryAutoInputPortName = (node: AnyNode): string | null => {
  if (usesPipelineInput(node.type)) return PIPE_INPUT_PORT;

  const ports = getInputPorts(node).filter(
    (port) => port.type === 'texture' || port.type === 'mask',
  );
  if (ports.length > 0) {
    const preferredPortNames = ['pipe', 'source', 'image', 'backdrop', 'input'];
    for (const portName of preferredPortNames) {
      if (ports.some((port) => port.name === portName)) return portName;
    }
    return (ports.find((port) => port.required) ?? ports[0]).name;
  }

  // Fallback for source-type nodes with dynamic port declarations that may
  // return empty at creation time (e.g. Comfy node with no workflow loaded).
  // This is checked by ensuring inputPorts is a function — static arrays or
  // undefined inputPorts (e.g. Media Source) won't trigger the fallback.
  const nodeDef = nodeRegistry.get(node.type);
  if (nodeDef && typeof nodeDef.inputPorts === 'function' && isSourceNodeType(node.type)) {
    return 'image';
  }

  return null;
};

const canUseNodeAsAutoSource = (node: AnyNode): boolean =>
  !isSceneNode(node) && !isInputNode(node) && !isOutputNode(node);

const getAutoConnectionSource = (
  state: GraphCommandState,
): {
  sourceNodeId: string;
  sourcePortName: string;
  downstreamEdge: Pick<
    FlowEdge,
    'sourceNodeId' | 'sourcePort' | 'targetNodeId' | 'targetPort'
  > | null;
} | null => {
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const activeFlow = getRootFlow(state.flows, flowId);
  const outputPipeEdge = getOutputInputEdge(activeFlow);

  if (state.selectedNodeId === OUTPUT_NODE_ID) {
    if (outputPipeEdge) {
      return {
        sourceNodeId: outputPipeEdge.sourceNodeId,
        sourcePortName: outputPipeEdge.sourcePort,
        downstreamEdge: outputPipeEdge,
      };
    }

    return null;
  }

  const selectedNode = state.selectedNodeId
    ? state.nodes.find((node) => node.id === state.selectedNodeId)
    : null;
  if (!selectedNode || !canUseNodeAsAutoSource(selectedNode)) return null;

  return {
    sourceNodeId: selectedNode.id,
    sourcePortName: 'output',
    downstreamEdge: getDownstreamPipeTarget(activeFlow, selectedNode.id),
  };
};

// ---------------------------------------------------------------------------
// createNodeCommand  —  creates a node and returns its insertion context
// ---------------------------------------------------------------------------

interface CreateNodeResult {
  finalNewNode: AnyNode;
  newNodes: AnyNode[];
  name: string;
}

/**
 * Creates a node entity with registry-backed initial props, name counting, and
 * insertion position.  Returns pure data — does not touch state.
 */
export function createNodeCommand(
  state: { nodes: AnyNode[]; selectedNodeId: string | null },
  nodeType: NodeType,
  props: Record<string, unknown> = {},
  options?: { name?: string },
): CreateNodeResult | null {
  const definition = nodeRegistry.get(nodeType);
  if (!definition) return null;

  const { nodes: currentNodes, selectedNodeId } = state;
  let name = options?.name ?? definition.name;
  const existingCount = getNodeCount(currentNodes, nodeType);
  if (!options?.name && existingCount > 0) name = `${definition.name} ${existingCount + 1}`;

  const nodeData = getInitialNodeData(
    nodeType,
    currentNodes,
    definition.getInitialNodeProps?.() ?? definition.getInitialNodeProps(),
  );

  const newNodeBase = {
    ...nodeData,
    ...props,
    id: `${nodeType}_${Date.now()}`,
    type: nodeType,
    name,
    enabled: true,
  };

  const selectedIndex = selectedNodeId
    ? currentNodes.findIndex((node) => node.id === selectedNodeId)
    : -1;
  const selectedNode = selectedIndex !== -1 ? currentNodes[selectedIndex] : null;
  const finalNewNode = newNodeBase as AnyNode;
  const newNodes = [...currentNodes];

  if (!selectedNode || nodeFlags(selectedNode.type).isSceneLike) {
    newNodes.push(finalNewNode);
  } else {
    const insertIndex = getStackedGroupEndIndex(currentNodes, selectedIndex);
    newNodes.splice(insertIndex + 1, 0, finalNewNode);
  }

  return { finalNewNode, newNodes, name };
}

// ---------------------------------------------------------------------------
// Node factory helpers — create fully-formed node instances for common types
// ---------------------------------------------------------------------------

/** Create a Scene node with the given format dimensions. */
export const createSceneNode = (opts: {
  width: number;
  height: number;
  startFrame?: number;
  maxFrames?: number;
  fps?: number;
}): SceneNode => ({
  id: `scene_${Date.now()}`,
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: opts.width,
  height: opts.height,
  bitDepth: 16,
  colorSpace: ColorManagementDefaults.WORKING_SPACE,
  startFrame: opts.startFrame ?? 0,
  maxFrames: opts.maxFrames ?? 0,
  fps: opts.fps ?? 30,
});

/** Create a Media Source node with the given asset and metadata. */
export const createMediaSourceNode = (opts: {
  name: string;
  src: string;
  sourceFileName?: string;
  mediaKind: 'image' | 'video';
  width: number;
  height: number;
  colorSpace?: MediaSourceNode['colorSpace'];
  mediaColorManagement?: MediaSourceNode['mediaColorManagement'];
  videoColorMetadata?: MediaSourceNode['videoColorMetadata'];
  duration?: number;
  frameCount?: number;
  startFrame?: number;
  transform?: ImageTransform;
}): MediaSourceNode => {
  const mediaColorManagement =
    opts.mediaColorManagement ??
    (opts.colorSpace
      ? createProjectDefaultMediaColorManagement(opts.colorSpace)
      : opts.mediaKind === 'video'
        ? createUnassignedMediaColorManagement()
        : createProjectDefaultMediaColorManagement());
  const sourceColorSpace = getMediaSourceColorSpace(mediaColorManagement);

  return {
    id: `media_${Date.now()}`,
    type: NodeType.MEDIA_SOURCE,
    name: opts.name,
    enabled: true,
    src: opts.src,
    sourceFileName: opts.sourceFileName,
    mediaKind: opts.mediaKind,
    width: opts.width,
    height: opts.height,
    opacity: 100,
    operator: BlendMode.OVER,
    ...(sourceColorSpace ? { colorSpace: sourceColorSpace } : {}),
    mediaColorManagement,
    ...(opts.mediaKind === 'video'
      ? {
          duration: opts.duration ?? 0,
          frameCount: opts.frameCount ?? Math.max(1, Math.ceil((opts.duration ?? 0) * 30)),
          startFrame: opts.startFrame ?? 0,
          beforeRangeBehavior: 'black',
          afterRangeBehavior: 'black',
          ...(opts.videoColorMetadata ? { videoColorMetadata: opts.videoColorMetadata } : {}),
        }
      : {}),
    transform: opts.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
  };
};

/** Create an Image Sequence node with the given frame assets and metadata. */
export const createSequenceNode = (opts: {
  name: string;
  frames: string[];
  plates?: ImageSequencePlate[];
  activePlateId?: string;
  sourceFileName?: string;
  width: number;
  height: number;
  colorSpace?: ImageSequenceNode['colorSpace'];
  mediaColorManagement?: ImageSequenceNode['mediaColorManagement'];
  startFrame?: number;
  scaleX?: number;
  scaleY?: number;
}): ImageSequenceNode => {
  const mediaColorManagement =
    opts.mediaColorManagement ??
    createProjectDefaultMediaColorManagement(
      opts.colorSpace ?? ColorManagementDefaults.TEXTURE_SPACE,
    );
  const sourceColorSpace =
    getMediaSourceColorSpace(mediaColorManagement) ?? ColorManagementDefaults.TEXTURE_SPACE;

  return {
    id: `seq_${Date.now()}`,
    type: NodeType.IMAGE_SEQUENCE,
    name: opts.name,
    enabled: true,
    frames: opts.frames,
    ...(opts.plates ? { plates: opts.plates } : {}),
    ...(opts.activePlateId ? { activePlateId: opts.activePlateId } : {}),
    sourceFileName: opts.sourceFileName,
    width: opts.width,
    height: opts.height,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: {
      x: 0,
      y: 0,
      scaleX: opts.scaleX ?? 1,
      scaleY: opts.scaleY ?? 1,
      fitMode: ImageFitMode.FIT,
    },
    colorSpace: sourceColorSpace,
    mediaColorManagement,
    fps: 30,
    startFrame: opts.startFrame ?? 0,
    beforeRangeBehavior: 'black',
    afterRangeBehavior: 'black',
  };
};

// ---------------------------------------------------------------------------
// createDetachedNode  —  creates a node without inserting it into the list
// ---------------------------------------------------------------------------

interface DetachedNodeResult {
  node: AnyNode;
  name: string;
}

function createDetachedNodeCommand(
  state: { nodes: AnyNode[] },
  nodeType: NodeType,
  props: Record<string, unknown> = {},
  options?: { name?: string },
): DetachedNodeResult | null {
  const definition = nodeRegistry.get(nodeType);
  if (!definition) return null;

  const { nodes: existingNodes } = state;
  let name = options?.name ?? definition.name;
  const existingCount = getNodeCount(existingNodes, nodeType);
  if (!options?.name && existingCount > 0) name = `${definition.name} ${existingCount + 1}`;

  const nodeData = getInitialNodeData(
    nodeType,
    existingNodes,
    definition.getInitialNodeProps?.() ?? definition.getInitialNodeProps(),
  );

  return {
    name,
    node: {
      ...nodeData,
      ...props,
      id: `${nodeType}_${Date.now()}`,
      type: nodeType,
      name,
      enabled: true,
    } as AnyNode,
  };
}

// ---------------------------------------------------------------------------
// insertNodeCommand  —  commits a node addition with graph-aware auto-wiring
// ---------------------------------------------------------------------------

const createAutoConnectedInsertCommand = (
  state: GraphCommandState,
  finalNewNode: AnyNode,
  newNodes: AnyNode[],
  name: string,
): GraphCommandResult | null => {
  const targetPortName = getPrimaryAutoInputPortName(finalNewNode);
  const source = getAutoConnectionSource(state);
  if (!targetPortName || !source || source.sourceNodeId === finalNewNode.id) return null;

  const shouldReconnectDownstream = !!source.downstreamEdge;

  let nextNodes = newNodes.map((node) => {
    if (node.id === finalNewNode.id) {
      return assignNodeInput(node, targetPortName, source.sourceNodeId, source.sourcePortName);
    }

    if (
      shouldReconnectDownstream &&
      source.downstreamEdge?.targetNodeId !== OUTPUT_NODE_ID &&
      node.id === source.downstreamEdge?.targetNodeId
    ) {
      return assignNodeInput(node, source.downstreamEdge.targetPort, finalNewNode.id);
    }

    return node;
  });

  const flowId = state.activeFlowId ?? state.rootFlowId;
  let nextFlows: Record<FlowId, Flow> | undefined;
  if (flowId) {
    const connectToOutput =
      shouldReconnectDownstream && source.downstreamEdge?.targetNodeId === OUTPUT_NODE_ID
        ? finalNewNode.id
        : undefined;
    const result = rebuildFlow(state.flows, flowId, nextNodes, connectToOutput);
    nextFlows = result.flows;
    nextNodes = result.nodes;
  }

  return {
    documentPatch: {
      nodes: nextNodes,
      ...(nextFlows ? { flows: nextFlows } : {}),
    },
    selectionPatch: {
      selectedNodeId: finalNewNode.id,
      selectedNodeIds: [finalNewNode.id],
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(finalNewNode.type),
    },
    layoutPatch: {},
    historyLabel: `Add ${name} Node`,
  };
};

export function insertNodeCommand(
  state: GraphCommandState,
  finalNewNode: AnyNode,
  newNodes: AnyNode[],
  name: string,
): GraphCommandResult {
  const autoConnectedResult = createAutoConnectedInsertCommand(state, finalNewNode, newNodes, name);
  if (autoConnectedResult) return autoConnectedResult;

  const sourceMergeResult = insertSourceWithMergeCommand(state, finalNewNode, newNodes, name);
  if (sourceMergeResult) return sourceMergeResult;

  return {
    documentPatch: { nodes: newNodes },
    selectionPatch: {
      selectedNodeId: finalNewNode.id,
      selectedNodeIds: [finalNewNode.id],
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(finalNewNode.type),
    },
    layoutPatch: {},
    historyLabel: `Add ${name} Node`,
  };
}

// ---------------------------------------------------------------------------
// insertSourceWithMergeCommand  —  inserts a source node, auto-creating a
//   merge node when a compatible source is already selected
// ---------------------------------------------------------------------------

export function insertSourceWithMergeCommand(
  state: GraphCommandState,
  newNode: AnyNode,
  newNodes: AnyNode[],
  name: string,
): GraphCommandResult | null {
  const nodeType = newNode.type;
  if (!isSourceNodeType(nodeType)) return null;

  const selectedNode = state.selectedNodeId
    ? state.nodes.find((node) => node.id === state.selectedNodeId)
    : null;
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const activeFlow = getRootFlow(state.flows, flowId);

  const shouldCreateMerge =
    !!selectedNode &&
    isNodeConnectedToOutput(activeFlow, selectedNode.id) &&
    state.nodes.some(
      (node) => isSourceNodeType(node.type) && isNodeConnectedToOutput(activeFlow, node.id),
    ) &&
    (nodeFlags(selectedNode.type).isSource ||
      usesPipelineInput(selectedNode.type) ||
      !!selectedNode.inputs?.pipe);

  if (!shouldCreateMerge) {
    const shouldConnectFirstSource = !!flowId && !!activeFlow && !getOutputInputEdge(activeFlow);
    const rebuilt = shouldConnectFirstSource
      ? rebuildFlow(state.flows, flowId, newNodes, newNode.id)
      : null;
    return {
      documentPatch: rebuilt ? { nodes: rebuilt.nodes, flows: rebuilt.flows } : { nodes: newNodes },
      selectionPatch: {
        selectedNodeId: newNode.id,
        selectedNodeIds: [newNode.id],
        activeTab: EditorTab.Flow,
        activeViewportTool: getDefaultViewportTool(newNode.type),
      },
      layoutPatch: {},
      historyLabel: `Add ${name} Node`,
    };
  }

  // Build merge node — the selected node's output feeds into the merge's pipe
  // input, same behavior regardless of whether the selected node is a source
  // or a non-source pipeline node.
  const mergeNode = {
    id: `merge_${Date.now()}`,
    type: NodeType.MERGE,
    name: 'Merge',
    enabled: true,
    opacity: 100,
    operator: BlendMode.OVER,
    inputs: { source: newNode.id, pipe: selectedNode.id },
  } as AnyNode;

  const insertAt = newNodes.indexOf(newNode);
  const nodesWithMerge = [...newNodes];
  nodesWithMerge.splice(insertAt + 1, 0, mergeNode);
  let nextNodes = nodesWithMerge;

  // Patch flows: merge output replaces the selected node's position in the
  // downstream pipeline. The selected node's own output feeds into merge.pipe.
  let nextFlows: Record<FlowId, Flow> | undefined;
  if (flowId) {
    const downstreamTarget = getDownstreamPipeTarget(activeFlow, selectedNode.id);

    if (downstreamTarget && downstreamTarget.targetNodeId !== OUTPUT_NODE_ID) {
      // Connect merge output to the downstream non-output node
      const finalNodes = nextNodes.map((node) => {
        if (node.id === downstreamTarget.targetNodeId) {
          return assignNodeInput(node, downstreamTarget.targetPort, mergeNode.id);
        }
        return node;
      });
      const { flows, nodes: syncedNodes } = rebuildFlow(state.flows, flowId, finalNodes);
      nextFlows = flows;
      nextNodes = syncedNodes;
    } else if (downstreamTarget) {
      // Selected node was connected to output — redirect to merge
      const { flows, nodes: syncedNodes } = rebuildFlow(
        state.flows,
        flowId,
        nextNodes,
        mergeNode.id,
      );
      nextFlows = flows;
      nextNodes = syncedNodes;
    } else {
      // Selected node had no downstream connection — merge stays floating too
      const { flows } = rebuildFlow(state.flows, flowId, nextNodes);
      nextFlows = flows;
    }
  }

  // Layout: position the new source+merge branch
  const currentPositions = getNodePositionsForFlow(state.nodePositionsByFlow, flowId);
  const nextPositions = placeNewMergeSourceBranch(
    currentPositions,
    selectedNode.id,
    newNode.id,
    mergeNode.id,
    buildNodeStacks(nextNodes),
  );
  const nextNodePositionsByFlow =
    nextPositions === currentPositions
      ? state.nodePositionsByFlow
      : setNodePositionsForFlow(state.nodePositionsByFlow, flowId, nextPositions);

  return {
    documentPatch: {
      nodes: nextNodes,
      ...(nextFlows ? { flows: nextFlows } : {}),
    },
    selectionPatch: {
      selectedNodeId: newNode.id,
      selectedNodeIds: [newNode.id],
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(newNode.type),
    },
    layoutPatch: {
      nodePositionsByFlow: nextNodePositionsByFlow,
    },
    historyLabel: `Add Merge ${name}`,
  };
}

// ---------------------------------------------------------------------------
// extractMergeChannelsCommand  —  creates an Extract/Merge Channels pair
// ---------------------------------------------------------------------------

export function extractMergeChannelsCommand(state: GraphCommandState): GraphCommandResult | null {
  const { nodes } = state;
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const connection = getAutoConnectionSource(state);
  if (!connection) return null;

  const { sourceNodeId, sourcePortName, downstreamEdge } = connection;
  const sourceIndex = nodes.findIndex((node) => node.id === sourceNodeId);
  if (sourceIndex === -1) return null;

  const extract = createDetachedNodeCommand({ nodes }, NodeType.EXTRACT_CHANNELS);
  if (!extract) return null;
  const merge = createDetachedNodeCommand(
    { nodes: [...nodes, extract.node] },
    NodeType.MERGE_CHANNELS,
  );
  if (!merge) return null;

  const extractNode = assignNodeInput(extract.node, 'source', sourceNodeId, sourcePortName);
  let mergeNode = merge.node;
  for (const portName of CHANNEL_PORTS) {
    mergeNode = assignNodeInput(mergeNode, portName, extractNode.id, portName);
  }

  const newNodes = [...nodes];
  newNodes.splice(sourceIndex + 1, 0, extractNode, mergeNode);

  if (downstreamEdge && downstreamEdge.targetNodeId !== OUTPUT_NODE_ID) {
    const targetIndex = newNodes.findIndex((node) => node.id === downstreamEdge.targetNodeId);
    if (targetIndex !== -1) {
      newNodes[targetIndex] = assignNodeInput(
        newNodes[targetIndex],
        downstreamEdge.targetPort,
        mergeNode.id,
      );
    }
  }

  // Rebuild flows
  let nextFlows: Record<FlowId, Flow> | undefined;
  let syncedNodes = newNodes;
  if (flowId) {
    const rebuilt = rebuildFlow(
      state.flows,
      flowId,
      newNodes,
      downstreamEdge?.targetNodeId === OUTPUT_NODE_ID ? mergeNode.id : undefined,
    );
    nextFlows = rebuilt.flows;
    syncedNodes = rebuilt.nodes;
  }

  return {
    documentPatch: {
      nodes: syncedNodes,
      ...(nextFlows ? { flows: nextFlows } : {}),
    },
    selectionPatch: {
      selectedNodeId: mergeNode.id,
      selectedNodeIds: [mergeNode.id],
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(mergeNode.type),
    },
    layoutPatch: {},
    historyLabel: 'Add Extract/Merge Channels Nodes',
  };
}

// ---------------------------------------------------------------------------
// connectNodeCommand  —  connects a node input in the persisted flow graph
// ---------------------------------------------------------------------------

export function connectNodeCommand(
  state: GraphCommandState,
  nodeId: string,
  portName: string,
  sourceNodeId: string,
  sourcePortName = 'output',
): GraphCommandResult | null {
  const flowId = state.activeFlowId ?? state.rootFlowId;

  // Validation
  if (nodeId === sourceNodeId) return null;
  if (!state.nodes.find((l) => l.id === sourceNodeId)) return null;
  if (
    nodeId !== OUTPUT_NODE_ID &&
    !canConnectNodeProcessingDomains({
      nodes: state.nodes,
      sourceNodeId,
      sourcePortName,
      targetNodeId: nodeId,
      targetPortName: portName,
    })
  ) {
    return null;
  }

  const nextFlows = replaceFlowNodeInput(
    state.flows,
    flowId,
    nodeId,
    portName,
    sourceNodeId,
    sourcePortName,
  );
  const nextFlow = flowId ? nextFlows?.[flowId] : null;
  if (!nextFlows || !nextFlow) return null;
  if (
    validateRootFlow(nextFlow).some((issue) => issue.code === 'connection_cycle') ||
    wouldCreateCycle(state.nodes, nodeId, sourceNodeId, portName)
  ) {
    return null;
  }

  const node = state.nodes.find((l) => l.id === nodeId);
  if (!node && nodeId !== OUTPUT_NODE_ID) return null;

  // Keep the nodes array in sync with flows: set the connected input
  const nextNodes = state.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const inputs = { ...(n.inputs ?? {}), [portName]: sourceNodeId };
    const inputSourcePorts = { ...(n.inputSourcePorts ?? {}) };
    if (sourcePortName === 'output') {
      delete inputSourcePorts[portName];
    } else {
      inputSourcePorts[portName] = sourcePortName;
    }
    return {
      ...n,
      inputs,
      inputSourcePorts: Object.keys(inputSourcePorts).length > 0 ? inputSourcePorts : undefined,
    } as AnyNode;
  });

  return {
    documentPatch: { flows: nextFlows, nodes: nextNodes },
    selectionPatch: {
      selectedNodeId: state.selectedNodeId,
      selectedNodeIds: state.selectedNodeIds,
    },
    layoutPatch: {},
    historyLabel: `Connect ${portName} input`,
  };
}

// ---------------------------------------------------------------------------
// disconnectNodeCommand  —  disconnects a node input in the persisted graph
// ---------------------------------------------------------------------------

export interface NodeInputTarget {
  nodeId: string;
  portName: string;
}

const getNodeInputTargetKey = ({ nodeId, portName }: NodeInputTarget): string =>
  `${nodeId}\u0000${portName}`;

/** Disconnect several canonical graph inputs as one undoable command. */
export function disconnectNodeInputsCommand(
  state: {
    flows: Record<FlowId, Flow>;
    activeFlowId: FlowId | null;
    rootFlowId: FlowId | null;
    nodes: AnyNode[];
    selectedNodeId?: string | null;
    selectedNodeIds?: string[];
  },
  targets: readonly NodeInputTarget[],
): GraphCommandResult | null {
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const flow = flowId ? state.flows[flowId] : null;
  if (!flowId || !flow || targets.length === 0) return null;

  const requestedKeys = new Set(targets.map(getNodeInputTargetKey));
  const disconnectedEdges = flow.edges.filter((edge) =>
    requestedKeys.has(
      getNodeInputTargetKey({ nodeId: edge.targetNodeId, portName: edge.targetPort }),
    ),
  );
  if (disconnectedEdges.length === 0) return null;

  const disconnectedPortsByNode = new Map<string, Set<string>>();
  for (const edge of disconnectedEdges) {
    const ports = disconnectedPortsByNode.get(edge.targetNodeId) ?? new Set<string>();
    ports.add(edge.targetPort);
    disconnectedPortsByNode.set(edge.targetNodeId, ports);
  }

  const nextFlow: Flow = {
    ...flow,
    edges: flow.edges.filter(
      (edge) =>
        !requestedKeys.has(
          getNodeInputTargetKey({ nodeId: edge.targetNodeId, portName: edge.targetPort }),
        ),
    ),
  };
  const nextFlows = { ...state.flows, [flowId]: nextFlow };
  const nextNodes = state.nodes.map((node) => {
    const disconnectedPorts = disconnectedPortsByNode.get(node.id);
    if (!disconnectedPorts || disconnectedPorts.size === 0) return node;

    const inputs = { ...(node.inputs ?? {}) };
    const inputSourcePorts = { ...(node.inputSourcePorts ?? {}) };
    for (const portName of disconnectedPorts) {
      delete inputs[portName];
      delete inputSourcePorts[portName];
    }

    return {
      ...node,
      inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
      inputSourcePorts: Object.keys(inputSourcePorts).length > 0 ? inputSourcePorts : undefined,
    } as AnyNode;
  });

  const connectionLabel = disconnectedEdges.length === 1 ? 'connection' : 'connections';
  return {
    documentPatch: { flows: nextFlows, nodes: nextNodes },
    selectionPatch: {
      selectedNodeId: state.selectedNodeId ?? null,
      selectedNodeIds: state.selectedNodeIds ?? [],
    },
    layoutPatch: {},
    historyLabel: `Disconnect ${disconnectedEdges.length} ${connectionLabel}`,
  };
}

export function disconnectNodeCommand(
  state: {
    flows: Record<FlowId, Flow>;
    activeFlowId: FlowId | null;
    rootFlowId: FlowId | null;
    nodes: AnyNode[];
    selectedNodeId?: string | null;
    selectedNodeIds?: string[];
  },
  nodeId: string,
  portName: string,
): GraphCommandResult | null {
  const result = disconnectNodeInputsCommand(state, [{ nodeId, portName }]);
  return result ? { ...result, historyLabel: `Disconnect ${portName} input` } : null;
}

// ---------------------------------------------------------------------------
// Node clipboard helpers — serializes selected real graph nodes and pastes
// them into the active flow with fresh ids, nested group flows, and positions.
// ---------------------------------------------------------------------------

export interface PasteNodesOptions {
  position?: { x: number; y: number } | null;
}

const PASTE_OFFSET = { x: 48, y: 48 };
const POSITION_COLLISION_EPSILON = 4;

const sanitizeIdSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '') || 'node';

const createUniqueId = (preferredId: string, usedIds: Set<string>): string => {
  const baseId = `${sanitizeIdSegment(preferredId)}_copy`;
  let candidate = baseId;
  let index = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}_${index++}`;
  }

  usedIds.add(candidate);
  return candidate;
};

const createUniqueFlowId = (preferredId: string, usedFlowIds: Set<string>): string => {
  const baseId = `flow_${sanitizeIdSegment(preferredId)}_copy`;
  let candidate = baseId;
  let index = 2;

  while (usedFlowIds.has(candidate)) {
    candidate = `${baseId}_${index++}`;
  }

  usedFlowIds.add(candidate);
  return candidate;
};

const isCopyableClipboardNode = (node: AnyNode): boolean =>
  !nodeFlags(node.type).isProtected &&
  !isSceneNode(node) &&
  !isInputNode(node) &&
  !isOutputNode(node);

const getSelectedCopyableNodes = (state: GraphCommandState): AnyNode[] => {
  const selectedIds =
    state.selectedNodeIds.length > 0
      ? state.selectedNodeIds
      : state.selectedNodeId
        ? [state.selectedNodeId]
        : [];
  if (selectedIds.length === 0) return [];

  const selectedIdSet = new Set(selectedIds);
  return state.nodes.filter((node) => selectedIdSet.has(node.id) && isCopyableClipboardNode(node));
};

const collectGroupFlows = (
  nodes: Iterable<AnyNode>,
  flows: Record<FlowId, Flow>,
  collectedFlows: Record<FlowId, Flow>,
): void => {
  for (const node of nodes) {
    if (node.type !== NodeType.GROUP) continue;
    const childFlowId = (node as GroupNode).childFlowId;
    if (!childFlowId || collectedFlows[childFlowId]) continue;

    const childFlow = flows[childFlowId];
    if (!childFlow) continue;

    collectedFlows[childFlowId] = deepClone(childFlow);
    collectGroupFlows(childFlow.nodes, flows, collectedFlows);
  }
};

const filterNodePositions = (
  positions: NodePositions,
  nodeIds: Iterable<string>,
): NodePositions => {
  const nodeIdSet = new Set(nodeIds);
  const nextPositions: NodePositions = {};

  for (const [nodeId, position] of Object.entries(positions)) {
    if (nodeIdSet.has(nodeId)) {
      nextPositions[nodeId] = { ...position };
    }
  }

  return nextPositions;
};

export function createNodeClipboardPayload(state: GraphCommandState): NodeClipboardPayload | null {
  const activeFlowId = state.activeFlowId ?? state.rootFlowId;
  const activeFlow = getRootFlow(state.flows, activeFlowId);
  if (!activeFlowId || !activeFlow) return null;

  const selectedNodes = getSelectedCopyableNodes(state);
  if (selectedNodes.length === 0) return null;

  const selectedNodeIds = selectedNodes.map((node) => node.id);
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const nestedFlows: Record<FlowId, Flow> = {};
  collectGroupFlows(selectedNodes, state.flows, nestedFlows);

  const nodePositionsByFlow: Record<FlowId, NodePositions> = {};
  nodePositionsByFlow[activeFlowId] = filterNodePositions(
    getNodePositionsForFlow(state.nodePositionsByFlow, activeFlowId),
    selectedNodeIds,
  );

  for (const [flowId, flow] of Object.entries(nestedFlows)) {
    nodePositionsByFlow[flowId] = filterNodePositions(
      getNodePositionsForFlow(state.nodePositionsByFlow, flowId),
      flow.nodes.map((node) => node.id),
    );
  }

  return {
    kind: NODE_CLIPBOARD_KIND,
    version: NODE_CLIPBOARD_VERSION,
    createdAt: Date.now(),
    nodes: deepClone(selectedNodes),
    edges: activeFlow.edges
      .filter(
        (edge) =>
          selectedNodeIdSet.has(edge.sourceNodeId) && selectedNodeIdSet.has(edge.targetNodeId),
      )
      .map((edge) => ({ ...edge })),
    flows: nestedFlows,
    nodePositionsByFlow,
    sourceFlowId: activeFlowId,
    selectedNodeIds,
  };
}

const getAllExistingNodeIds = (state: GraphCommandState): Set<string> => {
  const usedIds = new Set<string>();

  for (const node of state.nodes) {
    if (!isOutputNode(node)) {
      usedIds.add(node.id);
    }
  }

  for (const flow of Object.values(state.flows)) {
    for (const node of flow.nodes) {
      if (!isOutputNode(node)) {
        usedIds.add(node.id);
      }
    }
  }

  return usedIds;
};

const getClipboardNodeIds = (payload: NodeClipboardPayload): string[] => {
  const nodeIds: string[] = [];
  const seenIds = new Set<string>();
  const pushNodeId = (node: AnyNode) => {
    if (isOutputNode(node) || seenIds.has(node.id)) return;
    seenIds.add(node.id);
    nodeIds.push(node.id);
  };

  payload.nodes.forEach(pushNodeId);
  Object.values(payload.flows).forEach((flow) => flow.nodes.forEach(pushNodeId));
  return nodeIds;
};

const buildNodeIdMap = (payload: NodeClipboardPayload, state: GraphCommandState) => {
  const usedIds = getAllExistingNodeIds(state);
  const nodeIdMap = new Map<string, string>();

  for (const nodeId of getClipboardNodeIds(payload)) {
    nodeIdMap.set(nodeId, createUniqueId(nodeId, usedIds));
  }

  return nodeIdMap;
};

const buildFlowIdMap = (payload: NodeClipboardPayload, state: GraphCommandState) => {
  const usedFlowIds = new Set(Object.keys(state.flows));
  const flowIdMap = new Map<FlowId, FlowId>();

  for (const flowId of Object.keys(payload.flows)) {
    flowIdMap.set(flowId, createUniqueFlowId(flowId, usedFlowIds));
  }

  return flowIdMap;
};

const mapNodeRef = (
  nodeId: string | null | undefined,
  nodeIdMap: Map<string, string>,
): string | null => {
  if (!nodeId) return null;
  return nodeIdMap.get(nodeId) ?? null;
};

const remapNodeInputs = (
  node: AnyNode,
  nodeIdMap: Map<string, string>,
  edges: FlowEdge[] = [],
): {
  inputs?: Record<string, string>;
  inputSourcePorts?: Record<string, string>;
} => {
  const sourceInputs = { ...(node.inputs ?? {}) };
  const sourcePorts = { ...(node.inputSourcePorts ?? {}) };

  for (const edge of edges) {
    if (edge.targetNodeId !== node.id) continue;
    sourceInputs[edge.targetPort] = edge.sourceNodeId;
    if (edge.sourcePort === 'output') {
      delete sourcePorts[edge.targetPort];
    } else {
      sourcePorts[edge.targetPort] = edge.sourcePort;
    }
  }

  const inputs: Record<string, string> = {};
  const inputSourcePorts: Record<string, string> = {};

  for (const [portName, sourceNodeId] of Object.entries(sourceInputs)) {
    const mappedSourceNodeId = nodeIdMap.get(sourceNodeId);
    if (!mappedSourceNodeId) {
      continue;
    }

    inputs[portName] = mappedSourceNodeId;
    const sourcePort = sourcePorts[portName];
    if (sourcePort && sourcePort !== 'output') {
      inputSourcePorts[portName] = sourcePort;
    }
  }

  return {
    inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
    inputSourcePorts: Object.keys(inputSourcePorts).length > 0 ? inputSourcePorts : undefined,
  };
};

const remapGroupNodeFields = (
  node: GroupNode,
  nodeIdMap: Map<string, string>,
  flowIdMap: Map<FlowId, FlowId>,
): Partial<GroupNode> => {
  const externalInputs = (node.externalInputs ?? [])
    .map((input) => {
      const entryNodeId = mapNodeRef(input.entryNodeId, nodeIdMap);
      const targetNodeId = mapNodeRef(input.targetNodeId, nodeIdMap);
      if (!entryNodeId || !targetNodeId) return null;

      return {
        ...input,
        entryNodeId,
        targetNodeId,
      };
    })
    .filter((input): input is NonNullable<GroupNode['externalInputs']>[number] => !!input);
  const exposedFields = (node.exposedFields ?? [])
    .map((field) => {
      const targetNodeId = mapNodeRef(field.targetNodeId, nodeIdMap);
      return targetNodeId ? { ...field, targetNodeId } : null;
    })
    .filter((field): field is NonNullable<GroupNode['exposedFields']>[number] => !!field);
  const inputNodeId = mapNodeRef(node.inputNodeId, nodeIdMap);
  const outputNodeId = mapNodeRef(node.outputNodeId, nodeIdMap);

  return {
    childFlowId: node.childFlowId ? (flowIdMap.get(node.childFlowId) ?? null) : null,
    externalInputs,
    exposedFields,
    ...(inputNodeId ? { inputNodeId } : { inputNodeId: undefined }),
    ...(outputNodeId ? { outputNodeId } : { outputNodeId: undefined }),
  };
};

const remapInputNodeFields = (
  node: InputNode,
  nodeIdMap: Map<string, string>,
): Partial<InputNode> => {
  const groupNodeId = mapNodeRef(node.groupNodeId, nodeIdMap);
  return {
    groupNodeId,
  };
};

const cloneNodeForPaste = ({
  node,
  nodeIdMap,
  flowIdMap,
  nameAssigner,
  edges = [],
}: {
  node: AnyNode;
  nodeIdMap: Map<string, string>;
  flowIdMap: Map<FlowId, FlowId>;
  nameAssigner?: (name: string) => string;
  edges?: FlowEdge[];
}): AnyNode => {
  const mappedId = nodeIdMap.get(node.id) ?? node.id;
  const { inputs, inputSourcePorts } = remapNodeInputs(node, nodeIdMap, edges);
  const baseNode = deepClone({
    ...node,
    id: mappedId,
    ...(nameAssigner ? { name: nameAssigner(node.name) } : {}),
    inputs,
    inputSourcePorts,
  }) as AnyNode;

  const nextNode =
    baseNode.type === NodeType.GROUP
      ? ({
          ...baseNode,
          ...remapGroupNodeFields(baseNode as GroupNode, nodeIdMap, flowIdMap),
        } as AnyNode)
      : baseNode.type === NodeType.INPUT
        ? ({
            ...baseNode,
            ...remapInputNodeFields(baseNode as InputNode, nodeIdMap),
          } as AnyNode)
        : baseNode;

  return nextNode;
};

const mapFlowNodeRef = (
  nodeId: string,
  outputNodeId: string,
  nodeIdMap: Map<string, string>,
): string | null => {
  if (nodeId === outputNodeId) return nodeId;
  return nodeIdMap.get(nodeId) ?? null;
};

const cloneFlowForPaste = (
  flow: Flow,
  nodeIdMap: Map<string, string>,
  flowIdMap: Map<FlowId, FlowId>,
): Flow | null => {
  const flowId = flowIdMap.get(flow.id);
  if (!flowId) return null;

  const nodes = flow.nodes.map((node) =>
    cloneNodeForPaste({
      node,
      nodeIdMap,
      flowIdMap,
    }),
  );
  const edges = flow.edges
    .map((edge) => {
      const sourceNodeId = mapFlowNodeRef(edge.sourceNodeId, flow.outputNodeId, nodeIdMap);
      const targetNodeId = mapFlowNodeRef(edge.targetNodeId, flow.outputNodeId, nodeIdMap);
      if (!sourceNodeId || !targetNodeId) return null;

      return {
        id: getFlowEdgeId(sourceNodeId, targetNodeId, edge.targetPort, edge.sourcePort),
        sourceNodeId,
        sourcePort: edge.sourcePort,
        targetNodeId,
        targetPort: edge.targetPort,
      } satisfies FlowEdge;
    })
    .filter((edge): edge is FlowEdge => !!edge);
  const stacks = flow.stacks
    .map((stack): FlowStack | null => {
      const rootNodeId = mapFlowNodeRef(stack.rootNodeId, flow.outputNodeId, nodeIdMap);
      if (!rootNodeId) return null;

      const nodeIds = stack.nodeIds
        .map((nodeId) => mapFlowNodeRef(nodeId, flow.outputNodeId, nodeIdMap))
        .filter((nodeId): nodeId is string => !!nodeId);

      if (!nodeIds.includes(rootNodeId)) return null;

      return {
        ...stack,
        id: `stack_${rootNodeId}`,
        rootNodeId,
        nodeIds,
      };
    })
    .filter((stack): stack is FlowStack => !!stack);

  return {
    ...flow,
    id: flowId,
    nodes,
    edges,
    stacks,
  };
};

const getPasteInsertIndex = (nodes: AnyNode[], selectedNodeId: string | null): number => {
  if (!selectedNodeId || selectedNodeId === OUTPUT_NODE_ID) return nodes.length - 1;

  const selectedIndex = nodes.findIndex((node) => node.id === selectedNodeId);
  if (selectedIndex === -1) return nodes.length - 1;

  return getStackedGroupEndIndex(nodes, selectedIndex);
};

const getPositionBounds = (
  nodes: AnyNode[],
  positions: NodePositions,
): { minX: number; minY: number; centerX: number; centerY: number } | null => {
  const selectedPositions = nodes
    .map((node) => positions[node.id])
    .filter((position): position is { x: number; y: number } => !!position);
  if (selectedPositions.length === 0) return null;

  const minX = Math.min(...selectedPositions.map((position) => position.x));
  const minY = Math.min(...selectedPositions.map((position) => position.y));
  const maxX = Math.max(...selectedPositions.map((position) => position.x));
  const maxY = Math.max(...selectedPositions.map((position) => position.y));
  return {
    minX,
    minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
};

const positionsOverlap = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.abs(left.x - right.x) < POSITION_COLLISION_EPSILON &&
  Math.abs(left.y - right.y) < POSITION_COLLISION_EPSILON;

const hasPositionCollision = (positions: NodePositions, existingPositions: NodePositions) =>
  Object.values(positions).some((position) =>
    Object.values(existingPositions).some((existingPosition) =>
      positionsOverlap(position, existingPosition),
    ),
  );

const offsetPositions = (positions: NodePositions, offset: { x: number; y: number }) =>
  Object.fromEntries(
    Object.entries(positions).map(([nodeId, position]) => [
      nodeId,
      {
        x: position.x + offset.x,
        y: position.y + offset.y,
      },
    ]),
  ) as NodePositions;

const buildPastedTopLevelPositions = ({
  payload,
  clonedNodes,
  nodeIdMap,
  activePositions,
  selectedNodeId,
  pastePosition,
}: {
  payload: NodeClipboardPayload;
  clonedNodes: AnyNode[];
  nodeIdMap: Map<string, string>;
  activePositions: NodePositions;
  selectedNodeId: string | null;
  pastePosition?: { x: number; y: number } | null;
}): NodePositions => {
  const sourcePositions = payload.sourceFlowId
    ? (payload.nodePositionsByFlow[payload.sourceFlowId] ?? {})
    : {};
  const sourceBounds = getPositionBounds(payload.nodes, sourcePositions);

  if (!sourceBounds && pastePosition && clonedNodes.length > 0) {
    return Object.fromEntries(
      clonedNodes.map((node, index) => [
        node.id,
        {
          x: pastePosition.x,
          y: pastePosition.y + index * 96,
        },
      ]),
    ) as NodePositions;
  }

  if (!sourceBounds) return {};

  let offset = PASTE_OFFSET;
  const selectedPosition = selectedNodeId ? activePositions[selectedNodeId] : null;

  if (pastePosition) {
    offset = {
      x: pastePosition.x - sourceBounds.centerX,
      y: pastePosition.y - sourceBounds.centerY,
    };
  } else if (selectedPosition) {
    offset = {
      x: selectedPosition.x + PASTE_OFFSET.x - sourceBounds.minX,
      y: selectedPosition.y + PASTE_OFFSET.y - sourceBounds.minY,
    };
  }

  let nextPositions: NodePositions = {};
  for (const sourceNode of payload.nodes) {
    const sourcePosition = sourcePositions[sourceNode.id];
    const mappedNodeId = nodeIdMap.get(sourceNode.id);
    if (!sourcePosition || !mappedNodeId) continue;

    nextPositions[mappedNodeId] = {
      x: sourcePosition.x + offset.x,
      y: sourcePosition.y + offset.y,
    };
  }

  if (pastePosition) return nextPositions;

  let attempts = 0;
  while (hasPositionCollision(nextPositions, activePositions) && attempts < 20) {
    attempts += 1;
    nextPositions = offsetPositions(nextPositions, PASTE_OFFSET);
  }

  return nextPositions;
};

const remapFlowPositions = (
  positions: NodePositions,
  outputNodeId: string,
  nodeIdMap: Map<string, string>,
): NodePositions => {
  const nextPositions: NodePositions = {};

  for (const [nodeId, position] of Object.entries(positions)) {
    const mappedNodeId = nodeId === outputNodeId ? nodeId : nodeIdMap.get(nodeId);
    if (!mappedNodeId) continue;
    nextPositions[mappedNodeId] = { ...position };
  }

  return nextPositions;
};

export function pasteNodesCommand(
  state: GraphCommandState,
  payload: NodeClipboardPayload,
  options: PasteNodesOptions = {},
): GraphCommandResult | null {
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const activeFlow = getRootFlow(state.flows, flowId);
  if (!flowId || !activeFlow || payload.kind !== NODE_CLIPBOARD_KIND) return null;

  const sourceNodes = payload.nodes.filter(isCopyableClipboardNode);
  if (sourceNodes.length === 0) return null;

  const nodeIdMap = buildNodeIdMap(payload, state);
  const flowIdMap = buildFlowIdMap(payload, state);
  const nameAssigner = createUniqueItemNameAssigner(state.nodes.map((node) => node.name));
  const clonedNodes = sourceNodes.map((node) =>
    cloneNodeForPaste({
      node,
      nodeIdMap,
      flowIdMap,
      nameAssigner,
      edges: payload.edges,
    }),
  );

  const insertIndex = getPasteInsertIndex(state.nodes, state.selectedNodeId);
  const nextNodes = [...state.nodes];
  nextNodes.splice(insertIndex + 1, 0, ...clonedNodes);

  let nextFlows = replaceFlowNodes(state.flows, flowId, nextNodes, activeFlow.name);
  const clonedFlows: Record<FlowId, Flow> = {};
  for (const flow of Object.values(payload.flows)) {
    const clonedFlow = cloneFlowForPaste(flow, nodeIdMap, flowIdMap);
    if (clonedFlow) {
      clonedFlows[clonedFlow.id] = clonedFlow;
    }
  }
  nextFlows = {
    ...nextFlows,
    ...clonedFlows,
  };

  const activePositions = getNodePositionsForFlow(state.nodePositionsByFlow, flowId);
  let nextNodePositionsByFlow = setNodePositionsForFlow(state.nodePositionsByFlow, flowId, {
    ...activePositions,
    ...buildPastedTopLevelPositions({
      payload,
      clonedNodes,
      nodeIdMap,
      activePositions,
      selectedNodeId: state.selectedNodeId,
      pastePosition: options.position,
    }),
  });

  for (const [sourceFlowId, sourceFlow] of Object.entries(payload.flows)) {
    const clonedFlowId = flowIdMap.get(sourceFlowId);
    if (!clonedFlowId) continue;
    nextNodePositionsByFlow = setNodePositionsForFlow(
      nextNodePositionsByFlow,
      clonedFlowId,
      remapFlowPositions(
        payload.nodePositionsByFlow[sourceFlowId] ?? {},
        sourceFlow.outputNodeId,
        nodeIdMap,
      ),
    );
  }

  const selectedNodeIds = clonedNodes.map((node) => node.id);
  const selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const historyLabel =
    clonedNodes.length === 1
      ? `Paste ${clonedNodes[0].name} Node`
      : `Paste ${clonedNodes.length} Nodes`;

  return {
    documentPatch: { flows: nextFlows },
    selectionPatch: {
      selectedNodeId,
      selectedNodeIds,
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(clonedNodes[clonedNodes.length - 1]?.type),
    },
    layoutPatch: {
      nodePositionsByFlow: nextNodePositionsByFlow,
    },
    historyLabel,
  };
}

// ---------------------------------------------------------------------------
// deleteNodeCommand  —  removes only the explicitly selected real node(s)
// ---------------------------------------------------------------------------

const createNoopDeleteResult = (
  state: GraphCommandState,
  historyLabel = 'Delete Node',
): GraphCommandResult => ({
  documentPatch: {},
  selectionPatch: {
    selectedNodeId: state.selectedNodeId,
    selectedNodeIds: state.selectedNodeIds,
  },
  layoutPatch: {},
  historyLabel,
});

const getDeletableNodeIds = (
  state: GraphCommandState,
  nodeIds: readonly string[],
): { deletedIds: Set<string>; firstDeletedIndex: number } => {
  const deletedIds = new Set<string>();
  let firstDeletedIndex = Infinity;

  for (const nodeId of nodeIds) {
    const nodeIndex = state.nodes.findIndex((node) => node.id === nodeId);
    if (nodeIndex === -1 || nodeFlags(state.nodes[nodeIndex].type).isProtected) continue;

    firstDeletedIndex = Math.min(firstDeletedIndex, nodeIndex);
    deletedIds.add(state.nodes[nodeIndex].id);
  }

  return {
    deletedIds,
    firstDeletedIndex: Number.isFinite(firstDeletedIndex) ? firstDeletedIndex : -1,
  };
};

const getSelectionAfterDelete = (
  state: GraphCommandState,
  cleanedNodes: AnyNode[],
  deletedIds: Set<string>,
  firstDeletedIndex: number,
): { selectedNodeId: string | null; selectedNodeIds: string[] } => {
  if (state.selectedNodeId && !deletedIds.has(state.selectedNodeId)) {
    const selectedNodeIds = state.selectedNodeIds.filter((nodeId) => !deletedIds.has(nodeId));
    return {
      selectedNodeId: state.selectedNodeId,
      selectedNodeIds: selectedNodeIds.length > 0 ? selectedNodeIds : [state.selectedNodeId],
    };
  }

  const previousNode = state.nodes
    .slice(0, Math.max(0, firstDeletedIndex))
    .filter((node) => !deletedIds.has(node.id))
    .pop();
  const fallbackNode = previousNode ?? cleanedNodes[Math.max(0, firstDeletedIndex - 1)] ?? null;
  const selectedNodeId = fallbackNode?.id ?? null;

  return {
    selectedNodeId,
    selectedNodeIds: selectedNodeId ? [selectedNodeId] : [],
  };
};

function deleteNodesCommand(
  state: GraphCommandState,
  nodeIds: readonly string[],
  historyLabel?: string,
): GraphCommandResult | null {
  const { deletedIds, firstDeletedIndex } = getDeletableNodeIds(state, nodeIds);
  if (deletedIds.size === 0) return null;

  const cleanedNodes = cleanDanglingNodeInputs(
    state.nodes.filter((node) => !deletedIds.has(node.id)),
    deletedIds,
  );

  // Clean up node positions
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const currentPositions = getNodePositionsForFlow(state.nodePositionsByFlow, flowId);
  const cleanedPositions = { ...currentPositions };
  let positionsChanged = false;
  for (const id of deletedIds) {
    if (id in cleanedPositions) {
      delete cleanedPositions[id];
      positionsChanged = true;
    }
  }
  const nextNodePositionsByFlow = positionsChanged
    ? setNodePositionsForFlow(state.nodePositionsByFlow, flowId, cleanedPositions)
    : undefined;

  const selection = getSelectionAfterDelete(state, cleanedNodes, deletedIds, firstDeletedIndex);

  const cleanedViewerSlots = sanitizeViewerSlots(state.viewerSlots, cleanedNodes);
  const cleanedViewerNodeId = sanitizeViewerNodeId(state.viewerNodeId, cleanedNodes);
  const cleanedActiveViewerSlot = sanitizeActiveViewerSlot(
    state.activeViewerSlot,
    cleanedViewerSlots,
    cleanedViewerNodeId,
  );

  return {
    documentPatch: {
      nodes: cleanedNodes,
      viewerSlots: cleanedViewerSlots,
      viewerNodeId: cleanedViewerNodeId,
      activeViewerSlot: cleanedActiveViewerSlot,
    },
    selectionPatch: {
      selectedNodeId: selection.selectedNodeId,
      selectedNodeIds: selection.selectedNodeIds,
    },
    layoutPatch: {
      ...(nextNodePositionsByFlow ? { nodePositionsByFlow: nextNodePositionsByFlow } : {}),
    },
    historyLabel:
      historyLabel ?? (deletedIds.size === 1 ? 'Delete Node' : `Delete ${deletedIds.size} Nodes`),
  };
}

export function deleteNodeCommand(state: GraphCommandState, nodeId: string): GraphCommandResult {
  return deleteNodesCommand(state, [nodeId], 'Delete Node') ?? createNoopDeleteResult(state);
}

export function deleteSelectedNodesCommand(state: GraphCommandState): GraphCommandResult | null {
  const selectedNodeIds =
    state.selectedNodeIds.length > 0
      ? state.selectedNodeIds
      : state.selectedNodeId
        ? [state.selectedNodeId]
        : [];
  if (selectedNodeIds.length === 0) return null;
  return deleteNodesCommand(state, selectedNodeIds);
}

// ---------------------------------------------------------------------------
// groupNodesCommand  —  wraps selected nodes into a Group node with a child flow
// ---------------------------------------------------------------------------

const createGroupNode = (name: string, childFlowId: FlowId): GroupNode => ({
  id: `${NodeType.GROUP}_${Date.now()}`,
  kind: NodeKind.GROUP,
  type: NodeType.GROUP,
  name,
  enabled: true,
  childFlowId,
  externalInputs: [],
  exposedFields: [],
});

const getInputNodeId = (groupNodeId: string, externalInputId: string) =>
  `input_${groupNodeId}_${externalInputId}`.replace(/[^a-zA-Z0-9_-]/g, '_');

export const createInputNode = (
  groupNodeId: string,
  inputNodeKey: string,
  name: string,
  externalInputId: string | null = inputNodeKey,
): InputNode =>
  ({
    id: getInputNodeId(groupNodeId, inputNodeKey),
    kind: NodeKind.INPUT,
    type: NodeType.INPUT,
    name,
    enabled: true,
    groupNodeId,
    externalInputId,
  }) as InputNode;

const getGroupInputId = (targetNodeId: string, targetPort: string): string =>
  `input_${targetNodeId}_${targetPort}`.replace(/[^a-zA-Z0-9_-]/g, '_');

export const getUniqueGroupInputId = (
  targetNodeId: string,
  targetPort: string,
  usedIds: Set<string>,
) => {
  const baseId = getGroupInputId(targetNodeId, targetPort);
  let nextId = baseId;
  let index = 2;
  while (usedIds.has(nextId)) {
    nextId = `${baseId}_${index++}`;
  }
  usedIds.add(nextId);
  return nextId;
};

export const buildEmptyGroupFlow = (flowId: FlowId, name: string): Flow => ({
  id: flowId,
  name,
  nodes: [createOutputNode()],
  edges: [],
  stacks: [],
  outputNodeId: 'output',
});

export function groupNodesCommand(state: GraphCommandState): GraphCommandResult | null {
  const activeFlow = getRootFlow(state.flows, state.activeFlowId);
  if (!state.activeFlowId || !activeFlow) return null;

  const groupableNodeIds = getSelectedNodeIdsForGrouping(state.nodes, state.selectedNodeIds);
  if (groupableNodeIds.length === 0) return null;

  const groupableIdSet = new Set(groupableNodeIds);
  const selectedNodes = state.nodes.filter((node) => groupableIdSet.has(node.id));
  if (selectedNodes.length === 0) return null;

  const groupName = selectedNodes.length === 1 ? `${selectedNodes[0].name} Group` : 'Group';
  const childFlowId = `flow_group_${Date.now()}`;
  const groupNodeBase = createGroupNode(groupName, childFlowId);
  const groupIndex = state.nodes.findIndex((node) => groupableIdSet.has(node.id));
  const parentNodes = state.nodes.filter((node) => !groupableIdSet.has(node.id));

  const usedGroupInputIds = new Set<string>();
  const externalInputs: NonNullable<GroupNode['externalInputs']> = [];
  const groupInputs: Record<string, string> = {};
  const childInputNodes: InputNode[] = [];
  const childInputEdges: FlowEdge[] = [];
  const parentEdges: FlowEdge[] = [];
  const childOutputEdges: FlowEdge[] = [];
  const childOutputSourceIds = new Set<string>();
  let groupOutputNodeId: string | null = null;
  let groupInputNodeId: string | null = null;
  const inputNodeIdByExternalSource = new Map<string, string>();
  const exposedTargetPorts = new Set<string>();

  const orderedEdges = [...activeFlow.edges].sort(
    (left, right) =>
      Number(right.targetPort === PIPE_INPUT_PORT) - Number(left.targetPort === PIPE_INPUT_PORT),
  );
  for (const edge of orderedEdges) {
    const sourceIsGrouped = groupableIdSet.has(edge.sourceNodeId);
    const targetIsGrouped = groupableIdSet.has(edge.targetNodeId);

    if (!sourceIsGrouped && !targetIsGrouped) {
      parentEdges.push(edge);
      continue;
    }

    if (!sourceIsGrouped && targetIsGrouped) {
      const inputId = getUniqueGroupInputId(edge.targetNodeId, edge.targetPort, usedGroupInputIds);
      const targetNodeName =
        selectedNodes.find((node) => node.id === edge.targetNodeId)?.name ?? edge.targetNodeId;
      const existingEntryNodeId = inputNodeIdByExternalSource.get(edge.sourceNodeId);
      const entryNodeId = existingEntryNodeId ?? getInputNodeId(groupNodeBase.id, inputId);
      if (edge.targetPort === PIPE_INPUT_PORT && !groupInputNodeId) {
        groupInputNodeId = entryNodeId;
      }
      if (!existingEntryNodeId) {
        inputNodeIdByExternalSource.set(edge.sourceNodeId, entryNodeId);
        childInputNodes.push(
          createInputNode(
            groupNodeBase.id,
            inputId,
            edge.targetPort === PIPE_INPUT_PORT ? 'Main' : `${targetNodeName} ${edge.targetPort}`,
          ),
        );
      }
      externalInputs.push({
        id: inputId,
        label:
          edge.targetPort === PIPE_INPUT_PORT ? 'Main' : `${targetNodeName} ${edge.targetPort}`,
        entryNodeId,
        targetNodeId: edge.targetNodeId,
        targetPort: edge.targetPort,
      });
      exposedTargetPorts.add(`${edge.targetNodeId}:${edge.targetPort}`);
      groupInputs[inputId] = edge.sourceNodeId;
      childInputEdges.push({
        id: `edge_${entryNodeId}_${edge.targetNodeId}_${edge.targetPort}`,
        sourceNodeId: entryNodeId,
        sourcePort: 'output',
        targetNodeId: edge.targetNodeId,
        targetPort: edge.targetPort,
      });
      parentEdges.push({
        id: `edge_${edge.sourceNodeId}_${groupNodeBase.id}_${inputId}`,
        sourceNodeId: edge.sourceNodeId,
        sourcePort: edge.sourcePort,
        targetNodeId: groupNodeBase.id,
        targetPort: inputId,
      });
      continue;
    }

    if (sourceIsGrouped && !targetIsGrouped) {
      groupOutputNodeId ??= edge.sourceNodeId;
      if (!childOutputSourceIds.has(edge.sourceNodeId)) {
        childOutputSourceIds.add(edge.sourceNodeId);
        childOutputEdges.push({
          id: `edge_${edge.sourceNodeId}_output_pipe`,
          sourceNodeId: edge.sourceNodeId,
          sourcePort: edge.sourcePort,
          targetNodeId: OUTPUT_NODE_ID,
          targetPort: 'pipe',
        });
      }
      parentEdges.push({
        id: `edge_${groupNodeBase.id}_${edge.targetNodeId}_${edge.targetPort}`,
        sourceNodeId: groupNodeBase.id,
        sourcePort: 'output',
        targetNodeId: edge.targetNodeId,
        targetPort: edge.targetPort,
      });
    }
  }

  const internallyConnectedTargetPorts = new Set(
    activeFlow.edges
      .filter(
        (edge) => groupableIdSet.has(edge.sourceNodeId) && groupableIdSet.has(edge.targetNodeId),
      )
      .map((edge) => `${edge.targetNodeId}:${edge.targetPort}`),
  );

  for (const targetNode of selectedNodes) {
    const targetNodeName = targetNode.name || targetNode.id;
    for (const port of getInputPorts(targetNode)) {
      if (port.name === 'pipe') continue;

      const targetKey = `${targetNode.id}:${port.name}`;
      if (exposedTargetPorts.has(targetKey) || internallyConnectedTargetPorts.has(targetKey)) {
        continue;
      }

      const inputId = getUniqueGroupInputId(targetNode.id, port.name, usedGroupInputIds);
      const entryNode = createInputNode(
        groupNodeBase.id,
        inputId,
        `${targetNodeName} ${port.label}`,
      );
      childInputNodes.push(entryNode);
      externalInputs.push({
        id: inputId,
        label: `${targetNodeName} ${port.label}`,
        entryNodeId: entryNode.id,
        targetNodeId: targetNode.id,
        targetPort: port.name,
      });
      exposedTargetPorts.add(targetKey);
      childInputEdges.push({
        id: `edge_${entryNode.id}_${targetNode.id}_${port.name}`,
        sourceNodeId: entryNode.id,
        sourcePort: 'output',
        targetNodeId: targetNode.id,
        targetPort: port.name,
      });
    }
  }

  const groupNode: GroupNode = {
    ...groupNodeBase,
    ...(externalInputs.length > 0 ? { externalInputs } : {}),
    ...(Object.keys(groupInputs).length > 0 ? { inputs: groupInputs } : {}),
    ...(groupInputNodeId ? { inputNodeId: groupInputNodeId } : {}),
    ...(groupOutputNodeId ? { outputNodeId: groupOutputNodeId } : {}),
  };

  parentNodes.splice(Math.max(0, groupIndex), 0, groupNode);

  const parentFlowDraft = buildFlowFromNodes(parentNodes, state.activeFlowId, activeFlow.name);
  const parentFlow: Flow = {
    ...parentFlowDraft,
    edges: parentEdges,
  };
  const childFlowDraft = buildFlowFromNodes(
    [...childInputNodes, ...selectedNodes],
    childFlowId,
    groupName,
  );
  const childFlow: Flow = {
    ...childFlowDraft,
    edges: [
      ...childInputEdges,
      ...activeFlow.edges.filter(
        (edge) => groupableIdSet.has(edge.sourceNodeId) && groupableIdSet.has(edge.targetNodeId),
      ),
      ...childOutputEdges,
    ],
  };

  const existingPositionsByFlow = state.nodePositionsByFlow ?? {};
  const activePositions = existingPositionsByFlow[state.activeFlowId] ?? {};
  const selectedPositions = selectedNodes
    .map((node) => activePositions[node.id])
    .filter((position): position is { x: number; y: number } => !!position);
  const groupPosition =
    selectedPositions.length > 0
      ? {
          x:
            selectedPositions.reduce((total, position) => total + position.x, 0) /
            selectedPositions.length,
          y:
            selectedPositions.reduce((total, position) => total + position.y, 0) /
            selectedPositions.length,
        }
      : activePositions[selectedNodes[0].id];
  const nextActivePositions = { ...activePositions };
  for (const nodeId of groupableIdSet) {
    delete nextActivePositions[nodeId];
  }
  if (groupPosition) {
    nextActivePositions[groupNode.id] = groupPosition;
  }
  const childPositions = Object.fromEntries(
    selectedNodes
      .map((node) => [node.id, activePositions[node.id]] as const)
      .filter((entry): entry is readonly [string, { x: number; y: number }] => !!entry[1]),
  );

  const nextFlows = {
    ...state.flows,
    [state.activeFlowId]: parentFlow,
    [childFlowId]: childFlow,
  };
  const nextNodePositionsByFlow = {
    ...existingPositionsByFlow,
    [state.activeFlowId]: nextActivePositions,
    [childFlowId]: childPositions,
  };

  return {
    documentPatch: { flows: nextFlows },
    selectionPatch: {
      selectedNodeId: groupNode.id,
      selectedNodeIds: [groupNode.id],
    },
    layoutPatch: { nodePositionsByFlow: nextNodePositionsByFlow },
    historyLabel: `Group ${selectedNodes.length} Node${selectedNodes.length === 1 ? '' : 's'}`,
  };
}

// ---------------------------------------------------------------------------
// Utility: apply patches to state (for use by action factories)
// ---------------------------------------------------------------------------

/**
 * Build a GraphCommandState from a raw editor state object.
 */
export function buildGraphCommandState(state: {
  nodes: AnyNode[];
  flows: Record<FlowId, Flow>;
  activeFlowId: FlowId | null | undefined;
  rootFlowId: FlowId | null | undefined;
  selectedNodeId: string | null | undefined;
  selectedNodeIds?: string[] | null | undefined;
  nodePositionsByFlow?: Record<FlowId, NodePositions> | null | undefined;
  viewerSlots?: ViewerSlotAssignments | null | undefined;
  viewerNodeId?: string | null | undefined;
  activeViewerSlot?: ViewerSlot | null | undefined;
}): GraphCommandState {
  return {
    nodes: state.nodes,
    flows: state.flows,
    activeFlowId: state.activeFlowId ?? null,
    rootFlowId: state.rootFlowId ?? null,
    selectedNodeId: state.selectedNodeId ?? null,
    selectedNodeIds: state.selectedNodeIds ?? [],
    nodePositionsByFlow: state.nodePositionsByFlow ?? {},
    viewerSlots: state.viewerSlots ?? {},
    viewerNodeId: state.viewerNodeId ?? null,
    activeViewerSlot: state.activeViewerSlot ?? null,
  };
}

/**
 * Merge a GraphCommandResult into a state patch object that can be spread
 * into a `set()` call.  Returns the state patch plus the history label.
 */
export function applyGraphCommandPatch(result: GraphCommandResult): {
  statePatch: Record<string, unknown>;
  historyLabel: string;
} {
  const statePatch: Record<string, unknown> = {};

  // Document patch
  if (result.documentPatch.nodes !== undefined) statePatch.nodes = result.documentPatch.nodes;
  if (result.documentPatch.flows !== undefined) statePatch.flows = result.documentPatch.flows;
  if (result.documentPatch.viewerSlots !== undefined)
    statePatch.viewerSlots = result.documentPatch.viewerSlots;
  if (result.documentPatch.viewerNodeId !== undefined)
    statePatch.viewerNodeId = result.documentPatch.viewerNodeId;
  if (result.documentPatch.activeViewerSlot !== undefined)
    statePatch.activeViewerSlot = result.documentPatch.activeViewerSlot;

  // Selection patch
  if (result.selectionPatch.selectedNodeId !== undefined)
    statePatch.selectedNodeId = result.selectionPatch.selectedNodeId;
  if (result.selectionPatch.selectedNodeIds !== undefined)
    statePatch.selectedNodeIds = result.selectionPatch.selectedNodeIds;
  if (result.selectionPatch.activeTab !== undefined)
    statePatch.activeTab = result.selectionPatch.activeTab;
  if (result.selectionPatch.activeViewportTool !== undefined)
    statePatch.activeViewportTool = result.selectionPatch.activeViewportTool;

  // Layout patch
  if (result.layoutPatch.nodePositionsByFlow !== undefined)
    statePatch.nodePositionsByFlow = result.layoutPatch.nodePositionsByFlow;

  return { statePatch, historyLabel: result.historyLabel };
}

/**
 * Helper to build a full history entry state from a command result.
 */
export function buildHistoryState(result: GraphCommandResult): Record<string, unknown> {
  return {
    ...result.documentPatch,
    ...result.selectionPatch,
    ...result.layoutPatch,
  } as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// executeGraphCommand  —  applies a GraphCommandResult to the editor store
// ---------------------------------------------------------------------------

/**
 * Apply a GraphCommandResult to the editor store: patches state, pushes
 * history, and triggers debounced persistence.
 */
export function executeGraphCommand(
  commitMutation: (mutation: {
    patch: Record<string, unknown>;
    history: { label: string; state: Record<string, unknown> };
    persist: 'debounced';
  }) => void,
  result: GraphCommandResult,
): void {
  const { statePatch, historyLabel } = applyGraphCommandPatch(result);
  commitMutation({
    patch: statePatch,
    history: { label: historyLabel, state: buildHistoryState(result) },
    persist: 'debounced',
  });
}
