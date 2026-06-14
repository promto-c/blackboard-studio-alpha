import type { HistoryEntry } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorMutation<TState> {
  /** The partial state patch to apply. */
  patch: Partial<TState>;
  /** Optional undo history entry. */
  history?: {
    label: string;
    /** The state snapshot to store in the history entry (should be explicit). */
    state: Record<string, unknown>;
  };
  /** Whether and how to persist after the mutation. */
  persist?: 'none' | 'debounced';
}

/**
 * A mutation descriptor or a factory that reads current state and returns one.
 * Using a factory allows computing derived values from state before the patch.
 */
export type EditorMutationInput<TState> =
  | EditorMutation<TState>
  | ((state: Readonly<TState>) => EditorMutation<TState>);

export interface MutationDeps {
  pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
  debouncedSave?: () => void;
}

/**
 * Type of the bound `commitMutation` function created by `createCommitMutation`.
 * Useful for injecting via deps rather than re-creating in each slice.
 */
export type CommitEditorMutation<TState = unknown> = (input: EditorMutationInput<TState>) => void;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Create a `commitMutation` function bound to a specific store + deps.
 *
 * Policy encoded in this executor:
 *  - `set()` is always called with the patch.
 *  - `pushHistory()` is called only when `mutation.history` is provided.
 *  - `debouncedSave()` is called only when `mutation.persist === 'debounced'`.
 *
 * Every policy is visible at the mutation call site — nothing is implicit.
 */
export function createCommitMutation<TState>(
  set: (fn: (prev: TState) => Partial<TState> | TState) => void,
  get: () => TState,
  deps: MutationDeps,
) {
  return (input: EditorMutationInput<TState>): void => {
    const mutation = typeof input === 'function' ? input(get()) : input;

    set(() => mutation.patch);

    if (mutation.history) {
      deps.pushHistory({
        label: mutation.history.label,
        state: mutation.history.state,
      });
    }

    if (mutation.persist === 'debounced') {
      deps.debouncedSave?.();
    }
  };
}
