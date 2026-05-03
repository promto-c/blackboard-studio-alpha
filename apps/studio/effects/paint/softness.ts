import type { PaintBrushSettings } from '@blackboard/types';

export const DEFAULT_PAINT_SOFTNESS = 30;

interface PaintSoftnessLike {
  softness?: number | null;
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

export const resolvePaintSoftness = (
  value: PaintSoftnessLike,
  fallback = DEFAULT_PAINT_SOFTNESS,
): number => {
  if (typeof value.softness === 'number') {
    return clampPercent(value.softness);
  }

  return clampPercent(fallback);
};

export const mergePaintBrushSettings = (
  current: PaintBrushSettings,
  updates: Partial<PaintBrushSettings>,
): PaintBrushSettings => {
  const merged = { ...current, ...updates };

  return {
    ...merged,
    softness: resolvePaintSoftness(merged),
  };
};
