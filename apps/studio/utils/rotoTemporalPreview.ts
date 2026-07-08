export type RotoPlaybackPreviewMode = 'auto' | 'optimized' | 'full';

export const RotoPreviewRefineDelay = {
  MIN: 40,
  MAX: 500,
  STEP: 10,
  DEFAULT: 120,
} as const;

export const clampRotoPreviewRefineDelay = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return RotoPreviewRefineDelay.DEFAULT;
  }
  return Math.round(
    Math.min(RotoPreviewRefineDelay.MAX, Math.max(RotoPreviewRefineDelay.MIN, value)),
  );
};

export interface AdaptiveRotoPreviewState {
  optimized: boolean;
  slowRenderCount: number;
  fastRenderCount: number;
}

export const createAdaptiveRotoPreviewState = (): AdaptiveRotoPreviewState => ({
  optimized: false,
  slowRenderCount: 0,
  fastRenderCount: 0,
});

/**
 * Switches down quickly when full-quality Roto work cannot fit inside the
 * playback frame budget, then periodically probes full quality again only
 * after the optimized path has sustained substantial headroom.
 */
export const advanceAdaptiveRotoPreview = (
  state: AdaptiveRotoPreviewState,
  renderDurationMs: number,
  fps: number,
): AdaptiveRotoPreviewState => {
  if (!Number.isFinite(renderDurationMs) || renderDurationMs < 0) return state;

  const frameBudgetMs = 1000 / Math.max(1, fps);
  if (!state.optimized) {
    if (renderDurationMs >= frameBudgetMs * 1.5) {
      return { optimized: true, slowRenderCount: 0, fastRenderCount: 0 };
    }
    const slowRenderCount =
      renderDurationMs >= frameBudgetMs * 0.9
        ? state.slowRenderCount + 1
        : Math.max(0, state.slowRenderCount - 1);
    if (slowRenderCount >= 2) {
      return { optimized: true, slowRenderCount: 0, fastRenderCount: 0 };
    }
    return { ...state, slowRenderCount, fastRenderCount: 0 };
  }

  const fastRenderCount = renderDurationMs <= frameBudgetMs * 0.65 ? state.fastRenderCount + 1 : 0;
  if (fastRenderCount >= 30) {
    return createAdaptiveRotoPreviewState();
  }
  return { ...state, slowRenderCount: 0, fastRenderCount };
};
