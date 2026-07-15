import { useCallback, useEffect, useRef, type RefObject } from 'react';

type PlaybackMode = 'every_frame' | 'realtime';
export type PlaybackBoundaryBehavior = 'stop' | 'loop';

const wrapFrame = (frame: number, startFrame: number, endFrame: number) => {
  const frameCount = Math.max(1, endFrame - startFrame + 1);
  return startFrame + ((((frame - startFrame) % frameCount) + frameCount) % frameCount);
};

interface PlaybackState {
  isPlaying: boolean;
  playbackDirection?: 1 | -1;
  fps: number;
  currentFrame: number;
  timelineStartFrame?: number;
  maxFrames: number;
}

interface PlaybackStore<S extends PlaybackState = PlaybackState> {
  getState: () => S;
  setState: (fn: (prev: S) => Partial<S>) => void;
}

/**
 * Drives the editor playback loop.  Encapsulates the requestAnimationFrame
 * bookkeeping that was previously inlined inside EditorProvider.
 *
 * @param store        - Editor store with getState/setState.
 * @param isPlaying    - Current playback state (from the store via useSyncExternalStore).
 * @param playbackMode - Either 'every_frame' (render-locked) or 'realtime'.
 * @param renderLockRef - Shared ref toggled by signalFrameRendered to gate every-frame mode.
 * @param boundaryBehavior - Explicit caller policy at timeline boundaries.
 */
export function usePlayback(
  store: PlaybackStore,
  isPlaying: boolean,
  playbackMode: PlaybackMode,
  renderLockRef: RefObject<boolean>,
  boundaryBehavior: PlaybackBoundaryBehavior = 'stop',
): void {
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const runPlayback = useCallback(
    (timestamp: number) => {
      const current = store.getState();
      if (!current.isPlaying) {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        return;
      }

      const fps = current.fps || 30;
      const interval = 1000 / fps;
      const playbackDirection = current.playbackDirection ?? 1;
      const timelineStartFrame = current.timelineStartFrame ?? 0;

      if (playbackMode === 'every_frame') {
        if (renderLockRef.current) {
          animationFrameRef.current = requestAnimationFrame(runPlayback);
          return;
        }

        let nextFrame = current.currentFrame + playbackDirection;
        if (nextFrame > current.maxFrames || nextFrame < timelineStartFrame) {
          if (boundaryBehavior === 'loop') {
            nextFrame = wrapFrame(nextFrame, timelineStartFrame, current.maxFrames);
          } else {
            renderLockRef.current = false;
            store.setState(() => ({
              isPlaying: false,
              currentFrame: playbackDirection > 0 ? current.maxFrames : timelineStartFrame,
            }));
            animationFrameRef.current = requestAnimationFrame(runPlayback);
            return;
          }
        }

        renderLockRef.current = true;
        store.setState(() => ({ currentFrame: nextFrame }));
        animationFrameRef.current = requestAnimationFrame(runPlayback);
        return;
      }

      // realtime mode
      const delta = timestamp - lastFrameTimeRef.current;
      if (delta >= interval) {
        const framesToAdvance = Math.max(1, Math.floor(delta / interval));
        lastFrameTimeRef.current = timestamp - (delta % interval);
        store.setState((s) => {
          const direction = s.playbackDirection ?? 1;
          const startFrame = s.timelineStartFrame ?? 0;
          let nextFrame = s.currentFrame + framesToAdvance * direction;
          if (nextFrame > s.maxFrames || nextFrame < startFrame) {
            if (boundaryBehavior === 'loop') {
              nextFrame = wrapFrame(nextFrame, startFrame, s.maxFrames);
            } else {
              return {
                isPlaying: false,
                currentFrame: direction > 0 ? s.maxFrames : startFrame,
              };
            }
          }
          return { currentFrame: nextFrame };
        });
      }

      animationFrameRef.current = requestAnimationFrame(runPlayback);
    },
    [boundaryBehavior, store, playbackMode, renderLockRef],
  );

  useEffect(() => {
    if (isPlaying) {
      if (playbackMode === 'realtime') {
        lastFrameTimeRef.current = performance.now();
      }
      renderLockRef.current = false;
      animationFrameRef.current = requestAnimationFrame(runPlayback);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      renderLockRef.current = false;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, playbackMode, renderLockRef, runPlayback]);
}
