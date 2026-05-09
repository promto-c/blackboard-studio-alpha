import { describe, expect, it } from 'vitest';
import { getInitialState } from '@/state/editor/initialState';
import { createPlaybackActions } from './playbackActions';
import type { EditorState } from './types';

const createHarness = (overrides: Partial<EditorState> = {}) => {
  let state = {
    ...getInitialState(),
    maxFrames: 100,
    ...overrides,
  } as EditorState;

  const set = (fn: (prevState: EditorState) => Partial<EditorState> | EditorState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;
  const actions = createPlaybackActions(set, get, { current: false });

  return {
    actions,
    getState: get,
  };
};

describe('playback actions', () => {
  it('sets standard playback directions for JKL-style controls', () => {
    const { actions, getState } = createHarness({ currentFrame: 12 });

    actions.playBackward();
    expect(getState()).toMatchObject({
      isPlaying: true,
      playbackDirection: -1,
    });

    actions.pausePlayback();
    expect(getState()).toMatchObject({
      isPlaying: false,
      playbackDirection: -1,
    });

    actions.playForward();
    expect(getState()).toMatchObject({
      isPlaying: true,
      playbackDirection: 1,
    });
  });

  it('jumps back to the most recent seek frame and toggles between both frames', () => {
    const { actions, getState } = createHarness({ currentFrame: 12 });

    actions.seekFrame(48);
    expect(getState().currentFrame).toBe(48);

    expect(actions.goToRecentFrame()).toBe(true);
    expect(getState().currentFrame).toBe(12);

    expect(actions.goToRecentFrame()).toBe(true);
    expect(getState().currentFrame).toBe(48);
  });

  it('does not replace the recent frame while scrubbing', () => {
    const { actions, getState } = createHarness({ currentFrame: 10 });

    actions.seekFrame(30);
    actions.setFrameScrubbing(true);
    actions.seekFrame(31);
    actions.seekFrame(32);
    actions.setFrameScrubbing(false);

    expect(actions.goToRecentFrame()).toBe(true);
    expect(getState().currentFrame).toBe(10);
  });

  it('returns false when there is no recent frame', () => {
    const { actions, getState } = createHarness({ currentFrame: 5 });

    expect(actions.goToRecentFrame()).toBe(false);
    expect(getState().currentFrame).toBe(5);
  });
});
