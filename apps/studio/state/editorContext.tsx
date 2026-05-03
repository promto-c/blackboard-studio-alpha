import React, {
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
import { createProjectAutosave } from '@/state/editor/services/autosave';
import { usePlayback } from '@/hooks/usePlayback';
import {
  getNodePositionsForFlow,
  getOrderedNodesFromFlow,
  getRootFlow,
  replaceFlowNodes,
  ROOT_FLOW_ID,
  setNodePositionsForFlow,
} from '@/state/editor/flowModel';

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

type EditorState = ReturnType<typeof getInitialState> & { maxFrames: number };
type SetState = (fn: (prevState: EditorState) => Partial<EditorState> | EditorState) => void;

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

const normalizeEditorState = (
  previousState: EditorState,
  patch: Partial<EditorState> | EditorState,
): EditorState => {
  const nextState = { ...previousState, ...patch } as EditorState;
  const hasNodesMutation = hasOwn(patch, 'nodes');
  const hasLegacyNodePositionsMutation = hasOwn(patch, 'nodePositions');
  const hasStructuralFlowMutation =
    hasOwn(patch, 'flows') || hasOwn(patch, 'rootFlowId') || hasOwn(patch, 'activeFlowId');
  const hasPositionFlowMutation = hasOwn(patch, 'nodePositionsByFlow');

  if (hasNodesMutation) {
    const nextNodes = nextState.nodes ?? [];
    if (nextNodes.length > 0) {
      const flowId = nextState.rootFlowId ?? ROOT_FLOW_ID;
      nextState.flows = replaceFlowNodes(
        nextState.flows,
        flowId,
        nextNodes,
        getRootFlow(previousState.flows, previousState.rootFlowId)?.name ?? 'Root Flow',
      );
      nextState.rootFlowId = flowId;
      nextState.activeFlowId = flowId;
    } else {
      nextState.flows = {};
      nextState.rootFlowId = null;
      nextState.activeFlowId = null;
      nextState.selectedNodeId = null;
      nextState.nodePositionsByFlow = {};
    }
  }

  if (hasLegacyNodePositionsMutation && !hasPositionFlowMutation) {
    nextState.nodePositionsByFlow = setNodePositionsForFlow(
      nextState.nodePositionsByFlow,
      nextState.rootFlowId,
      nextState.nodePositions ?? {},
    );
  }

  // Only recreate the nodes array when the flow structure actually changes.
  // Position-only changes (nodePositionsByFlow) should NOT recreate nodes,
  // as that causes unnecessary re-renders of thumbnails/viewport.
  if (hasNodesMutation || hasStructuralFlowMutation) {
    const rootFlow = getRootFlow(nextState.flows, nextState.rootFlowId);
    nextState.nodes = getOrderedNodesFromFlow(rootFlow);
  }

  if (
    hasNodesMutation ||
    hasStructuralFlowMutation ||
    hasPositionFlowMutation ||
    hasLegacyNodePositionsMutation
  ) {
    nextState.nodePositions = getNodePositionsForFlow(
      nextState.nodePositionsByFlow,
      nextState.rootFlowId,
    );
  }

  return nextState;
};

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
export function useEditorSelector<T>(
  selector: (state: EditorState & Record<string, any>) => T, // eslint-disable-line @typescript-eslint/no-explicit-any
): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useEditorSelector must be used within an EditorProvider');

  // Keep selector in a ref so getSnapshot is stable across renders.
  const selectorRef = useRef(selector);
  const resultRef = useRef<T | typeof UNSET>(UNSET);
  selectorRef.current = selector;

  const getSnapshot = useCallback(() => {
    const nextResult = selectorRef.current(store.getState() as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (resultRef.current !== UNSET && Object.is(resultRef.current, nextResult)) {
      return resultRef.current as T;
    }
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

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { playbackMode, geminiApiKey } = usePreferences();
  const geminiApiKeyRef = useRef(geminiApiKey);
  geminiApiKeyRef.current = geminiApiKey;

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
      createProjectAutosave(() => {
        return get();
      }),
    [get],
  );

  const actions = useMemo(() => {
    const historyActions = createHistoryActions(set, get, debouncedSave);
    const backgroundJobActions = createBackgroundJobActions(set);

    const sharedDeps = {
      pushHistory: historyActions.pushHistory,
      debouncedSave,
    };

    const rotoDrawingDeps = {
      pushHistory: historyActions.pushHistory,
    };

    const projectDeps = {
      pushHistory: historyActions.pushHistory,
      debouncedSave,
      trackingAbortController,
      startBackgroundJob: backgroundJobActions.startBackgroundJob,
      updateBackgroundJob: backgroundJobActions.updateBackgroundJob,
      finishBackgroundJob: backgroundJobActions.finishBackgroundJob,
    };

    return {
      ...createViewportUIActions(set, get),
      ...createViewerActions(set, get),
      ...createPlaybackActions(set, get, renderLockRef),
      ...createSelectionActions(set, get),
      ...historyActions,
      ...createNodeActions(set, get, sharedDeps),
      ...createRotoDrawingActions(set, get, rotoDrawingDeps),
      ...createAiActions(set, get, {
        pushHistory: historyActions.pushHistory,
        debouncedSave,
        getGeminiApiKey: () => geminiApiKeyRef.current,
      }),
      ...createProjectActions(set, get, projectDeps),
      ...createNodeViewActions(set, get, sharedDeps),
      ...backgroundJobActions,
    };
  }, [debouncedSave, get, set]);

  useEffect(() => {
    if (!state.isAiCurrentlyGenerating && state.aiGenerationQueue.length > 0) {
      actions._processAiQueue();
    }
  }, [actions, state.aiGenerationQueue, state.isAiCurrentlyGenerating]);

  return (
    <StoreContext.Provider value={store}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StoreContext.Provider>
  );
};
