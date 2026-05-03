import { NodeType, type HistoryEntry, type NodePositions } from '@blackboard/types';
import { getNodePositionsForFlow, setNodePositionsForFlow } from '@/state/editor/flowModel';
import { computeAutoLayout } from '@/utils/autoLayoutGraph';
import { buildNodeStacks } from '@/utils/nodeStacks';
import type { SetState, GetState } from '@/state/editor/slices/types';

function nodePositionsEqual(a: NodePositions, b: NodePositions) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    const aPosition = a[key];
    const bPosition = b[key];

    if (!bPosition || aPosition.x !== bPosition.x || aPosition.y !== bPosition.y) {
      return false;
    }
  }

  return true;
}

const cloneNodePositions = (positions: NodePositions): NodePositions =>
  Object.fromEntries(
    Object.entries(positions).map(([nodeId, position]) => [nodeId, { ...position }]),
  );

export function createNodeViewActions(
  set: SetState,
  get: GetState,
  deps: {
    pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
    debouncedSave: () => void;
  },
) {
  const updateActiveHistoryNodePositions = (preNodePositions: NodePositions) => {
    set((state) => {
      const activeHistoryEntry = state.history[state.historyIndex];
      if (!activeHistoryEntry) {
        return {};
      }

      const preNodePositionsByFlow = setNodePositionsForFlow(
        state.nodePositionsByFlow,
        state.rootFlowId,
        cloneNodePositions(preNodePositions),
      );

      return {
        history: state.history.map((entry, index) =>
          index === state.historyIndex
            ? {
                ...entry,
                state: {
                  ...entry.state,
                  nodePositionsByFlow: preNodePositionsByFlow,
                },
              }
            : entry,
        ),
      };
    });
  };

  return {
    autoArrangeNodes: (options?: { pushHistory?: boolean }) => {
      const state = get();
      const otherNodes = state.nodes.filter((node) => node.type !== NodeType.SCENE);
      const nodeStacks = buildNodeStacks(otherNodes);
      const positions = computeAutoLayout(state.nodes, nodeStacks);

      set(() => ({
        nodePositionsByFlow: setNodePositionsForFlow(
          state.nodePositionsByFlow,
          state.rootFlowId,
          positions,
        ),
      }));

      if (options?.pushHistory === false) {
        return positions;
      }

      const nextState = get();
      deps.pushHistory({
        label: 'Auto-arrange Nodes',
        state: {
          flows: nextState.flows,
          selectedNodeId: nextState.selectedNodeId,
          nodePositionsByFlow: nextState.nodePositionsByFlow,
        },
      });

      return positions;
    },

    setNodePosition: (nodeId: string, x: number, y: number) => {
      set((state) => {
        const nodePositions = getNodePositionsForFlow(state.nodePositionsByFlow, state.rootFlowId);
        return {
          nodePositionsByFlow: setNodePositionsForFlow(
            state.nodePositionsByFlow,
            state.rootFlowId,
            {
              ...nodePositions,
              [nodeId]: { x, y },
            },
          ),
        };
      });
    },

    commitNodePosition: (preNodePositions: NodePositions) => {
      const state = get();
      const nodePositions = getNodePositionsForFlow(state.nodePositionsByFlow, state.rootFlowId);

      if (nodePositionsEqual(preNodePositions, nodePositions)) {
        return;
      }

      updateActiveHistoryNodePositions(preNodePositions);

      const nextState = get();
      deps.pushHistory({
        label: 'Move Node',
        state: {
          flows: nextState.flows,
          selectedNodeId: nextState.selectedNodeId,
          nodePositionsByFlow: nextState.nodePositionsByFlow,
        },
      });
    },

    setNodePositions: (positions: NodePositions, options?: { pushHistory?: boolean }) => {
      set((state) => ({
        nodePositionsByFlow: setNodePositionsForFlow(
          state.nodePositionsByFlow,
          state.rootFlowId,
          positions,
        ),
      }));

      if (options?.pushHistory === false) {
        return;
      }

      const state = get();
      deps.pushHistory({
        label: 'Auto-arrange Nodes',
        state: {
          flows: state.flows,
          selectedNodeId: state.selectedNodeId,
          nodePositionsByFlow: state.nodePositionsByFlow,
        },
      });
    },

    cleanNodePositions: (deletedIds: Set<string>) => {
      const state = get();
      const nodePositions = getNodePositionsForFlow(state.nodePositionsByFlow, state.rootFlowId);
      const cleanedPositions = { ...nodePositions };
      let changed = false;

      for (const id of deletedIds) {
        if (id in cleanedPositions) {
          delete cleanedPositions[id];
          changed = true;
        }
      }

      if (changed) {
        set(() => ({
          nodePositionsByFlow: setNodePositionsForFlow(
            state.nodePositionsByFlow,
            state.rootFlowId,
            cleanedPositions,
          ),
        }));
      }
    },
  };
}
