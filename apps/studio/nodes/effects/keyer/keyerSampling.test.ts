import { describe, expect, it } from 'vitest';
import { collectKeyerAreaColors, createKeyerSampleResult } from './keyerSampling';

describe('keyer area sampling', () => {
  it('creates useful HSL tolerance around a single click sample', () => {
    const result = createKeyerSampleResult([[0.05, 0.8, 0.1]])!;
    expect(result.sampleCount).toBe(1);
    expect(result.hueRange[0]).toBeLessThan(result.hueRange[1]);
    expect(result.saturationRange[0]).toBeLessThan(result.saturationRange[1]);
    expect(result.luminanceRange[0]).toBeLessThan(result.luminanceRange[1]);
  });

  it('uses trimmed ranges so isolated off-screen colors do not dominate a drag sample', () => {
    const screenColors = Array.from(
      { length: 100 },
      (_, index) => [0.04, 0.65 + (index % 10) * 0.01, 0.08] as [number, number, number],
    );
    const result = createKeyerSampleResult([...screenColors, [0.9, 0.05, 0.04]])!;
    expect(result.hueRange[0]).toBeGreaterThan(0.2);
    expect(result.hueRange[1]).toBeLessThan(0.5);
  });

  it('maps a centered scene rectangle to pixels and ignores transparent samples', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let pixel = 0; pixel < 16; pixel += 1) {
      const offset = pixel * 4;
      data.set([10, 200, 30, 255], offset);
    }
    data[3] = 0;

    const colors = collectKeyerAreaColors({
      data,
      width: 4,
      height: 4,
      sceneWidth: 4,
      sceneHeight: 4,
      start: { x: -2, y: 2 },
      end: { x: 2, y: -2 },
    });
    expect(colors).toHaveLength(15);
    expect(colors[0]).toEqual([10 / 255, 200 / 255, 30 / 255]);
  });

  it('maps negative scene Y to the top of the top-down pixel buffer', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        data.set(y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4);
      }
    }

    const colors = collectKeyerAreaColors({
      data,
      width: 4,
      height: 4,
      sceneWidth: 4,
      sceneHeight: 4,
      start: { x: -2, y: -2 },
      end: { x: 2, y: -1.1 },
    });
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((color) => color[0] === 1 && color[2] === 0)).toBe(true);
  });
});
