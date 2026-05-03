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
      selectedPaintLayerIds?: string[];
      selectedPaintStrokeIds?: string[];
      selectedRotoLayerIds?: string[];
      selectedRotoPathIds?: string[];
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
  selectedPaintLayerIds: string[];
  selectedPaintStrokeIds: string[];
  selectedRotoLayerIds: string[];
  selectedRotoPathIds: string[];
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
    selectedPaintLayerIds: ['paint-layer-1'],
    selectedPaintStrokeIds: ['paint-stroke-1'],
    selectedRotoLayerIds: ['roto-layer-1'],
    selectedRotoPathIds: ['roto-path-1'],
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
        selectedPaintLayerIds: ['paint-layer-1'],
        selectedPaintStrokeIds: ['paint-stroke-1'],
        selectedRotoLayerIds: ['roto-layer-1'],
        selectedRotoPathIds: ['roto-path-1'],
        selectedRotoPointRefs: [{ pathId: 'roto-path-1', pointIndex: 2 }],
        selectedKeyframes: [{ nodeId: 'node-current', path: 'opacity', frame: 24 }],
      },
    });
  });

  it('lets explicit history state override captured context', () => {
    const { actions, getState } = createHarness();

    actions.pushHistory({
      label: 'Set Keyframe',
      state: {
        currentFrame: 48,
        selectedNodeId: 'node-target',
        selectedRotoPathIds: ['roto-path-2'],
      },
    });

    expect(getState().history[1]).toMatchObject({
      label: 'Set Keyframe',
      state: {
        currentFrame: 48,
        selectedNodeId: 'node-target',
        selectedRotoPathIds: ['roto-path-2'],
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
});
