import { useCallback, useEffect, useRef, useState } from 'react';
import {
  advanceAdaptiveRotoPreview,
  createAdaptiveRotoPreviewState,
  type AdaptiveRotoPreviewState,
  type RotoPlaybackPreviewMode,
} from '@/utils/rotoTemporalPreview';

interface UseRotoTemporalPreviewOptions {
  currentFrame: number;
  fps: number;
  isPlaying: boolean;
  isFrameScrubbing: boolean;
  frameChangePreviewEnabled: boolean;
  refineDelayMs: number;
  playbackMode: RotoPlaybackPreviewMode;
}

export const useRotoTemporalPreview = ({
  currentFrame,
  fps,
  isPlaying,
  isFrameScrubbing,
  frameChangePreviewEnabled,
  refineDelayMs,
  playbackMode,
}: UseRotoTemporalPreviewOptions) => {
  const previousFrameRef = useRef(currentFrame);
  const frameChangedThisRender = previousFrameRef.current !== currentFrame;
  const refineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adaptiveStateRef = useRef<AdaptiveRotoPreviewState>(createAdaptiveRotoPreviewState());
  const pendingPrepareDurationRef = useRef(0);
  const [frameChangeOptimized, setFrameChangeOptimized] = useState(false);
  const [adaptiveOptimized, setAdaptiveOptimized] = useState(false);

  useEffect(() => {
    const frameChanged = previousFrameRef.current !== currentFrame;
    previousFrameRef.current = currentFrame;

    if (refineTimerRef.current) {
      clearTimeout(refineTimerRef.current);
      refineTimerRef.current = null;
    }

    if (!frameChangePreviewEnabled || isPlaying || !frameChanged) {
      if (isPlaying || !frameChangePreviewEnabled) setFrameChangeOptimized(false);
      return;
    }

    setFrameChangeOptimized(true);
    refineTimerRef.current = setTimeout(() => {
      refineTimerRef.current = null;
      setFrameChangeOptimized(false);
    }, refineDelayMs);
  }, [currentFrame, frameChangePreviewEnabled, isPlaying, refineDelayMs]);

  useEffect(
    () => () => {
      if (refineTimerRef.current) clearTimeout(refineTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    adaptiveStateRef.current = createAdaptiveRotoPreviewState();
    setAdaptiveOptimized(false);
  }, [isPlaying, playbackMode]);

  const reportPrepareDuration = useCallback((durationMs: number) => {
    pendingPrepareDurationRef.current = Math.max(0, durationMs);
  }, []);

  const reportRenderDuration = useCallback(
    (durationMs: number) => {
      if (!isPlaying || playbackMode !== 'auto') return;
      const totalDurationMs = durationMs + pendingPrepareDurationRef.current;
      pendingPrepareDurationRef.current = 0;
      const nextState = advanceAdaptiveRotoPreview(adaptiveStateRef.current, totalDurationMs, fps);
      adaptiveStateRef.current = nextState;
      setAdaptiveOptimized((current) =>
        current === nextState.optimized ? current : nextState.optimized,
      );
    },
    [fps, isPlaying, playbackMode],
  );

  const playbackOptimized =
    isPlaying && (playbackMode === 'optimized' || (playbackMode === 'auto' && adaptiveOptimized));
  const temporalPreviewActive =
    playbackOptimized ||
    (!isPlaying &&
      frameChangePreviewEnabled &&
      (isFrameScrubbing || frameChangedThisRender || frameChangeOptimized));

  return { temporalPreviewActive, reportPrepareDuration, reportRenderDuration };
};
