import { getAcesCgLuminance } from '@/color-management/effectColorMath';
import { clampUnit, rgbToHue } from './keyerModel';

export interface KeyerSampleResult {
  keyColor: [number, number, number];
  hueRange: [number, number];
  saturationRange: [number, number];
  luminanceRange: [number, number];
  sampleCount: number;
}

const quantile = (sortedValues: readonly number[], position: number): number => {
  if (sortedValues.length === 0) return 0;
  const index = clampUnit(position) * (sortedValues.length - 1);
  const lowIndex = Math.floor(index);
  const highIndex = Math.ceil(index);
  const mix = index - lowIndex;
  return (sortedValues[lowIndex] ?? 0) * (1 - mix) + (sortedValues[highIndex] ?? 0) * mix;
};

const saturation = (color: readonly [number, number, number]): number => {
  const max = Math.max(...color);
  const min = Math.min(...color);
  return max <= Number.EPSILON ? 0 : (max - min) / max;
};

export const createKeyerSampleResult = (
  colors: readonly (readonly [number, number, number])[],
): KeyerSampleResult | null => {
  const usableColors = colors.filter((color) => color.every(Number.isFinite));
  if (usableColors.length === 0) return null;

  const hueBins = Array.from({ length: 24 }, () => 0);
  usableColors.forEach((color) => {
    const hue = rgbToHue(color);
    const weight = Math.max(0.05, saturation(color));
    const bin = Math.min(hueBins.length - 1, Math.floor(hue * hueBins.length));
    hueBins[bin] = (hueBins[bin] ?? 0) + weight;
  });
  const dominantBin = hueBins.reduce(
    (best, weight, index) => (weight > (hueBins[best] ?? 0) ? index : best),
    0,
  );
  const dominantHue = (dominantBin + 0.5) / hueBins.length;
  const hueDistance = (hue: number) =>
    Math.min(Math.abs(hue - dominantHue), 1 - Math.abs(hue - dominantHue));
  const dominantColors = usableColors.filter((color) => hueDistance(rgbToHue(color)) <= 0.12);
  const selectedColors =
    dominantColors.length >= Math.max(1, Math.floor(usableColors.length * 0.2))
      ? dominantColors
      : usableColors;

  const hues = selectedColors.map(rgbToHue).sort((a, b) => a - b);
  const saturations = selectedColors.map(saturation).sort((a, b) => a - b);
  const luminances = selectedColors
    .map((color) => clampUnit(getAcesCgLuminance(color)))
    .sort((a, b) => a - b);
  const trimLow = selectedColors.length === 1 ? 0.5 : 0.05;
  const trimHigh = selectedColors.length === 1 ? 0.5 : 0.95;
  const huePadding = selectedColors.length === 1 ? 0.09 : 0.025;
  const saturationPadding = selectedColors.length === 1 ? 0.2 : 0.06;
  const luminancePadding = selectedColors.length === 1 ? 0.25 : 0.08;

  const keyColor = selectedColors
    .reduce<
      [number, number, number]
    >((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
    .map((channel) => channel / selectedColors.length) as [number, number, number];

  return {
    keyColor,
    hueRange: [
      clampUnit(quantile(hues, trimLow) - huePadding),
      clampUnit(quantile(hues, trimHigh) + huePadding),
    ],
    saturationRange: [
      clampUnit(quantile(saturations, trimLow) - saturationPadding),
      clampUnit(quantile(saturations, trimHigh) + saturationPadding),
    ],
    luminanceRange: [
      clampUnit(quantile(luminances, trimLow) - luminancePadding),
      clampUnit(quantile(luminances, trimHigh) + luminancePadding),
    ],
    sampleCount: selectedColors.length,
  };
};

export const collectKeyerAreaColors = ({
  data,
  width,
  height,
  sceneWidth,
  sceneHeight,
  start,
  end,
  maxSamples = 4096,
}: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  sceneWidth: number;
  sceneHeight: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  maxSamples?: number;
}): Array<[number, number, number]> => {
  const toPixelX = (sceneX: number) => ((sceneX + sceneWidth / 2) / sceneWidth) * width;
  const toPixelY = (sceneY: number) => ((sceneY + sceneHeight / 2) / sceneHeight) * height;
  const x0 = Math.max(0, Math.floor(Math.min(toPixelX(start.x), toPixelX(end.x))));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(toPixelX(start.x), toPixelX(end.x))));
  const y0 = Math.max(0, Math.floor(Math.min(toPixelY(start.y), toPixelY(end.y))));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(toPixelY(start.y), toPixelY(end.y))));
  const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
  const stride = Math.max(1, Math.ceil(Math.sqrt(area / maxSamples)));
  const colors: Array<[number, number, number]> = [];

  for (let y = y0; y <= y1; y += stride) {
    for (let x = x0; x <= x1; x += stride) {
      const offset = (y * width + x) * 4;
      if ((data[offset + 3] ?? 0) < 16) continue;
      colors.push([
        (data[offset] ?? 0) / 255,
        (data[offset + 1] ?? 0) / 255,
        (data[offset + 2] ?? 0) / 255,
      ]);
    }
  }
  return colors;
};
