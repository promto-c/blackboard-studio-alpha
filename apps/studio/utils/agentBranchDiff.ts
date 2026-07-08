import { NodeType, type AnyNode, type Flow, type PersistedProjectState } from '@blackboard/types';
import { getOrderedNodesFromFlow } from '@/state/editor/flowModel';

export interface AgentBranchDiffSummary {
  hasChanges: boolean;
  items: string[];
  nodeChanges: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  domainChanges: {
    roto: string[];
    paint: string[];
    assets: {
      added: string[];
      removed: string[];
    };
    conflicts: string[];
    details: Array<{
      domain: 'roto' | 'paint' | 'assets' | 'node';
      severity: 'info' | 'warning';
      title: string;
      description: string;
      recommendation: string;
    }>;
  };
}

const stringifyComparable = (value: unknown) => JSON.stringify(value ?? null);

const getNodeLabel = (node: AnyNode | undefined, fallbackId: string) =>
  node?.name?.trim() || fallbackId;

const collectNodes = (state: PersistedProjectState | null | undefined) => {
  const nodesById = new Map<string, AnyNode>();
  Object.values((state?.flows ?? {}) as Record<string, Flow>).forEach((flow) => {
    getOrderedNodesFromFlow(flow).forEach((node) => {
      nodesById.set(node.id, node);
    });
  });
  return nodesById;
};

const hasFlowTopologyChange = (
  base: PersistedProjectState | null | undefined,
  candidate: PersistedProjectState | null | undefined,
) => {
  const serializeTopology = (state: PersistedProjectState | null | undefined) =>
    stringifyComparable(
      Object.values((state?.flows ?? {}) as Record<string, Flow>).map((flow) => ({
        id: flow.id,
        outputNodeId: flow.outputNodeId,
        edges: flow.edges,
        stacks: flow.stacks,
      })),
    );

  return serializeTopology(base) !== serializeTopology(candidate);
};

const countArray = (value: unknown) => (Array.isArray(value) ? value.length : 0);

const collectAssetIdsFromNode = (node: AnyNode): string[] => {
  const ids = new Set<string>();
  const maybeNode = node as unknown as Record<string, unknown>;

  if (typeof maybeNode.src === 'string' && maybeNode.src.trim()) {
    ids.add(maybeNode.src);
  }
  if (Array.isArray(maybeNode.frames)) {
    maybeNode.frames.forEach((frame) => {
      if (typeof frame === 'string' && frame.trim()) {
        ids.add(frame);
      }
    });
  }
  if (Array.isArray(maybeNode.generatedOutputs)) {
    maybeNode.generatedOutputs.forEach((output) => {
      if (
        output &&
        typeof output === 'object' &&
        typeof (output as { src?: unknown }).src === 'string'
      ) {
        ids.add((output as { src: string }).src);
      }
    });
  }

  return Array.from(ids);
};

const collectAssetIds = (nodes: Map<string, AnyNode>) => {
  const ids = new Set<string>();
  nodes.forEach((node) => {
    collectAssetIdsFromNode(node).forEach((assetId) => ids.add(assetId));
  });
  return ids;
};

const collectDomainChanges = (
  baseNodes: Map<string, AnyNode>,
  candidateNodes: Map<string, AnyNode>,
  changedNodeIds: string[],
): AgentBranchDiffSummary['domainChanges'] => {
  const roto: string[] = [];
  const paint: string[] = [];
  const conflicts: string[] = [];
  const details: AgentBranchDiffSummary['domainChanges']['details'] = [];

  changedNodeIds.forEach((nodeId) => {
    const baseNode = baseNodes.get(nodeId);
    const candidateNode = candidateNodes.get(nodeId);
    if (!baseNode || !candidateNode) return;

    if (baseNode.type !== candidateNode.type) {
      const title = `${getNodeLabel(candidateNode, nodeId)} changes node type.`;
      conflicts.push(title);
      details.push({
        domain: 'node',
        severity: 'warning',
        title,
        description: 'The branch changes a node to a different effect type.',
        recommendation:
          'Inspect this branch before full apply. Pick Nodes may be safer if unrelated parent changes should stay untouched.',
      });
      return;
    }

    if (candidateNode.type === NodeType.ROTO) {
      const beforePaths = countArray((baseNode as { paths?: unknown }).paths);
      const afterPaths = countArray((candidateNode as { paths?: unknown }).paths);
      const beforeLayers = countArray((baseNode as { layers?: unknown }).layers);
      const afterLayers = countArray((candidateNode as { layers?: unknown }).layers);
      roto.push(
        `${getNodeLabel(candidateNode, nodeId)} roto paths ${beforePaths} -> ${afterPaths}, layers ${beforeLayers} -> ${afterLayers}.`,
      );
      details.push({
        domain: 'roto',
        severity: beforePaths > afterPaths || beforeLayers > afterLayers ? 'warning' : 'info',
        title: `${getNodeLabel(candidateNode, nodeId)} roto edit`,
        description: `Paths ${beforePaths} -> ${afterPaths}; layers ${beforeLayers} -> ${afterLayers}.`,
        recommendation:
          beforePaths > afterPaths || beforeLayers > afterLayers
            ? 'Review the mask before full apply because the agent removed roto data.'
            : 'Use Preview/Self Review to verify edge quality before applying.',
      });
    }

    if (candidateNode.type === NodeType.PAINT) {
      const beforeStrokes = countArray((baseNode as { strokes?: unknown }).strokes);
      const afterStrokes = countArray((candidateNode as { strokes?: unknown }).strokes);
      const beforeLayers = countArray((baseNode as { layers?: unknown }).layers);
      const afterLayers = countArray((candidateNode as { layers?: unknown }).layers);
      paint.push(
        `${getNodeLabel(candidateNode, nodeId)} paint strokes ${beforeStrokes} -> ${afterStrokes}, layers ${beforeLayers} -> ${afterLayers}.`,
      );
      details.push({
        domain: 'paint',
        severity: beforeStrokes > afterStrokes || beforeLayers > afterLayers ? 'warning' : 'info',
        title: `${getNodeLabel(candidateNode, nodeId)} paint edit`,
        description: `Strokes ${beforeStrokes} -> ${afterStrokes}; layers ${beforeLayers} -> ${afterLayers}.`,
        recommendation:
          beforeStrokes > afterStrokes || beforeLayers > afterLayers
            ? 'Review the paint layer before full apply because the agent removed paint data.'
            : 'Use Preview/Self Review to verify stroke placement before applying.',
      });
    }
  });

  const baseAssetIds = collectAssetIds(baseNodes);
  const candidateAssetIds = collectAssetIds(candidateNodes);
  const addedAssets = Array.from(candidateAssetIds).filter((assetId) => !baseAssetIds.has(assetId));
  const removedAssets = Array.from(baseAssetIds).filter(
    (assetId) => !candidateAssetIds.has(assetId),
  );
  if (addedAssets.length > 0 || removedAssets.length > 0) {
    details.push({
      domain: 'assets',
      severity: removedAssets.length > 0 ? 'warning' : 'info',
      title: `Media assets +${addedAssets.length}, -${removedAssets.length}`,
      description: [
        addedAssets.length
          ? `Adds ${addedAssets.slice(0, 3).join(', ')}${addedAssets.length > 3 ? ', ...' : ''}.`
          : '',
        removedAssets.length
          ? `Removes ${removedAssets.slice(0, 3).join(', ')}${removedAssets.length > 3 ? ', ...' : ''}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      recommendation:
        removedAssets.length > 0
          ? 'Prefer Pick Nodes or inspect all media references before full apply.'
          : 'Confirm added assets are expected before applying.',
    });
  }

  return {
    roto,
    paint,
    assets: {
      added: addedAssets,
      removed: removedAssets,
    },
    conflicts,
    details,
  };
};

export const summarizeAgentBranchDiff = (
  base: PersistedProjectState | null | undefined,
  candidate: PersistedProjectState | null | undefined,
): AgentBranchDiffSummary => {
  const baseNodes = collectNodes(base);
  const candidateNodes = collectNodes(candidate);
  const added = Array.from(candidateNodes.keys()).filter((id) => !baseNodes.has(id));
  const removed = Array.from(baseNodes.keys()).filter((id) => !candidateNodes.has(id));
  const changed = Array.from(candidateNodes.keys()).filter((id) => {
    const baseNode = baseNodes.get(id);
    const candidateNode = candidateNodes.get(id);
    return (
      baseNode &&
      candidateNode &&
      stringifyComparable(baseNode) !== stringifyComparable(candidateNode)
    );
  });

  const items: string[] = [];
  if (added.length > 0) {
    items.push(
      `Adds ${added.length} node${added.length === 1 ? '' : 's'}: ${added
        .slice(0, 3)
        .map((id) => getNodeLabel(candidateNodes.get(id), id))
        .join(', ')}${added.length > 3 ? ', ...' : ''}`,
    );
  }
  if (removed.length > 0) {
    items.push(
      `Removes ${removed.length} node${removed.length === 1 ? '' : 's'}: ${removed
        .slice(0, 3)
        .map((id) => getNodeLabel(baseNodes.get(id), id))
        .join(', ')}${removed.length > 3 ? ', ...' : ''}`,
    );
  }
  if (changed.length > 0) {
    items.push(
      `Updates ${changed.length} node${changed.length === 1 ? '' : 's'}: ${changed
        .slice(0, 3)
        .map((id) => getNodeLabel(candidateNodes.get(id), id))
        .join(', ')}${changed.length > 3 ? ', ...' : ''}`,
    );
  }
  if (hasFlowTopologyChange(base, candidate)) {
    items.push('Changes flow connections or stack order.');
  }
  if (
    stringifyComparable(base?.nodePositionsByFlow) !==
    stringifyComparable(candidate?.nodePositionsByFlow)
  ) {
    items.push('Changes node positions.');
  }
  if (
    stringifyComparable({
      renderSettings: base?.renderSettings,
      fps: base?.fps,
    }) !==
    stringifyComparable({
      renderSettings: candidate?.renderSettings,
      fps: candidate?.fps,
    })
  ) {
    items.push('Changes project settings.');
  }
  if (stringifyComparable(base?.aiChats) !== stringifyComparable(candidate?.aiChats)) {
    items.push('Changes saved chat history.');
  }
  const domainChanges = collectDomainChanges(baseNodes, candidateNodes, changed);
  if (domainChanges.roto.length > 0) {
    items.push(
      `Changes roto data on ${domainChanges.roto.length} node${domainChanges.roto.length === 1 ? '' : 's'}.`,
    );
  }
  if (domainChanges.paint.length > 0) {
    items.push(
      `Changes paint data on ${domainChanges.paint.length} node${domainChanges.paint.length === 1 ? '' : 's'}.`,
    );
  }
  if (domainChanges.assets.added.length > 0 || domainChanges.assets.removed.length > 0) {
    items.push(
      `Changes media assets (+${domainChanges.assets.added.length}, -${domainChanges.assets.removed.length}).`,
    );
  }
  if (domainChanges.conflicts.length > 0) {
    items.push(
      `Has ${domainChanges.conflicts.length} explicit conflict warning${domainChanges.conflicts.length === 1 ? '' : 's'}.`,
    );
  }

  return {
    hasChanges: items.length > 0,
    items,
    nodeChanges: {
      added,
      removed,
      changed,
    },
    domainChanges,
  };
};
