import { NodeType, type AnyNode, type Flow, type GroupNode } from '@blackboard/types';
import { getOrderedNodesFromFlow } from '@/state/editor/flowModel';
import { collectUpstreamNodeIds, getOutputInputEdge } from '@/utils/flowTopology';

const rewriteNodeInputs = (node: AnyNode, replacements: ReadonlyMap<string, string>): AnyNode => {
  if (!node.inputs) return node;

  let changed = false;
  const nextInputs = Object.fromEntries(
    Object.entries(node.inputs).map(([portName, sourceNodeId]) => {
      const replacement = replacements.get(sourceNodeId);
      if (replacement) {
        changed = true;
        return [portName, replacement];
      }
      return [portName, sourceNodeId];
    }),
  );

  return changed ? ({ ...node, inputs: nextInputs } as AnyNode) : node;
};

const removeUnresolvedEntryInputs = (node: AnyNode, entryNodeIds: ReadonlySet<string>): AnyNode => {
  if (!node.inputs) return node;

  let changed = false;
  const nextInputs = { ...node.inputs };
  const nextInputSourcePorts = { ...(node.inputSourcePorts ?? {}) };

  for (const [portName, sourceNodeId] of Object.entries(node.inputs)) {
    if (!entryNodeIds.has(sourceNodeId)) continue;

    delete nextInputs[portName];
    delete nextInputSourcePorts[portName];
    changed = true;
  }

  if (!changed) return node;

  return {
    ...node,
    inputs: Object.keys(nextInputs).length > 0 ? nextInputs : undefined,
    inputSourcePorts:
      Object.keys(nextInputSourcePorts).length > 0 ? nextInputSourcePorts : undefined,
  } as AnyNode;
};

const isGroupEntryInputNode = (node: AnyNode): boolean =>
  node.type === NodeType.INPUT &&
  (!!(node as { groupNodeId?: string | null }).groupNodeId ||
    !!(node as { externalInputId?: string | null }).externalInputId);

type SourceContext = {
  nodes: AnyNode[];
  outputNodeId: string;
};

const getFlowNodesThroughNode = (flow: Flow, nodeId: string): SourceContext | null => {
  const orderedNodes = getOrderedNodesFromFlow(flow);
  if (!orderedNodes.some((node) => node.id === nodeId)) return null;
  const includedNodeIds = new Set(collectUpstreamNodeIds(flow.edges, nodeId));
  includedNodeIds.add(nodeId);

  return {
    nodes: orderedNodes.filter(
      (node) => node.type === NodeType.SCENE || includedNodeIds.has(node.id),
    ),
    outputNodeId: nodeId,
  };
};

const findSourceContextInFlows = (
  nodeId: string,
  flows: Record<string, Flow>,
): SourceContext | null => {
  for (const flow of Object.values(flows)) {
    const sourceContext = getFlowNodesThroughNode(flow, nodeId);
    if (sourceContext) return sourceContext;
  }
  return null;
};

const findParentSourceForEntryNode = (
  entryNode: AnyNode,
  flows: Record<string, Flow>,
): SourceContext | null => {
  for (const flow of Object.values(flows)) {
    for (const node of getOrderedNodesFromFlow(flow)) {
      if (node.type !== NodeType.GROUP) continue;
      const groupNode = node as GroupNode;
      const externalInput = groupNode.externalInputs?.find(
        (input) => input.entryNodeId === entryNode.id,
      );
      if (!externalInput) continue;
      const sourceNodeId = groupNode.inputs?.[externalInput.id];
      return sourceNodeId ? findSourceContextInFlows(sourceNodeId, flows) : null;
    }
  }
  return null;
};

type ProjectionResult = {
  nodes: AnyNode[];
  outputReplacements: Map<string, string>;
};

const projectGroupNodesForRender = (
  nodes: readonly AnyNode[],
  flows: Record<string, Flow>,
  depth = 0,
): ProjectionResult => {
  if (depth > 8) {
    return { nodes: [...nodes], outputReplacements: new Map() };
  }

  const projectedNodes: AnyNode[] = [];
  const outputReplacements = new Map<string, string>();
  const emittedEntrySourceIds = new Set<string>();
  const emittedNodeIds = new Set<string>();

  const pushProjectedNodes = (nodesToPush: readonly AnyNode[]) => {
    for (const nodeToPush of nodesToPush) {
      if (emittedNodeIds.has(nodeToPush.id)) continue;
      projectedNodes.push(nodeToPush);
      emittedNodeIds.add(nodeToPush.id);
    }
  };

  for (const rawNode of nodes) {
    const node = rewriteNodeInputs(rawNode, outputReplacements);

    if (node.type !== NodeType.GROUP) {
      if (isGroupEntryInputNode(node)) {
        const sourceContext = findParentSourceForEntryNode(node, flows);
        if (sourceContext) {
          const sourceProjection = projectGroupNodesForRender(
            sourceContext.nodes,
            flows,
            depth + 1,
          );
          const sourceOutputId =
            sourceProjection.outputReplacements.get(sourceContext.outputNodeId) ??
            sourceContext.outputNodeId;
          if (!emittedEntrySourceIds.has(sourceContext.outputNodeId)) {
            pushProjectedNodes(sourceProjection.nodes);
            emittedEntrySourceIds.add(sourceContext.outputNodeId);
          }
          outputReplacements.set(node.id, sourceOutputId);
        }
      } else {
        pushProjectedNodes([node]);
      }
      continue;
    }

    const groupNode = node as GroupNode;
    if (!groupNode.enabled) continue;

    const childFlow = groupNode.childFlowId ? flows[groupNode.childFlowId] : null;
    if (!childFlow) {
      pushProjectedNodes([node]);
      continue;
    }

    const entryReplacements = new Map<string, string>();
    for (const input of groupNode.externalInputs ?? []) {
      const sourceNodeId = groupNode.inputs?.[input.id];
      if (sourceNodeId) {
        entryReplacements.set(input.entryNodeId, sourceNodeId);
      }
    }

    const entryNodeIds = new Set(
      childFlow.nodes.filter(isGroupEntryInputNode).map((child) => child.id),
    );
    const childNodes = getOrderedNodesFromFlow(childFlow)
      .filter((childNode) => !isGroupEntryInputNode(childNode))
      .map((childNode) =>
        removeUnresolvedEntryInputs(rewriteNodeInputs(childNode, entryReplacements), entryNodeIds),
      );

    const childProjection = projectGroupNodesForRender(childNodes, flows, depth + 1);
    pushProjectedNodes(childProjection.nodes);

    const canonicalOutputNodeId =
      groupNode.outputNodeId ?? getOutputInputEdge(childFlow)?.sourceNodeId ?? null;
    const outputNodeId = canonicalOutputNodeId
      ? (childProjection.outputReplacements.get(canonicalOutputNodeId) ?? canonicalOutputNodeId)
      : null;
    if (outputNodeId) {
      outputReplacements.set(groupNode.id, outputNodeId);
    }
  }

  return {
    nodes: projectedNodes.map((node) => rewriteNodeInputs(node, outputReplacements)),
    outputReplacements,
  };
};

export const expandGroupNodesForRender = (
  nodes: readonly AnyNode[],
  flows: Record<string, Flow>,
): AnyNode[] => {
  return projectGroupNodesForRender(nodes, flows).nodes;
};
