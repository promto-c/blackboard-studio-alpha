import { describe, expect, it } from 'vitest';
import { UniformUIType } from '@blackboard/types';
import { parseInputPortsFromGLSL, parseUniformsFromGLSL } from './glsl';

describe('parseUniformsFromGLSL', () => {
  it('parses toggle and segmented custom shader uniforms', () => {
    const uniforms = parseUniformsFromGLSL(`
precision highp float;
uniform bool u_enabled; // {"label": "Enabled", "value": true}
uniform int u_mode; // {"label": "Mode", "type": "segment", "value": 1, "options": ["Soft", "Hard"]}
uniform float u_mix; // {"label": "Mix", "type": "segment", "value": 0.5, "options": [{"label": "Low", "value": 0.25}, {"label": "High", "value": 0.75}]}
uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -2}
`);

    expect(uniforms.u_enabled).toEqual({
      label: 'Enabled',
      ui: UniformUIType.TOGGLE,
      value: true,
    });
    expect(uniforms.u_mode).toEqual({
      label: 'Mode',
      ui: UniformUIType.SEGMENTED,
      value: 1,
      options: [
        { label: 'Soft', value: 0 },
        { label: 'Hard', value: 1 },
      ],
    });
    expect(uniforms.u_mix).toEqual({
      label: 'Mix',
      ui: UniformUIType.SEGMENTED,
      value: 0.5,
      options: [
        { label: 'Low', value: 0.25 },
        { label: 'High', value: 0.75 },
      ],
    });
    expect(uniforms.u_relativeFrame).toEqual({
      label: 'Relative Frame',
      ui: UniformUIType.NUMBER,
      value: -2,
      step: 1,
    });
  });

  it('excludes built-in temporal uniforms from generated controls', () => {
    const uniforms = parseUniformsFromGLSL(`
precision highp float;
uniform float u_frame;
uniform float u_time;
uniform float u_fps;
uniform float u_mix; // {"label": "Mix", "min": 0.0, "max": 1.0, "step": 0.01, "value": 0.5}
`);

    expect(Object.keys(uniforms)).toEqual(['u_mix']);
  });

  it('parses temporal sampler input ports from shader metadata', () => {
    const ports = parseInputPortsFromGLSL(`
precision highp float;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tPreviousFrame;
uniform sampler2D u_tFrameMinus2; // {"label": "Frame -2", "type": "temporal", "mode": "relative", "frame": -2}
uniform sampler2D u_tFrame100; // {"label": "Frame 100", "type": "temporal", "mode": "absolute", "frame": 100}
uniform sampler2D u_tRelativeFrame; // {"label": "Relative Frame", "type": "temporal", "mode": "relative", "frameUniform": "u_relativeFrame"}
`);

    expect(ports).toEqual([
      expect.objectContaining({
        name: 'u_tPreviousFrame',
        uniformName: 'u_tPreviousFrame',
        frameOffset: -1,
      }),
      expect.objectContaining({
        name: 'u_tFrameMinus2',
        uniformName: 'u_tFrameMinus2',
        label: 'Frame -2',
        frameOffset: -2,
      }),
      expect.objectContaining({
        name: 'u_tFrame100',
        uniformName: 'u_tFrame100',
        label: 'Frame 100',
        absoluteFrame: 100,
      }),
      expect.objectContaining({
        name: 'u_tRelativeFrame',
        uniformName: 'u_tRelativeFrame',
        label: 'Relative Frame',
        frameOffsetUniform: 'u_relativeFrame',
      }),
    ]);
  });
});
