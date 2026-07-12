// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayback, type PlaybackBoundaryBehavior } from './usePlayback';

interface TestPlaybackState {
  isPlaying: boolean;
  playbackDirection: 1 | -1;
  fps: number;
  currentFrame: number;
  maxFrames: number;
}

describe('usePlayback boundary behavior', () => {
  let callbacks: FrameRequestCallback[];

  beforeEach(() => {
    callbacks = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderPlayback = (boundaryBehavior: PlaybackBoundaryBehavior) => {
    let state: TestPlaybackState = {
      isPlaying: true,
      playbackDirection: 1,
      fps: 24,
      currentFrame: 10,
      maxFrames: 10,
    };
    const store = {
      getState: () => state,
      setState: (update: (previous: TestPlaybackState) => Partial<TestPlaybackState>) => {
        state = { ...state, ...update(state) };
      },
    };
    const renderLockRef = { current: false };

    const hook = renderHook(() =>
      usePlayback(store, true, 'every_frame', renderLockRef, boundaryBehavior),
    );
    act(() => callbacks.shift()?.(16));

    return { state: () => state, hook };
  };

  it('stops the editor-style timeline at its end by default', () => {
    const { state, hook } = renderPlayback('stop');
    expect(state()).toMatchObject({ isPlaying: false, currentFrame: 10 });
    hook.unmount();
  });

  it('wraps callers that explicitly request looping preview playback', () => {
    const { state, hook } = renderPlayback('loop');
    expect(state()).toMatchObject({ isPlaying: true, currentFrame: 0 });
    hook.unmount();
  });
});
