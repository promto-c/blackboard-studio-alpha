import type { MutableRefObject } from 'react';
import type { SetState, GetState } from '@/state/editor/slices/types';

export function createPlaybackActions(
  set: SetState,
  get: GetState,
  renderLockRef: MutableRefObject<boolean>,
) {
  let recentFrame: number | null = null;

  const clampFrame = (frame: number) => {
    const current = get();
    return Math.max(0, Math.min(current.maxFrames, frame));
  };

  return {
    playPause: () => set((s) => ({ isPlaying: !s.isPlaying })),
    playForward: () =>
      set(() => ({
        isPlaying: true,
        playbackDirection: 1,
      })),
    playBackward: () =>
      set(() => ({
        isPlaying: true,
        playbackDirection: -1,
      })),
    pausePlayback: () =>
      set(() => ({
        isPlaying: false,
      })),
    seekFrame: (frame: number) => {
      const current = get();
      const nextFrame = clampFrame(frame);
      if (current.currentFrame === nextFrame && !current.isPlaying) {
        return;
      }
      if (current.currentFrame !== nextFrame && !current.isFrameScrubbing) {
        recentFrame = current.currentFrame;
      }
      set(() => ({
        currentFrame: nextFrame,
        isPlaying: false,
      }));
    },
    goToRecentFrame: () => {
      if (recentFrame === null) {
        return false;
      }

      const current = get();
      const nextFrame = clampFrame(recentFrame);
      if (current.currentFrame === nextFrame) {
        return false;
      }

      recentFrame = current.currentFrame;
      set(() => ({
        currentFrame: nextFrame,
        isPlaying: false,
      }));
      return true;
    },
    setFrameScrubbing: (isFrameScrubbing: boolean) => {
      if (get().isFrameScrubbing === isFrameScrubbing) {
        return;
      }
      set(() => ({ isFrameScrubbing }));
    },
    setMaxFrames: (frames: number) => set(() => ({ maxFrames: frames })),
    setFps: (fps: number) => set(() => ({ fps })),
    signalFrameRendered: () => {
      renderLockRef.current = false;
    },
  };
}
