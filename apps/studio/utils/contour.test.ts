import { describe, expect, it } from 'vitest';
import { findContours, findMaskContours, getContourArea, getLargestContour } from './contour';

describe('contour extraction', () => {
  it('extracts a closed contour from a binary mask', () => {
    const mask = Uint8Array.from([
      0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0,
    ]);

    const contour = getLargestContour(findMaskContours(mask, 5, 5));
    expect(contour).not.toBeNull();
    expect(getContourArea(contour ?? [])).toBeGreaterThan(7);
    expect(contour?.[0]).toEqual(contour?.[contour.length - 1]);
  });

  it('selects the contour with the largest enclosed area', () => {
    const small = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const large = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(getLargestContour([small, large])).toBe(large);
  });

  it('closes masks that touch an image boundary', () => {
    const mask = Uint8Array.from([255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const contour = getLargestContour(findMaskContours(mask, 4, 4));
    expect(contour).not.toBeNull();
    expect(contour?.[0]).toEqual(contour?.[contour.length - 1]);
    expect(contour?.some((point) => point.x === 0 || point.y === 0)).toBe(true);
  });

  it('keeps the RGBA channel API used by Auto-Trace', () => {
    const rgba = new Uint8Array(5 * 5 * 4);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) rgba[(y * 5 + x) * 4 + 3] = 255;
    }
    expect(findContours(rgba, 5, 5, 0.5, 3)).toHaveLength(1);
  });
});
