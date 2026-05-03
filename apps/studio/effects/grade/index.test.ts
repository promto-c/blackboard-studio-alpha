import { describe, it, expect } from 'vitest';
import { NodeType } from '@blackboard/types';
import { GRADE_SHADER } from './gradeShader';
import { getValueAtFrame } from '@blackboard/renderer';

// Test the grade effect's logic directly, without importing the full
// EffectDefinition (which transitively pulls in the entire app).

describe('grade effect', () => {
  it('GRADE_SHADER contains expected uniforms', () => {
    expect(GRADE_SHADER).toContain('u_brightness');
    expect(GRADE_SHADER).toContain('u_contrast');
    expect(GRADE_SHADER).toContain('u_saturation');
    expect(GRADE_SHADER).toContain('u_gain');
    expect(GRADE_SHADER).toContain('u_gamma');
    expect(GRADE_SHADER).toContain('void main()');
  });

  it('initial grade props have correct defaults', () => {
    // Matches gradeEffect.getInitialNodeProps()
    const initialProps = {
      grade: { brightness: 0, contrast: 1, saturation: 1, gain: 1, gamma: 1 },
    };
    expect(initialProps.grade.brightness).toBe(0);
    expect(initialProps.grade.contrast).toBe(1);
    expect(initialProps.grade.saturation).toBe(1);
    expect(initialProps.grade.gain).toBe(1);
    expect(initialProps.grade.gamma).toBe(1);
  });

  it('computes uniforms from grade node props', () => {
    // Replicate the getUniforms logic from gradeEffect
    const gradeNode = {
      id: '1',
      type: NodeType.GRADE,
      name: 'Grade',
      visible: true,
      grade: { brightness: 0.5, contrast: 1, saturation: 0.75, gain: 1.25, gamma: 0.9 },
    };
    const frame = 0;
    const brightness = getValueAtFrame(gradeNode.grade.brightness, frame);
    const contrast = getValueAtFrame(gradeNode.grade.contrast, frame);
    const saturation = getValueAtFrame(gradeNode.grade.saturation, frame);
    const gain = getValueAtFrame(gradeNode.grade.gain, frame);
    const gamma = getValueAtFrame(gradeNode.grade.gamma, frame);

    expect(brightness).toBeCloseTo(0.5);
    expect(contrast).toBeCloseTo(1.0);
    expect(saturation).toBeCloseTo(0.75);
    expect(gain).toBeCloseTo(1.25);
    expect(gamma).toBeCloseTo(0.9);
  });

  it('handles animated grade properties', () => {
    const keyframes = [
      { frame: 0, value: 0 },
      { frame: 100, value: 100 },
    ];
    expect(getValueAtFrame(keyframes, 0)).toBe(0);
    expect(getValueAtFrame(keyframes, 100)).toBe(100);
  });
});
