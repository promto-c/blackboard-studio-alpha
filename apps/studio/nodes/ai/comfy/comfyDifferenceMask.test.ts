import { describe, expect, it } from 'vitest';
import { createComfyDifferenceMask } from './comfyDifferenceMask';

describe('Comfy difference mask', () => {
  it('creates a disabled, soft-range mask from a captured input reference', () => {
    expect(
      createComfyDifferenceMask({
        referenceAssetId: 'input_snapshot',
        referenceWidth: 640,
        referenceHeight: 480,
        referenceTransform: { x: 12, y: -8, scaleX: 1.2, scaleY: 1.2 },
      }),
    ).toEqual({
      enabled: false,
      referenceAssetId: 'input_snapshot',
      referenceWidth: 640,
      referenceHeight: 480,
      referenceTransform: { x: 12, y: -8, scaleX: 1.2, scaleY: 1.2 },
      thresholdLow: 0.06,
      thresholdHigh: 0.18,
      edgeAdjustment: 0,
      removeSpecks: 0,
      fillHoles: 0,
      invert: false,
      previewMode: 'result',
    });
  });
});
