import { describe, expect, it } from 'vitest';
import type { RotoMaskPart, RotoPartSeparationResult } from './rotoPartSeparation';
import { measureRotoPartVectorFit } from './rotoPartVectorFit';

const createResult = (): RotoPartSeparationResult => {
  const width = 12;
  const height = 12;
  const mask = new Uint8Array(width * height);
  for (let y = 2; y < 10; y += 1) {
    for (let x = 2; x < 10; x += 1) mask[y * width + x] = 255;
  }
  const part = { index: 0, mask } as RotoMaskPart;
  return { width, height, sourceMask: mask, parts: [part] };
};

describe('measureRotoPartVectorFit', () => {
  it('reports coverage and spill against the source silhouette', () => {
    const result = createResult();
    const exact = measureRotoPartVectorFit(result, [
      {
        index: 0,
        points: [
          { x: 2, y: 2 },
          { x: 10, y: 2 },
          { x: 10, y: 10 },
          { x: 2, y: 10 },
        ],
        pointTypes: ['corner', 'corner', 'corner', 'corner'],
      },
    ]);
    const oversized = measureRotoPartVectorFit(result, [
      {
        index: 0,
        points: [
          { x: 1, y: 1 },
          { x: 11, y: 1 },
          { x: 11, y: 11 },
          { x: 1, y: 11 },
        ],
        pointTypes: ['corner', 'corner', 'corner', 'corner'],
      },
    ]);

    expect(exact.sourceCoveragePercent).toBeGreaterThan(99);
    expect(exact.outsideSourcePercent).toBeLessThan(1);
    expect(oversized.sourceCoveragePercent).toBeGreaterThan(99);
    expect(oversized.outsideSourcePercent).toBeGreaterThan(20);
  });

  it('does not penalize editable vectors for crossing temporary part guides', () => {
    const result = createResult();
    const leftGuide = new Uint8Array(result.width * result.height);
    const rightGuide = new Uint8Array(result.width * result.height);
    for (let y = 2; y < 10; y += 1) {
      for (let x = 2; x < 10; x += 1) {
        (x < 6 ? leftGuide : rightGuide)[y * result.width + x] = 255;
      }
    }
    result.parts = [
      { index: 0, mask: leftGuide } as RotoMaskPart,
      { index: 1, mask: rightGuide } as RotoMaskPart,
    ];

    const metrics = measureRotoPartVectorFit(result, [
      {
        index: 0,
        points: [
          { x: 2, y: 2 },
          { x: 7, y: 2 },
          { x: 7, y: 10 },
          { x: 2, y: 10 },
        ],
        pointTypes: ['corner', 'corner', 'corner', 'corner'],
      },
      {
        index: 1,
        points: [
          { x: 5, y: 2 },
          { x: 10, y: 2 },
          { x: 10, y: 10 },
          { x: 5, y: 10 },
        ],
        pointTypes: ['corner', 'corner', 'corner', 'corner'],
      },
    ]);

    expect(metrics.sourceCoveragePercent).toBeGreaterThan(99);
    expect(metrics.outsideSourcePercent).toBeLessThan(1);
    expect(metrics.sourcePixelCount).toBe(64);
  });
});
