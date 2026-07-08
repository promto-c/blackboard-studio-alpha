import { describe, expect, it } from 'vitest';
import {
  advanceAdaptiveRotoPreview,
  clampRotoPreviewRefineDelay,
  createAdaptiveRotoPreviewState,
} from './rotoTemporalPreview';

describe('adaptive Roto temporal preview', () => {
  it('drops to optimized quality after full renders repeatedly miss the frame budget', () => {
    let state = createAdaptiveRotoPreviewState();
    state = advanceAdaptiveRotoPreview(state, 39, 30);
    state = advanceAdaptiveRotoPreview(state, 38, 30);
    expect(state.optimized).toBe(true);
  });

  it('drops immediately after a severe frame-budget miss', () => {
    const state = advanceAdaptiveRotoPreview(createAdaptiveRotoPreviewState(), 60, 30);
    expect(state.optimized).toBe(true);
  });

  it('uses hysteresis before probing full quality again', () => {
    let state = { optimized: true, slowRenderCount: 0, fastRenderCount: 0 };
    for (let index = 0; index < 29; index += 1) {
      state = advanceAdaptiveRotoPreview(state, 10, 30);
    }
    expect(state.optimized).toBe(true);

    state = advanceAdaptiveRotoPreview(state, 10, 30);
    expect(state.optimized).toBe(false);
  });

  it('clamps the refine delay preference', () => {
    expect(clampRotoPreviewRefineDelay(5)).toBe(40);
    expect(clampRotoPreviewRefineDelay(900)).toBe(500);
  });
});
