import { describe, expect, it } from 'vitest';
import { BlurMethod, NodeType, UniformUIType, type AnyNode } from '@blackboard/types';
import { getNodeExposableFields } from './helpers';

describe('getNodeExposableFields', () => {
  it('uses explicit registry metadata for richer child controls', () => {
    const node = {
      id: 'blur-1',
      name: 'Blur',
      type: NodeType.BLUR,
      enabled: true,
      blur: { radius: 5, method: BlurMethod.GAUSSIAN },
    } as AnyNode;

    expect(getNodeExposableFields(node)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'blur.method', label: 'Method', control: 'select' }),
        expect.objectContaining({
          path: 'blur.radius',
          label: 'Radius',
          control: 'slider',
          animatable: true,
        }),
      ]),
    );
  });

  it('automatically exposes shader uniform metadata', () => {
    const node = {
      id: 'pixelate-1',
      name: 'Pixelate',
      type: NodeType.PIXELATE,
      enabled: true,
      uniforms: {
        u_pixelSize: {
          label: 'Block Count',
          ui: UniformUIType.SLIDER,
          value: 64,
          min: 2,
          max: 512,
          step: 1,
        },
        u_colorCount: {
          label: 'Color Count',
          ui: UniformUIType.SLIDER,
          value: 16,
          min: 2,
          max: 256,
          step: 1,
        },
      },
    } as AnyNode;

    expect(getNodeExposableFields(node)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'uniforms.u_pixelSize.value',
          label: 'Block Count',
          control: 'slider',
        }),
        expect.objectContaining({
          path: 'uniforms.u_colorCount.value',
          label: 'Color Count',
          control: 'slider',
        }),
      ]),
    );
  });

  it('discovers simple initial-state fields without node-specific UI code', () => {
    const node = {
      id: 'reformat-1',
      name: 'Reformat',
      type: NodeType.REFORMAT,
      enabled: true,
      width: 1920,
      height: 1080,
      resizeMode: 'fit',
      resampling: 'linear',
    } as AnyNode;

    expect(getNodeExposableFields(node)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'width', label: 'Width', control: 'number' }),
        expect.objectContaining({ path: 'height', label: 'Height', control: 'number' }),
        expect.objectContaining({ path: 'resizeMode', label: 'Resize Mode', control: 'text' }),
      ]),
    );
  });
});
