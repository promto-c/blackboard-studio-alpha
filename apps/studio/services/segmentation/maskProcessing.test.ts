import { describe, expect, it } from 'vitest';
import { cleanSegmentationMask, thresholdSegmentationLogits } from './maskProcessing';

const logits = (rows: number[][]): Float32Array => Float32Array.from(rows.flat());

describe('segmentation mask processing', () => {
  it('thresholds mask logits without rerunning inference', () => {
    expect(Array.from(thresholdSegmentationLogits(Float32Array.from([-1, 0, 0.2]), 0))).toEqual([
      0, 0, 255,
    ]);
  });

  it('removes small isolated foreground regions', () => {
    const result = cleanSegmentationMask(
      logits([
        [-1, -1, -1, -1, -1],
        [-1, 1, 1, -1, -1],
        [-1, 1, 1, -1, 1],
        [-1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1],
      ]),
      5,
      5,
      { threshold: 0, removeSpecks: 1, fillHoles: 0 },
    );

    expect(result[2 * 5 + 4]).toBe(0);
    expect(result[1 * 5 + 1]).toBe(255);
  });

  it('fills enclosed background holes while preserving edge-connected background', () => {
    const result = cleanSegmentationMask(
      logits([
        [-1, -1, -1, -1, -1],
        [-1, 1, 1, 1, -1],
        [-1, 1, -1, 1, -1],
        [-1, 1, 1, 1, -1],
        [-1, -1, -1, -1, -1],
      ]),
      5,
      5,
      { threshold: 0, removeSpecks: 0, fillHoles: 1 },
    );

    expect(result[2 * 5 + 2]).toBe(255);
    expect(result[0]).toBe(0);
  });
});
