import { describe, expect, it, vi } from 'vitest';
import { UniformUIType } from '@blackboard/types';
import { createUniformGetter } from './nodeFactoryHelpers';

describe('createUniformGetter', () => {
  it('converts picker color uniforms into project scene-linear values', () => {
    const transformColorPickingToSceneLinear = vi.fn(
      () => [-0.25, 1.5, 0.5] as [number, number, number],
    );
    const getUniforms = createUniformGetter();
    const uniforms = getUniforms(
      {
        uniforms: {
          u_color: {
            ui: UniformUIType.COLOR,
            value: [0.1, 0.2, 0.3],
          },
        },
      } as never,
      {
        frame: 0,
        fps: 24,
        scene: { width: 1920, height: 1080 },
        nodes: [],
        quality: { mode: 'full', resolutionScale: 1, sampleLimit: 128 },
        transformColorPickingToSceneLinear,
      },
    );

    expect(transformColorPickingToSceneLinear).toHaveBeenCalledWith([0.1, 0.2, 0.3]);
    expect(uniforms.u_color?.value).toMatchObject({ r: -0.25, g: 1.5, b: 0.5 });
  });
});
