import {
  AnyNode,
  Flow,
  FlowConnection,
  FlowId,
  FlowRelationship,
  FlowStackRelationship,
  NodeKind,
  NodePositions,
  NodeType,
  OutputNode,
} from '@blackboard/types';

export const ROOT_FLOW_ID = 'root-flow';
export const OUTPUT_NODE_ID = 'output';

export const isSceneNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.SCENE || node.type === NodeType.SCENE;

export const isOutputNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.OUTPUT || node.type === NodeType.OUTPUT;

export const isGroupNode = (node: AnyNode) =>
  (node.kind as string | undefined) === NodeKind.GROUP || node.type === NodeType.GROUP;

export const createOutputNode = (id = OUTPUT_NODE_ID): OutputNode => ({
  id,
  kind: NodeKind.OUTPUT,
  type: NodeType.OUTPUT,
  name: 'Output',
  visible: true,
});

const normalizeNodeForFlow = (node: AnyNode): AnyNode => {
  const { stacked: _stacked, inputs: _inputs, ...rest } = node;

  if (isSceneNode(node)) {
    return {
      ...rest,
      kind: NodeKind.SCENE,
      type: NodeType.SCENE,
    } as AnyNode;
  }

  if (isOutputNode(node)) {
    return {
      ...rest,
      kind: NodeKind.OUTPUT,
      type: NodeType.OUTPUT,
    } as AnyNode;
  }

  if (isGroupNode(node)) {
    return {
      ...rest,
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
    } as AnyNode;
  }

  return {
    ...rest,
    kind: node.kind ?? NodeKind.EFFECT,
  } as AnyNode;
};

const buildPipeRelationships = (
  sceneNodeId: string,
  outputNodeId: string,
  baseNodeIds: string[],
): FlowConnection[] => {
  const pipeRelationships: FlowConnection[] = [];
  const orderedTargets = baseNodeIds.length > 0 ? baseNodeIds : [outputNodeId];

  pipeRelationships.push({
    id: `pipe_${sceneNodeId}_${orderedTargets[0]}`,
    kind: 'connection',
    sourceNodeId: sceneNodeId,
    sourcePort: 'output',
    targetNodeId: orderedTargets[0],
    targetPort: 'pipe',
  });

  for (let index = 0; index < baseNodeIds.length - 1; index += 1) {
    pipeRelationships.push({
      id: `pipe_${baseNodeIds[index]}_${baseNodeIds[index + 1]}`,
      kind: 'connection',
      sourceNodeId: baseNodeIds[index],
      sourcePort: 'output',
      targetNodeId: baseNodeIds[index + 1],
      targetPort: 'pipe',
    });
  }

  if (baseNodeIds.length > 0) {
    pipeRelationships.push({
      id: `pipe_${baseNodeIds[baseNodeIds.length - 1]}_${outputNodeId}`,
      kind: 'connection',
      sourceNodeId: baseNodeIds[baseNodeIds.length - 1],
      sourcePort: 'output',
      targetNodeId: outputNodeId,
      targetPort: 'pipe',
    });
  }

  return pipeRelationships;
};

export const buildFlowFromNodes = (
  orderedNodes: AnyNode[],
  flowId: FlowId = ROOT_FLOW_ID,
  flowName = 'Flow',
): Flow => {
  const relationships: FlowRelationship[] = [];
  const nodes: AnyNode[] = [];
  const nodeOrder: string[] = [];
  const baseNodeIds: string[] = [];

  const existingOutputNode = orderedNodes.find(isOutputNode);
  const outputNode = normalizeNodeForFlow(existingOutputNode ?? createOutputNode()) as OutputNode;

  let sceneNodeId: string | null = null;
  let currentBaseNodeId: string | null = null;

  for (const rawNode of orderedNodes) {
    if (isOutputNode(rawNode)) {
      continue;
    }

    const node = normalizeNodeForFlow(rawNode);
    nodes.push(node);
    nodeOrder.push(node.id);

    if (isSceneNode(node)) {
      sceneNodeId = node.id;
      currentBaseNodeId = null;
      continue;
    }

    if (isGroupNode(node)) {
      continue;
    }

    if (rawNode.stacked && currentBaseNodeId) {
      relationships.push({
        id: `stack_${currentBaseNodeId}_${node.id}`,
        kind: 'stack',
        sourceNodeId: currentBaseNodeId,
        targetNodeId: node.id,
      } satisfies FlowStackRelationship);
    } else {
      baseNodeIds.push(node.id);
      currentBaseNodeId = node.id;
    }

    for (const [targetPort, sourceNodeId] of Object.entries(rawNode.inputs ?? {})) {
      relationships.push({
        id: `connection_${sourceNodeId}_${node.id}_${targetPort}`,
        kind: 'connection',
        sourceNodeId,
        sourcePort: 'output',
        targetNodeId: node.id,
        targetPort,
      } satisfies FlowConnection);
    }
  }

  nodes.push(outputNode);
  nodeOrder.push(outputNode.id);

  if (sceneNodeId) {
    relationships.push(...buildPipeRelationships(sceneNodeId, outputNode.id, baseNodeIds));
  }

  return {
    id: flowId,
    name: flowName,
    nodes,
    nodeOrder,
    relationships,
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

export const getOrderedNodesFromFlow = (flow: Flow | null): AnyNode[] => {
  if (!flow) {
    return [];
  }

  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const stackedNodeIds = new Set(
    flow.relationships
      .filter(
        (relationship): relationship is FlowStackRelationship => relationship.kind === 'stack',
      )
      .map((relationship) => relationship.targetNodeId),
  );
  const explicitConnections = flow.relationships.filter(
    (relationship): relationship is FlowConnection =>
      relationship.kind === 'connection' && relationship.targetPort !== 'pipe',
  );

  return flow.nodeOrder
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is AnyNode => !!node && !isOutputNode(node) && !isGroupNode(node))
    .map((node) => {
      const nodeInputs = explicitConnections
        .filter((relationship) => relationship.targetNodeId === node.id)
        .reduce<Record<string, string>>((acc, relationship) => {
          acc[relationship.targetPort] = relationship.sourceNodeId;
          return acc;
        }, {});

      return {
        ...node,
        ...(stackedNodeIds.has(node.id) ? { stacked: true } : {}),
        ...(Object.keys(nodeInputs).length > 0 ? { inputs: nodeInputs } : {}),
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
  const nextFlow = buildFlowFromNodes(orderedNodes, flowId, currentFlow?.name ?? fallbackFlowName);
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
