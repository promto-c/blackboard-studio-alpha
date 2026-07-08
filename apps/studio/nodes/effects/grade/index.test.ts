import { describe, expect, it } from 'vitest';
import { getValueAtFrame } from '@blackboard/renderer';
import { GRADE_SHADER } from './gradeShader';
import { createDefaultGrade, getGradeRgbAtFrame } from './gradeModel';

describe('grade effect', () => {
  it('defines the complete scene-linear and log grading shader contract', () => {
    [
      'u_exposure',
      'u_contrast',
      'u_contrastPivot',
      'u_saturation',
      'u_lift',
      'u_gamma',
      'u_gain',
      'u_cdlSlope',
      'u_cdlOffset',
      'u_cdlPower',
      'u_cdlSaturation',
      'u_outOfGamutMode',
    ].forEach((uniform) => expect(GRADE_SHADER).toContain(uniform));

    expect(GRADE_SHADER).toContain('acescg_luminance');
    expect(GRADE_SHADER).toContain('signed_power');
    expect(GRADE_SHADER).toContain('exp2(u_exposure)');
    expect(GRADE_SHADER).not.toContain('vec3(0.2126, 0.7152, 0.0722)');
    expect(GRADE_SHADER).not.toContain('clamp(');
  });

  it('creates independent canonical defaults', () => {
    const first = createDefaultGrade();
    const second = createDefaultGrade();

    expect(first).toMatchObject({
      processingDomain: 'scene_linear',
      outOfGamut: 'preserve',
      exposure: 0,
      contrast: 1,
      contrastPivot: 0.18,
      saturation: 1,
      lift: { r: 0, g: 0, b: 0 },
      gamma: { r: 1, g: 1, b: 1 },
      gain: { r: 1, g: 1, b: 1 },
      cdl: {
        slope: { r: 1, g: 1, b: 1 },
        offset: { r: 0, g: 0, b: 0 },
        power: { r: 1, g: 1, b: 1 },
        saturation: 1,
      },
    });
    expect(first.lift).not.toBe(second.lift);
    expect(first.cdl.slope).not.toBe(second.cdl.slope);
  });

  it('resolves scalar and RGB animation values at the render frame', () => {
    const grade = createDefaultGrade();
    grade.exposure = [
      { frame: 0, value: 0 },
      { frame: 10, value: 2 },
    ];
    grade.gain.r = 1.25;
    grade.gain.g = 0.9;
    grade.gain.b = 1.1;

    expect(getValueAtFrame(grade.exposure, 10)).toBe(2);
    expect(getGradeRgbAtFrame(grade.gain, 10)).toEqual([1.25, 0.9, 1.1]);
  });
});
