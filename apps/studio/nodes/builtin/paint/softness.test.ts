import { describe, expect, it } from 'vitest';
import { DEFAULT_PAINT_SOFTNESS, mergePaintBrushSettings, resolvePaintSoftness } from './softness';

describe('paint softness helpers', () => {
  it('returns explicit softness values unchanged', () => {
    expect(resolvePaintSoftness({ softness: 42 })).toBe(42);
  });

  it('falls back to the default softness when nothing is set', () => {
    expect(resolvePaintSoftness({})).toBe(DEFAULT_PAINT_SOFTNESS);
  });

  it('merges brush updates and keeps softness clamped', () => {
    expect(
      mergePaintBrushSettings(
        {
          size: 24,
          softness: 120,
          opacity: 100,
          color: [1, 1, 1],
          alpha: 1,
          channels: 'rgb',
        },
        { size: 48 },
      ),
    ).toEqual({
      size: 48,
      softness: 100,
      opacity: 100,
      color: [1, 1, 1],
      alpha: 1,
      channels: 'rgb',
    });
  });
});
