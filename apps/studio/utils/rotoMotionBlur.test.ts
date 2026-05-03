import { describe, expect, it } from 'vitest';
import {
  clampRotoMotionBlurSamples,
  getRotoMotionBlurCanvasSampleWeights,
  getRotoMotionBlurSampleFrames,
  getRotoMotionBlurSampleWeights,
  resolveRotoMotionBlurPreviewSamples,
  resolveRotoMotionBlurSettings,
} from './rotoMotionBlur';

describe('resolveRotoMotionBlurSettings', () => {
  it('fills defaults and clamps invalid values', () => {
    const resolved = resolveRotoMotionBlurSettings({
      enabled: true,
      shutter: -2,
      samples: 200,
      phase: 'invalid' as never,
    });

    expect(resolved).toEqual({
      enabled: true,
      shutter: 0,
      samples: 128,
      phase: 'centered',
    });
  });
});

describe('getRotoMotionBlurSampleFrames', () => {
  it('creates centered edge-aligned samples', () => {
    const samples = getRotoMotionBlurSampleFrames(10, 1, 4, 'centered');
    expect(samples).toEqual([9.5, 9.833333333333334, 10.166666666666666, 10.5]);
  });

  it('creates start-offset edge-aligned samples', () => {
    const samples = getRotoMotionBlurSampleFrames(10, 1, 4, 'start');
    expect(samples).toEqual([10, 10.333333333333334, 10.666666666666666, 11]);
  });

  it('creates end-offset edge-aligned samples', () => {
    const samples = getRotoMotionBlurSampleFrames(10, 1, 4, 'end');
    expect(samples).toEqual([9, 9.333333333333334, 9.666666666666666, 10]);
  });

  it('keeps the first and last samples locked to the shutter edges', () => {
    expect(getRotoMotionBlurSampleFrames(10, 1, 2, 'centered')).toEqual([9.5, 10.5]);
    expect(getRotoMotionBlurSampleFrames(10, 1, 64, 'centered')).toEqual(
      expect.arrayContaining([9.5, 10.5]),
    );
  });

  it('falls back to current frame when shutter is zero', () => {
    const samples = getRotoMotionBlurSampleFrames(24, 0, 8, 'centered');
    expect(samples).toEqual([24]);
  });
});

describe('clampRotoMotionBlurSamples', () => {
  it('enforces sample bounds', () => {
    expect(clampRotoMotionBlurSamples(1)).toBe(2);
    expect(clampRotoMotionBlurSamples(64)).toBe(64);
    expect(clampRotoMotionBlurSamples(99)).toBe(64);
  });
});

describe('resolveRotoMotionBlurPreviewSamples', () => {
  it('keeps the node sample count when interactive preview is disabled', () => {
    expect(
      resolveRotoMotionBlurPreviewSamples(24, {
        interactivePreviewEnabled: false,
        interactivePreviewActive: true,
        interactivePreviewSamples: 4,
      }),
    ).toBe(24);
  });

  it('keeps the node sample count when no interactive edit is active', () => {
    expect(
      resolveRotoMotionBlurPreviewSamples(24, {
        interactivePreviewEnabled: true,
        interactivePreviewActive: false,
        interactivePreviewSamples: 4,
      }),
    ).toBe(24);
  });

  it('caps samples during active interactive preview', () => {
    expect(
      resolveRotoMotionBlurPreviewSamples(24, {
        interactivePreviewEnabled: true,
        interactivePreviewActive: true,
        interactivePreviewSamples: 4,
      }),
    ).toBe(4);
  });

  it('never increases samples above the node setting', () => {
    expect(
      resolveRotoMotionBlurPreviewSamples(6, {
        interactivePreviewEnabled: true,
        interactivePreviewActive: true,
        interactivePreviewSamples: 32,
      }),
    ).toBe(6);
  });
});

describe('getRotoMotionBlurSampleWeights', () => {
  it('creates trapezoidal weights that sum to 1', () => {
    expect(getRotoMotionBlurSampleWeights(2)).toEqual([0.5, 0.5]);
    expect(getRotoMotionBlurSampleWeights(4)).toEqual([
      0.16666666666666666, 0.3333333333333333, 0.3333333333333333, 0.16666666666666666,
    ]);
  });

  it('keeps the endpoint weights at half an interior step', () => {
    for (let samples = 2; samples <= 64; samples += 1) {
      const weights = getRotoMotionBlurSampleWeights(samples);
      const interiorWeight = 1 / (samples - 1);

      expect(weights.reduce((total, weight) => total + weight, 0)).toBeCloseTo(1, 10);
      expect(weights[0]).toBeCloseTo(interiorWeight * 0.5, 10);
      expect(weights[weights.length - 1]).toBeCloseTo(interiorWeight * 0.5, 10);
    }
  });
});

describe('getRotoMotionBlurCanvasSampleWeights', () => {
  it('distributes 8-bit sample weights so they sum to a full-strength mask', () => {
    for (let samples = 1; samples <= 64; samples += 1) {
      const weightBytes = getRotoMotionBlurCanvasSampleWeights(
        getRotoMotionBlurSampleWeights(samples),
      ).map((weight) => Math.round(weight * 255));

      expect(weightBytes).toHaveLength(samples);
      expect(weightBytes.reduce((total, weight) => total + weight, 0)).toBe(255);
    }
  });

  it('uses only the nearest byte weights for a given sample count', () => {
    const samples = 63;
    const idealWeights = getRotoMotionBlurSampleWeights(samples).map((weight) => weight * 255);
    const weightBytes = getRotoMotionBlurCanvasSampleWeights(
      getRotoMotionBlurSampleWeights(samples),
    ).map((weight) => Math.round(weight * 255));

    expect(
      weightBytes.every((weight, index) => {
        const floorWeight = Math.floor(idealWeights[index]);
        const ceilWeight = Math.ceil(idealWeights[index]);
        return weight === floorWeight || weight === ceilWeight;
      }),
    ).toBe(true);
  });

  it('keeps static fully covered pixels at 1.0 across sample counts', () => {
    for (let samples = 1; samples <= 64; samples += 1) {
      let alphaByte = 0;
      const weightBytes = getRotoMotionBlurCanvasSampleWeights(
        getRotoMotionBlurSampleWeights(samples),
      ).map((weight) => Math.round(weight * 255));

      for (const weightByte of weightBytes) {
        alphaByte = Math.min(255, alphaByte + weightByte);
      }

      expect(alphaByte / 255).toBe(1);
    }
  });
});
