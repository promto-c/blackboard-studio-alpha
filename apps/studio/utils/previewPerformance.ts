import type { AnyNode } from '@blackboard/types';
import type { NodeRegistryLike, RenderQuality } from '@blackboard/renderer';

export type PreviewPlaybackMode = 'auto' | 'optimized' | 'full';

export const PreviewMaxDimension = {
  MIN: 320,
  MAX: 2160,
  STEP: 80,
  DEFAULT: 1280,
} as const;

export const PreviewSampleLimit = {
  MIN: 2,
  MAX: 128,
  STEP: 1,
  DEFAULT: 16,
} as const;

export const PreviewRefineDelay = {
  MIN: 40,
  MAX: 500,
  STEP: 10,
  DEFAULT: 120,
} as const;

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export const clampPreviewMaxDimension = (value: unknown): number =>
  clampInteger(
    value,
    PreviewMaxDimension.DEFAULT,
    PreviewMaxDimension.MIN,
    PreviewMaxDimension.MAX,
  );

export const clampPreviewSampleLimit = (value: unknown): number =>
  clampInteger(value, PreviewSampleLimit.DEFAULT, PreviewSampleLimit.MIN, PreviewSampleLimit.MAX);

export const clampPreviewRefineDelay = (value: unknown): number =>
  clampInteger(value, PreviewRefineDelay.DEFAULT, PreviewRefineDelay.MIN, PreviewRefineDelay.MAX);

export const resolvePreviewRasterSize = (
  sceneSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  optimized: boolean,
  maxDimension: number = PreviewMaxDimension.DEFAULT,
): { width: number; height: number } => {
  const sceneWidth = Math.max(1, sceneSize.width);
  const sceneHeight = Math.max(1, sceneSize.height);
  if (!optimized) return { width: sceneWidth, height: sceneHeight };

  const viewportScale =
    viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(viewportSize.width / sceneWidth, viewportSize.height / sceneHeight)
      : 1;
  const budgetScale = clampPreviewMaxDimension(maxDimension) / Math.max(sceneWidth, sceneHeight);
  const scale = Math.min(1, viewportScale, budgetScale);

  return {
    width: Math.max(1, Math.round(sceneWidth * scale)),
    height: Math.max(1, Math.round(sceneHeight * scale)),
  };
};

export const resolvePreviewRenderQuality = (
  sceneSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  optimized: boolean,
  maxDimension: number,
  sampleLimit: number,
): RenderQuality => {
  if (!optimized) return { mode: 'full', resolutionScale: 1, sampleLimit: 128 };
  const rasterSize = resolvePreviewRasterSize(sceneSize, viewportSize, true, maxDimension);
  return {
    mode: 'preview',
    resolutionScale: Math.min(
      1,
      rasterSize.width / Math.max(1, sceneSize.width),
      rasterSize.height / Math.max(1, sceneSize.height),
    ),
    sampleLimit: clampPreviewSampleLimit(sampleLimit),
  };
};

/** True when the active render branch contains work that can consume a proxy budget. */
export const hasAdaptivePreviewNodes = (
  nodes: readonly AnyNode[],
  nodeRegistry: NodeRegistryLike,
): boolean =>
  nodes.some((node) => {
    if (!node.enabled) return false;
    const capability = nodeRegistry.get(node.type)?.adaptivePreview;
    return capability?.resolutionScale === true || capability?.sampleLimit === true;
  });

export interface AdaptivePreviewState {
  optimized: boolean;
  slowRenderCount: number;
  fastRenderCount: number;
  fullDurationMs: number | null;
  previewDurationMs: number | null;
  retryAfterFullFrames: number;
}

export const createAdaptivePreviewState = (): AdaptivePreviewState => ({
  optimized: false,
  slowRenderCount: 0,
  fastRenderCount: 0,
  fullDurationMs: null,
  previewDurationMs: null,
  retryAfterFullFrames: 0,
});

const updateDurationAverage = (current: number | null, sample: number): number =>
  current === null ? sample : current * 0.75 + sample * 0.25;

/**
 * Drops preview quality after two missed frame budgets (or one severe miss),
 * then periodically returns to full quality after sustained headroom.
 */
export const advanceAdaptivePreview = (
  state: AdaptivePreviewState,
  renderDurationMs: number,
  fps: number,
  renderedMode: RenderQuality['mode'] = state.optimized ? 'preview' : 'full',
): AdaptivePreviewState => {
  if (!Number.isFinite(renderDurationMs) || renderDurationMs < 0) return state;

  const frameBudgetMs = 1000 / Math.max(1, fps);
  if (renderedMode === 'full') {
    const fullDurationMs = updateDurationAverage(state.fullDurationMs, renderDurationMs);
    const retryAfterFullFrames = Math.max(0, state.retryAfterFullFrames - 1);
    const baseState = { ...state, fullDurationMs, retryAfterFullFrames };
    if (state.optimized) {
      return fullDurationMs <= frameBudgetMs * 0.8
        ? { ...baseState, optimized: false, slowRenderCount: 0, fastRenderCount: 0 }
        : baseState;
    }
    if (retryAfterFullFrames > 0) {
      return { ...baseState, slowRenderCount: 0, fastRenderCount: 0 };
    }
    if (renderDurationMs >= frameBudgetMs * 1.5) {
      return { ...baseState, optimized: true, slowRenderCount: 0, fastRenderCount: 0 };
    }
    const slowRenderCount =
      renderDurationMs >= frameBudgetMs * 0.9
        ? state.slowRenderCount + 1
        : Math.max(0, state.slowRenderCount - 1);
    return slowRenderCount >= 2
      ? { ...baseState, optimized: true, slowRenderCount: 0, fastRenderCount: 0 }
      : { ...baseState, slowRenderCount, fastRenderCount: 0 };
  }

  const previewDurationMs = updateDurationAverage(state.previewDurationMs, renderDurationMs);
  const fullDurationMs = state.fullDurationMs;
  if (fullDurationMs !== null && previewDurationMs >= fullDurationMs * 0.95) {
    return {
      ...state,
      optimized: false,
      slowRenderCount: 0,
      fastRenderCount: 0,
      previewDurationMs,
      retryAfterFullFrames: 12,
    };
  }

  const fastRenderCount = state.fastRenderCount + 1;
  return fastRenderCount >= 30
    ? {
        ...state,
        optimized: false,
        slowRenderCount: 0,
        fastRenderCount: 0,
        previewDurationMs,
      }
    : { ...state, previewDurationMs, slowRenderCount: 0, fastRenderCount };
};
