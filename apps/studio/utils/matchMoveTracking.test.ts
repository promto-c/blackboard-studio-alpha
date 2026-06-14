import { describe, expect, it } from 'vitest';
import { createMatchMoveSolveFrame, detectMatchMoveFeatures } from './matchMoveTracking';

const createCornerFrame = () => {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 12; y < 36; y += 1) {
    for (let x = 12; x < 36; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }

  return { data, width, height };
};

describe('matchMoveTracking', () => {
  it('detects high contrast corner features', () => {
    const features = detectMatchMoveFeatures(createCornerFrame(), {
      maxFeatures: 12,
      minFeatureDistance: 6,
      featureQuality: 0.02,
      patchSize: 7,
    });

    expect(features.length).toBeGreaterThan(0);
    expect(features.length).toBeLessThanOrEqual(12);
  });

  it('solves a translation model from tracked points', () => {
    const solve = createMatchMoveSolveFrame(
      8,
      'translation',
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 0, y: 40 },
        { x: 40, y: 40 },
      ],
      [
        { x: 7, y: -4 },
        { x: 47, y: -4 },
        { x: 7, y: 36 },
        { x: 47, y: 36 },
      ],
      1,
    );

    expect(solve.translate.x).toBeCloseTo(7, 5);
    expect(solve.translate.y).toBeCloseTo(-4, 5);
    expect(solve.residual).toBeCloseTo(0, 5);
    expect(solve.tracked).toBe(4);
  });
});
