import { type HistoryEntry, type RotoPointRef, type SelectedKeyframeRef } from '@blackboard/types';
import type { SetState, GetState } from '@/state/editor/slices/types';

const MAX_HISTORY = 200;
type HistoryActionEntry = Omit<HistoryEntry, 'id'>;
const NAVIGATION_STATE_KEYS = [
  'currentFrame',
  'selectedNodeId',
  'selectedPaintLayerIds',
  'selectedPaintStrokeIds',
  'selectedRotoLayerIds',
  'selectedRotoPathIds',
  'selectedRotoPointRefs',
  'selectedKeyframes',
] as const satisfies readonly (keyof HistoryEntry['state'])[];

const cloneStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

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
  selectedPaintLayerIds: cloneStringArray(state.selectedPaintLayerIds),
  selectedPaintStrokeIds: cloneStringArray(state.selectedPaintStrokeIds),
  selectedRotoLayerIds: cloneStringArray(state.selectedRotoLayerIds),
  selectedRotoPathIds: cloneStringArray(state.selectedRotoPathIds),
  selectedRotoPointRefs: cloneRotoPointRefs(state.selectedRotoPointRefs),
  selectedKeyframes: cloneSelectedKeyframes(state.selectedKeyframes),
});

const getNavigationState = (state: HistoryEntry['state']): HistoryEntry['state'] =>
  cloneHistorySelectionState(
    Object.fromEntries(NAVIGATION_STATE_KEYS.map((key) => [key, state[key]])),
  );

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

const isCheckpointEntry = (entry: HistoryEntry): boolean =>
  typeof entry.checkpointLabel === 'string' && entry.checkpointLabel.trim().length > 0;

const createHistoryIdFactory = () => {
  let counter = 0;
  return (prefix: string) => `${prefix}_${Date.now()}_${counter++}`;
};

export function createHistoryActions(set: SetState, get: GetState, debouncedSave: () => void) {
  let activeInteraction: { id: string; historyIndex: number | null } | null = null;
  const createHistoryId = createHistoryIdFactory();

  const buildHistoryEntry = (entry: HistoryActionEntry, id: string): HistoryEntry => {
    return {
      ...entry,
      id,
      createdAt: entry.createdAt ?? Date.now(),
      state: cloneHistorySelectionState({
        ...getNavigationState(get()),
        ...entry.state,
      }),
    };
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
        set(() => ({ history: nextHistory, historyIndex: activeInteraction!.historyIndex! }));
        debouncedSave();
        return;
      }

      const newEntry = buildHistoryEntry(entry, createHistoryId('hist'));
      const newHistory = [...history.slice(0, historyIndex + 1), newEntry];
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      const nextHistoryIndex = newHistory.length - 1;
      set(() => ({ history: newHistory, historyIndex: nextHistoryIndex }));

      if (activeInteraction) {
        activeInteraction = { ...activeInteraction, historyIndex: nextHistoryIndex };
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
      }
    },

    jumpToHistoryState: (index: number) => {
      activeInteraction = null;
      const { history } = get();
      if (index >= 0 && index < history.length) {
        set(() => ({ ...cloneHistorySelectionState(history[index].state), historyIndex: index }));
        debouncedSave();
      }
    },

    toggleHistoryCheckpoint: (index: number) => {
      activeInteraction = null;
      const { history, historyIndex } = get();
      if (index < 0 || index >= history.length) return;

      const nextHistory = history.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;

        if (isCheckpointEntry(entry)) {
          const nextEntry = { ...entry };
          delete nextEntry.checkpointLabel;
          return nextEntry;
        }

        return {
          ...entry,
          checkpointLabel: entry.label,
        };
      });

      set(() => ({ history: nextHistory, historyIndex }));
      debouncedSave();
    },
  };
}
