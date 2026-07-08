import { describe, expect, it } from 'vitest';
import {
  ACESCG_LUMINANCE_COEFFICIENTS,
  ACESCG_LUMINANCE_GLSL,
  getAcesCgLuminance,
} from './effectColorMath';

describe('ACEScg effect color math', () => {
  it('uses AP1 luminance coefficients normalized to one', () => {
    expect(ACESCG_LUMINANCE_COEFFICIENTS.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(getAcesCgLuminance([1, 0, 0])).toBeCloseTo(0.2722287168);
    expect(getAcesCgLuminance([0, 1, 0])).toBeCloseTo(0.6740817658);
    expect(getAcesCgLuminance([0, 0, 1])).toBeCloseTo(0.0536895174);
  });

  it('preserves negative and HDR values without clamping', () => {
    expect(getAcesCgLuminance([-1, 2, 4])).toBeGreaterThan(1);
  });

  it('keeps the CPU and GLSL coefficient definitions aligned', () => {
    ACESCG_LUMINANCE_COEFFICIENTS.forEach((coefficient) => {
      expect(ACESCG_LUMINANCE_GLSL).toContain(String(coefficient));
    });
  });
});
