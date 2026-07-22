import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  AlphaMergeOperation,
  BlendMode,
  NodeType,
  type AnyNode,
  type MaskedMergeNode,
  type SceneNode,
  type ViewerSettings,
} from '@blackboard/types';
import {
  renderViewportFrameWithSharedPipeline as renderViewportFrameWithSharedPipelineBase,
  renderWithSharedPipeline as renderWithSharedPipelineBase,
  type RenderPipelineOptions,
  type ViewportPipelineOptions,
} from '../../../packages/renderer/src/pipeline';
import type {
  RendererNodeEntry,
  RendererColorManagement,
  RendererOcioShaderInfo,
  RendererDataWindowPlan,
  ResolveOutputContext,
  ViewportPipelineResources,
} from '../../../packages/renderer/src';
import { AlphaMathShader } from '@/nodes/builtin/alpha_math/alphaMathShader';
import { renderMaskedMergeGpu } from '@/nodes/builtin/merge/maskedMergeGpu';

class MockRenderer {
  capabilities = { isWebGL2: true };
  domElement = {} as HTMLCanvasElement;
  autoClear = true;
  currentTarget: THREE.WebGLRenderTarget | null = null;
  renderCalls: Array<{
    target: THREE.WebGLRenderTarget | null;
    material: THREE.Material | undefined;
  }> = [];
  compileCalls = 0;
  setSizeCalls = 0;
  lastSetSize: { width: number; height: number } | null = null;
  scissorTest = false;
  scissor = new THREE.Vector4();

  setSize(width: number, height: number) {
    this.setSizeCalls += 1;
    this.lastSetSize = { width, height };
  }

  setRenderTarget(target: THREE.WebGLRenderTarget | null) {
    this.currentTarget = target;
  }

  getDrawingBufferSize(target: THREE.Vector2) {
    return target.set(1920, 1080);
  }

  setScissorTest(enabled: boolean) {
    this.scissorTest = enabled;
  }

  setScissor(x: number, y: number, width: number, height: number) {
    this.scissor.set(x, y, width, height);
  }

  compile() {
    this.compileCalls += 1;
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

const SCENE_WORKING_SPACE = 'ACEScg';
const TEXTURE_PAINT_SPACE = 'sRGB Encoded Rec.709 (sRGB)';
const TEST_DISPLAY_VIEW = {
  display: 'sRGB - Display',
  view: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  look: 'Studio Look',
};

const createViewerSettings = (): ViewerSettings => ({
  channels: 'RGB',
  alphaOverlay: false,
  gamutWarning: false,
  showOverlays: true,
  gain: 1,
  gamma: 1,
  saturation: 1,
  lastCustomGain: 1,
  lastCustomGamma: 1,
  lastCustomSaturation: 1,
});

const testColorManagement: RendererColorManagement = {
  getColorSpaceTransform: () => null,
  getDisplayViewTransform: () => null,
  getTransform: () => null,
  transformRgb: (_source, _destination, color) => [...color],
  resolveColorSpaceName: (value) => value ?? TEXTURE_PAINT_SPACE,
  defaultDisplay: 'sRGB - Display',
  defaultView: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  workingColorSpace: SCENE_WORKING_SPACE,
  textureColorSpace: TEXTURE_PAINT_SPACE,
  colorPickingColorSpace: TEXTURE_PAINT_SPACE,
  dataColorSpace: 'Raw',
};

const createOcioShaderInfo = (
  kind: RendererOcioShaderInfo['kind'],
  key: string,
  functionName: string,
): RendererOcioShaderInfo => ({
  kind,
  key,
  shaderText: `vec4 ${functionName}(vec4 color) { return vec4(color.rgb * 2.0, 0.0); }`,
  functionName,
  language: 'glsl',
  cacheId: key,
  textures: [],
  uniforms: [],
});

const renderViewportFrameWithSharedPipeline = (
  options: Omit<ViewportPipelineOptions, 'colorManagement' | 'displayView'>,
) =>
  renderViewportFrameWithSharedPipelineBase({
    ...options,
    displayView: TEST_DISPLAY_VIEW,
    colorManagement: testColorManagement,
  });

const renderWithSharedPipeline = (
  options: Omit<RenderPipelineOptions, 'colorManagement' | 'displayView'>,
) =>
  renderWithSharedPipelineBase({
    ...options,
    displayView: TEST_DISPLAY_VIEW,
    colorManagement: testColorManagement,
  });

const createSceneNode = (): SceneNode => ({
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: SCENE_WORKING_SPACE,
  startFrame: 0,
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
    colorSpace: TEXTURE_PAINT_SPACE,
  }) as AnyNode;

const createMediaNodeWithId = (id: string, assetId: string): AnyNode =>
  ({
    ...createMediaNode(),
    id,
    name: id,
    src: assetId,
  }) as AnyNode;

const createTextNode = (): AnyNode =>
  ({
    id: 'text',
    type: NodeType.TEXT,
    name: 'Text',
    enabled: true,
    text: 'Linear',
    fontFamily: 'sans-serif',
    fontSize: 32,
    color: [0.1, 0.2, 0.3],
    position: { x: 0, y: 0 },
    rotation: 0,
    opacity: 100,
    operator: BlendMode.OVER,
  }) as AnyNode;

const createBlurNode = (stacked = false): AnyNode =>
  ({
    id: stacked ? 'stacked-blur' : 'global-blur',
    type: NodeType.BLUR,
    name: 'Blur',
    enabled: true,
    stacked,
    inputs: { pipe: 'media' },
    blur: { radius: 12, method: 'gaussian' },
  }) as AnyNode;

const createPremultiplyNode = (stacked = false): AnyNode =>
  ({
    id: stacked ? 'stacked-premultiply' : 'global-premultiply',
    type: NodeType.PREMULTIPLY,
    name: 'Premultiply',
    enabled: true,
    stacked,
    uniforms: {},
    inputs: { pipe: 'media' },
  }) as AnyNode;

const createLogGradeNode = (): AnyNode =>
  ({
    id: 'stacked-grade',
    type: NodeType.GRADE,
    name: 'Log Grade',
    enabled: true,
    stacked: true,
    inputs: { pipe: 'media' },
    grade: { processingDomain: 'log' },
  }) as unknown as AnyNode;

const createOcioTransformNode = (): AnyNode =>
  ({
    id: 'ocio-transform',
    type: NodeType.OCIO_COLOR_SPACE,
    name: 'Color Space Transform',
    enabled: true,
    sourceColorSpace: TEXTURE_PAINT_SPACE,
    destinationColorSpace: SCENE_WORKING_SPACE,
  }) as AnyNode;

const createMaskNode = (stacked = false): AnyNode =>
  ({
    id: stacked ? 'stacked-roto' : 'global-roto',
    type: NodeType.ROTO,
    name: 'Roto',
    enabled: true,
    stacked,
    inputs: { pipe: 'media' },
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
    inputs: { pipe: 'media' },
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

const createMaskedMergeNode = (): MaskedMergeNode => ({
  id: 'masked-merge',
  type: NodeType.MASKED_MERGE,
  name: 'Masked Merge',
  enabled: true,
  mix: 100,
  alphaOperation: AlphaMergeOperation.REPLACE,
  inputs: {
    pipe: 'rgba',
    mask: 'mask',
  },
});

const createMergeChannelsNode = (): AnyNode =>
  ({
    id: 'channels',
    type: NodeType.MERGE_CHANNELS,
    name: 'Merge Channels',
    enabled: true,
    inputs: {},
  }) as AnyNode;

const createRegistry = (): Map<string, RendererNodeEntry> =>
  new Map<string, RendererNodeEntry>([
    [
      NodeType.SCENE,
      {
        renderMode: 'scene',
        category: 'Utility',
        processingDomain: 'scene_linear',
        flags: { isSceneLike: true },
      },
    ],
    [
      NodeType.MEDIA_SOURCE,
      {
        renderMode: 'media',
        category: 'Image',
        processingDomain: 'scene_linear',
        flags: { isMediaNode: true, isSource: true, isRenderable: true },
        mediaDescriptor: {
          getAssetIds: () => ['asset-1'],
          getMediaTextureKey: () => 'asset-1',
          getColorSpace: () => TEXTURE_PAINT_SPACE,
        },
      },
    ],
    [
      NodeType.TEXT,
      {
        renderMode: 'text',
        category: 'Image',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        getGeneratedColor: (node, context) =>
          context.transformColorPickingToSceneLinear(
            (node as { color: [number, number, number] }).color,
          ),
      },
    ],
    [
      NodeType.BLUR,
      {
        renderMode: 'multipass',
        category: 'Effect',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        getShader: () => ({
          horizontal: 'void main() { }',
          vertical: 'void main() { }',
        }),
        getUniforms: () => ({ u_radius: { value: 12 } }),
        renderScale: () => 0.5,
      },
    ],
    [
      NodeType.GRADE,
      {
        renderMode: 'shader',
        category: 'Effect',
        processingDomain: (node) =>
          (node as { grade: { processingDomain: 'scene_linear' | 'log' } }).grade.processingDomain,
        flags: { isRenderable: true },
        getShader: () => 'void main() { /* LogGradePass */ }',
        getUniforms: () => ({ u_exposure: { value: 0 } }),
      },
    ],
    [
      NodeType.PREMULTIPLY,
      {
        renderMode: 'shader',
        category: 'Utility',
        processingDomain: 'scene_linear',
        inputPorts: [
          {
            name: 'reference',
            label: 'Reference',
            type: 'texture',
            required: false,
            uniformName: 'u_reference',
            frameOffset: -1,
          },
        ],
        getShader: () => AlphaMathShader.PREMULTIPLY,
        getUniforms: () => ({}),
      },
    ],
    [
      NodeType.OCIO_COLOR_SPACE,
      {
        renderMode: 'ocio',
        category: 'Adjustment',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        getOcioTransforms: (_node, context) => [
          {
            type: 'colorSpace',
            source: TEXTURE_PAINT_SPACE,
            destination: context.workingColorSpace,
          },
        ],
      },
    ],
    [
      NodeType.ROTO,
      {
        renderMode: 'mask',
        category: 'Effect',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        renderOutput: (
          node: AnyNode,
          target: THREE.WebGLRenderTarget,
          inputTexture: THREE.Texture | undefined,
          context: ResolveOutputContext,
        ) => {
          const layer = context.getRotoMaskLayers?.(node.id)?.[0];
          if (!layer) return false;
          layer.prepare?.();
          const material = context.getMaterial(node.id, 'void main() {}', {
            u_tDiffuse: { value: inputTexture },
            u_tMask: { value: layer.texture },
            u_alphaMode: { value: context.getRotoAlphaMode?.(node.id) ?? 0 },
          });
          context.applyNoBlending(material);
          context.quad.material = material;
          context.renderer.setRenderTarget(target);
          context.renderer.render(context.scene, context.camera);
          return true;
        },
      },
    ],
    [
      NodeType.PAINT,
      {
        renderMode: 'paint',
        category: 'Effect',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        renderOutput: (
          node: AnyNode,
          target: THREE.WebGLRenderTarget,
          inputTexture: THREE.Texture | undefined,
          context: ResolveOutputContext,
        ) => {
          const material = context.getMaterial(`${node.id}_paint`, 'void main() {}', {
            u_tDiffuse: { value: inputTexture },
          });
          context.applyNoBlending(material);
          context.quad.material = material;
          context.renderer.setRenderTarget(target);
          context.renderer.render(context.scene, context.camera);
          return true;
        },
      },
    ],
    [
      NodeType.MERGE,
      {
        renderMode: 'merge',
        category: 'Effect',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
      },
    ],
    [
      NodeType.MASKED_MERGE,
      {
        renderMode: 'mask',
        category: 'Effect',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        inputPorts: [
          { name: 'pipe', label: 'RGBA', type: 'texture', required: false },
          {
            name: 'mask',
            label: 'Alpha / Mask',
            type: 'mask',
            dataSemantic: 'mask',
            channel: 'a',
            processingDomain: 'alpha',
            required: false,
          },
        ],
        renderOutput: (node, target, inputTexture, context) =>
          renderMaskedMergeGpu(node, target, inputTexture, context),
      },
    ],
    [
      NodeType.MERGE_CHANNELS,
      {
        renderMode: 'utility',
        category: 'Utility',
        processingDomain: 'scene_linear',
        flags: { isRenderable: true },
        renderOutput: (
          node: AnyNode,
          target: THREE.WebGLRenderTarget,
          _inputTexture: THREE.Texture | undefined,
          context: ResolveOutputContext,
        ) => {
          const material = context.getMaterial(`${node.id}_channels_output`, 'void main() {}', {
            u_tDiffuse: { value: context.getTransparentInputTexture() },
          });
          context.applyNoBlending(material);
          context.quad.material = material;
          context.renderer.setRenderTarget(target);
          context.renderer.render(context.scene, context.camera);
          return true;
        },
      },
    ],
    [
      NodeType.EXTRACT_CHANNELS,
      {
        renderMode: 'utility',
        category: 'Utility',
        processingDomain: 'scene_linear',
        outputPorts: [
          { name: 'output', label: 'RGBA', processingDomain: 'scene_linear' },
          { name: 'r', label: 'R', channel: 'r', processingDomain: 'data' },
          { name: 'g', label: 'G', channel: 'g', processingDomain: 'data' },
          { name: 'b', label: 'B', channel: 'b', processingDomain: 'data' },
          {
            name: 'a',
            label: 'A',
            channel: 'a',
            processingDomain: 'alpha',
            dataSemantic: 'alpha',
          },
        ],
        flags: { isRenderable: true },
        renderOutput: (
          node: AnyNode,
          target: THREE.WebGLRenderTarget,
          _inputTexture: THREE.Texture | undefined,
          context: ResolveOutputContext,
          portName = 'output',
        ) => {
          const material = context.getMaterial(
            `${node.id}_extract_${portName}`,
            `void main() { /* ${portName} */ }`,
            {},
          );
          context.applyNoBlending(material);
          context.quad.material = material;
          context.renderer.setRenderTarget(target);
          context.renderer.render(context.scene, context.camera);
          return true;
        },
      },
    ],
  ]);

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
      new THREE.WebGLRenderTarget(1920, 1080, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      }),
      new THREE.WebGLRenderTarget(1920, 1080, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      }),
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

const expectSceneCompositeShaderPreservesRgbRange = (material: THREE.Material | undefined) => {
  expect(material).toBeInstanceOf(THREE.ShaderMaterial);
  const shader = (material as THREE.ShaderMaterial).fragmentShader;

  expect(shader).toContain('vec4 straight_over(vec4 src, vec4 dst)');
  expect(shader).toContain('src.a = clamp(src.a, 0.0, 1.0);');
  expect(shader).toContain('dst.a = clamp(dst.a, 0.0, 1.0);');
  expect(shader).toContain('return vec4(out_rgb, out_a);');
  expect(shader).not.toMatch(/\b(?:clamp|min|max)\s*\(\s*(?:src|dst)\.rgb/);
  expect(shader).not.toMatch(/\b(?:clamp|min|max)\s*\(\s*(?:weighted_rgb|out_rgb)/);
};

describe('viewport/export render pipeline parity guards', () => {
  it('scissors shared viewport work to the non-destructive working area', () => {
    const { renderer, resources } = createResources();
    const croppedTexture = new THREE.Texture();
    croppedTexture.userData.blackboardSourceRegion = {
      x: 240,
      y: 120,
      width: 720,
      height: 360,
      fullWidth: 1920,
      fullHeight: 1080,
      coordinateSpace: 'top-left',
    };

    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      workingArea: { x: 240, y: 120, width: 720, height: 360 },
      getMediaTexture: () => croppedTexture,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(resources.renderTargets).toHaveLength(2);
    resources.renderTargets.forEach((target) => {
      expect(target.scissorTest).toBe(true);
      expect(target.scissor.toArray()).toEqual([240, 600, 720, 360]);
    });
    expect(renderer.scissorTest).toBe(true);
    expect(renderer.scissor.toArray()).toEqual([240, 600, 720, 360]);
    const mediaMaterial = [...resources.materials.values()].find(
      (material) => material.uniforms.u_tDiffuse?.value === croppedTexture,
    );
    expect((mediaMaterial?.uniforms.u_image_region.value as THREE.Vector4).toArray()).toEqual([
      240, 600, 720, 360,
    ]);
  });

  it.each([
    ['connected', false, 'global-premultiply'],
    ['stacked', true, 'stacked-premultiply'],
  ])('renders a Utility-category primary-input shader when %s', (_label, stacked, materialId) => {
    const { resources } = createResources();

    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createPremultiplyNode(stacked)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const material = resources.materials.get(materialId);
    expect(material?.fragmentShader).toContain('source.rgb *= source.a;');
    expect(material?.uniforms.u_tDiffuse.value).toBeInstanceOf(THREE.Texture);
    expect(material?.uniforms).not.toHaveProperty('u_reference');
  });

  it('compiles shader programs on first use and reuses unchanged viewport materials', () => {
    const { renderer, resources } = createResources();
    const options = {
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    };

    renderViewportFrameWithSharedPipeline(options);
    const firstFrameCompileCount = renderer.compileCalls;

    renderViewportFrameWithSharedPipeline({
      ...options,
      frame: 1,
    });

    expect(firstFrameCompileCount).toBeGreaterThan(0);
    expect(renderer.compileCalls).toBe(firstFrameCompileCount);
  });

  it('renders the exact sparse component requested by a normal color output', () => {
    const { resources } = createResources();
    const extract = {
      id: 'extract',
      type: NodeType.EXTRACT_CHANNELS,
      name: 'Extract Channels',
      enabled: true,
    } as AnyNode;

    renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [extract],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      outputDomain: {
        kind: 'color',
        sourceNodeId: extract.id,
        sourcePort: 'r',
      },
      colorManagement: testColorManagement,
      getMediaTexture: () => undefined,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(resources.materials.has('extract_extract_r')).toBe(true);
    expect(resources.materials.has('extract_extract_output')).toBe(false);
    expect(resources.materials.has('viewer_data')).toBe(false);
  });

  it('renders text masks with an unclamped scene-linear generated color', () => {
    const transformRgb = vi.fn(() => [-0.25, 1.5, 0.625] as [number, number, number]);
    const { resources } = createResources();

    renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [createTextNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      colorManagement: {
        ...testColorManagement,
        transformRgb,
      },
      getMediaTexture: () => undefined,
      getTextTexture: () => ({
        texture: createTexture(),
        width: 320,
        height: 80,
      }),
      nodeRegistry: createRegistry(),
    });

    const material = resources.materials.get('text_comp_transformed_straight_over');
    const generatedColor = material?.uniforms.u_generated_color.value as THREE.Color | undefined;

    expect(transformRgb).toHaveBeenCalledWith(
      TEXTURE_PAINT_SPACE,
      SCENE_WORKING_SPACE,
      [0.1, 0.2, 0.3],
    );
    expect(material?.uniforms.u_use_generated_color.value).toBe(true);
    expect(generatedColor?.toArray()).toEqual([-0.25, 1.5, 0.625]);
    expect(material?.fragmentShader).toContain(
      'src.rgb = src.a > 0.0 ? u_generated_color : vec3(0.0);',
    );
  });

  it('renders registry-declared OCIO nodes through one GPU transform pass', () => {
    const getTransform = vi.fn(() =>
      createOcioShaderInfo('transform', 'ocio-node-transform', 'OCIONodeTransform'),
    );
    const { resources } = createResources();

    renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [createMediaNode(), createOcioTransformNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      colorManagement: { ...testColorManagement, getTransform },
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(getTransform).toHaveBeenCalledWith([
      {
        type: 'colorSpace',
        source: TEXTURE_PAINT_SPACE,
        destination: SCENE_WORKING_SPACE,
      },
    ]);
    const material = resources.materials.get('ocio-transform_ocio_transform');
    expect(material?.fragmentShader).toContain('OCIONodeTransform');
    expect(material?.fragmentShader).toContain('fragColor = vec4(transformed.rgb, source.a);');
  });

  it('uses registry scene-size behavior for plugin-defined format nodes', () => {
    const formatType = 'plugin_format';
    const registry = createRegistry();
    registry.set(formatType, {
      renderMode: 'shader',
      category: 'Spatial',
      processingDomain: 'scene_linear',
      sceneSize: {
        getInputSize: (node) => {
          const format = node as AnyNode & { sourceWidth: number; sourceHeight: number };
          return { width: format.sourceWidth, height: format.sourceHeight };
        },
        getOutputSize: (node) => {
          const format = node as AnyNode & { width: number; height: number };
          return { width: format.width, height: format.height };
        },
      },
      getShader: () => 'void main() {}',
      getUniforms: () => ({}),
    });
    const formatNode = {
      id: 'plugin-format',
      type: formatType,
      name: 'Plugin Format',
      enabled: true,
      sourceWidth: 1280,
      sourceHeight: 720,
      width: 640,
      height: 360,
    } as unknown as AnyNode;
    const { resources } = createResources();
    const initialTargetPool = [...resources.renderTargets];

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), formatNode],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: registry,
    });

    const mediaComposite = resources.materials.get('media_comp_transformed_straight_over');
    const initialSceneSize = mediaComposite?.uniforms.u_scene_res.value as
      | THREE.Vector2
      | undefined;

    expect(initialSceneSize?.toArray()).toEqual([1280, 720]);
    expect(result.finalCompositeTarget?.width).toBe(640);
    expect(result.finalCompositeTarget?.height).toBe(360);

    const firstFrameUtilityTargets = new Map(resources.utilityTargets);
    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), formatNode],
      sceneNode: createSceneNode(),
      frame: 1,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: registry,
    });

    resources.renderTargets.forEach((target, index) => {
      expect(target).toBe(initialTargetPool[index]);
    });
    expect(resources.utilityTargets?.size).toBe(firstFrameUtilityTargets.size);
    firstFrameUtilityTargets.forEach((target, key) => {
      expect(resources.utilityTargets?.get(key)).toBe(target);
    });
  });

  it('keeps upstream overscan allocated until a larger format reveals it', async () => {
    const formatType = 'plugin_overscan_format';
    let uniformContextSnapshot: {
      scene: { width: number; height: number };
      storageWindow?: { x: number; y: number; width: number; height: number };
      outputStorageWindow?: { x: number; y: number; width: number; height: number };
    } | null = null;
    const getUniforms = vi.fn((_node: AnyNode, context) => {
      uniformContextSnapshot = {
        scene: { ...context.scene },
        storageWindow: context.storageWindow ? { ...context.storageWindow } : undefined,
        outputStorageWindow: context.outputStorageWindow
          ? { ...context.outputStorageWindow }
          : undefined,
      };
      return { u_storage_width: { value: context.storageWindow?.width ?? 0 } };
    });
    const registry = createRegistry();
    registry.set(formatType, {
      renderMode: 'shader',
      category: 'Spatial',
      processingDomain: 'scene_linear',
      sceneSize: {
        getInputSize: () => ({ width: 100, height: 100 }),
        getOutputSize: () => ({ width: 200, height: 200 }),
      },
      getShader: () => 'void main() {}',
      getUniforms,
    });
    const mediaNode = {
      ...createMediaNode(),
      width: 200,
      height: 200,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: 'custom' },
    } as AnyNode;
    const formatNode = {
      id: 'overscan-format',
      type: formatType,
      name: 'Overscan Format',
      enabled: true,
      inputs: { pipe: mediaNode.id },
      width: 200,
      height: 200,
    } as unknown as AnyNode;
    const dataWindowPlan: RendererDataWindowPlan = {
      initialDisplayWindow: { width: 100, height: 100 },
      displayWindow: { width: 200, height: 200 },
      storageWindow: { x: 0, y: 0, width: 200, height: 200 },
      nodeWindows: new Map([
        [
          mediaNode.id,
          {
            inputDisplayWindow: { width: 100, height: 100 },
            outputDisplayWindow: { width: 100, height: 100 },
            inputDataWindow: { x: -50, y: -50, width: 200, height: 200 },
            outputDataWindow: { x: -50, y: -50, width: 200, height: 200 },
            inputStorageWindow: { x: -50, y: -50, width: 200, height: 200 },
            outputStorageWindow: { x: -50, y: -50, width: 200, height: 200 },
          },
        ],
        [
          formatNode.id,
          {
            inputDisplayWindow: { width: 100, height: 100 },
            outputDisplayWindow: { width: 200, height: 200 },
            inputDataWindow: { x: -50, y: -50, width: 200, height: 200 },
            outputDataWindow: { x: 0, y: 0, width: 200, height: 200 },
            inputStorageWindow: { x: -50, y: -50, width: 200, height: 200 },
            outputStorageWindow: { x: 0, y: 0, width: 200, height: 200 },
          },
        ],
      ]),
    };
    const sceneNode = { ...createSceneNode(), width: 200, height: 200 };
    const { resources } = createResources();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [mediaNode, formatNode],
      sceneNode,
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: registry,
      dataWindowPlan,
    });

    const mediaComposite = resources.materials.get('media_comp_transformed_straight_over');
    expect((mediaComposite?.uniforms.u_scene_res.value as THREE.Vector2).toArray()).toEqual([
      200, 200,
    ]);
    expect(getUniforms).toHaveBeenCalledOnce();
    expect(uniformContextSnapshot).toEqual({
      scene: { width: 100, height: 100 },
      storageWindow: { x: -50, y: -50, width: 200, height: 200 },
      outputStorageWindow: { x: 0, y: 0, width: 200, height: 200 },
    });
    expect(result.finalCompositeTarget).toMatchObject({ width: 200, height: 200 });

    const exportRenderer = new MockRenderer();
    const exportResult = await renderWithSharedPipeline({
      renderer: exportRenderer as unknown as THREE.WebGLRenderer,
      nodes: [mediaNode, formatNode],
      sceneNode,
      frame: 0,
      width: 200,
      height: 200,
      finalColorSpace: 'raw_texture',
      getAsset: async () => new Blob(['asset']),
      loadAssetTexture: async () => createTexture(),
      nodeRegistry: registry,
      dataWindowPlan,
    });

    try {
      const exportMediaComposite = exportRenderer.renderCalls.find(({ material }) =>
        materialWithUniform(material, 'u_scene_res'),
      )?.material as THREE.ShaderMaterial | undefined;
      expect((exportMediaComposite?.uniforms.u_scene_res.value as THREE.Vector2).toArray()).toEqual(
        [200, 200],
      );
      expect(exportRenderer.renderCalls.at(-1)?.target).toBeNull();
    } finally {
      exportResult.dispose();
    }
  });

  it('crops preserved overscan only at the final display boundary', () => {
    const sceneNode = { ...createSceneNode(), width: 200, height: 200 };
    const mediaNode = {
      ...createMediaNode(),
      width: 300,
      height: 300,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: 'custom' },
    } as AnyNode;
    const storageWindow = { x: -50, y: -50, width: 300, height: 300 };
    const dataWindowPlan: RendererDataWindowPlan = {
      initialDisplayWindow: { width: 200, height: 200 },
      displayWindow: { width: 200, height: 200 },
      storageWindow,
      nodeWindows: new Map([
        [
          mediaNode.id,
          {
            inputDisplayWindow: { width: 200, height: 200 },
            outputDisplayWindow: { width: 200, height: 200 },
            inputDataWindow: storageWindow,
            outputDataWindow: storageWindow,
            inputStorageWindow: storageWindow,
            outputStorageWindow: storageWindow,
          },
        ],
      ]),
    };
    const { resources } = createResources();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [mediaNode],
      sceneNode,
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
      dataWindowPlan,
    });

    expect(resources.renderTargets).toEqual([
      expect.objectContaining({ width: 300, height: 300 }),
      expect.objectContaining({ width: 300, height: 300 }),
    ]);
    expect(result.finalCompositeTarget).toMatchObject({ width: 200, height: 200 });
    const copyMaterial = resources.materials.get('__viewer:scene-linear-display-window-copy');
    expect((copyMaterial?.uniforms.u_display_res.value as THREE.Vector2).toArray()).toEqual([
      200, 200,
    ]);
    expect((copyMaterial?.uniforms.u_storage_res.value as THREE.Vector2).toArray()).toEqual([
      300, 300,
    ]);
  });

  it('rebuilds stale byte targets at the scene working precision', () => {
    const { resources } = createResources();
    resources.renderTargets.forEach((target) => target.dispose());
    resources.renderTargets = [
      new THREE.WebGLRenderTarget(1920, 1080),
      new THREE.WebGLRenderTarget(1920, 1080),
      new THREE.WebGLRenderTarget(1920, 1080),
    ];
    const staleTargets = [...resources.renderTargets];

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => new THREE.Texture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(result.renderTargets).not.toEqual(staleTargets);
    expect(resources.renderTargets).toBe(result.renderTargets);
    expect(
      result.renderTargets.every((target) => target.texture.type === THREE.HalfFloatType),
    ).toBe(true);
  });

  it('captures display scopes with the same terminal viewer material', () => {
    const { resources } = createResources();
    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      captureDisplayOutput: true,
      getMediaTexture: () => new THREE.Texture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(result.displayOutputTarget).toBe(
      resources.utilityTargets?.get('__viewer:display-output'),
    );
    expect(result.displayOutputTarget).not.toBe(result.finalCompositeTarget);
  });

  it.each([
    ['nearest', 0],
    ['linear', 1],
  ] as const)(
    'presents stabilized output with explicit %s GPU sampling',
    (interpolation, interpolationUniform) => {
      const { renderer, resources } = createResources();
      const inverseTransform = new THREE.Matrix3().set(1.25, 0, -12, 0, 1.25, 8, 0, 0, 1);
      const result = renderViewportFrameWithSharedPipeline({
        resources,
        nodes: [createMediaNode()],
        sceneNode: createSceneNode(),
        frame: 0,
        viewerSettings: createViewerSettings(),
        presentation: {
          inverseTransform,
          destinationSize: { width: 960, height: 540 },
          interpolation,
          pixelGrid: { opacity: 0.1, thresholdZoom: 8, fadeZoomSpan: 1 },
        },
        getMediaTexture: () => new THREE.Texture(),
        getTextTexture: () => undefined,
        nodeRegistry: createRegistry(),
      });

      const material = resources.materials.get('__viewer:presentation');
      expect(material?.uniforms.u_inverse_transform.value).toBe(inverseTransform);
      expect(material?.uniforms.u_source_resolution.value).toEqual(new THREE.Vector2(1920, 1080));
      expect(material?.uniforms.u_destination_resolution.value).toEqual(
        new THREE.Vector2(960, 540),
      );
      expect(material?.uniforms.u_interpolation.value).toBe(interpolationUniform);
      expect(material?.uniforms.u_pixel_grid.value).toEqual(new THREE.Vector3(0.1, 8, 1));
      expect(material?.fragmentShader).toContain('texelFetch(u_tDiffuse, pixel, 0)');
      expect(material?.fragmentShader).toContain('sample_linear(source_pixel, texture_size)');
      expect(material?.fragmentShader).toContain('dFdx(source_pixel.x)');
      expect(material?.fragmentShader).toContain('apply_pixel_grid(sampled_color, source_pixel)');
      expect(result.displayOutputTarget).toBeNull();
      expect(resources.utilityTargets?.has('__viewer:display-output')).toBe(true);
      expect(renderer.lastSetSize).toEqual({ width: 960, height: 540 });
      expect(renderer.renderCalls.at(-1)).toMatchObject({ target: null, material });
    },
  );

  it('captures an offscreen viewer pass without resizing or presenting the canvas', () => {
    const { renderer, resources } = createResources();
    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      captureDisplayOutput: true,
      presentToCanvas: false,
      getMediaTexture: () => new THREE.Texture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(renderer.setSizeCalls).toBe(0);
    expect(
      renderer.renderCalls.filter(({ target }) => target === result.displayOutputTarget),
    ).toHaveLength(1);
    expect(renderer.renderCalls.every(({ target }) => target !== null)).toBe(true);
    expect(renderer.currentTarget).toBeNull();
  });

  it('applies output-gamut warnings in the terminal RGB viewer material', () => {
    const { resources } = createResources();
    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: {
        ...createViewerSettings(),
        gamutWarning: true,
      },
      getMediaTexture: () => new THREE.Texture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const material = resources.quad.material as THREE.ShaderMaterial;
    expect(material.uniforms.u_gamutWarning.value).toBe(true);
    expect(material.fragmentShader).toContain('bool gamut_below');
    expect(material.fragmentShader).toContain('u_gamutWarning && u_channel == 0');
    expect(material.fragmentShader).toContain('vec3(0.0, 0.85, 1.0)');
    expect(material.fragmentShader).toContain('vec3(1.0, 0.0, 0.75)');
  });

  it('rebuilds target pools when discrete data filtering changes', () => {
    const { resources } = createResources();
    const initialTargets = [...resources.renderTargets];

    const dataResult = renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      outputDomain: {
        kind: 'data',
        sourceNodeId: 'id-output',
        sourcePort: 'id',
        semantic: 'id',
      },
      getMediaTexture: () => undefined,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
      colorManagement: testColorManagement,
    });

    expect(dataResult.renderTargets).not.toEqual(initialTargets);
    expect(
      dataResult.renderTargets.every(
        (target) =>
          target.texture.type === THREE.FloatType &&
          target.texture.minFilter === THREE.NearestFilter &&
          target.texture.magFilter === THREE.NearestFilter,
      ),
    ).toBe(true);

    const dataTargets = [...dataResult.renderTargets];
    const colorResult = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [],
      sceneNode: createSceneNode(),
      frame: 1,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => undefined,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    expect(colorResult.renderTargets).not.toEqual(dataTargets);
    expect(
      colorResult.renderTargets.every(
        (target) =>
          target.texture.minFilter === THREE.LinearFilter &&
          target.texture.magFilter === THREE.LinearFilter,
      ),
    ).toBe(true);
  });

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

    expect(result.renderTargets).toHaveLength(2);
    expect(result.renderTargets).toEqual(initialTargets);
    expect(resources.materials.get('global-blur_ds')?.fragmentShader).toContain(
      'texture(u_tDiffuse, v_uv)',
    );
    expect(resources.materials.get('global-blur_blur_h')?.uniforms.u_radius.value).toBe(6);
    expect(resources.materials.get('global-blur_blur_h')?.uniforms).not.toHaveProperty(
      'u_input_premultiplied',
    );
    expect(resources.materials.get('global-blur_blur_v')?.uniforms).not.toHaveProperty(
      'u_output_premultiplied',
    );
    expect(resources.materials.get('global-blur_us')?.fragmentShader).not.toContain(
      'color.rgb /= color.a',
    );
  });

  it('keeps multipass execution identical when compact stack metadata changes', () => {
    const renderMaterialKeys = (stacked: boolean) => {
      const { resources } = createResources();
      const blurNode = {
        ...createBlurNode(false),
        id: 'blur',
        stacked,
      } as unknown as AnyNode;

      const result = renderViewportFrameWithSharedPipeline({
        resources,
        nodes: [createMediaNode(), blurNode],
        sceneNode: createSceneNode(),
        frame: 0,
        viewerSettings: createViewerSettings(),
        getMediaTexture: () => new THREE.Texture(),
        getTextTexture: () => undefined,
        nodeRegistry: createRegistry(),
      });

      expect(result.renderTargets).toHaveLength(2);
      return [...resources.materials.keys()].sort();
    };

    expect(renderMaterialKeys(true)).toEqual(renderMaterialKeys(false));
  });

  it('wraps log-domain effects in explicit scene-to-log and log-to-scene OCIO passes', () => {
    const { renderer, resources } = createResources();
    const getColorSpaceTransform = vi.fn((source: string, destination: string) =>
      createOcioShaderInfo(
        'colorspace',
        `${source}->${destination}`,
        destination === 'ACEScct' ? 'OCIOSceneToLog' : 'OCIOLogToScene',
      ),
    );

    renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [createMediaNode(), createLogGradeNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
      colorManagement: {
        ...testColorManagement,
        logColorSpace: 'ACEScct',
        getColorSpaceTransform,
      },
    });

    expect(getColorSpaceTransform).toHaveBeenCalledWith(SCENE_WORKING_SPACE, 'ACEScct');
    expect(getColorSpaceTransform).toHaveBeenCalledWith('ACEScct', SCENE_WORKING_SPACE);

    const toLogMaterial = resources.materials.get('stacked-grade_scene_to_log');
    const gradeMaterial = resources.materials.get('stacked-grade_log');
    const toSceneMaterial = resources.materials.get('stacked-grade_log_to_scene');

    expect(toLogMaterial?.fragmentShader).toContain('OCIOSceneToLog');
    expect(gradeMaterial?.fragmentShader).toContain('LogGradePass');
    expect(toSceneMaterial?.fragmentShader).toContain('OCIOLogToScene');
    expect(toLogMaterial?.fragmentShader).toContain('fragColor = vec4(transformed.rgb, source.a);');
    expect(toSceneMaterial?.fragmentShader).toContain(
      'fragColor = vec4(transformed.rgb, source.a);',
    );
    expect(renderer.renderCalls.filter(({ material }) => material === toLogMaterial)).toHaveLength(
      1,
    );
    expect(renderer.renderCalls.filter(({ material }) => material === gradeMaterial)).toHaveLength(
      1,
    );
    expect(
      renderer.renderCalls.filter(({ material }) => material === toSceneMaterial),
    ).toHaveLength(1);
  });

  it('rejects log-domain effects when the OCIO log role is unavailable', () => {
    const { resources } = createResources();

    expect(() =>
      renderViewportFrameWithSharedPipelineBase({
        resources,
        nodes: [createMediaNode(), createLogGradeNode()],
        sceneNode: createSceneNode(),
        frame: 0,
        viewerSettings: createViewerSettings(),
        displayView: TEST_DISPLAY_VIEW,
        getMediaTexture: () => createTexture(),
        getTextTexture: () => undefined,
        nodeRegistry: createRegistry(),
        colorManagement: testColorManagement,
      }),
    ).toThrow('requires the OCIO "compositing_log" role');
  });

  it('renders a compacted mask through its canonical pipe input', () => {
    const { renderer, resources } = createResources();
    const maskTexture = createTexture();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createMaskNode(true)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      getRotoMaskLayers: () => [
        {
          texture: maskTexture,
          feather: 0,
          opacity: 1,
          operation: 'add',
        },
      ],
      getRotoAlphaMode: () => 1,
      nodeRegistry: createRegistry(),
    });

    const maskMaterial = resources.materials.get('stacked-roto');
    const maskCall = renderer.renderCalls.find(({ material }) => material === maskMaterial);

    expect(result.renderTargets).toHaveLength(2);
    expect(maskMaterial?.uniforms.u_tMask.value).toBe(maskTexture);
    expect(maskMaterial?.uniforms.u_alphaMode.value).toBe(1);
    expect(maskCall?.target).toBe(result.finalCompositeTarget);
  });

  it('bypasses an alpha-dead Roto with the same pass count as its upstream source', () => {
    const sourceOnly = createResources();
    renderViewportFrameWithSharedPipeline({
      resources: sourceOnly.resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const withBypassedRoto = createResources();
    const getRotoMaskLayers = vi.fn();
    const roto = createMaskNode(true);
    renderViewportFrameWithSharedPipeline({
      resources: withBypassedRoto.resources,
      nodes: [createMediaNode(), roto],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      getRotoMaskLayers,
      getRotoAlphaMode: () => 1,
      bypassNodeIds: new Set([roto.id]),
      nodeRegistry: createRegistry(),
    });

    expect(getRotoMaskLayers).not.toHaveBeenCalled();
    expect(withBypassedRoto.resources.materials.has(roto.id)).toBe(false);
    expect(withBypassedRoto.renderer.renderCalls).toHaveLength(
      sourceOnly.renderer.renderCalls.length,
    );
  });

  it('renders compacted paint through its canonical pipe input', () => {
    const { renderer, resources } = createResources();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createPaintNode(true)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const paintMaterial = resources.materials.get('stacked-paint_paint');
    const paintCall = renderer.renderCalls.find(({ material }) => material === paintMaterial);

    expect(result.renderTargets).toHaveLength(2);
    expect(paintMaterial?.uniforms.u_tDiffuse.value).toBeDefined();
    expect(paintCall?.target).toBe(result.finalCompositeTarget);
  });

  it('applies global paint through the shared adjustment renderer in the viewport path', () => {
    const { resources } = createResources();
    const mediaTexture = createTexture();

    const result = renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode(), createPaintNode(false)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => mediaTexture,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const paintMaterial = resources.materials.get('global-paint_paint');

    expect(result.renderTargets).toHaveLength(2);
    expect(paintMaterial?.uniforms.u_tDiffuse.value).toBeDefined();
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
    const mergeMaterial = resources.materials.get('merge_merge_comp_straight_over');

    expect(result.renderTargets).toHaveLength(2);
    expect(pipeTarget).toBeDefined();
    expect(sourceTarget).toBeDefined();
    expect(mergeMaterial?.uniforms.u_tBackdrop.value).toBe(pipeTarget?.texture);
    expect(mergeMaterial?.uniforms.u_tDiffuse.value).toBe(sourceTarget?.texture);
    expectSceneCompositeShaderPreservesRgbRange(mergeMaterial);
  });

  it('resolves RGBA and Alpha/Mask as the only Masked Merge viewport inputs', () => {
    const { resources } = createResources();
    const textures = new Map([
      ['rgba', createTexture()],
      ['mask', createTexture()],
    ]);

    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [
        createMediaNodeWithId('rgba', 'rgba-asset'),
        createMediaNodeWithId('mask', 'mask-asset'),
        createMaskedMergeNode(),
      ],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: (node) => textures.get(node.id),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const rgbaTarget = resources.utilityTargets?.get('rgba:output');
    const maskTarget = resources.utilityTargets?.get('mask:output');
    const material = resources.materials.get('masked-merge:masked-merge');

    expect(material?.uniforms.u_tSource.value).toBe(rgbaTarget?.texture);
    expect(material?.uniforms.u_tMask.value).toBe(maskTarget?.texture);
    expect(material?.uniforms.u_hasMask.value).toBe(true);
    expect(material?.uniforms.u_maskChannel.value).toBe(3);
    expect(material?.uniforms.u_alphaOperation.value).toBe(0);
    expect(material?.uniforms.u_mix.value).toBe(1);
    expect(material?.fragmentShader).toContain('fragColor = vec4(source.rgb, outputAlpha)');
    expect(material?.blending).toBe(THREE.NoBlending);
  });

  it('resolves merge output as the input texture of a downstream node', () => {
    const { resources } = createResources();
    const downstreamBlur = {
      ...createBlurNode(false),
      id: 'downstream-blur',
      inputs: { pipe: 'merge' },
    } as AnyNode;

    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [
        createMediaNodeWithId('pipe', 'pipe-asset'),
        createMediaNodeWithId('source', 'source-asset'),
        createMergeNode(),
        downstreamBlur,
      ],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
    });

    const mergeTarget = resources.utilityTargets?.get('merge:output');
    const downstreamInputMaterial = resources.materials.get('downstream-blur_ds');

    expect(mergeTarget).toBeDefined();
    expect(downstreamInputMaterial?.uniforms.u_tDiffuse.value).toBe(mergeTarget?.texture);
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

    expect(result.renderTargets).toHaveLength(2);
    expect(utilityTarget).toBeDefined();
    expect(utilityMaterial?.uniforms.u_tDiffuse.value).toBe(utilityTarget?.texture);
  });

  it('uses compacted mask output as the export final input', async () => {
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
      getRotoMaskLayers: () => [
        {
          texture: maskTexture,
          feather: 0,
          opacity: 1,
          operation: 'add',
        },
      ],
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
      getRotoMaskLayers: () => [
        {
          texture: maskTexture,
          feather: 0,
          opacity: 1,
          operation: 'add',
        },
      ],
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

  it('decodes resolved source frames and skips transparent-black range extensions', async () => {
    const registry = createRegistry();
    const mediaDefinition = registry.get(NodeType.MEDIA_SOURCE);
    if (!mediaDefinition?.mediaDescriptor) throw new Error('Media descriptor is required');
    mediaDefinition.mediaDescriptor = {
      ...mediaDefinition.mediaDescriptor,
      resolveFrame: (_node, frame) => (frame < 1002 ? null : frame - 1002),
    };

    const decodedFrames: number[] = [];
    const getAsset = vi.fn(async () => new Blob(['asset']));
    const renderFrame = (frame: number) =>
      renderWithSharedPipeline({
        renderer: new MockRenderer() as unknown as THREE.WebGLRenderer,
        nodes: [createMediaNode()],
        sceneNode: createSceneNode(),
        frame,
        width: 1920,
        height: 1080,
        finalColorSpace: 'raw_texture',
        getAsset,
        nodeRegistry: registry,
        loadAssetTexture: async ({ frame: sourceFrame }) => {
          decodedFrames.push(sourceFrame);
          return createTexture();
        },
      });

    const inRangeResult = await renderFrame(1004);
    inRangeResult.dispose();
    expect(decodedFrames).toEqual([2]);

    getAsset.mockClear();
    const blackResult = await renderFrame(1001);
    blackResult.dispose();
    expect(getAsset).not.toHaveBeenCalled();
    expect(decodedFrames).toEqual([2]);
  });

  it('uses the same display/view processor path for viewport and export', async () => {
    const viewerSettings = createViewerSettings();
    const displayRequests: Array<{
      source: string | undefined;
      display: string | undefined;
      view: string | undefined;
      look: string | undefined;
    }> = [];
    const colorManagement: RendererColorManagement = {
      ...testColorManagement,
      getDisplayViewTransform: (source, display, view, look) => {
        displayRequests.push({ source, display, view, look });
        return createOcioShaderInfo('display', `${source}->${display}/${view}`, 'OCIODisplay');
      },
    };

    const { resources } = createResources();
    renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings,
      displayView: TEST_DISPLAY_VIEW,
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
      colorManagement,
    });

    const exportRenderer = new MockRenderer();
    const result = await renderWithSharedPipelineBase({
      renderer: exportRenderer as unknown as THREE.WebGLRenderer,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'match_viewport',
      viewerSettings,
      displayView: TEST_DISPLAY_VIEW,
      getAsset: async () => new Blob(['asset']),
      nodeRegistry: createRegistry(),
      loadAssetTexture: async () => createTexture(),
      colorManagement,
    });

    try {
      const expectedRequest = {
        source: SCENE_WORKING_SPACE,
        display: TEST_DISPLAY_VIEW.display,
        view: TEST_DISPLAY_VIEW.view,
        look: TEST_DISPLAY_VIEW.look,
      };
      expect(displayRequests).toEqual([expectedRequest, expectedRequest]);

      const viewportMaterial = resources.materials.get('viewer');
      const exportMaterial = exportRenderer.renderCalls
        .map(({ material }) => material)
        .find(
          (material): material is THREE.ShaderMaterial =>
            material instanceof THREE.ShaderMaterial &&
            material.fragmentShader.includes('OCIODisplay'),
        );

      expect(viewportMaterial?.fragmentShader).toBe(exportMaterial?.fragmentShader);
      expect(viewportMaterial?.uniforms.u_gain.value).toBe(viewerSettings.gain);
      expect(exportMaterial?.uniforms.u_gain.value).toBe(viewerSettings.gain);
    } finally {
      result.dispose();
    }
  });

  it('keeps viewport intermediates scene-linear and applies the display transform once', () => {
    const displayTransform = createOcioShaderInfo('display', 'scene-to-display', 'OCIODisplayOnce');
    const getDisplayViewTransform = vi.fn(() => displayTransform);
    const colorManagement: RendererColorManagement = {
      ...testColorManagement,
      getDisplayViewTransform,
    };
    const { renderer, resources } = createResources();

    const result = renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [createMediaNode(), createBlurNode(false)],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      getMediaTexture: () => createTexture(),
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
      colorManagement,
    });

    const displayCalls = renderer.renderCalls.filter(({ material }) =>
      (material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes('OCIODisplayOnce'),
    );

    expect(getDisplayViewTransform).toHaveBeenCalledOnce();
    expect(displayCalls).toHaveLength(1);
    expect(displayCalls[0]?.target).toBeNull();
    expect(displayCalls[0]?.material).toBe(resources.materials.get('viewer'));
    expect(result.finalCompositeTarget).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(result.finalCompositeTarget?.texture.type).toBe(THREE.HalfFloatType);
    expect(result.finalCompositeTarget?.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(resources.materials.get('viewer')?.uniforms.u_tDiffuse.value).toBe(
      result.finalCompositeTarget?.texture,
    );
    expect(
      renderer.renderCalls
        .filter(({ target }) => target !== null)
        .every(
          ({ material }) =>
            !(material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes(
              'OCIODisplayOnce',
            ),
        ),
    ).toBe(true);
  });

  it('keeps export intermediates scene-linear and applies the display transform once', async () => {
    const displayTransform = createOcioShaderInfo('display', 'scene-to-display', 'OCIODisplayOnce');
    const getDisplayViewTransform = vi.fn(() => displayTransform);
    const colorManagement: RendererColorManagement = {
      ...testColorManagement,
      getDisplayViewTransform,
    };
    const renderer = new MockRenderer();
    const result = await renderWithSharedPipelineBase({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      nodes: [createMediaNode(), createBlurNode(false)],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'match_viewport',
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      captureFinalOutput: true,
      presentToCanvas: false,
      getAsset: async () => new Blob(['asset']),
      nodeRegistry: createRegistry(),
      loadAssetTexture: async () => createTexture(),
      colorManagement,
    });

    try {
      const displayCalls = renderer.renderCalls.filter(({ material }) =>
        (material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes('OCIODisplayOnce'),
      );

      expect(getDisplayViewTransform).toHaveBeenCalledOnce();
      expect(displayCalls).toHaveLength(1);
      expect(displayCalls[0]?.target).toBe(result.finalOutputTarget);
      expect(result.finalOutputTarget?.texture.type).toBe(THREE.HalfFloatType);
      expect(result.finalOutputTarget?.texture.colorSpace).toBe(THREE.NoColorSpace);
      expect(
        renderer.renderCalls
          .filter(({ target }) => target !== result.finalOutputTarget)
          .every(
            ({ material }) =>
              !(material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes(
                'OCIODisplayOnce',
              ),
          ),
      ).toBe(true);
    } finally {
      result.dispose();
    }
  });

  it('uses dedicated terminal paths for direct encoding, scene-linear conversion, and passthrough', async () => {
    const directEncodingTransform = createOcioShaderInfo(
      'colorspace',
      'scene-to-srgb',
      'OCIODirectEncoding',
    );
    const getColorSpaceTransform = vi.fn(() => directEncodingTransform);
    const getDisplayViewTransform = vi.fn(() => null);
    const colorManagement: RendererColorManagement = {
      ...testColorManagement,
      getColorSpaceTransform,
      getDisplayViewTransform,
    };
    const directRenderer = new MockRenderer();
    const directResult = await renderWithSharedPipelineBase({
      renderer: directRenderer as unknown as THREE.WebGLRenderer,
      nodes: [],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'srgb',
      outputColorSpace: 'Output - sRGB',
      captureFinalOutput: true,
      presentToCanvas: false,
      getAsset: async () => null,
      nodeRegistry: createRegistry(),
      colorManagement,
    });

    try {
      const directOutputCalls = directRenderer.renderCalls.filter(({ material }) =>
        (material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes(
          'OCIODirectEncoding',
        ),
      );

      expect(getColorSpaceTransform).toHaveBeenCalledOnce();
      expect(getColorSpaceTransform).toHaveBeenCalledWith(SCENE_WORKING_SPACE, 'Output - sRGB');
      expect(getDisplayViewTransform).not.toHaveBeenCalled();
      expect(directOutputCalls).toHaveLength(1);
      expect(directOutputCalls[0]?.target).toBe(directResult.finalOutputTarget);
      expect((directOutputCalls[0]?.material as THREE.ShaderMaterial).uniforms.u_gain.value).toBe(
        1,
      );
      expect(
        (directOutputCalls[0]?.material as THREE.ShaderMaterial).uniforms.u_ignoreAlpha.value,
      ).toBe(false);
    } finally {
      directResult.dispose();
    }

    getColorSpaceTransform.mockClear();
    const acesCgRenderer = new MockRenderer();
    const acesCgResult = await renderWithSharedPipelineBase({
      renderer: acesCgRenderer as unknown as THREE.WebGLRenderer,
      nodes: [],
      sceneNode: { ...createSceneNode(), colorSpace: 'Linear Rec.709' },
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'color_space',
      outputColorSpace: 'ACEScg',
      captureFinalOutput: true,
      presentToCanvas: false,
      getAsset: async () => null,
      nodeRegistry: createRegistry(),
      colorManagement,
    });

    try {
      const acesCgOutputCalls = acesCgRenderer.renderCalls.filter(({ material }) =>
        (material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes(
          'OCIODirectEncoding',
        ),
      );
      const outputMaterial = acesCgOutputCalls[0]?.material as THREE.ShaderMaterial;

      expect(getColorSpaceTransform).toHaveBeenCalledOnce();
      expect(getColorSpaceTransform).toHaveBeenCalledWith('Linear Rec.709', 'ACEScg');
      expect(getDisplayViewTransform).not.toHaveBeenCalled();
      expect(acesCgOutputCalls).toHaveLength(1);
      expect(acesCgOutputCalls[0]?.target).toBe(acesCgResult.finalOutputTarget);
      expect(outputMaterial.fragmentShader).toContain(
        'fragColor = vec4(transformed.rgb, source.a);',
      );
      expect(outputMaterial.fragmentShader).not.toContain('clamp(');
      expect(outputMaterial.uniforms).not.toHaveProperty('u_gain');
      expect(outputMaterial.uniforms).not.toHaveProperty('u_gamma');
    } finally {
      acesCgResult.dispose();
    }

    getColorSpaceTransform.mockClear();
    const linearRenderer = new MockRenderer();
    const linearResult = await renderWithSharedPipelineBase({
      renderer: linearRenderer as unknown as THREE.WebGLRenderer,
      nodes: [],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'scene_linear',
      captureFinalOutput: true,
      presentToCanvas: false,
      getAsset: async () => null,
      nodeRegistry: createRegistry(),
      colorManagement,
    });

    try {
      expect(getColorSpaceTransform).not.toHaveBeenCalled();
      expect(getDisplayViewTransform).not.toHaveBeenCalled();
      expect(
        linearRenderer.renderCalls.every(
          ({ material }) =>
            !(material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes('OCIO'),
        ),
      ).toBe(true);
    } finally {
      linearResult.dispose();
    }
  });

  it('captures multiple full-float node output ports in one pipeline execution', async () => {
    const renderer = new MockRenderer();
    const extract = {
      id: 'extract',
      type: NodeType.EXTRACT_CHANNELS,
      name: 'Extract Channels',
      enabled: true,
    } as AnyNode;
    const result = await renderWithSharedPipelineBase({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      nodes: [],
      captureSourceNodes: [extract],
      captureOutputs: [
        { id: 'red', nodeId: extract.id, sourcePort: 'r' },
        { id: 'alpha', nodeId: extract.id, sourcePort: 'a' },
      ],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'raw_texture',
      presentToCanvas: false,
      getAsset: async () => null,
      nodeRegistry: createRegistry(),
      colorManagement: testColorManagement,
    });

    try {
      expect([...result.capturedOutputTargets.keys()]).toEqual(['red', 'alpha']);
      expect(result.capturedOutputTargets.get('red')?.texture.type).toBe(THREE.FloatType);
      expect(result.capturedOutputTargets.get('alpha')?.texture.type).toBe(THREE.FloatType);
      expect(result.capturedOutputTargets.get('red')).not.toBe(
        result.capturedOutputTargets.get('alpha'),
      );
    } finally {
      result.dispose();
    }
  });

  it.each([
    ['PNG/JPEG texture', TEXTURE_PAINT_SPACE],
    ['ACEScg', SCENE_WORKING_SPACE],
    ['ACES2065-1', 'ACES2065-1'],
    ['linear Rec.709', 'Linear Rec.709 (sRGB)'],
    ['camera log', 'ARRI Wide Gamut 4 LogC4'],
  ])(
    'routes %s media from its assigned source space into ACEScg before compositing',
    async (_, sourceColorSpace) => {
      const renderer = new MockRenderer();
      const transformRequests: Array<{
        source: string | undefined;
        destination: string | undefined;
      }> = [];
      const colorManagement: RendererColorManagement = {
        ...testColorManagement,
        resolveColorSpaceName: (value) => value ?? TEXTURE_PAINT_SPACE,
        getColorSpaceTransform: (source, destination) => {
          transformRequests.push({ source, destination });
          if (source === destination) return null;
          return createOcioShaderInfo('colorspace', `${source}->${destination}`, 'OCIOInput');
        },
      };
      const registry = createRegistry();
      const mediaDefinition = registry.get(NodeType.MEDIA_SOURCE);
      if (mediaDefinition?.mediaDescriptor) {
        mediaDefinition.mediaDescriptor = {
          ...mediaDefinition.mediaDescriptor,
          getColorSpace: () => sourceColorSpace,
        };
      }

      const result = await renderWithSharedPipelineBase({
        renderer: renderer as unknown as THREE.WebGLRenderer,
        nodes: [createMediaNode()],
        sceneNode: createSceneNode(),
        frame: 0,
        width: 1920,
        height: 1080,
        finalColorSpace: 'raw_texture',
        getAsset: async () => new Blob(['asset']),
        nodeRegistry: registry,
        loadAssetTexture: async () => createTexture(),
        colorManagement,
      });

      try {
        expect(transformRequests).toEqual([
          {
            source: sourceColorSpace,
            destination: SCENE_WORKING_SPACE,
          },
        ]);

        const mediaMaterial = renderer.renderCalls
          .map(({ material }) => material)
          .find(
            (material): material is THREE.ShaderMaterial =>
              material instanceof THREE.ShaderMaterial &&
              material.fragmentShader.includes('OCIOInput'),
          );

        if (sourceColorSpace === SCENE_WORKING_SPACE) {
          expect(mediaMaterial).toBeUndefined();
        } else {
          expect(mediaMaterial?.fragmentShader).toContain('float ocioSourceAlpha = src.a;');
          expect(mediaMaterial?.fragmentShader).toContain('src = OCIOInput(src);');
          expect(mediaMaterial?.fragmentShader).toContain('src.a = ocioSourceAlpha;');
        }
      } finally {
        result.dispose();
      }
    },
  );

  it('applies a generated-output difference mask in the media compositor', async () => {
    const renderer = new MockRenderer();
    const outputTexture = createTexture();
    const referenceTexture = createTexture();
    const registry = createRegistry();
    const mediaDefinition = registry.get(NodeType.MEDIA_SOURCE);
    if (!mediaDefinition?.mediaDescriptor) throw new Error('Media descriptor is required');
    mediaDefinition.mediaDescriptor = {
      ...mediaDefinition.mediaDescriptor,
      getAssetIds: () => ['output_asset', 'reference_asset'],
      getCompositeLayers: () => [
        {
          id: 'generated_output',
          textureKey: 'output_asset',
          assetId: 'output_asset',
          width: 1920,
          height: 1080,
          differenceMask: {
            textureKey: 'reference_asset',
            assetId: 'reference_asset',
            width: 1920,
            height: 1080,
            thresholdLow: 0.06,
            thresholdHigh: 0.18,
            comparisonBlur: 1.25,
            edgeAdjustment: 4,
            removeSpecks: 3,
            fillHoles: 6,
            morphologyShape: 'round',
            previewMode: 'overlay',
          },
        },
      ],
    };

    const result = await renderWithSharedPipeline({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'raw_texture',
      getAsset: async () => new Blob(['asset']),
      nodeRegistry: registry,
      loadAssetTexture: async ({ assetId }) =>
        assetId === 'reference_asset' ? referenceTexture : outputTexture,
    });

    try {
      const differenceMaterial = renderer.renderCalls
        .map(({ material }) => material)
        .find(
          (material): material is THREE.ShaderMaterial =>
            materialWithUniform(material, 'u_tDifferenceReference') &&
            material.uniforms.u_tDifferenceReference.value === referenceTexture,
        );

      expect(differenceMaterial?.uniforms.u_tDiffuse.value).toBe(outputTexture);
      expect(differenceMaterial?.uniforms.u_difference_low.value).toBe(0.06);
      expect(differenceMaterial?.uniforms.u_difference_high.value).toBe(0.18);
      expect(differenceMaterial?.uniforms.u_difference_comparison_blur.value).toBe(1.25);
      expect(differenceMaterial?.fragmentShader).toContain('float sampleDifference');
      expect(differenceMaterial?.fragmentShader).toContain('float perceptualImageDifference');

      const morphologyPasses = renderer.renderCalls.filter(({ material }) =>
        materialWithUniform(material, 'u_operation'),
      );
      expect(morphologyPasses).toHaveLength(20);

      const compositeMaterial = renderer.renderCalls
        .map(({ material }) => material)
        .find((material) => materialWithUniform(material, 'u_tDifferenceMask'));
      expect(compositeMaterial?.uniforms.u_difference_preview_mode.value).toBe(0);
      expect(compositeMaterial?.fragmentShader).toContain('src.a *= u_opacity * difference_alpha;');
    } finally {
      result.dispose();
    }

    const { renderer: viewportRenderer, resources } = createResources();
    renderViewportFrameWithSharedPipeline({
      resources,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      getMediaTexture: () => outputTexture,
      getMediaTextureByKey: (key) => (key === 'reference_asset' ? referenceTexture : outputTexture),
      getTextTexture: () => undefined,
      nodeRegistry: registry,
    });

    const viewportDifferenceMaterial = [...resources.materials.values()].find(
      (material) => material.uniforms.u_tDifferenceReference?.value === referenceTexture,
    );
    expect(viewportDifferenceMaterial?.fragmentShader).toContain('float sampleDifference');
    expect(
      viewportRenderer.renderCalls.filter(({ material }) =>
        materialWithUniform(material, 'u_operation'),
      ),
    ).toHaveLength(20);
    const viewportCompositeMaterial = [...resources.materials.values()].find(
      (material) => material.uniforms.u_tDifferenceMask,
    );
    expect(viewportCompositeMaterial?.uniforms.u_difference_preview_mode.value).toBe(1);
    expect(
      [...(resources.utilityTargets?.keys() ?? [])].filter((key) =>
        key.includes('media-composite:difference-mask:'),
      ),
    ).toHaveLength(2);
  });

  it('bypasses OCIO RGB transforms for explicitly tagged data media', async () => {
    const renderer = new MockRenderer();
    const mediaTexture = createTexture();
    const getDisplayViewTransform = vi.fn(() =>
      createOcioShaderInfo('display', 'data-display', 'OCIODataDisplay'),
    );
    const transformRequests: Array<{
      source: string | undefined;
      destination: string | undefined;
    }> = [];
    const colorManagement: RendererColorManagement = {
      ...testColorManagement,
      resolveColorSpaceName: (value) => value ?? TEXTURE_PAINT_SPACE,
      getColorSpaceTransform: (source, destination) => {
        transformRequests.push({ source, destination });
        return createOcioShaderInfo('colorspace', `${source}->${destination}`, 'OCIOInput');
      },
      getDisplayViewTransform,
    };
    const registry = createRegistry();
    const mediaDefinition = registry.get(NodeType.MEDIA_SOURCE);
    if (mediaDefinition?.mediaDescriptor) {
      mediaDefinition.mediaDescriptor = {
        ...mediaDefinition.mediaDescriptor,
        getColorSpace: () => TEXTURE_PAINT_SPACE,
        isData: () => true,
      };
    }

    const result = await renderWithSharedPipelineBase({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      nodes: [createMediaNode()],
      sceneNode: createSceneNode(),
      frame: 0,
      width: 1920,
      height: 1080,
      finalColorSpace: 'match_viewport',
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      outputDomain: {
        kind: 'data',
        sourceNodeId: 'media',
        sourcePort: 'output',
        semantic: 'depth',
      },
      getAsset: async () => new Blob(['asset']),
      nodeRegistry: registry,
      loadAssetTexture: async () => mediaTexture,
      colorManagement,
    });

    try {
      expect(transformRequests).toEqual([]);
      expect(getDisplayViewTransform).not.toHaveBeenCalled();

      const mediaMaterial = renderer.renderCalls
        .map(({ material }) => material)
        .find(
          (material): material is THREE.ShaderMaterial =>
            material instanceof THREE.ShaderMaterial &&
            material.uniforms.u_tDiffuse?.value === mediaTexture,
        );

      expect(mediaMaterial?.fragmentShader).not.toContain('OCIOInput');
      expect(mediaMaterial?.fragmentShader).not.toContain('float ocioSourceAlpha = src.a;');
    } finally {
      result.dispose();
    }

    const { renderer: viewportRenderer, resources } = createResources();
    renderViewportFrameWithSharedPipelineBase({
      resources,
      nodes: [],
      sceneNode: createSceneNode(),
      frame: 0,
      viewerSettings: createViewerSettings(),
      displayView: TEST_DISPLAY_VIEW,
      outputDomain: {
        kind: 'data',
        sourceNodeId: 'extract',
        sourcePort: 'a',
        semantic: 'alpha',
      },
      getMediaTexture: () => undefined,
      getTextTexture: () => undefined,
      nodeRegistry: createRegistry(),
      colorManagement,
    });

    expect(getDisplayViewTransform).not.toHaveBeenCalled();
    expect((resources.quad.material as THREE.ShaderMaterial).fragmentShader).toContain(
      'fragColor = vec4(display_value, 1.0);',
    );
    expect((resources.quad.material as THREE.ShaderMaterial).uniforms.u_channel.value).toBe(3);
    expect(
      viewportRenderer.renderCalls.some(({ material }) =>
        (material as THREE.ShaderMaterial | undefined)?.fragmentShader.includes('OCIODataDisplay'),
      ),
    ).toBe(false);
  });
});
