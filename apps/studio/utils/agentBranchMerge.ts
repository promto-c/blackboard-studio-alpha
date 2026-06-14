import type { AnyNode, FlowId, NodePositions, PersistedProjectState } from '@blackboard/types';
import {
  getNodePositionsForFlow,
  getOrderedNodesFromFlow,
  replaceFlowNodes,
  setNodePositionsForFlow,
} from '@/state/editor/flowModel';
import { summarizeAgentBranchDiff, type AgentBranchDiffSummary } from './agentBranchDiff';

interface AgentNodeCherryPickResult {
  state: PersistedProjectState;
  summary: AgentBranchDiffSummary;
  appliedNodeIds: string[];
  skippedNodeIds: string[];
}

const getPrimaryFlowId = (state: PersistedProjectState): FlowId | null =>
  state.activeFlowId ?? state.rootFlowId ?? Object.keys(state.flows ?? {})[0] ?? null;

const removeMissingInputs = (node: AnyNode, availableNodeIds: Set<string>): AnyNode => {
  if (!node.inputs) return node;

  const inputs = { ...node.inputs };
  const inputSourcePorts = { ...(node.inputSourcePorts ?? {}) };
  let changed = false;

  Object.entries(inputs).forEach(([portName, sourceNodeId]) => {
    if (!availableNodeIds.has(sourceNodeId)) {
      delete inputs[portName];
      delete inputSourcePorts[portName];
      changed = true;
    }
  });

  return changed
    ? ({
        ...node,
        inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
        inputSourcePorts: Object.keys(inputSourcePorts).length > 0 ? inputSourcePorts : undefined,
      } as AnyNode)
    : node;
};

const insertAddedNodesInBranchOrder = (
  parentNodes: AnyNode[],
  branchNodes: AnyNode[],
  addedNodeIds: string[],
): AnyNode[] => {
  const nextNodes = [...parentNodes];
  const nextNodeIds = new Set(nextNodes.map((node) => node.id));

  addedNodeIds.forEach((nodeId) => {
    const node = branchNodes.find((entry) => entry.id === nodeId);
    if (!node || nextNodeIds.has(node.id)) return;

    const branchIndex = branchNodes.findIndex((entry) => entry.id === nodeId);
    let insertIndex = nextNodes.length;
    for (let index = branchIndex - 1; index >= 0; index -= 1) {
      const previousNodeId = branchNodes[index]?.id;
      const previousIndex = nextNodes.findIndex((entry) => entry.id === previousNodeId);
      if (previousIndex !== -1) {
        insertIndex = previousIndex + 1;
        break;
      }
    }

    nextNodes.splice(insertIndex, 0, node);
    nextNodeIds.add(node.id);
  });

  return nextNodes;
};

export const cherryPickAgentNodeChanges = (
  parentState: PersistedProjectState,
  branchState: PersistedProjectState,
): AgentNodeCherryPickResult => {
  const summary = summarizeAgentBranchDiff(parentState, branchState);
  const parentFlowId = getPrimaryFlowId(parentState);
  const branchFlowId = getPrimaryFlowId(branchState);
  const parentFlow = parentFlowId ? parentState.flows?.[parentFlowId] : null;
  const branchFlow = branchFlowId ? branchState.flows?.[branchFlowId] : null;
  if (!parentFlowId || !parentFlow || !branchFlow) {
    return {
      state: parentState,
      summary,
      appliedNodeIds: [],
      skippedNodeIds: [...summary.nodeChanges.added, ...summary.nodeChanges.changed],
    };
  }

  const parentNodes = getOrderedNodesFromFlow(parentFlow);
  const branchNodes = getOrderedNodesFromFlow(branchFlow);
  const branchNodesById = new Map(branchNodes.map((node) => [node.id, node]));
  const changedNodeIds = summary.nodeChanges.changed.filter((nodeId) =>
    branchNodesById.has(nodeId),
  );
  const addedNodeIds = summary.nodeChanges.added.filter((nodeId) => branchNodesById.has(nodeId));
  const changedNodeIdSet = new Set(changedNodeIds);

  const replacedNodes = parentNodes.map((node) =>
    changedNodeIdSet.has(node.id) ? (branchNodesById.get(node.id) ?? node) : node,
  );
  const nextNodesWithAdds = insertAddedNodesInBranchOrder(replacedNodes, branchNodes, addedNodeIds);
  const availableNodeIds = new Set(nextNodesWithAdds.map((node) => node.id));
  const nextNodes = nextNodesWithAdds.map((node) => removeMissingInputs(node, availableNodeIds));
  const nextFlows = replaceFlowNodes(
    parentState.flows ?? {},
    parentFlowId,
    nextNodes,
    parentFlow.name,
  );

  const parentPositions = getNodePositionsForFlow(
    parentState.nodePositionsByFlow ?? {},
    parentFlowId,
  );
  const branchPositions = getNodePositionsForFlow(
    branchState.nodePositionsByFlow ?? {},
    branchFlowId,
  );
  const nextPositions: NodePositions = { ...parentPositions };
  [...changedNodeIds, ...addedNodeIds].forEach((nodeId) => {
    if (branchPositions[nodeId]) {
      nextPositions[nodeId] = branchPositions[nodeId];
    }
  });

  return {
    state: {
      ...parentState,
      flows: nextFlows,
      activeFlowId: parentFlowId,
      rootFlowId: parentState.rootFlowId ?? parentFlowId,
      nodePositionsByFlow: setNodePositionsForFlow(
        parentState.nodePositionsByFlow ?? {},
        parentFlowId,
        nextPositions,
      ),
    },
    summary,
    appliedNodeIds: [...changedNodeIds, ...addedNodeIds],
    skippedNodeIds: summary.nodeChanges.removed,
  };
};
