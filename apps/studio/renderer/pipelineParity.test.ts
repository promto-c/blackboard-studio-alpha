import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BlendMode,
  NodeType,
  type AnyNode,
  type SceneNode,
  type ViewerSettings,
} from '@blackboard/types';
import {
  renderViewportFrameWithSharedPipeline,
  renderWithSharedPipeline,
} from '../../../packages/renderer/src/pipeline';
import type { NodeRegistryLike, ViewportPipelineResources } from '../../../packages/renderer/src';

class MockRenderer {
  capabilities = { isWebGL2: true };
  domElement = {} as HTMLCanvasElement;
  autoClear = true;
  currentTarget: THREE.WebGLRenderTarget | null = null;
  renderCalls: Array<{
    target: THREE.WebGLRenderTarget | null;
    material: THREE.Material | undefined;
  }> = [];

  setSize() {}

  setRenderTarget(target: THREE.WebGLRenderTarget | null) {
    this.currentTarget = target;
  }

  render(_scene: THREE.Scene, _camera: THREE.Camera) {
    const mesh = _scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const material = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
    this.renderCalls.push({ target: this.currentTarget, material });
  }

  getClearColor(target: THREE.Color) {
    return target.set(0x000000);
  }

  getClearAlpha() {
    return 0;
  }

  setClearColor() {}

  clear() {}
}

const createViewerSettings = (): ViewerSettings => ({
  channels: 'RGB',
  alphaOverlay: false,
  alphaMode: 'STRAIGHT',
  showOverlays: true,
  ocioDisplay: 'sRGB - Display',
  ocioView: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  gain: 1,
  gamma: 1,
  saturation: 1,
  lastCustomGain: 1,
  lastCustomGamma: 1,
  lastCustomSaturation: 1,
});

const createSceneNode = (): SceneNode => ({
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 0,
  fps: 30,
});

const createMediaNode = (): AnyNode =>
  ({
    id: 'media',
    type: NodeType.MEDIA_SOURCE,
    name: 'Plate',
    enabled: true,
    src: 'asset-1',
    mediaKind: 'image',
    width: 1920,
    height: 1080,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: 'fit' },
    colorSpace: 'sRGB',
  }) as AnyNode;

const createMediaNodeWithId = (id: string, assetId: string): AnyNode =>
  ({
    ...createMediaNode(),
    id,
    name: id,
    src: assetId,
  }) as AnyNode;

const createBlurNode = (stacked = false): AnyNode =>
  ({
    id: stacked ? 'stacked-blur' : 'global-blur',
    type: NodeType.BLUR,
    name: 'Blur',
    enabled: true,
    stacked,
    blur: { radius: 12, method: 'gaussian' },
  }) as AnyNode;

const createMaskNode = (stacked = false): AnyNode =>
  ({
    id: stacked ? 'stacked-roto' : 'global-roto',
    type: NodeType.ROTO,
    name: 'Roto',
    enabled: true,
    stacked,
    paths: [],
    layers: [],
    invert: false,
  }) as AnyNode;

const createPaintNode = (stacked = false): AnyNode =>
  ({
    id: stacked ? 'stacked-paint' : 'global-paint',
    type: NodeType.PAINT,
    name: 'Paint',
    enabled: true,
    stacked,
    strokes: [],
    layers: [],
  }) as AnyNode;

const createMergeNode = (): AnyNode =>
  ({
    id: 'merge',
    type: NodeType.MERGE,
    name: 'Merge',
    enabled: true,
    opacity: 100,
    operator: BlendMode.OVER,
    inputs: {
      pipe: 'pipe',
      source: 'source',
    },
  }) as AnyNode;

const createMergeChannelsNode = (): AnyNode =>
  ({
    id: 'channels',
    type: NodeType.MERGE_CHANNELS,
    name: 'Merge Channels',
    enabled: true,
    inputs: {},
  }) as AnyNode;

const createRegistry = (): NodeRegistryLike =>
  new Map([
    [
      NodeType.SCENE,
      {
        renderMode: 'scene',
        category: 'Utility',
        flags: { isSceneLike: true },
      },
    ],
    [
      NodeType.MEDIA_SOURCE,
      {
        renderMode: 'media',
        category: 'Image',
        flags: { isMediaNode: true, isSource: true, isRenderable: true },
        mediaDescriptor: {
          getAssetIds: () => ['asset-1'],
          getMediaTextureKey: () => 'asset-1',
          getColorSpace: () => 'sRGB',
        },
      },
    ],
    [
      NodeType.BLUR,
      {
        renderMode: 'multipass',
        category: 'Effect',
        flags: { isRenderable: true },
        getShader: () => ({
          horizontal: 'void main() { }',
          vertical: 'void main() { }',
        }),
        getUniforms: () => ({ u_radius: { value: 12 } }),
      },
    ],
    [
      NodeType.ROTO,
      {
        renderMode: 'mask',
        category: 'Effect',
        flags: { isRenderable: true },
      },
    ],
    [
      NodeType.PAINT,
      {
        renderMode: 'paint',
        category: 'Effect',
        flags: { isRenderable: true },
      },
    ],
    [
      NodeType.MERGE,
      {
        renderMode: 'merge',
        category: 'Effect',
        flags: { isRenderable: true },
      },
    ],
    [
      NodeType.MERGE_CHANNELS,
      {
        renderMode: 'utility',
        category: 'Utility',
        flags: { isRenderable: true },
      },
    ],
  ]) as NodeRegistryLike;

const createResources = () => {
  const renderer = new MockRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);

  const resources: ViewportPipelineResources = {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene,
    camera,
    quad,
    materials: new Map(),
    renderTargets: [
      new THREE.WebGLRenderTarget(1920, 1080),
      new THREE.WebGLRenderTarget(1920, 1080),
      new THREE.WebGLRenderTarget(1920, 1080),
    ],
    utilityTargets: new Map(),
  };

  return { renderer, resources };
};

const createTexture = () => new THREE.Texture();

const materialWithUniform = (
  material: THREE.Material | undefined,
  uniformName: string,
): material is THREE.ShaderMaterial =>
  material instanceof THREE.ShaderMaterial && uniformName in material.uniforms;

describe('viewport/export render pipeline parity guards', () => {
  it('keeps the viewport render target pool stable when rendering global multipass nodes', () => {
    const { resources } = createResources();
    const initialTargets = [...resources.renderTargets];

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createBlurNode(false)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => new THREE.Texture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(result.renderTargets).toHaveLength(3);
    expect(result.renderTargets).toEqual(initialTargets);
  });

  it('composites stacked multipass output from the stack write target', () => {
    const { resources } = createResources();
    const [, , auxBuffer] = resources.renderTargets;

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createBlurNode(true)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => new THREE.Texture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const compositeMaterial = resources.materials.get('media_comp_straight_over');

    expect(result.renderTargets).toHaveLength(3);
    expect(compositeMaterial?.uniforms.u_tDiffuse.value).toBe(auxBuffer.texture);
  });

  it('composites stacked mask output from the stack write target', () => {
    const { resources } = createResources();
    const [, , auxBuffer] = resources.renderTargets;
    const maskTexture = createTexture();
    const addMaskTexture = createTexture();
    const subMaskTexture = createTexture();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createMaskNode(true)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      getRotoMaskTexture: () => maskTexture,
      getRotoAddMaskTexture: () => addMaskTexture,
      getRotoSubMaskTexture: () => subMaskTexture,
      getRotoAlphaMode: () => 1,
      nodeRegistry: createRegistry(),
    });

    const maskMaterial = resources.materials.get('stacked-roto');
    const compositeMaterial = resources.materials.get('media_comp_straight_over');

    expect(result.renderTargets).toHaveLength(3);
    expect(maskMaterial?.uniforms.u_tMask.value).toBe(maskTexture);
    expect(maskMaterial?.uniforms.u_tAddMask.value).toBe(addMaskTexture);
    expect(maskMaterial?.uniforms.u_tSubMask.value).toBe(subMaskTexture);
    expect(maskMaterial?.uniforms.u_alphaMode.value).toBe(1);
    expect(compositeMaterial?.uniforms.u_tDiffuse.value).toBe(auxBuffer.texture);
  });

  it('composites stacked paint output from the stack write target', () => {
    const { resources } = createResources();
    const [, , auxBuffer] = resources.renderTargets;
    const paintTexture = createTexture();
    const paintAlphaTexture = createTexture();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createPaintNode(true)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      getPaintTextures: () => ({
        color: paintTexture,
        alpha: paintAlphaTexture,
      }),
      nodeRegistry: createRegistry(),
    });

    const paintMaterial = resources.materials.get('stacked-paint_paint');
    const compositeMaterial = resources.materials.get('media_comp_straight_over');

    expect(result.renderTargets).toHaveLength(3);
    expect(paintMaterial?.uniforms.u_tPaint.value).toBe(paintTexture);
    expect(paintMaterial?.uniforms.u_tPaintAlpha.value).toBe(paintAlphaTexture);
    expect(compositeMaterial?.uniforms.u_tDiffuse.value).toBe(auxBuffer.texture);
  });

  it('applies global paint through the shared adjustment renderer in the viewport path', () => {
    const { resources } = createResources();
    const paintTexture = createTexture();
    const paintAlphaTexture = createTexture();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createPaintNode(false)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      getPaintTextures: () => ({
        color: paintTexture,
        alpha: paintAlphaTexture,
      }),
      nodeRegistry: createRegistry(),
    });

    const paintMaterial = resources.materials.get('global-paint_paint');

    expect(result.renderTargets).toHaveLength(3);
    expect(paintMaterial?.uniforms.u_tPaint.value).toBe(paintTexture);
    expect(paintMaterial?.uniforms.u_tPaintAlpha.value).toBe(paintAlphaTexture);
  });

  it('uses explicit merge pipe and source inputs in the viewport path', () => {
    const { resources } = createResources();
    const textures = new Map([
      ['pipe', createTexture()],
      ['source', createTexture()],
    ]);

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [
        createMediaNodeWithId('pipe', 'pipe-asset'),
        createMediaNodeWithId('source', 'source-asset'),
        createMergeNode(),
      ],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: (node) => textures.get(node.id),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const pipeTarget = resources.utilityTargets?.get('pipe:output');
    const sourceTarget = resources.utilityTargets?.get('source:output');
    const pipeCopyMaterial = resources.materials.get('merge_merge_pipe_input');
    const mergeMaterial = resources.materials.get('merge_merge_comp_straight_over');

    expect(result.renderTargets).toHaveLength(3);
    expect(pipeTarget).toBeDefined();
    expect(sourceTarget).toBeDefined();
    expect(pipeCopyMaterial?.uniforms.u_tDiffuse.value).toBe(pipeTarget?.texture);
    expect(mergeMaterial?.uniforms.u_tDiffuse.value).toBe(sourceTarget?.texture);
  });

  it('presents utility node output through the shared utility renderer in the viewport path', () => {
    const { resources } = createResources();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMergeChannelsNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => undefined,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const utilityTarget = resources.utilityTargets?.get('channels:output');
    const utilityMaterial = resources.materials.get('channels_utility_output');

    expect(result.renderTargets).toHaveLength(3);
    expect(utilityTarget).toBeDefined();
    expect(utilityMaterial?.uniforms.u_tDiffuse.value).toBe(utilityTarget?.texture);
  });

  it('uses the stacked mask output as the export composite input', async () => {
    const renderer = new MockRenderer();
    const sceneNode = createSceneNode();
    const maskTexture = createTexture();

    const result = await renderWithSharedPipeline({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      nodes: [createMediaNode(), createMaskNode(true)],
      sceneNode,
      frame: 0,
      width: sceneNode.width,
      height: sceneNode.height,
      finalColorSpace: 'raw_texture',
      getAsset: async () => new Blob(['asset']),
      getRotoMaskTexture: () => maskTexture,
      nodeRegistry: createRegistry(),
      loadAssetTexture: async () => createTexture(),
    });

    try {
      const maskCall = renderer.renderCalls.find(({ material }) => {
        if (!materialWithUniform(material, 'u_tMask')) return false;
        return material.uniforms.u_tMask.value === maskTexture;
      });
      const compositeCall = renderer.renderCalls.find(({ material }) =>
        materialWithUniform(material, 'u_tBackdrop'),
      );

      expect(maskCall?.target).toBeInstanceOf(THREE.WebGLRenderTarget);
      expect(compositeCall?.material).toBeInstanceOf(THREE.ShaderMaterial);
      expect(
        (compositeCall?.material as THREE.ShaderMaterial | undefined)?.uniforms.u_tDiffuse.value,
      ).toBe(maskCall?.target?.texture);
    } finally {
      result.dispose();
    }
  });

  it('uses global mask output as the export final input', async () => {
    const renderer = new MockRenderer();
    const sceneNode = createSceneNode();
    const maskTexture = createTexture();

    const result = await renderWithSharedPipeline({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      nodes: [createMediaNode(), createMaskNode(false)],
      sceneNode,
      frame: 0,
      width: sceneNode.width,
      height: sceneNode.height,
      finalColorSpace: 'raw_texture',
      getAsset: async () => new Blob(['asset']),
      getRotoMaskTexture: () => maskTexture,
      nodeRegistry: createRegistry(),
      loadAssetTexture: async () => createTexture(),
    });

    try {
      const maskCall = renderer.renderCalls.find(({ material }) => {
        if (!materialWithUniform(material, 'u_tMask')) return false;
        return material.uniforms.u_tMask.value === maskTexture;
      });
      const finalCall = renderer.renderCalls.at(-1);

      expect(maskCall?.target).toBeInstanceOf(THREE.WebGLRenderTarget);
      expect(finalCall?.target).toBeNull();
      expect(
        (finalCall?.material as THREE.ShaderMaterial | undefined)?.uniforms.u_tDiffuse.value,
      ).toBe(maskCall?.target?.texture);
    } finally {
      result.dispose();
    }
  });
});
