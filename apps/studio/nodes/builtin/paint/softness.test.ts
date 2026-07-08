import { describe, expect, it } from 'vitest';
import { DEFAULT_PAINT_SOFTNESS, mergePaintBrushSettings, resolvePaintSoftness } from './softness';

describe('paint softness helpers', () => {
  it('returns explicit softness values unchanged', () => {
    expect(resolvePaintSoftness({ softness: 42 })).toBe(42);
  });

  it('falls back to the default softness when nothing is set', () => {
    expect(resolvePaintSoftness({})).toBe(DEFAULT_PAINT_SOFTNESS);
  });

  it('merges brush updates and clamps softness and spacing', () => {
    expect(
      mergePaintBrushSettings(
        {
          size: 24,
          spacing: 20,
          softness: 120,
          opacity: 100,
          color: [1, 1, 1],
          alpha: 1,
          channels: 'rgb',
        },
        { size: 48, spacing: 500 },
      ),
    ).toEqual({
      size: 48,
      spacing: 200,
      softness: 100,
      opacity: 100,
      color: [1, 1, 1],
      alpha: 1,
      channels: 'rgb',
    });
  });
});
