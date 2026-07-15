import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NodeType, type AnyNode } from '@blackboard/types';
import { RendererShader, type ResolveOutputContext } from '@blackboard/renderer';
import { extractChannelsNode, mergeChannelsNode } from './index';
import { ChannelShader } from './channelShader';

vi.mock('../../NodeToolButton', () => ({ NodeToolButton: () => null }));

const createRenderHarness = (overrides: Partial<ResolveOutputContext> = {}) => {
  const sourceTexture = new THREE.Texture();
  const resolveOutput = vi.fn(() => sourceTexture);
  const getMaterial = vi.fn(
    (_id: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      ({ fragmentShader, uniforms }) as THREE.ShaderMaterial,
  );
  const quad = { material: null } as unknown as THREE.Mesh;
  const renderer = {
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
  const context = {
    getInputSourcePort: () => 'output',
    resolveOutput,
    getTransparentInputTexture: () => new THREE.Texture(),
    getChannelIndex: (channel: string | undefined) =>
      channel === 'g' ? 1 : channel === 'b' ? 2 : channel === 'a' ? 3 : 0,
    getMaterial,
    applyNoBlending: vi.fn(),
    clearRenderTargetTransparent: vi.fn(),
    quad,
    renderer,
    scene: {} as THREE.Scene,
    camera: {} as THREE.Camera,
    nodes: [],
    nodeRegistry: { get: () => undefined },
    ...overrides,
  } as unknown as ResolveOutputContext;

  return { context, getMaterial, resolveOutput, sourceTexture };
};

const extractNode = {
  id: 'extract',
  type: NodeType.EXTRACT_CHANNELS,
  name: 'Extract Channels',
  enabled: true,
  inputs: { source: 'grade' },
} as AnyNode;

describe('Extract Channels node', () => {
  it('declares a color pass-through primary output and technical channel outputs', () => {
    const outputPorts =
      typeof extractChannelsNode.outputPorts === 'function'
        ? extractChannelsNode.outputPorts(extractNode)
        : extractChannelsNode.outputPorts;

    expect(extractChannelsNode.processingDomain).toBe('scene_linear');
    expect(outputPorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'output', processingDomain: 'scene_linear' }),
        expect.objectContaining({
          name: 'r',
          channel: 'r',
          processingDomain: 'data',
          color: '#c96f78',
        }),
        expect.objectContaining({
          name: 'a',
          channel: 'a',
          processingDomain: 'alpha',
          color: '#9da5b2',
        }),
      ]),
    );
    expect(mergeChannelsNode.inputPorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'g', channel: 'g', color: '#70ad87' }),
        expect.objectContaining({ name: 'b', channel: 'b', color: '#7293c2' }),
      ]),
    );
  });

  it('copies straight RGBA unchanged for primary node viewing', () => {
    const { context, getMaterial, sourceTexture } = createRenderHarness();

    expect(
      extractChannelsNode.renderOutput?.(
        extractNode,
        {} as THREE.WebGLRenderTarget,
        undefined,
        context,
        'output',
      ),
    ).toBe(true);
    expect(getMaterial).toHaveBeenCalledWith(
      'extract_extract_channels_output',
      RendererShader.TEXTURE,
      { u_tDiffuse: { value: sourceTexture } },
    );
  });

  it('isolates only explicitly requested technical ports', () => {
    const { context, getMaterial } = createRenderHarness();

    expect(
      extractChannelsNode.renderOutput?.(
        extractNode,
        {} as THREE.WebGLRenderTarget,
        undefined,
        context,
        'a',
      ),
    ).toBe(true);
    expect(getMaterial).toHaveBeenCalledWith(
      'extract_extract_channels_a',
      ChannelShader.EXTRACT,
      expect.objectContaining({ u_channel: { value: 3 } }),
    );
    expect(ChannelShader.EXTRACT).toContain('fragColor = vec4(0.0);');
    expect(ChannelShader.EXTRACT).toContain('fragColor.a = src.a;');
    expect(ChannelShader.EXTRACT).not.toContain('vec4(ch, ch, ch, ch)');
  });

  it('samples a normal RGBA source from the target channel', () => {
    const imageNode = {
      id: 'image',
      type: NodeType.MEDIA_SOURCE,
      name: 'Image',
      enabled: true,
    } as AnyNode;
    const mergeNode = {
      id: 'merge',
      type: NodeType.MERGE_CHANNELS,
      name: 'Merge Channels',
      enabled: true,
      inputs: { g: imageNode.id },
    } as AnyNode;
    const { context, getMaterial, resolveOutput } = createRenderHarness({
      nodes: [imageNode, mergeNode],
      getInputSourcePort: (node, inputPort, fallback = 'output') =>
        node.inputSourcePorts?.[inputPort] ?? fallback,
    });

    expect(
      mergeChannelsNode.renderOutput?.(
        mergeNode,
        {} as THREE.WebGLRenderTarget,
        undefined,
        context,
      ),
    ).toBe(true);
    expect(resolveOutput).toHaveBeenCalledWith(imageNode.id, 'output');
    expect(getMaterial.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({ u_sourceChannelG: { value: 1 } }),
    );
  });

  it('samples a named source channel when remapping across channel ports', () => {
    const mergeNode = {
      id: 'merge',
      type: NodeType.MERGE_CHANNELS,
      name: 'Merge Channels',
      enabled: true,
      inputs: { g: extractNode.id },
      inputSourcePorts: { g: 'r' },
    } as AnyNode;
    const { context, getMaterial, resolveOutput } = createRenderHarness({
      nodes: [extractNode, mergeNode],
      nodeRegistry: {
        get: (type) => (type === NodeType.EXTRACT_CHANNELS ? extractChannelsNode : undefined),
      },
      getInputSourcePort: (node, inputPort, fallback = 'output') =>
        node.inputSourcePorts?.[inputPort] ?? fallback,
    });

    expect(
      mergeChannelsNode.renderOutput?.(
        mergeNode,
        {} as THREE.WebGLRenderTarget,
        undefined,
        context,
      ),
    ).toBe(true);
    expect(resolveOutput).toHaveBeenCalledWith(extractNode.id, 'r');
    expect(getMaterial.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({ u_sourceChannelG: { value: 0 } }),
    );
  });
});
