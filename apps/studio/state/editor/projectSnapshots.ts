import type { PersistedProjectState } from '@blackboard/types';
import type { EditorState } from '@/state/editor/slices/types';
import { getRootFlow, replaceFlowNodes } from '@/state/editor/flowModel';

export type StoredProjectState = PersistedProjectState;
export type BuildPersistedProjectStateOptions = {
  maxHistoryEntries?: number;
  checkpointLatestHistoryEntry?: boolean;
};

export type RestorePersistedProjectHistoryOptions = {
  truncateFutureHistory?: boolean;
};

const stripSessionState = (
  entry: EditorState['history'][number],
): EditorState['history'][number] => {
  const {
    history: _history,
    historyIndex: _historyIndex,
    viewerSettings: _viewerSettings,
    viewportWorkingArea: _viewportWorkingArea,
    ...state
  } = entry.state;
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
    colorManagement: state.colorManagement,
    aiChats: state.aiChats,
    aiAgentRuns: state.aiAgentRuns,
    activeAiAgentRunId: state.activeAiAgentRunId,
    activeAiChatId: state.activeAiChatId,
    selectedNodeId: state.selectedNodeId,
    viewerNodeId: state.viewerNodeId,
    viewerSlots: state.viewerSlots,
    activeViewerSlot: state.activeViewerSlot,
    viewportWorkingArea: state.viewportWorkingArea,
    renderSettings: state.renderSettings,
    fps: state.fps,
    currentFrame: state.currentFrame,
    nodePositionsByFlow: state.nodePositionsByFlow,
    history,
    historyIndex,
  };
};

/**
 * Materializes a persisted history entry as a complete project snapshot.
 * History entries are partial editor patches, so node-only entries must also
 * be projected back into the canonical flow model before they can be opened.
 */
export const restorePersistedProjectHistoryEntry = (
  projectState: StoredProjectState,
  historyEntryId: string,
  options: RestorePersistedProjectHistoryOptions = {},
): StoredProjectState | null => {
  const history = Array.isArray(projectState.history) ? projectState.history : [];
  const historyIndex = history.findIndex((entry) => entry.id === historyEntryId);
  if (historyIndex < 0) return null;

  const entry = history[historyIndex];
  const restoredState: StoredProjectState = {
    ...projectState,
    ...entry.state,
    history: options.truncateFutureHistory ? history.slice(0, historyIndex + 1) : history,
    historyIndex,
  };

  if (entry.state.nodes) {
    const flowId =
      restoredState.activeFlowId ??
      restoredState.rootFlowId ??
      projectState.activeFlowId ??
      projectState.rootFlowId;

    if (flowId) {
      restoredState.flows = replaceFlowNodes(
        restoredState.flows ?? {},
        flowId,
        entry.state.nodes,
        getRootFlow(restoredState.flows ?? {}, flowId)?.name ?? 'Root Flow',
      );
      restoredState.rootFlowId = restoredState.rootFlowId ?? flowId;
      restoredState.activeFlowId = flowId;
    }
  }

  if (options.truncateFutureHistory) {
    restoredState.historyIndex = restoredState.history.length - 1;
  }

  return restoredState;
};
