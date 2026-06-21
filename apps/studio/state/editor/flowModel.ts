import {
  AnyNode,
  Flow,
  FlowEdge,
  FlowId,
  FlowStack,
  NodeKind,
  NodePositions,
  NodeType,
  OutputNode,
} from '@blackboard/types';
import { buildNodeStacks } from '@/utils/nodeStacks';

export const ROOT_FLOW_ID = 'root-flow';
export const OUTPUT_NODE_ID = 'output';

/** Returns every canonical node stored across the project's flows. */
export const getAllProjectNodes = (flows: Record<FlowId, Flow>): AnyNode[] =>
  Object.values(flows).flatMap((flow) => flow.nodes);

export const isSceneNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.SCENE || node.type === NodeType.SCENE;

export const isOutputNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.OUTPUT || node.type === NodeType.OUTPUT;

export const isGroupNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.GROUP || node.type === NodeType.GROUP;

export const isInputNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.INPUT || node.type === NodeType.INPUT;

export const getSelectedNodeIdsForGrouping = (
  nodes: AnyNode[],
  selectedNodeIds: string[],
): string[] => {
  const selectedIdSet = new Set(selectedNodeIds);

  return nodes
    .filter(
      (node) =>
        selectedIdSet.has(node.id) &&
        !isSceneNode(node) &&
        !isInputNode(node) &&
        !isOutputNode(node),
    )
    .map((node) => node.id);
};

export const getFlowEdgeId = (
  sourceNodeId: string,
  targetNodeId: string,
  targetPort: string,
  sourcePort = 'output',
): string =>
  sourcePort === 'output'
    ? `edge_${sourceNodeId}_${targetNodeId}_${targetPort}`
    : `edge_${sourceNodeId}_${sourcePort}_${targetNodeId}_${targetPort}`;

export const createOutputNode = (id = OUTPUT_NODE_ID): OutputNode => ({
  id,
  kind: NodeKind.OUTPUT,
  type: NodeType.OUTPUT,
  name: 'Output',
  enabled: true,
});

const stripNodeInputProjection = (node: AnyNode): AnyNode => {
  const {
    inputs: _inputs,
    inputSourcePorts: _inputSourcePorts,
    ...rest
  } = node as AnyNode & {
    inputs?: Record<string, string>;
    inputSourcePorts?: Record<string, string>;
  };
  return rest as AnyNode;
};

const normalizeNodeForFlow = (node: AnyNode): AnyNode => {
  const topologyFreeNode = stripNodeInputProjection(node);

  if (isSceneNode(node)) {
    return { ...topologyFreeNode, kind: NodeKind.SCENE, type: NodeType.SCENE } as AnyNode;
  }

  if (isOutputNode(node)) {
    return { ...topologyFreeNode, kind: NodeKind.OUTPUT, type: NodeType.OUTPUT } as AnyNode;
  }

  if (isGroupNode(node)) {
    return { ...topologyFreeNode, kind: NodeKind.GROUP, type: NodeType.GROUP } as AnyNode;
  }

  if (isInputNode(node)) {
    return { ...topologyFreeNode, kind: NodeKind.INPUT, type: NodeType.INPUT } as AnyNode;
  }

  return { ...topologyFreeNode, kind: node.kind ?? NodeKind.EFFECT } as AnyNode;
};

export const buildFlowFromNodes = (
  orderedNodes: AnyNode[],
  flowId: FlowId = ROOT_FLOW_ID,
  flowName = 'Flow',
): Flow => {
  const edges: FlowEdge[] = [];
  const nodes: AnyNode[] = [];

  const existingOutputNode = orderedNodes.find(isOutputNode);
  const outputNode = normalizeNodeForFlow(existingOutputNode ?? createOutputNode()) as OutputNode;

  for (const rawNode of orderedNodes) {
    if (isOutputNode(rawNode)) {
      continue;
    }

    const node = normalizeNodeForFlow(rawNode);
    nodes.push(node);

    for (const [targetPort, sourceNodeId] of Object.entries(rawNode.inputs ?? {})) {
      if (!sourceNodeId) {
        continue;
      }

      const sourcePort = rawNode.inputSourcePorts?.[targetPort] ?? 'output';

      edges.push({
        id: getFlowEdgeId(sourceNodeId, node.id, targetPort, sourcePort),
        sourceNodeId,
        sourcePort,
        targetNodeId: node.id,
        targetPort,
      } satisfies FlowEdge);
    }
  }

  nodes.push(outputNode);
  const stackableNodes = orderedNodes.filter((node) => !isOutputNode(node));
  const stacks = buildNodeStacks(stackableNodes).map(
    (stack): FlowStack => ({
      id: `stack_${stack[0].id}`,
      rootNodeId: stack[0].id,
      nodeIds: stack.map((node) => node.id),
    }),
  );

  return {
    id: flowId,
    name: flowName,
    nodes,
    edges,
    stacks,
    outputNodeId: outputNode.id,
  };
};

export const getRootFlow = (
  flows: Record<FlowId, Flow>,
  rootFlowId: FlowId | null,
): Flow | null => {
  if (!rootFlowId) {
    return null;
  }

  return flows[rootFlowId] ?? null;
};

export const getNodeInputsFromFlow = (flow: Flow, nodeId: string): Record<string, string> =>
  flow.edges
    .filter((edge) => edge.targetNodeId === nodeId)
    .reduce<Record<string, string>>((acc, edge) => {
      acc[edge.targetPort] = edge.sourceNodeId;
      return acc;
    }, {});

export const getNodeInputSourcePortsFromFlow = (
  flow: Flow,
  nodeId: string,
): Record<string, string> =>
  flow.edges
    .filter((edge) => edge.targetNodeId === nodeId && edge.sourcePort !== 'output')
    .reduce<Record<string, string>>((acc, edge) => {
      acc[edge.targetPort] = edge.sourcePort;
      return acc;
    }, {});

export const replaceFlowNodeInput = (
  flows: Record<FlowId, Flow>,
  flowId: FlowId | null,
  targetNodeId: string,
  targetPort: string,
  sourceNodeId: string,
  sourcePort = 'output',
): Record<FlowId, Flow> | null => {
  if (!flowId) {
    return null;
  }

  const flow = flows[flowId];
  if (!flow || !targetPort || !sourceNodeId || targetNodeId === sourceNodeId) {
    return null;
  }

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  if (!nodeIds.has(targetNodeId) || !nodeIds.has(sourceNodeId)) {
    return null;
  }

  const nextFlow: Flow = {
    ...flow,
    edges: [
      ...flow.edges.filter(
        (edge) => !(edge.targetNodeId === targetNodeId && edge.targetPort === targetPort),
      ),
      {
        id: getFlowEdgeId(sourceNodeId, targetNodeId, targetPort, sourcePort),
        sourceNodeId,
        sourcePort,
        targetNodeId,
        targetPort,
      },
    ],
  };

  return { ...flows, [flowId]: nextFlow };
};

export const removeFlowNodeInput = (
  flows: Record<FlowId, Flow>,
  flowId: FlowId | null,
  targetNodeId: string,
  targetPort: string,
): Record<FlowId, Flow> | null => {
  if (!flowId) {
    return null;
  }

  const flow = flows[flowId];
  if (!flow) {
    return null;
  }

  const nextEdges = flow.edges.filter(
    (edge) => !(edge.targetNodeId === targetNodeId && edge.targetPort === targetPort),
  );
  if (nextEdges.length === flow.edges.length) {
    return null;
  }

  return {
    ...flows,
    [flowId]: {
      ...flow,
      edges: nextEdges,
    },
  };
};

export const updateFlowNode = (
  flows: Record<FlowId, Flow>,
  flowId: FlowId | null,
  nodeId: string,
  changes: Partial<AnyNode>,
): Record<FlowId, Flow> | null => {
  if (!flowId) return null;
  const flow = flows[flowId];
  if (!flow) return null;

  let changed = false;
  const nodes = flow.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    return { ...node, ...changes } as AnyNode;
  });

  return changed ? { ...flows, [flowId]: { ...flow, nodes } } : null;
};

export const getOutputPipeEdge = (flow: Flow | null): FlowEdge | null => {
  if (!flow) return null;
  return (
    flow.edges.find(
      (edge) => edge.targetNodeId === flow.outputNodeId && edge.targetPort === 'pipe',
    ) ?? null
  );
};

export const isFlowOutputDetached = (flow: Flow | null): boolean => {
  if (!flow) return false;
  const outputNode = flow.nodes.find((node) => node.id === flow.outputNodeId);
  return !!(outputNode as { detachedFromPipe?: boolean } | undefined)?.detachedFromPipe;
};

export const getOrderedNodesFromFlow = (flow: Flow | null): AnyNode[] => {
  if (!flow) {
    return [];
  }

  const stackedNodeIds = new Set(
    flow.stacks.flatMap((stack) => stack.nodeIds.filter((nodeId) => nodeId !== stack.rootNodeId)),
  );

  return flow.nodes
    .filter((node): node is AnyNode => !!node && !isOutputNode(node))
    .map((node) => {
      const nodeInputs = getNodeInputsFromFlow(flow, node.id);
      const inputSourcePorts = getNodeInputSourcePortsFromFlow(flow, node.id);
      const topologyFreeNode = stripNodeInputProjection(node);

      return {
        ...topologyFreeNode,
        ...(stackedNodeIds.has(node.id) ? { stacked: true } : {}),
        ...(Object.keys(nodeInputs).length > 0 ? { inputs: nodeInputs } : {}),
        ...(Object.keys(inputSourcePorts).length > 0 ? { inputSourcePorts } : {}),
      } as AnyNode;
    });
};

export const replaceFlowNodes = (
  flows: Record<FlowId, Flow>,
  flowId: FlowId | null,
  orderedNodes: AnyNode[],
  fallbackFlowName = 'Root Flow',
): Record<FlowId, Flow> => {
  if (!flowId) {
    return flows;
  }

  const currentFlow = flows[flowId];
  const builtFlow = buildFlowFromNodes(orderedNodes, flowId, currentFlow?.name ?? fallbackFlowName);
  const currentOutputNode = currentFlow?.nodes.find((node) => node.id === builtFlow.outputNodeId);
  const nextNodeIds = new Set(builtFlow.nodes.map((node) => node.id));
  const preservedOutputEdges =
    currentFlow?.edges.filter(
      (edge) =>
        edge.targetNodeId === builtFlow.outputNodeId &&
        edge.targetPort === 'pipe' &&
        nextNodeIds.has(edge.sourceNodeId),
    ) ?? [];
  const nextFlow: Flow = {
    ...builtFlow,
    nodes: currentOutputNode
      ? builtFlow.nodes.map((node) =>
          node.id === builtFlow.outputNodeId
            ? ({ ...node, ...currentOutputNode } as AnyNode)
            : node,
        )
      : builtFlow.nodes,
    edges: [...builtFlow.edges, ...preservedOutputEdges],
  };
  return { ...flows, [flowId]: nextFlow };
};

export const getNodePositionsForFlow = (
  nodePositionsByFlow: Record<FlowId, NodePositions>,
  flowId: FlowId | null,
): NodePositions => {
  if (!flowId) {
    return {};
  }

  return nodePositionsByFlow[flowId] ?? {};
};

export const setNodePositionsForFlow = (
  nodePositionsByFlow: Record<FlowId, NodePositions>,
  flowId: FlowId | null,
  positions: NodePositions,
): Record<FlowId, NodePositions> => {
  if (!flowId) {
    return nodePositionsByFlow;
  }

  return {
    ...nodePositionsByFlow,
    [flowId]: positions,
  };
};
