import { describe, expect, it } from 'vitest';
import type { AnyNode } from '@blackboard/types';
import type { NodeRegistryLike } from '@blackboard/renderer';
import {
  PreviewMaxDimension,
  advanceAdaptivePreview,
  clampPreviewMaxDimension,
  createAdaptivePreviewState,
  hasAdaptivePreviewNodes,
  resolvePreviewRasterSize,
  resolvePreviewRenderQuality,
} from './previewPerformance';

describe('shared preview performance', () => {
  it('uses the configured long-edge budget only for optimized previews', () => {
    const scene = { width: 3840, height: 2160 };
    const viewport = { width: 1934, height: 1321 };

    expect(resolvePreviewRasterSize(scene, viewport, true, 960)).toEqual({
      width: 960,
      height: 540,
    });
    expect(resolvePreviewRasterSize(scene, viewport, false, 960)).toEqual(scene);
    expect(resolvePreviewRenderQuality(scene, viewport, true, 960, 12)).toEqual({
      mode: 'preview',
      resolutionScale: 0.25,
      sampleLimit: 12,
    });
  });

  it('normalizes persisted size values', () => {
    expect(clampPreviewMaxDimension(Number.NaN)).toBe(PreviewMaxDimension.DEFAULT);
    expect(clampPreviewMaxDimension(1)).toBe(PreviewMaxDimension.MIN);
    expect(clampPreviewMaxDimension(9999)).toBe(PreviewMaxDimension.MAX);
  });

  it('detects adaptive work declaratively through the node registry', () => {
    const nodes = [
      { id: 'plain', type: 'plain', name: 'Plain', enabled: true },
      { id: 'adaptive', type: 'adaptive', name: 'Adaptive', enabled: true },
    ] as unknown as AnyNode[];
    const registry = new Map([
      ['plain', { adaptivePreview: {} }],
      ['adaptive', { adaptivePreview: { sampleLimit: true } }],
    ]) as unknown as NodeRegistryLike;

    expect(hasAdaptivePreviewNodes(nodes.slice(0, 1), registry)).toBe(false);
    expect(hasAdaptivePreviewNodes(nodes, registry)).toBe(true);
  });

  it('adapts after missed frame budgets and later probes full quality', () => {
    let state = createAdaptivePreviewState();
    state = advanceAdaptivePreview(state, 40, 30);
    state = advanceAdaptivePreview(state, 40, 30);
    expect(state.optimized).toBe(true);

    for (let index = 0; index < 30; index += 1) {
      state = advanceAdaptivePreview(state, 5, 30);
    }
    expect(state.optimized).toBe(false);
    expect(state.fastRenderCount).toBe(0);
    expect(state.fullDurationMs).toBe(40);
    expect(state.previewDurationMs).toBe(5);
  });

  it('rejects a proxy that measures no faster than full quality', () => {
    let state = createAdaptivePreviewState();
    state = advanceAdaptivePreview(state, 40, 30, 'full');
    state = advanceAdaptivePreview(state, 40, 30, 'full');
    expect(state.optimized).toBe(true);

    state = advanceAdaptivePreview(state, 42, 30, 'preview');
    expect(state.optimized).toBe(false);
    expect(state.retryAfterFullFrames).toBe(12);
  });
});
