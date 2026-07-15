import type { Flow, FlowEdge } from '@blackboard/types';

export const PIPE_INPUT_PORT = 'pipe';
export const DEFAULT_OUTPUT_PORT = 'output';

export const getInputEdge = (
  flow: Flow | null | undefined,
  targetNodeId: string,
  targetPort: string,
): FlowEdge | null =>
  flow?.edges.find(
    (edge) => edge.targetNodeId === targetNodeId && edge.targetPort === targetPort,
  ) ?? null;

export const getSingleOutgoingEdge = (
  flow: Flow | null | undefined,
  sourceNodeId: string,
  targetPort?: string,
): FlowEdge | null => {
  const matches =
    flow?.edges.filter(
      (edge) =>
        edge.sourceNodeId === sourceNodeId &&
        (targetPort === undefined || edge.targetPort === targetPort),
    ) ?? [];
  return matches.length === 1 ? matches[0] : null;
};

export const getOutputInputEdge = (flow: Flow | null | undefined): FlowEdge | null =>
  flow ? getInputEdge(flow, flow.outputNodeId, PIPE_INPUT_PORT) : null;

export const collectUpstreamEdgeIdsForNodes = (
  edges: readonly FlowEdge[],
  targetNodeIds: Iterable<string | null | undefined>,
): ReadonlySet<string> => {
  const result = new Set<string>();

  const incomingByNode = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const incoming = incomingByNode.get(edge.targetNodeId) ?? [];
    incoming.push(edge);
    incomingByNode.set(edge.targetNodeId, incoming);
  }

  const pendingNodeIds = [...targetNodeIds].filter((nodeId): nodeId is string => !!nodeId);
  const visitedNodeIds = new Set<string>(pendingNodeIds);
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.pop()!;
    for (const edge of incomingByNode.get(nodeId) ?? []) {
      result.add(edge.id);
      if (visitedNodeIds.has(edge.sourceNodeId)) continue;
      visitedNodeIds.add(edge.sourceNodeId);
      pendingNodeIds.push(edge.sourceNodeId);
    }
  }

  return result;
};

export const collectUpstreamEdgeIds = (
  edges: readonly FlowEdge[],
  targetNodeId: string | null | undefined,
): ReadonlySet<string> => collectUpstreamEdgeIdsForNodes(edges, [targetNodeId]);

export const collectUpstreamNodeIds = (
  edges: readonly FlowEdge[],
  targetNodeId: string | null | undefined,
): ReadonlySet<string> => {
  const result = new Set<string>();
  if (!targetNodeId) return result;

  const incomingByNode = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const incoming = incomingByNode.get(edge.targetNodeId) ?? [];
    incoming.push(edge);
    incomingByNode.set(edge.targetNodeId, incoming);
  }

  const visitedNodeIds = new Set<string>([targetNodeId]);
  const pendingNodeIds = [targetNodeId];
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.pop()!;
    for (const edge of incomingByNode.get(nodeId) ?? []) {
      if (visitedNodeIds.has(edge.sourceNodeId)) continue;
      visitedNodeIds.add(edge.sourceNodeId);
      result.add(edge.sourceNodeId);
      pendingNodeIds.push(edge.sourceNodeId);
    }
  }

  return result;
};

/**
 * Returns the primary image-processing chain, ordered from its first source to
 * the output node. Branch inputs such as merge.source and masks are excluded.
 */
export const getPrimaryPipelineNodeIds = (flow: Flow | null | undefined): readonly string[] => {
  if (!flow) return [];

  const reversedNodeIds: string[] = [];
  const visitedNodeIds = new Set<string>([flow.outputNodeId]);
  let targetNodeId = flow.outputNodeId;

  while (true) {
    const edge = getInputEdge(flow, targetNodeId, PIPE_INPUT_PORT);
    if (!edge || visitedNodeIds.has(edge.sourceNodeId)) break;
    reversedNodeIds.push(edge.sourceNodeId);
    visitedNodeIds.add(edge.sourceNodeId);
    targetNodeId = edge.sourceNodeId;
  }

  return reversedNodeIds.reverse();
};

export const isNodeConnectedToOutput = (flow: Flow | null | undefined, nodeId: string): boolean =>
  !!flow &&
  (nodeId === flow.outputNodeId ||
    collectUpstreamNodeIds(flow.edges, flow.outputNodeId).has(nodeId));
