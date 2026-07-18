import { describe, expect, it } from 'vitest';
import { NodeType } from '@blackboard/types';
import { nodeRegistry } from '../../registry';
import { AlphaMathShader, UNPREMULTIPLY_ALPHA_EPSILON } from './alphaMathShader';

describe('alpha association nodes', () => {
  it.each([
    [NodeType.PREMULTIPLY, 'Premultiply', AlphaMathShader.PREMULTIPLY],
    [NodeType.UNPREMULTIPLY, 'Unpremultiply', AlphaMathShader.UNPREMULTIPLY],
  ])('registers %s as a parameter-free scene-linear utility', (type, name, shader) => {
    const definition = nodeRegistry.get(type);

    expect(definition).toMatchObject({
      type,
      name,
      category: 'Utility',
      renderMode: 'shader',
      processingDomain: 'scene_linear',
    });
    expect(definition?.getInitialNodeProps?.()).toEqual({ uniforms: {} });
    expect(definition?.getShader?.({} as never)).toBe(shader);
  });

  it('premultiplies RGB without clamping or changing alpha', () => {
    expect(AlphaMathShader.PREMULTIPLY).toContain('source.rgb *= source.a;');
    expect(AlphaMathShader.PREMULTIPLY).toContain('fragColor = source;');
    expect(AlphaMathShader.PREMULTIPLY).not.toContain('clamp(');
  });

  it('unpremultiplies non-zero alpha and safely blacks effectively transparent RGB', () => {
    expect(AlphaMathShader.UNPREMULTIPLY).toContain(
      `abs(source.a) > ${UNPREMULTIPLY_ALPHA_EPSILON}`,
    );
    expect(AlphaMathShader.UNPREMULTIPLY).toContain('source.rgb / source.a');
    expect(AlphaMathShader.UNPREMULTIPLY).toContain(': vec3(0.0)');
    expect(AlphaMathShader.UNPREMULTIPLY).toContain('fragColor = source;');
    expect(AlphaMathShader.UNPREMULTIPLY).not.toContain('clamp(');
  });
});
