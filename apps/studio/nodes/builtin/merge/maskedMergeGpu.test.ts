import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AlphaMergeOperation, NodeType, type MaskedMergeNode } from '@blackboard/types';
import type { ResolveOutputContext } from '@blackboard/renderer';
import { renderMaskedMergeGpu } from './maskedMergeGpu';
import { MASKED_MERGE_SHADER } from './maskedMergeShader';

const createNode = (changes: Partial<MaskedMergeNode> = {}): MaskedMergeNode => ({
  id: 'masked-merge',
  type: NodeType.MASKED_MERGE,
  name: 'Masked Merge',
  enabled: true,
  mix: 100,
  alphaOperation: AlphaMergeOperation.REPLACE,
  ...changes,
});

const createHarness = () => {
  const materials = new Map<string, THREE.ShaderMaterial>();
  const render = vi.fn();
  const maskTexture = new THREE.Texture();
  const context = {
    frame: 12,
    renderer: { setRenderTarget: vi.fn(), render },
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    nodes: [{ id: 'mask-source', type: 'technical-source', name: 'Mask', enabled: true }],
    nodeRegistry: new Map([
      [
        'technical-source',
        {
          outputPorts: [{ name: 'red', label: 'Red', channel: 'r', dataSemantic: 'mask' }],
        },
      ],
    ]),
    getMaterial: (id: string, shader: string, uniforms: Record<string, { value: unknown }>) => {
      const material = new THREE.ShaderMaterial({ fragmentShader: shader, uniforms });
      materials.set(id, material);
      return material;
    },
    applyNoBlending: (material: THREE.ShaderMaterial) => {
      material.blending = THREE.NoBlending;
    },
    getTransparentInputTexture: () => new THREE.Texture(),
    getInputSourcePort: (node: MaskedMergeNode, port: string) =>
      node.inputSourcePorts?.[port] ?? 'output',
    getChannelIndex: (channel: string | undefined) =>
      ({ r: 0, g: 1, b: 2, a: 3 })[channel as 'r' | 'g' | 'b' | 'a'] ?? 3,
    resolveOutput: vi.fn(() => maskTexture),
  } as unknown as ResolveOutputContext;
  return { context, maskTexture, materials, render };
};

describe('Masked Merge GPU renderer', () => {
  it('uses the RGBA input for RGB and the connected technical channel for alpha', () => {
    const { context, maskTexture, materials, render } = createHarness();
    const sourceTexture = new THREE.Texture();
    const target = new THREE.WebGLRenderTarget(64, 32);
    const node = createNode({
      inputs: { mask: 'mask-source' },
      inputSourcePorts: { mask: 'red' },
      mix: 75,
      alphaOperation: AlphaMergeOperation.INTERSECT,
    });

    expect(renderMaskedMergeGpu(node, target, sourceTexture, context)).toBe(true);

    const material = materials.get('masked-merge:masked-merge')!;
    expect(material.uniforms.u_tSource.value).toBe(sourceTexture);
    expect(material.uniforms.u_tMask.value).toBe(maskTexture);
    expect(material.uniforms.u_hasMask.value).toBe(true);
    expect(material.uniforms.u_maskChannel.value).toBe(0);
    expect(material.uniforms.u_alphaOperation.value).toBe(3);
    expect(material.uniforms.u_mix.value).toBe(0.75);
    expect(material.blending).toBe(THREE.NoBlending);
    expect(render).toHaveBeenCalledOnce();
  });

  it('passes the complete RGBA input through when no mask is connected', () => {
    const { context, materials } = createHarness();
    const sourceTexture = new THREE.Texture();
    const target = new THREE.WebGLRenderTarget(64, 32);

    renderMaskedMergeGpu(createNode(), target, sourceTexture, context);

    const material = materials.get('masked-merge:masked-merge')!;
    expect(material.uniforms.u_tSource.value).toBe(sourceTexture);
    expect(material.uniforms.u_hasMask.value).toBe(false);
  });

  it('passes the complete RGBA input through when the mask source is disabled', () => {
    const { context, materials } = createHarness();
    const sourceTexture = new THREE.Texture();
    const target = new THREE.WebGLRenderTarget(64, 32);
    context.nodes[0]!.enabled = false;

    renderMaskedMergeGpu(
      createNode({ inputs: { mask: 'mask-source' } }),
      target,
      sourceTexture,
      context,
    );

    const material = materials.get('masked-merge:masked-merge')!;
    expect(context.resolveOutput).not.toHaveBeenCalled();
    expect(material.uniforms.u_hasMask.value).toBe(false);
  });

  it('renders missing alpha props with Replace at a full 100% mix', () => {
    const { context, materials } = createHarness();
    const target = new THREE.WebGLRenderTarget(64, 32);
    const staleNode = {
      ...createNode({ inputs: { mask: 'mask-source' } }),
      mix: undefined,
      alphaOperation: undefined,
    } as unknown as MaskedMergeNode;

    renderMaskedMergeGpu(staleNode, target, new THREE.Texture(), context);

    const material = materials.get('masked-merge:masked-merge')!;
    expect(material.uniforms.u_alphaOperation.value).toBe(0);
    expect(material.uniforms.u_mix.value).toBe(1);
  });

  it('defines only alpha operations and always preserves source RGB', () => {
    expect(MASKED_MERGE_SHADER).toContain('return maskAlpha;');
    expect(MASKED_MERGE_SHADER).toContain('sourceAlpha + maskAlpha * (1.0 - sourceAlpha)');
    expect(MASKED_MERGE_SHADER).toContain('sourceAlpha * (1.0 - maskAlpha)');
    expect(MASKED_MERGE_SHADER).toContain('sourceAlpha * maskAlpha');
    expect(MASKED_MERGE_SHADER).toContain('fragColor = vec4(source.rgb, outputAlpha)');
    expect(MASKED_MERGE_SHADER).not.toContain('blend_rgb');
  });
});
