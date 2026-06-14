import { describe, expect, it } from 'vitest';
import { SpatialShader } from './spatialShaders';

describe('spatial shaders', () => {
  it('exposes resampling filter uniforms for resize-capable spatial nodes', () => {
    expect(SpatialShader.TRANSFORM).toContain('uniform int u_filter');
    expect(SpatialShader.REFORMAT).toContain('uniform int u_filter');
  });

  it('includes higher-quality spatial samplers', () => {
    expect(SpatialShader.REFORMAT).toContain('sample_nearest');
    expect(SpatialShader.REFORMAT).toContain('sample_cubic');
    expect(SpatialShader.REFORMAT).toContain('sample_lanczos');
  });

  it('does not use reserved GLSL words for helper parameters', () => {
    expect(SpatialShader.REFORMAT).not.toContain('int filter)');
    expect(SpatialShader.TRANSFORM).not.toContain('int filter)');
  });
});
