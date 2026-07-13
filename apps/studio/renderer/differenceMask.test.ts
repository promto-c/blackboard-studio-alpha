import { describe, expect, it } from 'vitest';
import {
  calculatePerceptualDifference,
  getDifferenceMaskMorphologyPasses,
  srgbToOklab,
} from '@blackboard/renderer';

describe('perceptual difference mask metric', () => {
  it('returns zero for unchanged pixels', () => {
    expect(calculatePerceptualDifference([0.42, 0.2, 0.73, 1], [0.42, 0.2, 0.73, 1])).toBe(0);
  });

  it('suppresses small opposing channel noise', () => {
    expect(calculatePerceptualDifference([0.5, 0.5, 0.5, 1], [0.51, 0.49, 0.5, 1])).toBeLessThan(
      0.01,
    );
  });

  it('detects a hue change even when perceptual lightness is nearly unchanged', () => {
    const red = [0.8, 0.1, 0.1] as const;
    const green = [0.1, 0.5234, 0.1] as const;
    const redLab = srgbToOklab(red);
    const greenLab = srgbToOklab(green);

    expect(Math.abs(redLab[0] - greenLab[0])).toBeLessThan(0.02);
    expect(calculatePerceptualDifference([...red, 1], [...green, 1])).toBeGreaterThan(0.25);
  });

  it('responds monotonically to brightness changes', () => {
    const subtleChange = calculatePerceptualDifference([0.5, 0.5, 0.5, 1], [0.53, 0.53, 0.53, 1]);
    const strongChange = calculatePerceptualDifference([0.5, 0.5, 0.5, 1], [0.75, 0.75, 0.75, 1]);

    expect(subtleChange).toBeGreaterThan(0);
    expect(strongChange).toBeGreaterThan(subtleChange);
  });

  it('detects alpha-only changes', () => {
    expect(calculatePerceptualDifference([0.2, 0.4, 0.6, 1], [0.2, 0.4, 0.6, 0])).toBe(0.5);
  });
});

describe('difference mask morphology', () => {
  it('builds opening, closing, and edge passes in shape-safe order', () => {
    expect(
      getDifferenceMaskMorphologyPasses({
        removeSpecks: 3,
        fillHoles: 5,
        edgeAdjustment: -2,
        morphologyShape: 'square',
      }),
    ).toEqual([
      { operation: 'erode', axis: 'horizontal', radius: 3 },
      { operation: 'erode', axis: 'vertical', radius: 3 },
      { operation: 'dilate', axis: 'horizontal', radius: 3 },
      { operation: 'dilate', axis: 'vertical', radius: 3 },
      { operation: 'dilate', axis: 'horizontal', radius: 5 },
      { operation: 'dilate', axis: 'vertical', radius: 5 },
      { operation: 'erode', axis: 'horizontal', radius: 5 },
      { operation: 'erode', axis: 'vertical', radius: 5 },
      { operation: 'erode', axis: 'horizontal', radius: 2 },
      { operation: 'erode', axis: 'vertical', radius: 2 },
    ]);
  });

  it('omits disabled cleanup and clamps excessive radii', () => {
    expect(
      getDifferenceMaskMorphologyPasses({
        removeSpecks: 0,
        fillHoles: 0,
        edgeAdjustment: 0,
        morphologyShape: 'square',
      }),
    ).toEqual([]);
    expect(
      getDifferenceMaskMorphologyPasses({
        removeSpecks: 80,
        fillHoles: 0,
        edgeAdjustment: 0,
        morphologyShape: 'square',
      })[0]?.radius,
    ).toBe(32);
  });

  it('approximates a round kernel with four radius-preserving directions', () => {
    const passes = getDifferenceMaskMorphologyPasses({
      removeSpecks: 0,
      fillHoles: 0,
      edgeAdjustment: 32,
      morphologyShape: 'round',
    });

    expect(passes.map((pass) => pass.axis)).toEqual([
      'horizontal',
      'vertical',
      'diagonal-down',
      'diagonal-up',
    ]);
    passes.forEach((pass) => {
      expect(pass.operation).toBe('dilate');
      expect(pass.radius).toBeCloseTo(32 / (1 + Math.SQRT2));
    });
  });
});
