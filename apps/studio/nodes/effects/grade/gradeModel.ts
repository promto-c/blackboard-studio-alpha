import type { AnimatableNumber, Grade, GradeRgbControl } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';

export type GradeRgbPath = 'lift' | 'gamma' | 'gain' | 'cdl.slope' | 'cdl.offset' | 'cdl.power';
export type GradeChannel = keyof GradeRgbControl;

export const GRADE_SCALAR_DEFAULTS = {
  exposure: 0,
  contrast: 1,
  contrastPivot: 0.18,
  saturation: 1,
  'cdl.saturation': 1,
} as const;

export const GRADE_RGB_DEFAULTS: Record<GradeRgbPath, number> = {
  lift: 0,
  gamma: 1,
  gain: 1,
  'cdl.slope': 1,
  'cdl.offset': 0,
  'cdl.power': 1,
};

const createRgb = (value: number): GradeRgbControl => ({ r: value, g: value, b: value });

export const createDefaultGrade = (): Grade => ({
  processingDomain: 'scene_linear',
  outOfGamut: 'preserve',
  exposure: GRADE_SCALAR_DEFAULTS.exposure,
  contrast: GRADE_SCALAR_DEFAULTS.contrast,
  contrastPivot: GRADE_SCALAR_DEFAULTS.contrastPivot,
  saturation: GRADE_SCALAR_DEFAULTS.saturation,
  lift: createRgb(GRADE_RGB_DEFAULTS.lift),
  gamma: createRgb(GRADE_RGB_DEFAULTS.gamma),
  gain: createRgb(GRADE_RGB_DEFAULTS.gain),
  cdl: {
    slope: createRgb(GRADE_RGB_DEFAULTS['cdl.slope']),
    offset: createRgb(GRADE_RGB_DEFAULTS['cdl.offset']),
    power: createRgb(GRADE_RGB_DEFAULTS['cdl.power']),
    saturation: GRADE_SCALAR_DEFAULTS['cdl.saturation'],
  },
});

export const getGradeRgbAtFrame = (
  control: GradeRgbControl,
  frame: number,
): [number, number, number] => [
  getValueAtFrame(control.r, frame),
  getValueAtFrame(control.g, frame),
  getValueAtFrame(control.b, frame),
];

export const getGradeProperty = (grade: Grade, path: string): AnimatableNumber => {
  const value = path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, grade);
  if (typeof value === 'number' || Array.isArray(value)) return value as AnimatableNumber;
  throw new Error(`Unknown Grade property "${path}".`);
};
