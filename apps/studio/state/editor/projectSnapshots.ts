import type { EditorStateSlice } from '@blackboard/types';
import type { EditorState } from '@/state/editor/slices/types';

export type StoredProjectState = Omit<EditorStateSlice, 'projectId'>;

export const buildPersistedProjectState = (state: EditorState): StoredProjectState => ({
  flows: state.flows,
  rootFlowId: state.rootFlowId,
  activeFlowId: state.activeFlowId,
  activeTab: state.activeTab,
  aiChats: state.aiChats,
  activeAiChatId: state.activeAiChatId,
  selectedNodeId: state.selectedNodeId,
  history: state.history,
  historyIndex: state.historyIndex,
  viewerNodeId: state.viewerNodeId,
  viewerSlots: state.viewerSlots,
  activeViewerSlot: state.activeViewerSlot,
  renderSettings: state.renderSettings,
  viewerSettings: state.viewerSettings,
  fps: state.fps,
  currentFrame: state.currentFrame,
  nodePositionsByFlow: state.nodePositionsByFlow,
});
