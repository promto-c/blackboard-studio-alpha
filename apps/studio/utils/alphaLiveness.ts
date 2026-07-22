import {
  NodeType,
  type AlphaInputBehavior,
  type AnyNode,
  type RenderOutputDomain,
  type ViewerSettings,
} from '@blackboard/types';

interface AlphaBehaviorDefinition {
  alphaInputBehavior?:
    | AlphaInputBehavior
    | ((node: AnyNode, inputPort: string) => AlphaInputBehavior);
}

interface AlphaBehaviorRegistry {
  get(nodeType: string): AlphaBehaviorDefinition | undefined;
}

const getNodeInputs = (node: AnyNode): Readonly<Record<string, string>> =>
  (node as AnyNode & { inputs?: Record<string, string> }).inputs ?? {};

const resolveAlphaInputBehavior = (
  definition: AlphaBehaviorDefinition | undefined,
  node: AnyNode,
  inputPort: string,
): AlphaInputBehavior => {
  const declared = definition?.alphaInputBehavior;
  if (typeof declared === 'function') return declared(node, inputPort);
  return declared ?? 'consume';
};

export const isViewerAlphaRequired = (
  viewerSettings: Pick<ViewerSettings, 'channels' | 'alphaOverlay'>,
  outputDomain: RenderOutputDomain,
): boolean =>
  viewerSettings.channels === 'A' ||
  viewerSettings.alphaOverlay ||
  outputDomain.sourcePort === 'a' ||
  outputDomain.sourcePort === 'alpha' ||
  (outputDomain.kind === 'data' &&
    (outputDomain.semantic === 'alpha' || outputDomain.semantic === 'mask'));

/**
 * Returns whether alpha produced by `sourceNodeId` can affect the current
 * viewer result. The supplied nodes must be the already-projected render
 * branch(es), so disconnected graph branches do not inhibit optimization.
 */
export const isNodeAlphaLiveInViewerPipeline = ({
  nodes,
  sourceNodeId,
  viewerRequiresAlpha,
  nodeRegistry,
}: {
  nodes: readonly AnyNode[];
  sourceNodeId: string;
  viewerRequiresAlpha: boolean;
  nodeRegistry: AlphaBehaviorRegistry;
}): boolean => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodesById.has(sourceNodeId)) return false;

  const outgoingBySourceId = new Map<string, Array<{ targetNode: AnyNode; targetPort: string }>>();
  nodes.forEach((targetNode) => {
    Object.entries(getNodeInputs(targetNode)).forEach(([targetPort, inputNodeId]) => {
      if (!nodesById.has(inputNodeId)) return;
      const outgoing = outgoingBySourceId.get(inputNodeId) ?? [];
      outgoing.push({ targetNode, targetPort });
      outgoingBySourceId.set(inputNodeId, outgoing);
    });
  });

  const pendingNodeIds = [sourceNodeId];
  const visitedNodeIds = new Set<string>();
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.pop()!;
    if (visitedNodeIds.has(nodeId)) continue;
    visitedNodeIds.add(nodeId);

    const outgoing = outgoingBySourceId.get(nodeId) ?? [];
    if (outgoing.length === 0 && viewerRequiresAlpha) return true;

    for (const { targetNode, targetPort } of outgoing) {
      if (targetNode.enabled === false) {
        if (targetPort === 'pipe') pendingNodeIds.push(targetNode.id);
        continue;
      }

      const behavior = resolveAlphaInputBehavior(
        nodeRegistry.get(targetNode.type),
        targetNode,
        targetPort,
      );
      if (behavior === 'consume') return true;
      if (behavior === 'propagate') pendingNodeIds.push(targetNode.id);
    }
  }

  return false;
};

/**
 * Finds enabled Roto nodes whose only observable contribution to the current
 * viewer branch is alpha. These nodes can be treated as RGB pass-throughs by
 * an interactive renderer without changing the displayed result.
 */
export const getAlphaDeadRotoNodeIds = ({
  nodes,
  viewerRequiresAlpha,
  nodeRegistry,
}: {
  nodes: readonly AnyNode[];
  viewerRequiresAlpha: boolean;
  nodeRegistry: AlphaBehaviorRegistry;
}): ReadonlySet<string> => {
  const alphaDeadNodeIds = new Set<string>();

  nodes.forEach((node) => {
    if (node.type !== NodeType.ROTO || node.enabled === false) return;
    if (
      !isNodeAlphaLiveInViewerPipeline({
        nodes,
        sourceNodeId: node.id,
        viewerRequiresAlpha,
        nodeRegistry,
      })
    ) {
      alphaDeadNodeIds.add(node.id);
    }
  });

  return alphaDeadNodeIds;
};
