import { describe, expect, it } from 'vitest';
import {
  RotoInteractivePreviewSize,
  clampRotoInteractivePreviewSize,
  resolveViewportRotoMaskRasterSize,
} from './rotoPreviewQuality';

describe('Roto interactive preview quality', () => {
  it('uses the configured long-edge budget while editing and full size after commit', () => {
    const scene = { width: 3840, height: 2160 };
    const viewport = { width: 1934, height: 1321 };

    expect(resolveViewportRotoMaskRasterSize(scene, viewport, true, 960)).toEqual({
      width: 960,
      height: 540,
    });
    expect(resolveViewportRotoMaskRasterSize(scene, viewport, false, 960)).toEqual(scene);
  });

  it('normalizes persisted size values', () => {
    expect(clampRotoInteractivePreviewSize(Number.NaN)).toBe(RotoInteractivePreviewSize.DEFAULT);
    expect(clampRotoInteractivePreviewSize(1)).toBe(RotoInteractivePreviewSize.MIN);
    expect(clampRotoInteractivePreviewSize(9999)).toBe(RotoInteractivePreviewSize.MAX);
  });
});
