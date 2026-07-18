import { describe, expect, it, vi } from 'vitest';
import { getInitialState } from '@/state/editor/initialState';
import { createViewportUIActions } from './viewportUIActions';
import type { EditorState, GetState, SetState } from './types';

const createHarness = () => {
  let state = { ...getInitialState(), maxFrames: 0 } as EditorState;
  const set: SetState = (updater) => {
    state = { ...state, ...updater(state) };
  };
  const get: GetState = () => state;
  const debouncedSave = vi.fn();
  const actions = createViewportUIActions(set, get, { debouncedSave });

  return { actions, get, debouncedSave };
};

describe('viewport working area actions', () => {
  it('updates the area and schedules its branch snapshot', () => {
    const { actions, get, debouncedSave } = createHarness();

    actions.setViewportWorkingArea({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });

    expect(get().viewportWorkingArea.enabled).toBe(true);
    expect(get().viewportWorkingArea.rect.x).toBeCloseTo(0.1);
    expect(get().viewportWorkingArea.rect.y).toBeCloseTo(0.2);
    expect(get().viewportWorkingArea.rect.width).toBeCloseTo(0.3);
    expect(get().viewportWorkingArea.rect.height).toBeCloseTo(0.4);
    expect(debouncedSave).toHaveBeenCalledOnce();

    actions.setViewportWorkingAreaEnabled(false);
    actions.resetViewportWorkingArea();

    expect(get().viewportWorkingArea).toEqual({
      enabled: false,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(debouncedSave).toHaveBeenCalledTimes(3);
  });
});
