import { describe, expect, it, vi } from 'vitest';
import { getInitialState } from '@/state/editor/initialState';
import { createViewerActions } from './viewerActions';
import type { EditorState, SetState } from './types';
import type { EditorMutationInput } from '@/state/editor/commitMutation';
import type { AnyNode } from '@blackboard/types';

const createHarness = () => {
  let state: EditorState = {
    ...getInitialState(),
    maxFrames: 120,
  };
  const set: SetState = (updater) => {
    state = { ...state, ...updater(state) };
  };
  const commitMutation = vi.fn();
  const actions = createViewerActions(set, () => state, { commitMutation });
  return {
    actions,
    commitMutation,
    getState: () => state,
    setState: (patch: Partial<EditorState>) => {
      state = { ...state, ...patch };
    },
  };
};

describe('viewer actions', () => {
  it('changes the local display/view without mutating project intent or history', () => {
    const harness = createHarness();
    const projectView = harness.getState().colorManagement.viewer;
    const history = harness.getState().history;

    harness.actions.setViewerDisplayView({
      display: 'Display P3',
      view: 'HDR Video',
    });

    expect(harness.getState().viewerColorManagement.displayViewOverride).toEqual({
      display: 'Display P3',
      view: 'HDR Video',
    });
    expect(harness.getState().colorManagement.viewer).toBe(projectView);
    expect(harness.getState().history).toBe(history);
    expect(harness.commitMutation).not.toHaveBeenCalled();
  });

  it('keeps temporary viewer adjustments out of project mutations', () => {
    const harness = createHarness();

    harness.actions.setViewerSettings({ gain: 1.5, channels: 'R' });

    expect(harness.getState().viewerSettings).toMatchObject({
      gain: 1.5,
      channels: 'R',
    });
    expect(harness.commitMutation).not.toHaveBeenCalled();
  });

  it('resets local display and image adjustments to the project view', () => {
    const harness = createHarness();
    harness.actions.setViewerDisplayView({
      display: 'Display P3',
      view: 'HDR Video',
    });
    harness.actions.setViewerSettings({ gain: 2, gamma: 1.2 });

    harness.actions.resetViewerToProjectView();

    expect(harness.getState().viewerColorManagement.displayViewOverride).toBeNull();
    expect(harness.getState().viewerSettings).toEqual(getInitialState().viewerSettings);
  });

  it('commits cloned project color-management intent', () => {
    const harness = createHarness();
    const colorManagement = {
      ...harness.getState().colorManagement,
      context: { SHOT: '010' },
    };

    harness.actions.setProjectColorManagement(colorManagement);

    const input = harness.commitMutation.mock.calls[0]?.[0] as EditorMutationInput<EditorState>;
    const mutation = typeof input === 'function' ? input(harness.getState()) : input;
    expect(mutation.persist).toBe('debounced');
    expect(mutation.patch.colorManagement).toEqual(colorManagement);
    expect(mutation.patch.colorManagement).not.toBe(colorManagement);
    expect(mutation.patch.colorManagement?.context).not.toBe(colorManagement.context);
    expect(mutation.history).toBeUndefined();
  });

  it('always enters Compare with the lower-numbered slot as the base', () => {
    const harness = createHarness();
    harness.setState({
      nodes: [{ id: 'node-a' }, { id: 'node-b' }] as AnyNode[],
      viewerSlots: { 1: 'node-a', 3: 'node-b' },
    });

    expect(harness.actions.enterCompareMode(3, 1)).toBe(true);
    expect(harness.getState()).toMatchObject({
      compareView: {
        isActive: true,
        slotA: 1,
        slotB: 3,
        sidesSwapped: false,
      },
      viewerNodeId: 'node-a',
      activeViewerSlot: 1,
    });

    harness.actions.swapCompareSlots();
    expect(harness.getState().compareView).toMatchObject({
      slotA: 1,
      slotB: 3,
      sidesSwapped: true,
    });

    harness.actions.swapCompareSlots();
    expect(harness.getState().compareView.sidesSwapped).toBe(false);
  });

  it.each([
    [1, 'node-a'],
    [2, 'node-b'],
    [3, 'node-c'],
    [4, 'node-d'],
  ] as const)(
    'exits Compare directly to viewer slot %i without toggling that slot off',
    (slot, nodeId) => {
      const harness = createHarness();
      harness.setState({
        nodes: [
          { id: 'node-a' },
          { id: 'node-b' },
          { id: 'node-c' },
          { id: 'node-d' },
        ] as AnyNode[],
        viewerSlots: { 1: 'node-a', 2: 'node-b', 3: 'node-c', 4: 'node-d' },
      });
      harness.actions.enterCompareMode(1, 2);

      expect(harness.actions.activateViewerSlot(slot)).toBe(true);
      expect(harness.getState()).toMatchObject({
        compareView: {
          isActive: false,
          slotA: null,
          slotB: null,
        },
        viewerNodeId: nodeId,
        activeViewerSlot: slot,
      });
    },
  );

  it('keeps Compare sizing as view-only state', () => {
    const harness = createHarness();
    const initialRequestId = harness.getState().compareView.sizingRequestId;

    harness.actions.setCompareSizingMode('none');

    expect(harness.getState().compareView.sizingMode).toBe('none');
    expect(harness.getState().compareView.sizingRequestId).toBe(initialRequestId + 1);

    harness.actions.setCompareSizingMode('none');
    expect(harness.getState().compareView.sizingRequestId).toBe(initialRequestId + 2);
    expect(harness.commitMutation).not.toHaveBeenCalled();
  });

  it('records project OCIO config changes in undo history when requested', () => {
    const harness = createHarness();
    const colorManagement = {
      ...harness.getState().colorManagement,
      config: {
        kind: 'external' as const,
        uri: 'project:///show/config.ocio',
      },
    };

    harness.actions.setProjectColorManagement(colorManagement, {
      historyLabel: 'Change Project OCIO Config',
    });

    const input = harness.commitMutation.mock.calls[0]?.[0] as EditorMutationInput<EditorState>;
    const mutation = typeof input === 'function' ? input(harness.getState()) : input;
    expect(mutation.history).toEqual({
      label: 'Change Project OCIO Config',
      state: {
        colorManagement,
      },
    });
    expect(mutation.history?.state.colorManagement).not.toBe(colorManagement);
    expect(
      mutation.patch.history?.[harness.getState().historyIndex]?.state.colorManagement,
    ).toEqual(harness.getState().colorManagement);
  });
});
