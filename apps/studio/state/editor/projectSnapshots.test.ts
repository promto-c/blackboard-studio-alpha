import { describe, expect, it } from 'vitest';
import { NodeType, type SceneNode } from '@blackboard/types';
import { getInitialState } from '@/state/editor/initialState';
import {
  buildPersistedProjectState,
  restorePersistedProjectHistoryEntry,
} from '@/state/editor/projectSnapshots';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';

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

    expect(persistedState.colorManagement).toBe(state.colorManagement);
    expect(persistedState).not.toHaveProperty('viewerSettings');
    expect(persistedState).not.toHaveProperty('viewerColorManagement');
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
            viewerSettings: getInitialState().viewerSettings,
          },
        },
      ],
      historyIndex: 0,
    };

    const persistedState = buildPersistedProjectState(state);

    expect(persistedState.history[0]?.state).not.toHaveProperty('history');
    expect(persistedState.history[0]?.state).not.toHaveProperty('historyIndex');
    expect(persistedState.history[0]?.state).not.toHaveProperty('viewerSettings');
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

  it('restores a node-only history entry into the canonical flow model', () => {
    const latestScene: SceneNode = {
      id: 'scene-latest',
      type: NodeType.SCENE,
      name: 'Latest scene',
      enabled: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      startFrame: 0,
      maxFrames: 120,
      fps: 30,
    };
    const olderScene: SceneNode = { ...latestScene, id: 'scene-older', name: 'Older scene' };
    const flow = buildFlowFromNodes([latestScene], ROOT_FLOW_ID, 'Root Flow');
    const projectState = {
      ...buildPersistedProjectState({
        ...getInitialState(),
        maxFrames: 120,
        flows: { [ROOT_FLOW_ID]: flow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
      }),
      history: [
        { id: 'older', label: 'Older edit', state: { nodes: [olderScene] } },
        { id: 'latest', label: 'Latest edit', state: { nodes: [latestScene] } },
      ],
      historyIndex: 1,
    };

    const restored = restorePersistedProjectHistoryEntry(projectState, 'older');

    expect(restored?.flows?.[ROOT_FLOW_ID]?.nodes.map((node) => node.id)).toContain('scene-older');
    expect(restored?.flows?.[ROOT_FLOW_ID]?.nodes.map((node) => node.id)).not.toContain(
      'scene-latest',
    );
    expect(restored?.historyIndex).toBe(0);
    expect(restored?.history).toHaveLength(2);
  });

  it('can make the selected history entry the head of a recovery snapshot', () => {
    const state = {
      ...buildPersistedProjectState({ ...getInitialState(), maxFrames: 0 }),
      history: [
        { id: 'older', label: 'Older edit', state: { selectedNodeId: 'older-node' } },
        { id: 'failed', label: 'Failed edit', state: { selectedNodeId: 'failed-node' } },
      ],
      historyIndex: 1,
    };

    const restored = restorePersistedProjectHistoryEntry(state, 'older', {
      truncateFutureHistory: true,
    });

    expect(restored?.selectedNodeId).toBe('older-node');
    expect(restored?.history.map((entry) => entry.id)).toEqual(['older']);
    expect(restored?.historyIndex).toBe(0);
  });
});
