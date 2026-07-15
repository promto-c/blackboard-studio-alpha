import {
  getOrderedNodesFromFlow,
  getRootFlow,
  replaceFlowNodes,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import type { EditorState } from '@/state/editor/slices/types';
import { clampToTimelineRange, findSceneTimelineRange } from '@/utils/timelineRange';

/**
 * Keeps the temporary node-list projection aligned with the canonical flow model.
 * Structural flow patches always win when a caller supplies both representations.
 */
export const normalizeEditorState = (
  previousState: EditorState,
  patch: Partial<EditorState> | EditorState,
): EditorState => {
  const nextState = { ...previousState, ...patch } as EditorState;
  const hasNodesMutation = 'nodes' in patch;
  const hasStructuralFlowMutation =
    'flows' in patch || 'rootFlowId' in patch || 'activeFlowId' in patch;
  const hasSelectedNodeMutation = 'selectedNodeId' in patch;
  const hasSelectedNodesMutation = 'selectedNodeIds' in patch;

  if (hasSelectedNodeMutation && !hasSelectedNodesMutation) {
    nextState.selectedNodeIds = nextState.selectedNodeId ? [nextState.selectedNodeId] : [];
  } else if (hasSelectedNodesMutation && !hasSelectedNodeMutation) {
    nextState.selectedNodeId =
      nextState.selectedNodeIds?.[nextState.selectedNodeIds.length - 1] ?? null;
  }

  if (hasNodesMutation && !hasStructuralFlowMutation) {
    const nextNodes = nextState.nodes ?? [];
    if (nextNodes.length > 0) {
      const flowId = nextState.activeFlowId ?? nextState.rootFlowId ?? ROOT_FLOW_ID;
      nextState.flows = replaceFlowNodes(
        nextState.flows,
        flowId,
        nextNodes,
        getRootFlow(previousState.flows, flowId)?.name ?? 'Root Flow',
      );
      nextState.rootFlowId = nextState.rootFlowId ?? flowId;
      nextState.activeFlowId = flowId;
    } else {
      nextState.flows = {};
      nextState.rootFlowId = null;
      nextState.activeFlowId = null;
      nextState.selectedNodeId = null;
      nextState.nodePositionsByFlow = {};
    }
  }

  if (hasNodesMutation || hasStructuralFlowMutation) {
    const activeFlow = getRootFlow(nextState.flows, nextState.activeFlowId);
    nextState.nodes = getOrderedNodesFromFlow(activeFlow);
    const rootFlow = getRootFlow(nextState.flows, nextState.rootFlowId);
    const timelineRange = findSceneTimelineRange(getOrderedNodesFromFlow(rootFlow));
    nextState.timelineStartFrame = timelineRange.startFrame;
    nextState.maxFrames = timelineRange.endFrame;
    nextState.currentFrame = clampToTimelineRange(nextState.currentFrame, timelineRange);
  }

  return nextState;
};
