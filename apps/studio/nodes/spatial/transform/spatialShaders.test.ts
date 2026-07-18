import { describe, expect, it } from 'vitest';
import { NodeType, type ReformatNode } from '@blackboard/types';
import type { RenderContext } from '@blackboard/renderer';
import { getReformatRenderWindowUniforms } from './spatialRenderWindows';
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

  it('samples Reformat inputs from the preserved upstream backing window', () => {
    expect(SpatialShader.REFORMAT).toContain('uniform vec2 u_source_storage_res');
    expect(SpatialShader.REFORMAT).toContain('uniform vec2 u_target_storage_res');
    expect(SpatialShader.REFORMAT).toContain('source_uv = source_px / source_storage_res + 0.5');
    expect(SpatialShader.REFORMAT).not.toContain('inside_target');
  });

  it('provides Reformat with separate display and backing-store sizes', () => {
    const node = {
      id: 'reformat',
      type: NodeType.REFORMAT,
      name: 'Reformat',
      enabled: true,
      sourceWidth: 100,
      sourceHeight: 100,
      width: 200,
      height: 200,
      resizeMode: 'none',
      resampling: 'linear',
    } as ReformatNode;
    const context: RenderContext = {
      frame: 0,
      fps: 24,
      scene: { width: 100, height: 100 },
      storageWindow: { x: -50, y: -50, width: 200, height: 200 },
      outputStorageWindow: { x: 0, y: 0, width: 200, height: 200 },
      nodes: [node],
      quality: { mode: 'full', resolutionScale: 1, sampleLimit: 128 },
      transformColorPickingToSceneLinear: (color) => [...color],
    };

    expect(getReformatRenderWindowUniforms(node, context)).toEqual({
      sourceSize: [100, 100],
      targetSize: [200, 200],
      sourceStorageSize: [200, 200],
      targetStorageSize: [200, 200],
    });
  });
});
