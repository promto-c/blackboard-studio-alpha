import { describe, expect, it } from 'vitest';
import {
  buildOpticalFlowPyramid,
  calculateHybridOpticalFlowFromPyramids,
  invertAxisAlignedTransformAroundCenter,
} from '@/utils/opticalFlow';

describe('invertAxisAlignedTransformAroundCenter', () => {
  it('inverts independent scale and translation around the image center', () => {
    const inverse = invertAxisAlignedTransformAroundCenter(
      { scaleX: 1.1, scaleY: 0.9, offsetX: 8, offsetY: -6 },
      { width: 200, height: 100 },
    );

    expect(inverse).not.toBeNull();
    const center = { x: (200 - 1) / 2, y: (100 - 1) / 2 };
    const source = { x: 35, y: -12 };
    const output = {
      x: 1.1 * (source.x + center.x) + 8 - center.x,
      y: 0.9 * (source.y + center.y) - 6 - center.y,
    };
    expect(output.x * inverse!.scaleX + inverse!.offsetX).toBeCloseTo(source.x);
    expect(output.y * inverse!.scaleY + inverse!.offsetY).toBeCloseTo(source.y);
  });

  it('rejects degenerate tracked scale', () => {
    expect(
      invertAxisAlignedTransformAroundCenter(
        { scaleX: 0, scaleY: 1, offsetX: 0, offsetY: 0 },
        { width: 200, height: 100 },
      ),
    ).toBeNull();
  });
});

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

  it('uses an artist target hint to refine a distant current-frame pose', () => {
    const width = 80;
    const height = 64;
    const source = { x: 16, y: 22 };
    const target = { x: 55, y: 30 };
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

    const [tracked] = calculateHybridOpticalFlowFromPyramids(
      previous,
      current,
      [source],
      {
        searchRadius: 3,
        patchRadius: 4,
        minimumNccScore: 0.5,
        coherentFallback: false,
      },
      [{ x: 53, y: 29 }],
    );

    expect(tracked.x).toBeCloseTo(target.x, 0);
    expect(tracked.y).toBeCloseTo(target.y, 0);
    expect(tracked.error).toBeLessThan(5);
  });
});
