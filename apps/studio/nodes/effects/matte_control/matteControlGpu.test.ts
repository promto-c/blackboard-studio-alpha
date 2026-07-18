import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NodeType, type MatteControlNode } from '@blackboard/types';
import type { ResolveOutputContext } from '@blackboard/renderer';
import { renderMatteControlGpu } from './matteControlGpu';
import { createDefaultMatteControlSettings } from './matteControlModel';

const createHarness = () => {
  const targets = new Map<string, THREE.WebGLRenderTarget>();
  const materials = new Map<string, THREE.ShaderMaterial>();
  const render = vi.fn();
  const context = {
    frame: 12,
    quality: { mode: 'full', resolutionScale: 1, sampleLimit: 128 },
    renderer: { setRenderTarget: vi.fn(), render },
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    nodes: [],
    nodeRegistry: new Map(),
    getMaterial: (id: string, shader: string, uniforms: Record<string, { value: unknown }>) => {
      const material = new THREE.ShaderMaterial({ fragmentShader: shader, uniforms });
      materials.set(id, material);
      return material;
    },
    applyNoBlending: (material: THREE.ShaderMaterial) => {
      material.blending = THREE.NoBlending;
    },
    getScratchRenderTarget: (key: string, size?: { width: number; height: number }) => {
      let target = targets.get(key);
      if (!target) {
        target = new THREE.WebGLRenderTarget(size?.width ?? 128, size?.height ?? 64, {
          type: THREE.HalfFloatType,
        });
        targets.set(key, target);
      } else if (size) {
        target.setSize(size.width, size.height);
      }
      return target;
    },
    getTransparentInputTexture: () => new THREE.Texture(),
  } as unknown as ResolveOutputContext;
  return { context, materials, render, targets };
};

const createNode = (changes: Partial<MatteControlNode> = {}): MatteControlNode => ({
  id: 'matte-control',
  type: NodeType.MATTE_CONTROL,
  name: 'Matte Control',
  enabled: true,
  matteControl: createDefaultMatteControlSettings(),
  ...changes,
});

describe('Matte Control GPU renderer', () => {
  it('uses an exact single pass when morphology and blur are off', () => {
    const { context, materials, render, targets } = createHarness();
    const output = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType });
    const input = new THREE.Texture();

    expect(renderMatteControlGpu(createNode(), output, input, context)).toBe(true);

    expect(targets.size).toBe(0);
    expect(materials.get('matte-control:matte-control:direct')?.uniforms.u_tSource.value).toBe(
      input,
    );
    expect(render).toHaveBeenCalledOnce();
  });

  it('refines source alpha through morphology and edge blur', () => {
    const { context, materials, render } = createHarness();
    const output = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType });
    const node = createNode({
      matteControl: {
        erodeDilate: -3,
        edgeBlur: 5,
        clampBlack: 0.1,
        clampWhite: 0.9,
        invert: true,
      },
    });

    expect(renderMatteControlGpu(node, output, new THREE.Texture(), context)).toBe(true);

    const prepare = materials.get('matte-control:matte-control:prepare')!;
    expect(prepare.uniforms.u_tSource.value).toBeInstanceOf(THREE.Texture);
    expect(
      materials.get('matte-control:matte-control:morph-horizontal')?.uniforms.u_radius.value,
    ).toBe(-3);
    expect(
      materials.get('matte-control:matte-control:blur-vertical')?.uniforms.u_radius.value,
    ).toBe(5);
    expect(materials.get('matte-control:matte-control:final')?.uniforms.u_invert.value).toBe(true);
    expect(render).toHaveBeenCalledTimes(6);
  });

  it('uses the shared preview resolution and sample budget for expensive passes', () => {
    const { context, materials, targets } = createHarness();
    context.quality = { mode: 'preview', resolutionScale: 0.5, sampleLimit: 12 };
    const output = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType });
    const node = createNode({
      matteControl: {
        ...createDefaultMatteControlSettings(),
        erodeDilate: 8,
        edgeBlur: 6,
      },
    });

    renderMatteControlGpu(node, output, new THREE.Texture(), context);

    expect(targets.get('matte-control:preview:read')).toMatchObject({
      width: 64,
      height: 32,
    });
    expect(
      materials.get('matte-control:matte-control:morph-horizontal')?.uniforms.u_radius.value,
    ).toBe(4);
    expect(
      materials.get('matte-control:matte-control:blur-horizontal')?.uniforms.u_sampleLimit.value,
    ).toBe(12);
  });
});
