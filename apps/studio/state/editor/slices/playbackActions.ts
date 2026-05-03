import type { MutableRefObject } from 'react';
import type { SetState, GetState } from '@/state/editor/slices/types';

export function createPlaybackActions(
  set: SetState,
  get: GetState,
  renderLockRef: MutableRefObject<boolean>,
) {
  return {
    playPause: () => set((s) => ({ isPlaying: !s.isPlaying })),
    seekFrame: (frame: number) => {
      const current = get();
      const nextFrame = Math.max(0, Math.min(current.maxFrames, frame));
      if (current.currentFrame === nextFrame && !current.isPlaying) {
        return;
      }
      set(() => ({
        currentFrame: nextFrame,
        isPlaying: false,
      }));
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
