import { describe, expect, it } from 'vitest';
import { getHueRangeAroundColor, hexToRgb, rgbToHex, rgbToHue } from './keyerModel';

describe('keyer model', () => {
  it('maps primary screen colors to normalized hue positions', () => {
    expect(rgbToHue([1, 0, 0])).toBeCloseTo(0);
    expect(rgbToHue([0, 1, 0])).toBeCloseTo(1 / 3);
    expect(rgbToHue([0, 0, 1])).toBeCloseTo(2 / 3);
  });

  it('builds a bounded qualifier range around a sample', () => {
    expect(getHueRangeAroundColor([0, 1, 0], 0.1)).toEqual([
      expect.closeTo(1 / 3 - 0.1),
      expect.closeTo(1 / 3 + 0.1),
    ]);
    expect(getHueRangeAroundColor([1, 0, 0], 0.1)).toEqual([0, 0.1]);
  });

  it('round-trips UI color values through hex', () => {
    expect(hexToRgb(rgbToHex([0.04, 0.78, 0.12]))).toEqual([
      expect.closeTo(10 / 255),
      expect.closeTo(199 / 255),
      expect.closeTo(31 / 255),
    ]);
  });
});
