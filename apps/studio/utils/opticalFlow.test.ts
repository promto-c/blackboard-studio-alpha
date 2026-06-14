import { describe, expect, it } from 'vitest';
import {
  buildOpticalFlowPyramid,
  calculateHybridOpticalFlowFromPyramids,
} from '@/utils/opticalFlow';

const createFrameWithPatch = (
  width: number,
  height: number,
  center: { x: number; y: number },
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const px = center.x + x;
      const py = center.y + y;
      const offset = (py * width + px) * 4;
      const value = (x * 31 + y * 17 + x * y * 9 + 255) % 255;
      pixels[offset] = value;
      pixels[offset + 1] = 255 - value;
      pixels[offset + 2] = (value * 3) % 255;
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
};

describe('opticalFlow hybrid tracking', () => {
  it('uses template matching to recover a small textured patch displacement', () => {
    const width = 64;
    const height = 64;
    const source = { x: 18, y: 22 };
    const target = { x: 31, y: 18 };
    const previous = buildOpticalFlowPyramid(
      createFrameWithPatch(width, height, source),
      width,
      height,
    );
    const current = buildOpticalFlowPyramid(
      createFrameWithPatch(width, height, target),
      width,
      height,
    );

    const [tracked] = calculateHybridOpticalFlowFromPyramids(previous, current, [source], {
      maxError: 0.000001,
      searchRadius: 18,
      patchRadius: 4,
      minimumNccScore: 0.5,
      coherentFallback: false,
    });

    expect(tracked.x).toBeCloseTo(target.x, 0);
    expect(tracked.y).toBeCloseTo(target.y, 0);
    expect(tracked.error).toBeLessThan(5);
  });
});
