import type { DifferenceMaskMorphologyShape } from '@blackboard/types';

export type DifferenceMaskRgba = readonly [number, number, number, number?];

export type DifferenceMaskMorphologyOperation = 'erode' | 'dilate';
export type DifferenceMaskMorphologyAxis =
  | 'horizontal'
  | 'vertical'
  | 'diagonal-down'
  | 'diagonal-up';

export interface DifferenceMaskMorphologyPass {
  operation: DifferenceMaskMorphologyOperation;
  axis: DifferenceMaskMorphologyAxis;
  radius: number;
}

export interface DifferenceMaskCleanupSettings {
  removeSpecks: number;
  fillHoles: number;
  edgeAdjustment: number;
  morphologyShape: DifferenceMaskMorphologyShape;
}

export const MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS = 32;

const normalizeMorphologyRadius = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS, Math.max(0, Math.round(Math.abs(value))))
    : 0;

const appendSeparableMorphology = (
  passes: DifferenceMaskMorphologyPass[],
  operation: DifferenceMaskMorphologyOperation,
  radius: number,
  shape: DifferenceMaskMorphologyShape,
): void => {
  if (radius <= 0) return;
  if (shape === 'square') {
    passes.push({ operation, axis: 'horizontal', radius }, { operation, axis: 'vertical', radius });
    return;
  }

  // Four line segments form a regular octagonal structuring element. Scaling
  // each segment by 1 / (1 + sqrt(2)) keeps the requested radius at both the
  // cardinal and diagonal extrema instead of expanding the mask beyond it.
  const lineRadius = radius / (1 + Math.SQRT2);
  passes.push(
    { operation, axis: 'horizontal', radius: lineRadius },
    { operation, axis: 'vertical', radius: lineRadius },
    { operation, axis: 'diagonal-down', radius: lineRadius },
    { operation, axis: 'diagonal-up', radius: lineRadius },
  );
};

/**
 * Builds a real grayscale-morphology cleanup sequence.
 *
 * Opening (erode then dilate) removes small foreground regions; closing
 * (dilate then erode) fills small holes and gaps. Edge adjustment is applied
 * last so it cannot reintroduce regions removed by cleanup.
 */
export const getDifferenceMaskMorphologyPasses = ({
  removeSpecks,
  fillHoles,
  edgeAdjustment,
  morphologyShape,
}: DifferenceMaskCleanupSettings): DifferenceMaskMorphologyPass[] => {
  const passes: DifferenceMaskMorphologyPass[] = [];
  const openingRadius = normalizeMorphologyRadius(removeSpecks);
  const closingRadius = normalizeMorphologyRadius(fillHoles);
  const edgeRadius = normalizeMorphologyRadius(edgeAdjustment);

  appendSeparableMorphology(passes, 'erode', openingRadius, morphologyShape);
  appendSeparableMorphology(passes, 'dilate', openingRadius, morphologyShape);
  appendSeparableMorphology(passes, 'dilate', closingRadius, morphologyShape);
  appendSeparableMorphology(passes, 'erode', closingRadius, morphologyShape);
  appendSeparableMorphology(
    passes,
    edgeAdjustment >= 0 ? 'dilate' : 'erode',
    edgeRadius,
    morphologyShape,
  );
  return passes;
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const srgbChannelToLinear = (value: number): number => {
  const channel = clampUnit(value);
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
};

export const srgbToOklab = (
  rgb: readonly [number, number, number],
): readonly [number, number, number] => {
  const red = srgbChannelToLinear(rgb[0]);
  const green = srgbChannelToLinear(rgb[1]);
  const blue = srgbChannelToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/**
 * Perceptual difference score for ordinary sRGB image pixels.
 *
 * Lightness and opponent-color distance are measured as Euclidean OKLab
 * distance. Alpha is included separately so transparency-only edits remain
 * detectable without exposing hidden RGB in fully transparent pixels.
 */
export const calculatePerceptualDifference = (
  left: DifferenceMaskRgba,
  right: DifferenceMaskRgba,
): number => {
  const leftLab = srgbToOklab([left[0], left[1], left[2]]);
  const rightLab = srgbToOklab([right[0], right[1], right[2]]);
  const colorDifference = Math.hypot(
    leftLab[0] - rightLab[0],
    leftLab[1] - rightLab[1],
    leftLab[2] - rightLab[2],
  );
  const leftAlpha = clampUnit(left[3] ?? 1);
  const rightAlpha = clampUnit(right[3] ?? 1);
  const visibleColorDifference = colorDifference * Math.max(leftAlpha, rightAlpha);
  const alphaDifference = Math.abs(leftAlpha - rightAlpha) * 0.5;
  return Math.hypot(visibleColorDifference, alphaDifference);
};

/** GLSL counterpart of `calculatePerceptualDifference`. Keep coefficients in sync. */
export const PERCEPTUAL_DIFFERENCE_GLSL = `
vec3 differenceSrgbToLinear(vec3 encoded) {
  vec3 value = clamp(encoded, 0.0, 1.0);
  vec3 lower = value / 12.92;
  vec3 upper = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(lower, upper, step(vec3(0.04045), value));
}

vec3 differenceLinearSrgbToOklab(vec3 linear_rgb) {
  float l = pow(max(dot(linear_rgb, vec3(0.4122214708, 0.5363325363, 0.0514459929)), 0.0), 1.0 / 3.0);
  float m = pow(max(dot(linear_rgb, vec3(0.2119034982, 0.6806995451, 0.1073969566)), 0.0), 1.0 / 3.0);
  float s = pow(max(dot(linear_rgb, vec3(0.0883024619, 0.2817188376, 0.6299787005)), 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}

float perceptualImageDifference(vec4 left_color, vec4 right_color) {
  vec3 left_lab = differenceLinearSrgbToOklab(differenceSrgbToLinear(left_color.rgb));
  vec3 right_lab = differenceLinearSrgbToOklab(differenceSrgbToLinear(right_color.rgb));
  float visible_color_difference = length(left_lab - right_lab)
    * max(left_color.a, right_color.a);
  float alpha_difference = abs(left_color.a - right_color.a) * 0.5;
  return length(vec2(visible_color_difference, alpha_difference));
}
`;
