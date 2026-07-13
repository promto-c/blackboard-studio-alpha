import { describe, expect, it } from 'vitest';
import type { GeneratedOutputDifferenceMask } from '@blackboard/types';
import { createComfyDifferenceMask, resolveComfyDifferenceMask } from './comfyDifferenceMask';

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
      thresholdLow: 0.03,
      thresholdHigh: 0.14,
      comparisonBlur: 1.25,
      edgeAdjustment: 0,
      removeSpecks: 0,
      fillHoles: 0,
      morphologyShape: 'round',
      invert: false,
      previewMode: 'result',
    });
  });

  it('normalizes an incomplete runtime mask before UI or rendering consumes it', () => {
    const mask = createComfyDifferenceMask({
      referenceAssetId: 'input_snapshot',
      referenceWidth: 640,
      referenceHeight: 480,
    });
    delete (mask as Partial<GeneratedOutputDifferenceMask>).comparisonBlur;
    delete (mask as Partial<GeneratedOutputDifferenceMask>).morphologyShape;

    expect(resolveComfyDifferenceMask(mask)).toMatchObject({
      comparisonBlur: 1.25,
      thresholdLow: 0.03,
      thresholdHigh: 0.14,
      morphologyShape: 'round',
    });
  });
});
