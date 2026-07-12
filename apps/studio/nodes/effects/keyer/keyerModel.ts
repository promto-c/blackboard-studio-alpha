import type { AnyUniform } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';

export const KEYER_SAMPLE_TOOL_ID = 'keyer_sample';

export const KEYER_DEFAULTS = {
  keyColor: [0.04, 0.78, 0.12] as [number, number, number],
  hueRange: [0.22, 0.45] as [number, number],
  saturationRange: [0.15, 1] as [number, number],
  luminanceRange: [0, 1] as [number, number],
  qualifierSoftness: 0.035,
  keyDensity: 1,
  clipBlack: 0.04,
  clipWhite: 0.96,
  matteDenoise: 0.15,
  matteGrow: 0,
  despillAmount: 0.65,
  despillBias: 0,
} as const;

export const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

export const rgbToHue = (color: readonly [number, number, number]): number => {
  const [red, green, blue] = color;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta <= Number.EPSILON) return 0;

  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return (((sector / 6) % 1) + 1) % 1;
};

export const getHueRangeAroundColor = (
  color: readonly [number, number, number],
  halfWidth = 0.09,
): [number, number] => {
  const hue = rgbToHue(color);
  return [clampUnit(hue - halfWidth), clampUnit(hue + halfWidth)];
};

export const rgbToHex = (color: readonly [number, number, number]): string =>
  `#${color
    .map((channel) =>
      Math.round(clampUnit(channel) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();

export const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export const getKeyerNumber = (
  uniforms: Record<string, AnyUniform>,
  name: string,
  frame: number,
  fallback: number,
): number => {
  const uniform = uniforms[name];
  if (!uniform || typeof uniform.value === 'boolean' || Array.isArray(uniform.value))
    return fallback;
  const value = getValueAtFrame(uniform.value, frame);
  return Number.isFinite(value) ? value : fallback;
};

export const getKeyerColor = (uniforms: Record<string, AnyUniform>): [number, number, number] => {
  const value = uniforms.u_keyColor?.value;
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)
    ? [clampUnit(Number(value[0])), clampUnit(Number(value[1])), clampUnit(Number(value[2]))]
    : KEYER_DEFAULTS.keyColor;
};
