import { NodeType, type NodePositions } from '@blackboard/types';
import { getNodePositionsForFlow, setNodePositionsForFlow } from '@/state/editor/flowModel';
import { computeAutoLayout } from '@/utils/autoLayoutGraph';
import { buildNodeStacks } from '@/utils/nodeStacks';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

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

const getPositionFlowId = (state: ReturnType<GetState>) => state.activeFlowId ?? state.rootFlowId;

export function createNodeViewActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
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
        getPositionFlowId(state),
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
      let resultPositions: NodePositions = {};

      deps.commitMutation((state) => {
        const otherNodes = state.nodes.filter((node) => node.type !== NodeType.SCENE);
        const nodeStacks = buildNodeStacks(otherNodes);
        const positions = computeAutoLayout(nodeStacks);
        resultPositions = positions;

        const nextNodePositionsByFlow = setNodePositionsForFlow(
          state.nodePositionsByFlow,
          getPositionFlowId(state),
          positions,
        );

        return {
          patch: { nodePositionsByFlow: nextNodePositionsByFlow },
          ...(options?.pushHistory === false
            ? {}
            : {
                history: {
                  label: 'Auto-arrange Nodes',
                  state: {
                    flows: state.flows,
                    selectedNodeId: state.selectedNodeId,
                    nodePositionsByFlow: state.nodePositionsByFlow,
                  },
                },
              }),
        };
      });

      return resultPositions;
    },

    setNodePosition: (nodeId: string, x: number, y: number) => {
      set((state) => {
        const positionFlowId = getPositionFlowId(state);
        const nodePositions = getNodePositionsForFlow(state.nodePositionsByFlow, positionFlowId);
        return {
          nodePositionsByFlow: setNodePositionsForFlow(state.nodePositionsByFlow, positionFlowId, {
            ...nodePositions,
            [nodeId]: { x, y },
          }),
        };
      });
    },

    commitNodePosition: (preNodePositions: NodePositions) => {
      const state = get();
      const nodePositions = getNodePositionsForFlow(
        state.nodePositionsByFlow,
        getPositionFlowId(state),
      );

      if (nodePositionsEqual(preNodePositions, nodePositions)) {
        return;
      }

      // Update the current history entry with pre-move positions so undo
      // restores the correct positions.
      updateActiveHistoryNodePositions(preNodePositions);

      // Push a new history entry with the current (post-move) state.
      // No state patch needed — position changes were already applied
      // during drag via setNodePosition / setNodePositions.
      deps.commitMutation({
        patch: {},
        history: {
          label: 'Move Node',
          state: {
            flows: state.flows,
            selectedNodeId: state.selectedNodeId,
            nodePositionsByFlow: state.nodePositionsByFlow,
          },
        },
        persist: 'debounced',
      });
    },

    setNodePositions: (positions: NodePositions, options?: { pushHistory?: boolean }) => {
      deps.commitMutation((state) => {
        const nextNodePositionsByFlow = setNodePositionsForFlow(
          state.nodePositionsByFlow,
          getPositionFlowId(state),
          positions,
        );

        return {
          patch: { nodePositionsByFlow: nextNodePositionsByFlow },
          ...(options?.pushHistory === false
            ? {}
            : {
                history: {
                  label: 'Auto-arrange Nodes',
                  state: {
                    flows: state.flows,
                    selectedNodeId: state.selectedNodeId,
                    nodePositionsByFlow: state.nodePositionsByFlow,
                  },
                },
              }),
        };
      });
    },

    setPendingNodePosition: (position: { x: number; y: number } | null) => {
      set(() => ({ pendingNodePosition: position }));
    },

    cleanNodePositions: (deletedIds: Set<string>) => {
      const state = get();
      const positionFlowId = getPositionFlowId(state);
      const nodePositions = getNodePositionsForFlow(state.nodePositionsByFlow, positionFlowId);
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
            positionFlowId,
            cleanedPositions,
          ),
        }));
      }
    },
  };
}
