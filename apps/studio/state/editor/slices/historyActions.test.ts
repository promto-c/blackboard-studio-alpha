import { describe, expect, it, vi } from 'vitest';
import { createHistoryActions } from '@/state/editor/slices/historyActions';

type TestState = {
  history: Array<{
    id: string;
    label: string;
    state: {
      nodes?: Array<{ id: string; name?: string }>;
      selectedNodeId?: string | null;
      currentFrame?: number;
      hierarchySelections?: Record<string, { layerIds: string[]; itemIds: string[] }>;
      selectedRotoPointRefs?: Array<{ pathId: string; pointIndex: number }>;
      selectedKeyframes?: Array<{ nodeId?: string; path: string; frame: number }>;
    };
    createdAt?: number;
    checkpointLabel?: string;
    consolidatedCount?: number;
  }>;
  historyIndex: number;
  nodes: Array<{ id: string; name?: string }>;
  currentFrame: number;
  selectedNodeId: string | null;
  hierarchySelections: Record<string, { layerIds: string[]; itemIds: string[] }>;
  selectedRotoPointRefs: Array<{ pathId: string; pointIndex: number }>;
  selectedKeyframes: Array<{ nodeId?: string; path: string; frame: number }>;
};

const createHarness = () => {
  let state: TestState = {
    history: [{ id: 'hist_init', label: 'Initial', state: { selectedNodeId: null } }],
    historyIndex: 0,
    nodes: [{ id: 'node-current' }],
    currentFrame: 24,
    selectedNodeId: 'node-current',
    hierarchySelections: {
      'node-current': { layerIds: ['roto-layer-1'], itemIds: ['roto-path-1'] },
    },
    selectedRotoPointRefs: [{ pathId: 'roto-path-1', pointIndex: 2 }],
    selectedKeyframes: [{ nodeId: 'node-current', path: 'opacity', frame: 24 }],
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;
  const debouncedSave = vi.fn();
  const actions = createHistoryActions(set as never, get as never, debouncedSave);

  return {
    actions,
    debouncedSave,
    getState: () => state,
    setState: (nextState: Partial<TestState>) => {
      state = { ...state, ...nextState };
    },
  };
};

describe('createHistoryActions', () => {
  it('captures the current frame and selection context for new history entries', () => {
    const { actions, getState } = createHarness();

    actions.pushHistory({ label: 'Move Selection', state: {} });

    expect(getState().history[1]).toMatchObject({
      label: 'Move Selection',
      state: {
        currentFrame: 24,
        selectedNodeId: 'node-current',
        hierarchySelections: {
          'node-current': { layerIds: ['roto-layer-1'], itemIds: ['roto-path-1'] },
        },
        selectedRotoPointRefs: [{ pathId: 'roto-path-1', pointIndex: 2 }],
        selectedKeyframes: [{ nodeId: 'node-current', path: 'opacity', frame: 24 }],
      },
    });
  });

  it('normalizes missing runtime history labels', () => {
    const { actions, getState } = createHarness();

    actions.pushHistory({ state: {} } as never);

    expect(getState().history[1].label).toBe('Edit');
  });

  it('lets explicit history state override captured context', () => {
    const { actions, getState } = createHarness();

    actions.pushHistory({
      label: 'Set Keyframe',
      state: {
        currentFrame: 48,
        selectedNodeId: 'node-target',
        hierarchySelections: {
          'node-target': { layerIds: [], itemIds: ['roto-path-2'] },
        },
      },
    });

    expect(getState().history[1]).toMatchObject({
      label: 'Set Keyframe',
      state: {
        currentFrame: 48,
        selectedNodeId: 'node-target',
        hierarchySelections: {
          'node-target': { layerIds: [], itemIds: ['roto-path-2'] },
        },
      },
    });
  });

  it('replaces the active history entry while an interaction is in progress', () => {
    const { actions, getState } = createHarness();

    actions.beginHistoryInteraction('slider-1');
    actions.pushHistory({ label: 'Set Keyframe', state: { selectedNodeId: 'node-a' } });
    actions.pushHistory({ label: 'Set Keyframe', state: { selectedNodeId: 'node-b' } });
    actions.endHistoryInteraction('slider-1');

    expect(getState().history).toHaveLength(2);
    expect(getState().historyIndex).toBe(1);
    expect(getState().history[1]).toMatchObject({
      label: 'Set Keyframe',
      state: { selectedNodeId: 'node-b' },
    });
  });

  it('starts a new history entry after the previous interaction ends', () => {
    const { actions, getState } = createHarness();

    actions.beginHistoryInteraction('slider-1');
    actions.pushHistory({ label: 'Set Keyframe', state: { selectedNodeId: 'node-a' } });
    actions.pushHistory({ label: 'Set Keyframe', state: { selectedNodeId: 'node-b' } });
    actions.endHistoryInteraction('slider-1');

    actions.beginHistoryInteraction('slider-2');
    actions.pushHistory({ label: 'Set Keyframe', state: { selectedNodeId: 'node-c' } });
    actions.endHistoryInteraction('slider-2');

    expect(getState().history).toHaveLength(3);
    expect(getState().historyIndex).toBe(2);
    expect(getState().history[1].state).toMatchObject({ selectedNodeId: 'node-b' });
    expect(getState().history[2].state).toMatchObject({ selectedNodeId: 'node-c' });
  });

  it('keeps rapid repetitive edits separate until compact is requested', () => {
    const { actions, getState } = createHarness();

    actions.pushHistory({ label: 'Nudge Stroke', state: { selectedNodeId: 'node-a' } });
    actions.pushHistory({ label: 'Nudge Stroke', state: { selectedNodeId: 'node-b' } });

    expect(getState().history).toHaveLength(3);
    expect(getState().historyIndex).toBe(2);
    expect(getState().history[1]).toMatchObject({
      label: 'Nudge Stroke',
      state: { selectedNodeId: 'node-a' },
    });
    expect(getState().history[2]).toMatchObject({
      label: 'Nudge Stroke',
      state: { selectedNodeId: 'node-b' },
    });
  });

  it('requests a backup before replacing a redo path after undo', () => {
    const { getState, setState } = createHarness();
    const backupRedoHistory = vi.fn();
    const debouncedSave = vi.fn();
    const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
      setState(fn(getState()));
    };
    const actions = createHistoryActions(set as never, getState as never, debouncedSave, {
      backupRedoHistory,
    });

    setState({
      historyIndex: 0,
      history: [
        { id: 'hist_base', label: 'Base', state: { selectedNodeId: 'node-a' } },
        {
          id: 'hist_checkpoint',
          label: 'Old Checkpoint',
          checkpointLabel: 'Old Checkpoint',
          state: { selectedNodeId: 'node-b' },
        },
        { id: 'hist_old_head', label: 'Old Head', state: { selectedNodeId: 'node-c' } },
      ],
    });

    actions.pushHistory({ label: 'New Branch Edit', state: { selectedNodeId: 'node-d' } });

    expect(backupRedoHistory).toHaveBeenCalledWith({
      history: expect.arrayContaining([
        expect.objectContaining({ id: 'hist_checkpoint' }),
        expect.objectContaining({ id: 'hist_old_head' }),
      ]),
      historyIndex: 0,
      nextEntry: expect.objectContaining({ label: 'New Branch Edit' }),
    });
    expect(getState().history.map((entry) => entry.label)).toEqual(['Base', 'New Branch Edit']);
  });

  it('limits open-project undo history using the configured cap', () => {
    const { getState, setState } = createHarness();
    const debouncedSave = vi.fn();
    const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
      setState(fn(getState()));
    };
    const actions = createHistoryActions(set as never, getState as never, debouncedSave, {
      getUndoHistoryLimit: () => 2,
    });

    setState({
      historyIndex: 2,
      history: [
        { id: 'hist_1', label: 'One', state: { selectedNodeId: 'node-a' } },
        { id: 'hist_2', label: 'Two', state: { selectedNodeId: 'node-b' } },
        { id: 'hist_3', label: 'Three', state: { selectedNodeId: 'node-c' } },
      ],
    });

    actions.pushHistory({ label: 'Four', state: { selectedNodeId: 'node-d' } });

    expect(getState().history.map((entry) => entry.label)).toEqual(['Two', 'Three', 'Four']);
    expect(getState().historyIndex).toBe(2);
  });

  it('can keep unlimited open-project undo history', () => {
    const { getState, setState } = createHarness();
    const debouncedSave = vi.fn();
    const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
      setState(fn(getState()));
    };
    const actions = createHistoryActions(set as never, getState as never, debouncedSave, {
      getUndoHistoryLimit: () => null,
    });

    setState({
      historyIndex: 2,
      history: [
        { id: 'hist_1', label: 'One', state: { selectedNodeId: 'node-a' } },
        { id: 'hist_2', label: 'Two', state: { selectedNodeId: 'node-b' } },
        { id: 'hist_3', label: 'Three', state: { selectedNodeId: 'node-c' } },
      ],
    });

    actions.pushHistory({ label: 'Four', state: { selectedNodeId: 'node-d' } });

    expect(getState().history.map((entry) => entry.label)).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(getState().historyIndex).toBe(3);
  });

  it('uses the undone entry context when restoring the previous history state', () => {
    const { actions, getState, setState } = createHarness();
    const baseNodes = [
      { id: 'node-a', name: 'Source' },
      { id: 'node-edited', name: 'Grade' },
    ];
    const editedNodes = [
      { id: 'node-a', name: 'Source' },
      { id: 'node-edited', name: 'Grade Updated' },
    ];

    setState({
      nodes: editedNodes,
      selectedNodeId: 'node-other',
      currentFrame: 99,
      historyIndex: 1,
      history: [
        {
          id: 'hist_base',
          label: 'Base',
          state: { nodes: baseNodes, selectedNodeId: 'node-a', currentFrame: 0 },
        },
        {
          id: 'hist_edit',
          label: 'Edit Grade',
          state: { nodes: editedNodes, selectedNodeId: 'node-edited', currentFrame: 42 },
        },
      ],
    });

    actions.undo();

    expect(getState()).toMatchObject({
      nodes: baseNodes,
      historyIndex: 0,
      selectedNodeId: 'node-edited',
      currentFrame: 42,
    });
  });

  it('selects a node restored by undoing a delete', () => {
    const { actions, getState, setState } = createHarness();
    const baseNodes = [{ id: 'node-a' }, { id: 'node-deleted' }, { id: 'node-c' }];
    const deletedNodes = [{ id: 'node-a' }, { id: 'node-c' }];

    setState({
      nodes: deletedNodes,
      selectedNodeId: 'node-a',
      historyIndex: 1,
      history: [
        {
          id: 'hist_base',
          label: 'Base',
          state: { nodes: baseNodes, selectedNodeId: 'node-deleted', currentFrame: 12 },
        },
        {
          id: 'hist_delete',
          label: 'Delete Node',
          state: { nodes: deletedNodes, selectedNodeId: 'node-a', currentFrame: 12 },
        },
      ],
    });

    actions.undo();

    expect(getState()).toMatchObject({
      nodes: baseNodes,
      historyIndex: 0,
      selectedNodeId: 'node-deleted',
      currentFrame: 12,
    });
  });

  it('does not restore an invalid selected node when undoing an add', () => {
    const { actions, getState, setState } = createHarness();
    const baseNodes = [{ id: 'node-a' }];
    const addedNodes = [{ id: 'node-a' }, { id: 'node-added' }];

    setState({
      nodes: addedNodes,
      selectedNodeId: 'node-added',
      historyIndex: 1,
      history: [
        {
          id: 'hist_base',
          label: 'Base',
          state: { nodes: baseNodes, selectedNodeId: 'node-a', currentFrame: 0 },
        },
        {
          id: 'hist_add',
          label: 'Add Node',
          state: { nodes: addedNodes, selectedNodeId: 'node-added', currentFrame: 0 },
        },
      ],
    });

    actions.undo();

    expect(getState()).toMatchObject({
      nodes: baseNodes,
      historyIndex: 0,
      selectedNodeId: 'node-a',
      currentFrame: 0,
    });
  });

  it('toggles checkpoint metadata on a history entry', () => {
    const { actions, getState } = createHarness();

    actions.pushHistory({ label: 'Grade Clip', state: { selectedNodeId: 'node-a' } });
    actions.toggleHistoryCheckpoint(1);

    expect(getState().history[1]).toMatchObject({
      label: 'Grade Clip',
      checkpointLabel: 'Grade Clip',
    });

    actions.toggleHistoryCheckpoint(1);

    expect(getState().history[1].checkpointLabel).toBeUndefined();
  });

  it('adds checkpoint metadata to the current history entry without toggling it off', () => {
    const { actions, getState, setState, debouncedSave } = createHarness();

    setState({
      historyIndex: 1,
      history: [
        { id: 'hist_base', label: 'Base', state: { selectedNodeId: 'node-a' } },
        { id: 'hist_grade', label: 'Grade Clip', state: { selectedNodeId: 'node-b' } },
      ],
    });

    actions.checkpointCurrentHistoryEntry();

    expect(getState().history[1]).toMatchObject({
      checkpointLabel: 'Grade Clip',
    });
    expect(debouncedSave).toHaveBeenCalledTimes(1);

    actions.checkpointCurrentHistoryEntry();

    expect(getState().history[1]).toMatchObject({
      checkpointLabel: 'Grade Clip',
    });
    expect(debouncedSave).toHaveBeenCalledTimes(2);
  });
});
