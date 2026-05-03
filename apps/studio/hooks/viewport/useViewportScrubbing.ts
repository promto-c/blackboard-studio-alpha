import { useState, useRef, useEffect, useCallback } from 'react';
import { useFrameScrubSession } from '@/hooks/useFrameScrubSession';

interface UseViewportScrubbingParams {
  currentFrame: number;
  seekFrame: (frame: number) => void;
  setFrameScrubbing: (isScrubbing: boolean) => void;
}

interface UseViewportScrubbingResult {
  /** Whether the user is currently scrubbing the timeline via middle-click+Ctrl. */
  isScrubbing: boolean;
  /**
   * Begin a scrubbing drag. Returns `true` if consumed.
   * Call from the viewport mousedown handler when the middle-mouse-button
   * is pressed with Ctrl held.
   */
  startScrub: (clientX: number) => void;
}

/**
 * Manages middle-mouse + Ctrl scrubbing: dragging left/right seeks the
 * timeline. Shift slows scrubbing for fine adjustment.
 */
export function useViewportScrubbing({
  currentFrame,
  seekFrame,
  setFrameScrubbing,
}: UseViewportScrubbingParams): UseViewportScrubbingResult {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubStartRef = useRef<{ startX: number; startFrame: number } | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDispatchedFrameRef = useRef(currentFrame);
  const { startFrameScrubSession } = useFrameScrubSession({ setFrameScrubbing });

  useEffect(() => {
    lastDispatchedFrameRef.current = currentFrame;
  }, [currentFrame]);

  const flushPendingSeek = useCallback(() => {
    rafIdRef.current = null;
    const nextFrame = pendingFrameRef.current;
    pendingFrameRef.current = null;

    if (nextFrame === null || nextFrame === lastDispatchedFrameRef.current) {
      return;
    }

    lastDispatchedFrameRef.current = nextFrame;
    seekFrame(nextFrame);
  }, [seekFrame]);

  const scheduleSeek = useCallback(
    (nextFrame: number) => {
      if (nextFrame === pendingFrameRef.current || nextFrame === lastDispatchedFrameRef.current) {
        return;
      }

      pendingFrameRef.current = nextFrame;
      if (rafIdRef.current !== null) {
        return;
      }

      rafIdRef.current = requestAnimationFrame(() => {
        flushPendingSeek();
      });
    },
    [flushPendingSeek],
  );

  const stopScrub = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const pendingFrame = pendingFrameRef.current;
    pendingFrameRef.current = null;
    if (pendingFrame !== null && pendingFrame !== lastDispatchedFrameRef.current) {
      lastDispatchedFrameRef.current = pendingFrame;
      seekFrame(pendingFrame);
    }

    setIsScrubbing(false);
    scrubStartRef.current = null;
  }, [seekFrame]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const startScrub = useCallback(
    (clientX: number) => {
      setIsScrubbing(true);
      scrubStartRef.current = { startX: clientX, startFrame: currentFrame };
      lastDispatchedFrameRef.current = currentFrame;
      pendingFrameRef.current = null;
      startFrameScrubSession((event) => {
        if (!scrubStartRef.current) return;
        const dx = event.clientX - scrubStartRef.current.startX;

        // Sensitivity: 0.5 frame per pixel for normal scrubbing.
        // Holding Shift slows it down for precision.
        const sensitivity = event.shiftKey ? 0.05 : 0.5;
        const frameDelta = dx * sensitivity;

        scheduleSeek(Math.round(scrubStartRef.current.startFrame + frameDelta));
      }, stopScrub);
    },
    [currentFrame, scheduleSeek, startFrameScrubSession, stopScrub],
  );

  return { isScrubbing, startScrub };
}
