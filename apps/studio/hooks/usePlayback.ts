import { useCallback, useEffect, useRef, MutableRefObject } from 'react';
import { isLoopingTimelineNode } from '@/utils/nodePredicates';

type PlaybackMode = 'every_frame' | 'realtime';

interface PlaybackState {
  isPlaying: boolean;
  fps: number;
  currentFrame: number;
  maxFrames: number;
  nodes: { type: string; loop?: boolean }[];
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
 */
export function usePlayback(
  store: PlaybackStore,
  isPlaying: boolean,
  playbackMode: PlaybackMode,
  renderLockRef: MutableRefObject<boolean>,
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

      if (playbackMode === 'every_frame') {
        if (renderLockRef.current) {
          animationFrameRef.current = requestAnimationFrame(runPlayback);
          return;
        }

        const hasLoopingVideo = current.nodes.some(isLoopingTimelineNode);
        let nextFrame = current.currentFrame + 1;
        if (nextFrame > current.maxFrames) {
          if (hasLoopingVideo) {
            const frameCount = Math.max(1, current.maxFrames + 1);
            nextFrame = nextFrame % frameCount;
          } else {
            renderLockRef.current = false;
            store.setState(() => ({
              isPlaying: false,
              currentFrame: current.maxFrames,
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
          let nextFrame = s.currentFrame + framesToAdvance;
          const hasLoopingVideo = s.nodes.some(isLoopingTimelineNode);
          if (nextFrame > s.maxFrames) {
            if (hasLoopingVideo) {
              const frameCount = Math.max(1, s.maxFrames + 1);
              nextFrame = nextFrame % frameCount;
            } else {
              return { isPlaying: false, currentFrame: s.maxFrames };
            }
          }
          return { currentFrame: nextFrame };
        });
      }

      animationFrameRef.current = requestAnimationFrame(runPlayback);
    },
    [store, playbackMode, renderLockRef],
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
