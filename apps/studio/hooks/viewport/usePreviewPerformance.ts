import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceAdaptivePreview,
  createAdaptivePreviewState,
  resolvePreviewRenderQuality,
  type AdaptivePreviewState,
  type PreviewPlaybackMode,
} from '@/utils/previewPerformance';

interface UsePreviewPerformanceOptions {
  renderRevision: unknown;
  currentFrame: number;
  fps: number;
  isPlaying: boolean;
  isFrameScrubbing: boolean;
  editingPreviewActive: boolean;
  hasAdaptivePreviewWork: boolean;
  optimizeWhileEditing: boolean;
  optimizeFrameChanges: boolean;
  refineDelayMs: number;
  playbackMode: PreviewPlaybackMode;
  sceneSize: { width: number; height: number };
  viewportSize: { width: number; height: number };
  maxDimension: number;
  sampleLimit: number;
}

export const usePreviewPerformance = ({
  renderRevision,
  currentFrame,
  fps,
  isPlaying,
  isFrameScrubbing,
  editingPreviewActive,
  hasAdaptivePreviewWork,
  optimizeWhileEditing,
  optimizeFrameChanges,
  refineDelayMs,
  playbackMode,
  sceneSize,
  viewportSize,
  maxDimension,
  sampleLimit,
}: UsePreviewPerformanceOptions) => {
  const previousFrameRef = useRef(currentFrame);
  const previousRevisionRef = useRef(renderRevision);
  const frameChangedThisRender = previousFrameRef.current !== currentFrame;
  const revisionChangedThisRender = previousRevisionRef.current !== renderRevision;
  const refineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackAdaptiveStateRef = useRef<AdaptivePreviewState>(createAdaptivePreviewState());
  const frameAdaptiveStateRef = useRef<AdaptivePreviewState>(createAdaptivePreviewState());
  const pendingPrepareDurationRef = useRef(0);
  const [settlingReason, setSettlingReason] = useState<'editing' | 'frame' | null>(null);
  const frameOptimizationRecommended = frameAdaptiveStateRef.current.optimized;

  useEffect(() => {
    const frameChanged = previousFrameRef.current !== currentFrame;
    const revisionChanged = previousRevisionRef.current !== renderRevision;
    previousFrameRef.current = currentFrame;
    previousRevisionRef.current = renderRevision;

    const nextSettlingReason =
      hasAdaptivePreviewWork && !isPlaying
        ? optimizeWhileEditing && revisionChanged
          ? 'editing'
          : optimizeFrameChanges && frameOptimizationRecommended && frameChanged
            ? 'frame'
            : null
        : null;
    if (!nextSettlingReason) {
      if (
        !hasAdaptivePreviewWork ||
        isPlaying ||
        (settlingReason === 'frame' && !frameOptimizationRecommended) ||
        (!optimizeFrameChanges && !optimizeWhileEditing)
      ) {
        if (refineTimerRef.current) {
          clearTimeout(refineTimerRef.current);
          refineTimerRef.current = null;
        }
        setSettlingReason(null);
      }
      return;
    }

    if (refineTimerRef.current) clearTimeout(refineTimerRef.current);
    setSettlingReason(nextSettlingReason);
    refineTimerRef.current = setTimeout(() => {
      refineTimerRef.current = null;
      setSettlingReason(null);
    }, refineDelayMs);
  }, [
    currentFrame,
    frameOptimizationRecommended,
    hasAdaptivePreviewWork,
    isPlaying,
    optimizeFrameChanges,
    optimizeWhileEditing,
    refineDelayMs,
    renderRevision,
    settlingReason,
  ]);

  useEffect(
    () => () => {
      if (refineTimerRef.current) clearTimeout(refineTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    playbackAdaptiveStateRef.current = createAdaptivePreviewState();
  }, [hasAdaptivePreviewWork, isPlaying, playbackMode]);

  useEffect(() => {
    frameAdaptiveStateRef.current = createAdaptivePreviewState();
  }, [hasAdaptivePreviewWork, optimizeFrameChanges]);

  const reportPrepareDuration = useCallback((durationMs: number) => {
    pendingPrepareDurationRef.current = Math.max(0, durationMs);
  }, []);

  const playbackOptimized =
    hasAdaptivePreviewWork &&
    isPlaying &&
    (playbackMode === 'optimized' ||
      (playbackMode === 'auto' && playbackAdaptiveStateRef.current.optimized));
  const previewOptimized =
    playbackOptimized ||
    (hasAdaptivePreviewWork &&
      !isPlaying &&
      ((optimizeWhileEditing &&
        (editingPreviewActive || revisionChangedThisRender || settlingReason === 'editing')) ||
        (optimizeFrameChanges &&
          frameOptimizationRecommended &&
          (isFrameScrubbing || frameChangedThisRender || settlingReason === 'frame'))));

  const reportRenderDuration = useCallback(
    (durationMs: number) => {
      const totalDurationMs = durationMs + pendingPrepareDurationRef.current;
      pendingPrepareDurationRef.current = 0;
      if (!hasAdaptivePreviewWork) return;
      const renderedMode = previewOptimized ? 'preview' : 'full';

      if (isPlaying) {
        if (playbackMode !== 'auto') return;
        playbackAdaptiveStateRef.current = advanceAdaptivePreview(
          playbackAdaptiveStateRef.current,
          totalDurationMs,
          fps,
          renderedMode,
        );
        return;
      }

      if (optimizeFrameChanges) {
        frameAdaptiveStateRef.current = advanceAdaptivePreview(
          frameAdaptiveStateRef.current,
          totalDurationMs,
          fps,
          renderedMode,
        );
      }
    },
    [fps, hasAdaptivePreviewWork, isPlaying, optimizeFrameChanges, playbackMode, previewOptimized],
  );

  const sceneWidth = sceneSize.width;
  const sceneHeight = sceneSize.height;
  const viewportWidth = viewportSize.width;
  const viewportHeight = viewportSize.height;

  const quality = useMemo(
    () =>
      resolvePreviewRenderQuality(
        { width: sceneWidth, height: sceneHeight },
        { width: viewportWidth, height: viewportHeight },
        previewOptimized,
        maxDimension,
        sampleLimit,
      ),
    [
      maxDimension,
      previewOptimized,
      sampleLimit,
      sceneHeight,
      sceneWidth,
      viewportHeight,
      viewportWidth,
    ],
  );

  return { previewOptimized, quality, reportPrepareDuration, reportRenderDuration };
};
