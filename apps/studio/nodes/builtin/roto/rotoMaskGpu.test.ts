import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { RendererMaskLayer, ResolveOutputContext } from '@blackboard/renderer';
import { renderFloatRotoMask } from './rotoMaskGpu';

const createContext = () => {
  const targets = new Map<string, THREE.WebGLRenderTarget>();
  const materials = new Map<string, THREE.ShaderMaterial>();
  const render = vi.fn();
  const context = {
    renderer: { setRenderTarget: vi.fn(), render },
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    getMaterial: (id: string, shader: string, uniforms: Record<string, { value: unknown }>) => {
      const material = new THREE.ShaderMaterial({ fragmentShader: shader, uniforms });
      materials.set(id, material);
      return material;
    },
    applyNoBlending: (material: THREE.ShaderMaterial) => {
      material.blending = THREE.NoBlending;
    },
    clearRenderTargetTransparent: vi.fn(),
    getScratchRenderTarget: (key: string) => {
      let target = targets.get(key);
      if (!target) {
        target = new THREE.WebGLRenderTarget(64, 32, { type: THREE.HalfFloatType });
        targets.set(key, target);
      }
      return target;
    },
  } as unknown as ResolveOutputContext;
  return { context, materials, render, targets };
};

describe('float Roto mask compositor', () => {
  it('feathers and composites hard mask layers without an 8-bit intermediate', () => {
    const { context, materials, render, targets } = createContext();
    const layer: RendererMaskLayer = {
      texture: new THREE.Texture(),
      feather: 12,
      opacity: 0.75,
      operation: 'subtract',
    };

    const result = renderFloatRotoMask('roto', [layer], context);

    expect(result).toBe(targets.get('roto-mask-b')?.texture);
    expect(targets.get('roto-blur-h')?.texture.type).toBe(THREE.HalfFloatType);
    expect(materials.get('roto:roto-feather-h')?.uniforms.u_radius.value).toBe(12);
    expect(materials.get('roto:roto-composite:0')?.uniforms.u_opacity.value).toBe(0.75);
    expect(materials.get('roto:roto-composite:0')?.uniforms.u_operation.value).toBe(1);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('uploads one precomposited temporal texture before feathering', () => {
    const { context, materials, render } = createContext();
    const prepare = vi.fn();
    const layer: RendererMaskLayer = {
      texture: new THREE.Texture(),
      prepare,
      feather: 6,
      opacity: 1,
      operation: 'add',
    };

    renderFloatRotoMask('motion', [layer], context);

    expect(materials.has('motion:roto-motion-accumulate')).toBe(false);
    expect(prepare).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(3);
  });
});
