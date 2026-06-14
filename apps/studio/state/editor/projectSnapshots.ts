import type { PersistedProjectState } from '@blackboard/types';
import type { EditorState } from '@/state/editor/slices/types';

export type StoredProjectState = PersistedProjectState;
export type BuildPersistedProjectStateOptions = {
  maxHistoryEntries?: number;
  checkpointLatestHistoryEntry?: boolean;
};

const stripSessionState = (
  entry: EditorState['history'][number],
): EditorState['history'][number] => {
  const { history: _history, historyIndex: _historyIndex, ...state } = entry.state;
  return {
    ...entry,
    state,
  };
};

export const buildPersistedProjectState = (
  state: EditorState,
  options: BuildPersistedProjectStateOptions = {},
): StoredProjectState => {
  const filteredHistory = state.history.map(stripSessionState);
  const maxEntries = options.maxHistoryEntries;

  let history = filteredHistory;
  let historyIndex = state.historyIndex;

  if (maxEntries !== undefined && maxEntries > 0 && history.length > maxEntries) {
    const clampedIndex = Math.max(0, Math.min(historyIndex, history.length - 1));
    const end = Math.min(history.length, Math.max(clampedIndex + 1, maxEntries));
    const start = Math.max(0, end - maxEntries);
    history = history.slice(start, end);
    historyIndex = clampedIndex - start;
  }

  if (options.checkpointLatestHistoryEntry && historyIndex >= 0 && historyIndex < history.length) {
    const entry = history[historyIndex];
    if (typeof entry.checkpointLabel !== 'string' || entry.checkpointLabel.trim().length === 0) {
      history = history.map((e, i) =>
        i === historyIndex ? { ...e, checkpointLabel: e.label } : e,
      );
    }
  }

  return {
    flows: state.flows,
    rootFlowId: state.rootFlowId,
    activeFlowId: state.activeFlowId,
    activeTab: state.activeTab,
    aiChats: state.aiChats,
    aiAgentRuns: state.aiAgentRuns,
    activeAiAgentRunId: state.activeAiAgentRunId,
    activeAiChatId: state.activeAiChatId,
    selectedNodeId: state.selectedNodeId,
    viewerNodeId: state.viewerNodeId,
    viewerSlots: state.viewerSlots,
    activeViewerSlot: state.activeViewerSlot,
    renderSettings: state.renderSettings,
    viewerSettings: state.viewerSettings,
    fps: state.fps,
    currentFrame: state.currentFrame,
    nodePositionsByFlow: state.nodePositionsByFlow,
    history,
    historyIndex,
  };
};
