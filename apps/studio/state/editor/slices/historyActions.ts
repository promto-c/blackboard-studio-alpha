import { type HistoryEntry, type RotoPointRef, type SelectedKeyframeRef } from '@blackboard/types';
import type { SetState, GetState } from '@/state/editor/slices/types';
import { isCheckpointEntry } from '@/state/editor/history';

type HistoryActionEntry = Omit<HistoryEntry, 'id'>;
type RedoHistoryBackupPayload = {
  history: HistoryEntry[];
  historyIndex: number;
  nextEntry: HistoryEntry;
};
type HistoryRestoreDirection = 'undo' | 'redo' | 'jump';
export type HistoryStateRestoredPayload = {
  direction: HistoryRestoreDirection;
  fromEntry: HistoryEntry;
  toEntry: HistoryEntry;
};
type HistoryActionDeps = {
  backupRedoHistory?: (payload: RedoHistoryBackupPayload) => void;
  getUndoHistoryLimit?: () => number | null;
  onHistoryStateRestored?: (payload: HistoryStateRestoredPayload) => void;
};
const isHierarchySelection = (
  value: unknown,
): value is { layerIds: string[]; itemIds: string[] } => {
  if (!value || typeof value !== 'object') return false;
  const sel = value as Record<string, unknown>;
  return Array.isArray(sel.layerIds) && Array.isArray(sel.itemIds);
};

const cloneHierarchySelections = (
  selections: Record<string, { layerIds: string[]; itemIds: string[] }>,
): Record<string, { layerIds: string[]; itemIds: string[] }> => {
  if (!selections) return {};
  const cloned: Record<string, { layerIds: string[]; itemIds: string[] }> = {};
  for (const [key, value] of Object.entries(selections)) {
    const sel = value as unknown;
    if (isHierarchySelection(sel)) {
      cloned[key] = {
        layerIds: [...sel.layerIds],
        itemIds: [...sel.itemIds],
      };
    }
  }
  return cloned;
};

const NAVIGATION_STATE_KEYS: readonly (keyof HistoryEntry['state'])[] = [
  'currentFrame',
  'selectedNodeId',
  'selectedNodeIds',
  'hierarchySelections',
  'selectedRotoPointRefs',
  'selectedKeyframes',
] as const;

const isRotoPointRef = (value: unknown): value is RotoPointRef => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const pointRef = value as Partial<RotoPointRef>;
  return typeof pointRef.pathId === 'string' && typeof pointRef.pointIndex === 'number';
};

const cloneRotoPointRefs = (value: unknown): RotoPointRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRotoPointRef).map((pointRef) => ({ ...pointRef }));
};

const isSelectedKeyframeRef = (value: unknown): value is SelectedKeyframeRef => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const keyframe = value as Partial<SelectedKeyframeRef>;
  return (
    typeof keyframe.path === 'string' &&
    typeof keyframe.frame === 'number' &&
    (keyframe.nodeId === undefined || typeof keyframe.nodeId === 'string')
  );
};

const cloneSelectedKeyframes = (value: unknown): SelectedKeyframeRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isSelectedKeyframeRef).map((keyframe) => ({ ...keyframe }));
};

const cloneHistorySelectionState = (state: HistoryEntry['state']): HistoryEntry['state'] => ({
  ...state,
  hierarchySelections: cloneHierarchySelections(
    state.hierarchySelections as Record<string, unknown> as Record<
      string,
      { layerIds: string[]; itemIds: string[] }
    >,
  ),
  selectedRotoPointRefs: cloneRotoPointRefs(state.selectedRotoPointRefs),
  selectedKeyframes: cloneSelectedKeyframes(state.selectedKeyframes),
});

const getNavigationState = (state: HistoryEntry['state']): HistoryEntry['state'] =>
  cloneHistorySelectionState(
    Object.fromEntries(NAVIGATION_STATE_KEYS.map((key) => [key, state[key]])),
  );

const normalizeHistoryLabel = (label: unknown): string =>
  typeof label === 'string' && label.trim().length > 0 ? label : 'Edit';

const findRestoredNodeId = (
  restoredState: HistoryEntry['state'],
  undoneState: HistoryEntry['state'],
): string | null => {
  if (!restoredState.nodes || !undoneState.nodes) return null;

  const undoneNodeIds = new Set(undoneState.nodes.map((node) => node.id));
  return restoredState.nodes.find((node) => !undoneNodeIds.has(node.id))?.id ?? null;
};

const getUndoNavigationState = (
  targetState: HistoryEntry['state'],
  undoneState: HistoryEntry['state'],
): HistoryEntry['state'] => {
  const navigationState = getNavigationState(undoneState);

  if (targetState.nodes && navigationState.selectedNodeId) {
    const targetNodeIds = new Set(targetState.nodes.map((node) => node.id));
    const restoredNodeId = findRestoredNodeId(targetState, undoneState);

    if (restoredNodeId) {
      navigationState.selectedNodeId = restoredNodeId;
    } else if (!targetNodeIds.has(navigationState.selectedNodeId)) {
      navigationState.selectedNodeId = targetState.selectedNodeId;
    }
  } else if (targetState.nodes) {
    const restoredNodeId = findRestoredNodeId(targetState, undoneState);
    if (restoredNodeId) {
      navigationState.selectedNodeId = restoredNodeId;
    }
  }

  return navigationState;
};

const applyHistoryCheckpointChange = (
  history: HistoryEntry[],
  index: number,
  mode: 'toggle' | 'ensure',
): HistoryEntry[] | null => {
  if (index < 0 || index >= history.length) return null;

  const entry = history[index];
  if (!entry) return null;

  if (isCheckpointEntry(entry)) {
    if (mode === 'ensure') {
      return history;
    }

    const nextEntry = { ...entry };
    delete nextEntry.checkpointLabel;
    return history.map((historyEntry, entryIndex) =>
      entryIndex === index ? nextEntry : historyEntry,
    );
  }

  return history.map((historyEntry, entryIndex) =>
    entryIndex === index
      ? {
          ...historyEntry,
          checkpointLabel: historyEntry.label,
        }
      : historyEntry,
  );
};

const createHistoryIdFactory = () => {
  let counter = 0;
  return (prefix: string) => `${prefix}_${Date.now()}_${counter++}`;
};

export const trimHistoryToLimit = (
  history: HistoryEntry[],
  historyIndex: number,
  maxHistoryEntries: number | null | undefined,
): { history: HistoryEntry[]; historyIndex: number } => {
  if (maxHistoryEntries === null || maxHistoryEntries === undefined) {
    return { history, historyIndex };
  }

  const limit = Math.max(1, Math.floor(maxHistoryEntries));
  if (history.length <= limit) {
    return { history, historyIndex };
  }

  const clampedIndex = Math.max(0, Math.min(historyIndex, history.length - 1));
  const end = Math.min(history.length, Math.max(clampedIndex + 1, limit));
  const start = Math.max(0, end - limit);

  return {
    history: history.slice(start, end),
    historyIndex: clampedIndex - start,
  };
};

export function createHistoryActions(
  set: SetState,
  get: GetState,
  debouncedSave: () => void,
  deps: HistoryActionDeps = {},
) {
  let activeInteraction: { id: string; historyIndex: number | null } | null = null;
  const createHistoryId = createHistoryIdFactory();
  const getUndoHistoryEntryLimit = () => {
    const undoStepLimit = deps.getUndoHistoryLimit?.() ?? 200;
    return undoStepLimit === null ? null : undoStepLimit + 1;
  };

  const buildHistoryEntry = (entry: HistoryActionEntry, id: string): HistoryEntry => {
    return {
      ...entry,
      id,
      label: normalizeHistoryLabel(entry.label),
      createdAt: entry.createdAt ?? Date.now(),
      state: cloneHistorySelectionState({
        ...getNavigationState(get()),
        ...entry.state,
      }),
    };
  };
  const notifyHistoryStateRestored = (
    direction: HistoryRestoreDirection,
    fromEntry: HistoryEntry | undefined,
    toEntry: HistoryEntry | undefined,
  ) => {
    if (!fromEntry || !toEntry || fromEntry === toEntry) return;
    deps.onHistoryStateRestored?.({ direction, fromEntry, toEntry });
  };

  return {
    beginHistoryInteraction: (id: string) => {
      activeInteraction = { id, historyIndex: null };
    },

    endHistoryInteraction: (id?: string) => {
      if (!activeInteraction) return;
      if (id && activeInteraction.id !== id) return;
      activeInteraction = null;
    },

    pushHistory: (entry: HistoryActionEntry) => {
      const { history, historyIndex } = get();

      if (
        activeInteraction &&
        activeInteraction.historyIndex !== null &&
        activeInteraction.historyIndex >= 0 &&
        activeInteraction.historyIndex < history.length
      ) {
        const nextHistory = [...history];
        nextHistory[activeInteraction.historyIndex] = buildHistoryEntry(
          entry,
          history[activeInteraction.historyIndex]?.id ?? createHistoryId('hist'),
        );
        const trimmed = trimHistoryToLimit(
          nextHistory,
          activeInteraction.historyIndex,
          getUndoHistoryEntryLimit(),
        );
        activeInteraction = { ...activeInteraction, historyIndex: trimmed.historyIndex };
        set(() => trimmed);
        debouncedSave();
        return;
      }

      const newEntry = buildHistoryEntry(entry, createHistoryId('hist'));
      if (historyIndex < history.length - 1) {
        deps.backupRedoHistory?.({ history, historyIndex, nextEntry: newEntry });
      }
      const next = trimHistoryToLimit(
        [...history.slice(0, historyIndex + 1), newEntry],
        historyIndex + 1,
        getUndoHistoryEntryLimit(),
      );
      set(() => next);

      if (activeInteraction) {
        activeInteraction = { ...activeInteraction, historyIndex: next.historyIndex };
      }

      debouncedSave();
    },

    undo: () => {
      activeInteraction = null;
      const { history, historyIndex } = get();
      if (historyIndex > 0) {
        const currentEntry = history[historyIndex];
        const prevEntry = history[historyIndex - 1];
        set(() => ({
          ...cloneHistorySelectionState(prevEntry.state),
          ...getUndoNavigationState(prevEntry.state, currentEntry.state),
          historyIndex: historyIndex - 1,
        }));
        debouncedSave();
        notifyHistoryStateRestored('undo', currentEntry, prevEntry);
      }
    },

    redo: () => {
      activeInteraction = null;
      const { history, historyIndex } = get();
      if (historyIndex < history.length - 1) {
        const nextEntry = history[historyIndex + 1];
        set(() => ({
          ...cloneHistorySelectionState(nextEntry.state),
          historyIndex: historyIndex + 1,
        }));
        debouncedSave();
        notifyHistoryStateRestored('redo', history[historyIndex], nextEntry);
      }
    },

    jumpToHistoryState: (index: number) => {
      activeInteraction = null;
      const { history, historyIndex } = get();
      if (index >= 0 && index < history.length) {
        set(() => ({ ...cloneHistorySelectionState(history[index].state), historyIndex: index }));
        debouncedSave();
        notifyHistoryStateRestored('jump', history[historyIndex], history[index]);
      }
    },

    toggleHistoryCheckpoint: (index: number) => {
      activeInteraction = null;
      const { history, historyIndex } = get();
      const nextHistory = applyHistoryCheckpointChange(history, index, 'toggle');
      if (!nextHistory) return;

      set(() => ({ history: nextHistory, historyIndex }));
      debouncedSave();
    },

    checkpointCurrentHistoryEntry: () => {
      activeInteraction = null;
      const { history, historyIndex } = get();
      const nextHistory = applyHistoryCheckpointChange(history, historyIndex, 'ensure');
      if (!nextHistory) return;

      if (nextHistory !== history) {
        set(() => ({ history: nextHistory, historyIndex }));
      }
      debouncedSave();
    },
  };
}
