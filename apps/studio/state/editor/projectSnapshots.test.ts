import { describe, expect, it } from 'vitest';
import { getInitialState } from '@/state/editor/initialState';
import { buildPersistedProjectState } from '@/state/editor/projectSnapshots';

describe('buildPersistedProjectState', () => {
  it('persists full history and historyIndex', () => {
    const state = {
      ...getInitialState(),
      maxFrames: 0,
      history: [
        {
          id: 'hist-1',
          label: 'Edit One',
          createdAt: 100,
          state: { selectedNodeId: 'node-a' },
        },
        {
          id: 'hist-2',
          label: 'Edit Two',
          createdAt: 200,
          state: { selectedNodeId: 'node-b' },
        },
      ],
      historyIndex: 1,
    };

    const persistedState = buildPersistedProjectState(state);

    expect(persistedState.history.map((entry) => entry.id)).toEqual(['hist-1', 'hist-2']);
    expect(persistedState.historyIndex).toBe(1);
  });

  it('strips session-only state (history, historyIndex) from entry states', () => {
    const state = {
      ...getInitialState(),
      maxFrames: 0,
      history: [
        {
          id: 'hist-1',
          label: 'Edit',
          createdAt: 100,
          state: {
            selectedNodeId: 'node-a',
            history: [{ id: 'nested' } as never],
            historyIndex: 0,
          },
        },
      ],
      historyIndex: 0,
    };

    const persistedState = buildPersistedProjectState(state);

    expect(persistedState.history[0]?.state).not.toHaveProperty('history');
    expect(persistedState.history[0]?.state).not.toHaveProperty('historyIndex');
  });

  it('limits history to maxHistoryEntries if set', () => {
    const state = {
      ...getInitialState(),
      maxFrames: 0,
      history: [
        { id: 'hist-1', label: 'One', createdAt: 100, state: { selectedNodeId: 'node-a' } },
        { id: 'hist-2', label: 'Two', createdAt: 200, state: { selectedNodeId: 'node-b' } },
        { id: 'hist-3', label: 'Three', createdAt: 300, state: { selectedNodeId: 'node-c' } },
        { id: 'hist-4', label: 'Four', createdAt: 400, state: { selectedNodeId: 'node-d' } },
      ],
      historyIndex: 3,
    };

    const persistedState = buildPersistedProjectState(state, {
      maxHistoryEntries: 2,
    });

    expect(persistedState.history.map((entry) => entry.id)).toEqual(['hist-3', 'hist-4']);
    expect(persistedState.historyIndex).toBe(1);
  });

  it('preserves redo history above an undone active entry', () => {
    const state = {
      ...getInitialState(),
      maxFrames: 0,
      history: [
        { id: 'hist-1', label: 'One', createdAt: 100, state: { selectedNodeId: 'node-a' } },
        { id: 'hist-2', label: 'Two', createdAt: 200, state: { selectedNodeId: 'node-b' } },
        { id: 'hist-3', label: 'Three', createdAt: 300, state: { selectedNodeId: 'node-c' } },
      ],
      historyIndex: 1,
    };

    const persistedState = buildPersistedProjectState(state, {
      maxHistoryEntries: 5,
    });

    expect(persistedState.history.map((entry) => entry.id)).toEqual(['hist-1', 'hist-2', 'hist-3']);
    expect(persistedState.historyIndex).toBe(1);
  });
});
