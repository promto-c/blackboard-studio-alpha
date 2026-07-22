import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
  useSyncExternalStore,
} from 'react';
import { usePreferences } from '@/state/preferencesContext';
import { getInitialState } from '@/state/editor/initialState';
import { cloneProjectColorManagement } from '@/color-management';
import { createProjectAutosave } from '@/state/editor/services/autosave';
import { buildPersistedProjectState } from '@/state/editor/projectSnapshots';
import { syncComfyGalleryEntriesAfterHistoryRestore } from '@/state/editor/services/comfySync';
import {
  createProjectBranchRecord,
  createScopedProjectBranchName,
  getActiveProjectBranchId,
  getProjectBranchStorageId,
  saveProject,
  upsertProjectBranch,
} from '@/state/persist';
import { usePlayback } from '@/hooks/usePlayback';
import { createViewportUIActions } from '@/state/editor/slices/viewportUIActions';
import { createViewerActions } from '@/state/editor/slices/viewerActions';
import { createPlaybackActions } from '@/state/editor/slices/playbackActions';
import { createSelectionActions } from '@/state/editor/slices/selectionActions';
import { createHistoryActions } from '@/state/editor/slices/historyActions';
import { createNodeActions } from '@/state/editor/slices/nodeActions';
import { createRotoDrawingActions } from '@/state/editor/slices/rotoDrawingActions';
import { createAiActions } from '@/state/editor/slices/aiActions';
import { createProjectActions } from '@/state/editor/slices/projectActions';
import { createNodeViewActions } from '@/state/editor/slices/nodeViewActions';
import { createBackgroundJobActions } from '@/state/editor/slices/backgroundJobActions';
import { installAgentMcpRuntimeBridge } from '@/utils/agentMcpRuntimeBridge';
import { createCommitMutation } from '@/state/editor/commitMutation';
import { normalizeEditorState } from '@/state/editor/normalizeEditorState';
import type { EditorState, SetState } from '@/state/editor/slices/types';
import type { HistoryEntry, NodeType } from '@blackboard/types';
import { getComfyEndpoint } from '@/utils/aiRouting';

// ---------------------------------------------------------------------------
// Store – holds state outside React so consumers can subscribe selectively.
// ---------------------------------------------------------------------------

type Listener = () => void;

interface EditorStore {
  getState: () => EditorState;
  setState: SetState;
  subscribe: (listener: Listener) => () => void;
}

function createEditorStore(initialState: EditorState): EditorStore {
  let state = initialState;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState: (fn) => {
      state = normalizeEditorState(state, fn(state));
      // Notify all subscribers synchronously so useSyncExternalStore picks up
      // the new snapshot before the next React render.
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const StoreContext = createContext<EditorStore | null>(null);
const ActionsContext = createContext<Record<string, unknown> | null>(null);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const UNSET = Symbol('unset');

/** Selective hook – only re-renders when the selected slice changes (Object.is). */
export function useEditorSelector<T>(selector: (state: EditorState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useEditorSelector must be used within an EditorProvider');

  // Keep selector in a ref so getSnapshot is stable across renders.
  const selectorRef = useRef(selector);
  const resultRef = useRef<T | typeof UNSET>(UNSET);
  selectorRef.current = selector;

  const stateRef = useRef(store.getState());
  const getSnapshot = useCallback(() => {
    const currentState = store.getState();
    if (resultRef.current !== UNSET && currentState === stateRef.current) {
      return resultRef.current as T;
    }
    stateRef.current = currentState;
    const nextResult = selectorRef.current(currentState);
    resultRef.current = nextResult;
    return nextResult;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/** Actions-only hook – never triggers re-renders. */
export const useEditorActions = () => {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useEditorActions must be used within an EditorProvider');
  return actions as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const useOptionalEditorActions = () => {
  const actions = useContext(ActionsContext);
  return actions as Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function EditorProvider({ children }: { children: ReactNode }) {
  const {
    playbackMode,
    undoHistoryLimit,
    reopenHistoryLimit,
    autoCheckpointEnabled,
    newProjectColorManagement,
    integrationConnections,
  } = usePreferences();
  const undoHistoryLimitRef = useRef(undoHistoryLimit);
  undoHistoryLimitRef.current = undoHistoryLimit;
  const reopenHistoryLimitRef = useRef(reopenHistoryLimit);
  reopenHistoryLimitRef.current = reopenHistoryLimit;
  const autoCheckpointEnabledRef = useRef(autoCheckpointEnabled);
  autoCheckpointEnabledRef.current = autoCheckpointEnabled;
  const newProjectColorManagementRef = useRef(newProjectColorManagement);
  newProjectColorManagementRef.current = newProjectColorManagement;
  const integrationConnectionsRef = useRef(integrationConnections);
  integrationConnectionsRef.current = integrationConnections;

  // Create the store once — it lives for the lifetime of the provider.
  const storeRef = useRef<EditorStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createEditorStore({ ...getInitialState(), maxFrames: 0 } as EditorState);
  }
  const store = storeRef.current;

  // The Provider itself subscribes to the store so its own effects can react
  // to state changes.  The context values (store / actions) are stable refs,
  // so children are NOT re-rendered by context propagation — only by their
  // own useSyncExternalStore subscriptions.
  const state = useSyncExternalStore(store.subscribe, store.getState);

  const set = store.setState; // stable
  const get = store.getState; // stable

  const renderLockRef = useRef<boolean>(false);
  const trackingAbortController = useRef<AbortController | null>(null);

  usePlayback(store, state.isPlaying, playbackMode, renderLockRef);

  const debouncedSave = useMemo(
    () =>
      createProjectAutosave(
        () => get(),
        () => reopenHistoryLimitRef.current,
        () => autoCheckpointEnabledRef.current,
      ),
    [get],
  );

  const actions = useMemo(() => {
    const backupRedoHistory = ({
      history,
      historyIndex,
    }: {
      history: HistoryEntry[];
      historyIndex: number;
      nextEntry: HistoryEntry;
    }) => {
      const state = get();
      if (!state.projectId || historyIndex >= history.length - 1) return;

      const futureHistory = history.slice(historyIndex + 1);
      const oldHead = futureHistory[futureHistory.length - 1];
      if (!oldHead) return;

      const branch = createProjectBranchRecord({
        projectId: state.projectId,
        name: createScopedProjectBranchName('backup', oldHead.label),
        kind: 'autosave',
        parentBranchId: state.activeProjectBranchId || getActiveProjectBranchId(state.projectId),
      });
      const branchIndex = upsertProjectBranch(state.projectId, branch);
      set(() => ({ projectBranches: branchIndex.branches }));

      const backupState = futureHistory.reduce<EditorState>(
        (snapshot, entry) => normalizeEditorState(snapshot, entry.state),
        {
          ...state,
          history,
          historyIndex: history.length - 1,
        },
      );

      void saveProject(
        getProjectBranchStorageId(state.projectId, branch.id),
        buildPersistedProjectState(backupState, {
          maxHistoryEntries: reopenHistoryLimitRef.current,
        }),
      );
    };

    const historyActions = createHistoryActions(set, get, debouncedSave, {
      backupRedoHistory,
      getUndoHistoryLimit: () =>
        undoHistoryLimitRef.current === 'unlimited' ? null : undoHistoryLimitRef.current,
      onHistoryStateRestored: ({ fromEntry, toEntry }) => {
        void syncComfyGalleryEntriesAfterHistoryRestore({
          fromState: fromEntry.state,
          toState: toEntry.state,
          editorState: get(),
        })
          .then((changed) => {
            if (changed) {
              set(() => ({ galleryUpdatedAt: Date.now() }));
            }
          })
          .catch((error) => {
            console.warn('Could not sync gallery entries after history restore.', error);
          });
      },
    });
    const backgroundJobActions = createBackgroundJobActions(set);

    // -----------------------------------------------------------------------
    // Single commitMutation instance shared by all slices.
    // Never inject fake no-op deps — debouncedSave is optional in MutationDeps.
    // -----------------------------------------------------------------------
    const commitMutation = createCommitMutation<EditorState>(set, get, {
      pushHistory: historyActions.pushHistory,
      debouncedSave,
    });

    return {
      ...createViewportUIActions(set, get, { debouncedSave }),
      ...createViewerActions(set, get, { commitMutation }),
      ...createPlaybackActions(set, get, renderLockRef, { commitMutation }),
      ...createSelectionActions(set, get),
      ...historyActions,
      ...createNodeActions(set, get, {
        commitMutation,
        getComfyEndpoint: () =>
          getComfyEndpoint({ integrationConnections: integrationConnectionsRef.current }),
      }),
      ...createRotoDrawingActions(set, get, {
        commitMutation,
      }),
      ...createAiActions(set, get, {
        commitMutation,
        debouncedSave,
      }),
      ...createProjectActions(set, get, {
        commitMutation,
        getNewProjectColorManagement: () =>
          cloneProjectColorManagement(newProjectColorManagementRef.current),
        getReopenHistoryLimit: () => reopenHistoryLimitRef.current,
        getAutoCheckpointEnabled: () => autoCheckpointEnabledRef.current,
        trackingAbortController,
        startBackgroundJob: backgroundJobActions.startBackgroundJob,
        updateBackgroundJob: backgroundJobActions.updateBackgroundJob,
        finishBackgroundJob: backgroundJobActions.finishBackgroundJob,
      }),
      ...createNodeViewActions(set, get, {
        commitMutation,
      }),
      ...backgroundJobActions,
      flushProjectSave: () => debouncedSave.flush(),
      commitMutation,
      setPreviewNodeType: (nodeType: NodeType | null) => {
        set(() => ({ previewNodeType: nodeType }));
      },
    };
  }, [debouncedSave, get, set]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof actions.pushHistory !== 'function') {
      return;
    }

    // Create a second commitMutation instance for the MCP bridge.
    // Functionally identical to the one in useMemo — same set/get/debouncedSave.
    const mcpCommitMutation = createCommitMutation<EditorState>(set, get, {
      pushHistory: actions.pushHistory,
      debouncedSave,
    });

    return installAgentMcpRuntimeBridge({
      commitMutation: mcpCommitMutation,
      getState: get,
      setState: set,
      debouncedSave,
    });
  }, [actions, debouncedSave, get, set]);

  return (
    <StoreContext.Provider value={store}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StoreContext.Provider>
  );
}
