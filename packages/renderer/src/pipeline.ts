import * as THREE from 'three';
import {
  configureRawStraightAlphaTexture,
  configureStraightAlphaTexture,
  STRAIGHT_ALPHA_OVER_GLSL,
} from './alpha';
import {
  type AnimatableNumber,
  type AnyNode,
  BlendMode,
  type DisplayViewSelection,
  type RenderOutputDomain,
  type ImageSequenceNode,
  type MediaSourceNode,
  type SceneNode,
  type TextNode,
  type ViewerSettings,
} from '@blackboard/types';
import type {
  RendererMediaCompositeLayer,
  ShaderUniformMap,
  RenderContext,
  RenderMode,
  NodeRegistryLike,
  RendererInputPort,
  RendererColorManagement,
  RendererOcioGpuTexture,
  RendererOcioGpuUniform,
  RendererOcioShaderInfo,
  RendererMaskLayer,
  RendererDifferenceMaskLayer,
  ResolveOutputContext,
} from './types';
import { RendererShader } from './glsl';
import {
  getDifferenceMaskMorphologyPasses,
  MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS,
  PERCEPTUAL_DIFFERENCE_GLSL,
} from './differenceMask';
import { getValueAtFrame } from './animation';
import { createNodePredicates } from './nodePredicates';
import {
  assertRendererProcessingDomainsSupported,
  resolveRendererNodeProcessingDomain,
} from './processingDomains';
import {
  assertFloatRenderTargetSupport,
  assertWebGL2Renderer,
  createStudioRenderer,
  StudioShaderMaterialCache,
} from './webgl';

type MediaNode = MediaSourceNode | ImageSequenceNode;

// ---------------------------------------------------------------------------
// Node-specific shaders — handled by the generic shader/warp multipass paths
// in renderAdjustmentNodeToTarget. Paint and mask rendering is done via
// renderOutput on the node definitions.
// ---------------------------------------------------------------------------

const VIEWER_CHANNELS: ViewerSettings['channels'][] = ['RGB', 'R', 'G', 'B', 'A'];
const CHANNEL_PORTS = ['r', 'g', 'b', 'a'] as const;
type ChannelPort = (typeof CHANNEL_PORTS)[number];
const SOURCE_ALPHA_MODE_UNIFORM = {
  file: 0,
  opaque: 1,
  transparent: 2,
} as const;

interface AlphaOverlayStyle {
  color: [number, number, number];
  opacity: number;
  bgDarken: number;
}

const DEFAULT_ALPHA_OVERLAY_STYLE: AlphaOverlayStyle = {
  color: [0.176, 0.831, 0.749],
  opacity: 0.35,
  bgDarken: 0,
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const resolveAlphaOverlayStyle = (style?: AlphaOverlayStyle): AlphaOverlayStyle => {
  const sourceColor = style?.color ?? DEFAULT_ALPHA_OVERLAY_STYLE.color;
  return {
    color: [clampUnit(sourceColor[0]), clampUnit(sourceColor[1]), clampUnit(sourceColor[2])],
    opacity: clampUnit(style?.opacity ?? DEFAULT_ALPHA_OVERLAY_STYLE.opacity),
    bgDarken: clampUnit(style?.bgDarken ?? DEFAULT_ALPHA_OVERLAY_STYLE.bgDarken),
  };
};

const persistentTextureCache = new Map<string, THREE.Texture>();
let transparentInputTexture: THREE.DataTexture | null = null;

const getTransparentInputTexture = (): THREE.Texture => {
  if (!transparentInputTexture) {
    transparentInputTexture = configureStraightAlphaTexture(
      new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat),
    );
    transparentInputTexture.minFilter = THREE.NearestFilter;
    transparentInputTexture.magFilter = THREE.NearestFilter;
    transparentInputTexture.generateMipmaps = false;
    transparentInputTexture.needsUpdate = true;
  }

  return transparentInputTexture;
};

// ---------------------------------------------------------------------------
// Registry-aware media helpers — these use the effect registry's flags and
// media descriptors to drive behaviour, eliminating hardcoded type checks.
// ---------------------------------------------------------------------------

/**
 * Check if a node's type has the `isMediaNode` flag in the registry.
 */
const isMediaNodeWithRegistry = (node: AnyNode, reg: NodeRegistryLike): node is MediaNode => {
  const def = reg.get(node.type);
  return !!def?.flags?.isMediaNode;
};

// ---------------------------------------------------------------------------
// Node render properties — typed extraction replacing `(node as any).*`
// ---------------------------------------------------------------------------

interface NodeBlendProps {
  opacity: AnimatableNumber;
  operator: BlendMode;
}

/**
 * Extract blend-related properties (opacity and operator) from a node in a
 * type-safe way. Only node types that declare both `opacity` and `operator`
 * (MediaSource, ImageSequence, Text, Merge, Comfy, OnnxModel) return their
 * stored values. All other node types return defaults (opacity=100, OVER).
 *
 * Replaces the `(node as any).opacity` / `(node as any).operator` pattern.
 */
const getNodeBlendProps = (node: AnyNode): NodeBlendProps => {
  if ('opacity' in node && 'operator' in node) {
    return { opacity: node.opacity, operator: node.operator };
  }
  return { opacity: 100, operator: BlendMode.OVER };
};

export interface RenderPipelineOptions {
  nodes: AnyNode[];
  sceneNode: SceneNode;
  frame?: number;
  width: number;
  height: number;
  blurRadiusScale?: number;
  finalColorSpace: 'raw_texture' | 'scene_linear' | 'color_space' | 'srgb' | 'match_viewport';
  outputColorSpace?: string;
  outputDomain?: RenderOutputDomain;
  captureOutputs?: readonly RenderOutputCaptureRequest[];
  captureSourceNodes?: readonly AnyNode[];
  viewerSettings?: ViewerSettings;
  displayView?: DisplayViewSelection;
  alphaOverlayStyle?: AlphaOverlayStyle;
  colorManagement: RendererColorManagement;
  textureCacheMode?: 'none' | 'persistent';
  canvas?: HTMLCanvasElement;
  /** When provided, this renderer is reused instead of creating (and disposing) a new one. */
  renderer?: THREE.WebGLRenderer;
  /** When false, skips the final blit to the renderer canvas for readback-only workflows. */
  presentToCanvas?: boolean;
  /** When true, keeps internally created renderers alive after dispose() for caller reuse. */
  keepRendererAlive?: boolean;
  /**
   * When true, preserves the final color-managed output in an offscreen render target
   * before presenting to the canvas. Useful for high-precision readback workflows.
   */
  captureFinalOutput?: boolean;
  /** Preserve source alpha in final display conversion, even when viewport settings flatten it. */
  preserveAlpha?: boolean;
  nodeRegistry: NodeRegistryLike;
  getAsset: (id: string) => Promise<Blob | null>;
  getRotoMaskLayers?: (nodeId: string) => readonly RendererMaskLayer[] | undefined;
  getRotoAlphaMode?: (nodeId: string) => number;
  loadAssetTexture?: (params: {
    assetId: string;
    blob: Blob;
    node: AnyNode;
    frame: number;
  }) => Promise<THREE.Texture | null>;
}

export interface RenderOutputCaptureRequest {
  id: string;
  nodeId: string;
  sourcePort: string;
}

export interface RenderPipelineResult {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  finalOutputTarget: THREE.WebGLRenderTarget | null;
  capturedOutputTargets: ReadonlyMap<string, THREE.WebGLRenderTarget>;
  dispose: () => void;
}

export const getSceneRenderTargetOptions = (
  sceneNode: Pick<SceneNode, 'bitDepth'>,
): THREE.RenderTargetOptions => {
  // Compositing is always floating point. An 8-bit scene describes delivery
  // precision, not an 8-bit working buffer; quantizing every node creates
  // visible banding and destroys values outside display range.
  const targetType = sceneNode.bitDepth === 32 ? THREE.FloatType : THREE.HalfFloatType;

  return {
    type: targetType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  };
};

export const getRenderTargetOptionsForOutput = (
  sceneNode: Pick<SceneNode, 'bitDepth'>,
  outputDomain?: RenderOutputDomain,
): THREE.RenderTargetOptions => {
  const options = getSceneRenderTargetOptions(sceneNode);
  if (outputDomain?.kind !== 'data') return options;
  const discrete = outputDomain.semantic === 'id' || outputDomain.semantic === 'cryptomatte';
  return {
    ...options,
    type: THREE.FloatType,
    ...(discrete ? { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } : {}),
  };
};

const getDataViewerChannel = (domain: RenderOutputDomain): number => {
  if (domain.kind !== 'data') return -1;

  const portChannel = CHANNEL_PORTS.indexOf(domain.sourcePort.toLowerCase() as ChannelPort);
  if (portChannel >= 0) return portChannel;
  if (domain.semantic === 'alpha' || domain.semantic === 'mask') return 3;
  if (
    domain.semantic === 'normal' ||
    domain.semantic === 'motion_vector' ||
    domain.semantic === 'uv' ||
    domain.semantic === 'position'
  ) {
    return -1;
  }
  return domain.semantic ? 0 : -1;
};

const clearRenderTargetTransparent = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget | null,
): void => {
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setClearColor(previousClearColor, previousClearAlpha);
};

interface RenderFormatSize {
  width: number;
  height: number;
}

const renderTargetMatchesOptions = (
  target: THREE.WebGLRenderTarget,
  options: THREE.RenderTargetOptions,
): boolean =>
  target.texture.type === options.type &&
  target.texture.format === options.format &&
  target.texture.minFilter === options.minFilter &&
  target.texture.magFilter === options.magFilter;

const getPositiveIntegerDimension = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value));
};

const normalizeRenderFormatSize = (
  size: RenderFormatSize | null | undefined,
): RenderFormatSize | null => {
  const width = getPositiveIntegerDimension(size?.width);
  const height = getPositiveIntegerDimension(size?.height);
  return width && height ? { width, height } : null;
};

const getInitialSceneSize = (
  nodes: AnyNode[],
  nodeRegistry: NodeRegistryLike,
  fallback: RenderFormatSize,
): RenderFormatSize => {
  for (const node of nodes) {
    if (node.enabled === false) continue;
    const size = normalizeRenderFormatSize(
      nodeRegistry.get(node.type)?.sceneSize?.getInputSize?.(node, fallback),
    );
    if (size) return size;
  }
  return fallback;
};

const getNodeOutputSceneSize = (
  node: AnyNode,
  nodeRegistry: NodeRegistryLike,
  context: RenderContext,
): RenderFormatSize | null =>
  normalizeRenderFormatSize(nodeRegistry.get(node.type)?.sceneSize?.getOutputSize?.(node, context));

const getScaledRenderTargetSize = (
  logicalSize: RenderFormatSize,
  renderScale: RenderFormatSize,
): RenderFormatSize => ({
  width: Math.max(1, Math.round(logicalSize.width * renderScale.width)),
  height: Math.max(1, Math.round(logicalSize.height * renderScale.height)),
});

const ensureRenderTargetSize = (
  target: THREE.WebGLRenderTarget,
  logicalSize: RenderFormatSize,
  renderScale: RenderFormatSize,
): void => {
  const physicalSize = getScaledRenderTargetSize(logicalSize, renderScale);
  if (target.width !== physicalSize.width || target.height !== physicalSize.height) {
    target.setSize(physicalSize.width, physicalSize.height);
  }
};

// ---------------------------------------------------------------------------
// Registry-aware texture key and asset ID helpers
// ---------------------------------------------------------------------------

/**
 * Get the media texture key for a node using the registry's media descriptor.
 */
const getMediaTextureKeyFromRegistry = (
  node: AnyNode,
  frame: number,
  reg: NodeRegistryLike,
): string | null => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.getMediaTextureKey?.(node, frame) || null;
};

const resolveMediaFrameFromRegistry = (
  node: AnyNode,
  frame: number,
  reg: NodeRegistryLike,
): number | null => {
  const resolveFrame = reg.get(node.type)?.mediaDescriptor?.resolveFrame;
  return resolveFrame ? resolveFrame(node, frame) : frame;
};

const getMediaCompositeLayersFromRegistry = (
  node: AnyNode,
  frame: number,
  sceneNode: SceneNode,
  reg: NodeRegistryLike,
  nodes?: readonly AnyNode[],
): RendererMediaCompositeLayer[] => {
  const def = reg.get(node.type);
  return (
    def?.mediaDescriptor?.getCompositeLayers?.(node, frame, {
      frame,
      sceneNode,
      nodes,
    }) ?? []
  ).filter((layer) => layer.textureKey && layer.width > 0 && layer.height > 0);
};

/**
 * Get asset IDs from a node using the registry's media descriptor.
 */
const getMediaAssetIdsFromRegistry = (
  node: AnyNode,
  _frame: number,
  reg: NodeRegistryLike,
): string[] => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.getAssetIds?.(node) ?? [];
};

/**
 * Get color space for a media node using the registry's media descriptor.
 */
const getColorSpaceFromRegistry = (node: AnyNode, reg: NodeRegistryLike): string | undefined => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.getColorSpace?.(node);
};

const isDataMediaWithRegistry = (node: AnyNode, reg: NodeRegistryLike): boolean => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.isData?.(node) === true;
};

const isVideoFileNodeWithRegistry = (node: AnyNode, reg: NodeRegistryLike): boolean => {
  const def = reg.get(node.type);
  return !!(def?.mediaDescriptor?.isVideoFile?.(node) ?? def?.flags?.isVideoFile);
};

const getResolvedColorSpace = (
  colorSpace: string | undefined,
  colorManagement: RendererColorManagement,
): string => colorManagement.resolveColorSpaceName(colorSpace);

const getOcioColorSpaceTransform = (
  sourceColorSpace: string | undefined,
  sceneColorSpace: SceneNode['colorSpace'],
  colorManagement: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  return colorManagement.getColorSpaceTransform(
    sourceColorSpace,
    getResolvedColorSpace(sceneColorSpace, colorManagement),
  );
};

const getMediaOcioColorSpaceTransform = (
  node: AnyNode,
  nodeRegistry: NodeRegistryLike,
  sceneColorSpace: SceneNode['colorSpace'],
  colorManagement: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  if (isDataMediaWithRegistry(node, nodeRegistry)) return null;
  return getOcioColorSpaceTransform(
    getColorSpaceFromRegistry(node, nodeRegistry),
    sceneColorSpace,
    colorManagement,
  );
};

const getMediaLayerOcioColorSpaceTransform = (
  layer: Pick<RendererMediaCompositeLayer, 'colorSpace' | 'isData'>,
  sceneColorSpace: SceneNode['colorSpace'],
  colorManagement: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  if (layer.isData === true) return null;
  return getOcioColorSpaceTransform(layer.colorSpace, sceneColorSpace, colorManagement);
};

const getOcioDisplayViewTransform = (
  sceneColorSpace: SceneNode['colorSpace'],
  displayView: DisplayViewSelection,
  colorManagement: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  return colorManagement.getDisplayViewTransform(
    getResolvedColorSpace(sceneColorSpace, colorManagement),
    displayView.display,
    displayView.view,
    displayView.look,
  );
};

const getOcioOutputColorSpaceTransform = (
  sceneColorSpace: SceneNode['colorSpace'],
  destinationColorSpace: string | undefined,
  colorManagement: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  if (!destinationColorSpace?.trim()) {
    throw new Error('A destination color space is required for color-space output.');
  }
  return colorManagement.getColorSpaceTransform(
    getResolvedColorSpace(sceneColorSpace, colorManagement),
    destinationColorSpace,
  );
};

const getOcioTextureCacheKey = (
  shaderInfo: RendererOcioShaderInfo,
  texture: RendererOcioGpuTexture,
): string =>
  `${shaderInfo.cacheId || shaderInfo.key}:${texture.samplerName}:${texture.dimensions}:${texture.width}x${texture.height}x${texture.depth}`;

const getOcioTextureFormat = (texture: RendererOcioGpuTexture): THREE.PixelFormat =>
  texture.channels === 1 ? THREE.RedFormat : THREE.RGBFormat;

const createOcioDataTexture = (texture: RendererOcioGpuTexture): THREE.Texture => {
  if (texture.dimensions === 3) {
    const dataTexture = new THREE.Data3DTexture(
      texture.values,
      texture.width,
      texture.height,
      texture.depth,
    );
    dataTexture.format = getOcioTextureFormat(texture);
    dataTexture.type = THREE.FloatType;
    dataTexture.wrapR = THREE.ClampToEdgeWrapping;
    dataTexture.unpackAlignment = 1;
    dataTexture.generateMipmaps = false;
    dataTexture.internalFormat = texture.channels === 1 ? 'R32F' : 'RGB32F';
    dataTexture.needsUpdate = true;
    return dataTexture;
  }

  const dataTexture = new THREE.DataTexture(
    texture.values,
    texture.width,
    texture.height,
    getOcioTextureFormat(texture),
    THREE.FloatType,
  );
  dataTexture.unpackAlignment = 1;
  dataTexture.generateMipmaps = false;
  dataTexture.internalFormat = texture.channels === 1 ? 'R32F' : 'RGB32F';
  dataTexture.needsUpdate = true;
  return dataTexture;
};

const applyOcioTextureSampling = (
  threeTexture: THREE.Texture,
  ocioTexture: RendererOcioGpuTexture,
): void => {
  const filter = ocioTexture.interpolation === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
  threeTexture.minFilter = filter;
  threeTexture.magFilter = filter;
  threeTexture.wrapS = THREE.ClampToEdgeWrapping;
  threeTexture.wrapT = THREE.ClampToEdgeWrapping;
};

const getOcioThreeTexture = (
  shaderInfo: RendererOcioShaderInfo,
  texture: RendererOcioGpuTexture,
  textureCache: Map<string, THREE.Texture>,
  ownedTextures?: THREE.Texture[],
): THREE.Texture => {
  const key = getOcioTextureCacheKey(shaderInfo, texture);
  const cached = textureCache.get(key);
  if (cached) return cached;

  const threeTexture = createOcioDataTexture(texture);
  applyOcioTextureSampling(threeTexture, texture);
  textureCache.set(key, threeTexture);
  ownedTextures?.push(threeTexture);
  return threeTexture;
};

const getOcioUniformValue = (uniform: RendererOcioGpuUniform): unknown => {
  if (uniform.type === 'bool') return uniform.value === true;
  if (uniform.type === 'float3' && Array.isArray(uniform.value)) {
    return new THREE.Vector3(uniform.value[0] ?? 0, uniform.value[1] ?? 0, uniform.value[2] ?? 0);
  }
  if (uniform.type === 'vector_float' && Array.isArray(uniform.value)) {
    return new Float32Array(uniform.value);
  }
  if (uniform.type === 'vector_int' && Array.isArray(uniform.value)) {
    return new Int32Array(uniform.value);
  }
  return uniform.value;
};

const createOcioUniforms = (
  shaderInfo: RendererOcioShaderInfo | null | undefined,
  textureCache: Map<string, THREE.Texture>,
  ownedTextures?: THREE.Texture[],
): ShaderUniformMap => {
  if (!shaderInfo) return {};

  const uniforms: ShaderUniformMap = {};
  shaderInfo.textures.forEach((texture) => {
    uniforms[texture.samplerName] = {
      value: getOcioThreeTexture(shaderInfo, texture, textureCache, ownedTextures),
    };
  });
  shaderInfo.uniforms.forEach((uniform) => {
    uniforms[uniform.name] = { value: getOcioUniformValue(uniform) };
  });
  return uniforms;
};

const buildDifferenceMaskBaseShader = (): string => `
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tDiffuse;
uniform sampler2D u_tDifferenceReference;
uniform float u_scaleX;
uniform float u_scaleY;
uniform vec2 u_offset;
uniform vec2 u_scene_res;
uniform vec2 u_image_res;
uniform vec2 u_reference_res;
uniform float u_reference_scaleX;
uniform float u_reference_scaleY;
uniform vec2 u_reference_offset;
uniform float u_difference_low;
uniform float u_difference_high;
uniform float u_difference_comparison_blur;

${PERCEPTUAL_DIFFERENCE_GLSL}

float sampleDifference(vec2 sample_scene_px) {
  vec2 output_px = sample_scene_px - u_offset;
  output_px.x /= u_scaleX;
  output_px.y /= u_scaleY;
  vec2 output_uv = output_px / u_image_res + 0.5;
  if (output_uv.x < 0.0 || output_uv.x > 1.0 || output_uv.y < 0.0 || output_uv.y > 1.0) {
    return 0.0;
  }

  vec2 reference_px = sample_scene_px - u_reference_offset;
  reference_px.x /= u_reference_scaleX;
  reference_px.y /= u_reference_scaleY;
  vec2 reference_uv = reference_px / u_reference_res + 0.5;
  if (reference_uv.x < 0.0 || reference_uv.x > 1.0 || reference_uv.y < 0.0 || reference_uv.y > 1.0) {
    return 1.0;
  }

  vec4 output_color = texture(u_tDiffuse, output_uv);
  vec4 reference_color = texture(u_tDifferenceReference, reference_uv);
  float smoothing_radius = max(u_difference_comparison_blur, 0.0);
  if (smoothing_radius > 0.01) {
    vec2 output_step = vec2(
      smoothing_radius / max(abs(u_scaleX * u_image_res.x), 0.0001),
      smoothing_radius / max(abs(u_scaleY * u_image_res.y), 0.0001)
    );
    vec2 reference_step = vec2(
      smoothing_radius / max(abs(u_reference_scaleX * u_reference_res.x), 0.0001),
      smoothing_radius / max(abs(u_reference_scaleY * u_reference_res.y), 0.0001)
    );
    output_color = output_color * 0.5
      + texture(u_tDiffuse, output_uv + vec2(output_step.x, 0.0)) * 0.125
      + texture(u_tDiffuse, output_uv - vec2(output_step.x, 0.0)) * 0.125
      + texture(u_tDiffuse, output_uv + vec2(0.0, output_step.y)) * 0.125
      + texture(u_tDiffuse, output_uv - vec2(0.0, output_step.y)) * 0.125;
    reference_color = reference_color * 0.5
      + texture(u_tDifferenceReference, reference_uv + vec2(reference_step.x, 0.0)) * 0.125
      + texture(u_tDifferenceReference, reference_uv - vec2(reference_step.x, 0.0)) * 0.125
      + texture(u_tDifferenceReference, reference_uv + vec2(0.0, reference_step.y)) * 0.125
      + texture(u_tDifferenceReference, reference_uv - vec2(0.0, reference_step.y)) * 0.125;
  }
  return perceptualImageDifference(output_color, reference_color);
}

void main() {
  vec2 scene_px = v_uv * u_scene_res - (u_scene_res / 2.0);
  float threshold_high = max(u_difference_high, u_difference_low + 0.0001);
  float mask_alpha = smoothstep(u_difference_low, threshold_high, sampleDifference(scene_px));
  fragColor = vec4(vec3(mask_alpha), 1.0);
}
`;

const DIFFERENCE_MASK_MORPHOLOGY_SHADER = `
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tMask;
uniform vec2 u_direction;
uniform float u_radius;
uniform int u_operation;

void main() {
  float value = texture(u_tMask, v_uv).r;
  for (int offset = 1; offset <= ${MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS}; offset++) {
    if (float(offset - 1) >= u_radius) break;
    vec2 delta = u_direction * min(float(offset), u_radius);
    float negative_sample = texture(u_tMask, v_uv - delta).r;
    float positive_sample = texture(u_tMask, v_uv + delta).r;
    if (u_operation == 0) {
      value = min(value, min(negative_sample, positive_sample));
    } else {
      value = max(value, max(negative_sample, positive_sample));
    }
  }
  fragColor = vec4(vec3(value), 1.0);
}
`;

const buildOcioTransformedTextureShader = (
  ocioTransform: RendererOcioShaderInfo | null | undefined,
  compositeOver: boolean,
  useDifferenceMask = false,
): string => `
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

${compositeOver ? 'uniform sampler2D u_tBackdrop;' : ''}
uniform sampler2D u_tDiffuse;
uniform float u_opacity;
uniform float u_scaleX;
uniform float u_scaleY;
uniform vec2 u_offset;
uniform vec2 u_scene_res;
uniform vec2 u_image_res;
uniform bool u_flipY;
uniform int u_source_alpha_mode;
uniform bool u_use_generated_color;
uniform vec3 u_generated_color;
${
  useDifferenceMask
    ? `uniform sampler2D u_tDifferenceMask;
uniform bool u_difference_invert;
uniform int u_difference_preview_mode;`
    : ''
}

${ocioTransform?.shaderText ?? ''}

${compositeOver ? STRAIGHT_ALPHA_OVER_GLSL : ''}

void main() {
  vec2 scene_px = v_uv * u_scene_res - (u_scene_res / 2.0);
  vec2 img_space_px = scene_px - u_offset;
  img_space_px.x /= u_scaleX;
  img_space_px.y /= u_scaleY;
  vec2 image_uv = img_space_px / u_image_res + 0.5;

  if (u_flipY) {
    image_uv.y = 1.0 - image_uv.y;
  }

  vec4 src = vec4(0.0);
  bool inside_image = image_uv.x >= 0.0 && image_uv.x <= 1.0 && image_uv.y >= 0.0 && image_uv.y <= 1.0;
  if (inside_image) {
    src = texture(u_tDiffuse, image_uv);
    if (u_source_alpha_mode == 1) {
      src.a = 1.0;
    } else if (u_source_alpha_mode == 2) {
      src.a = 0.0;
    }
  }
  if (u_use_generated_color) {
    src.rgb = src.a > 0.0 ? u_generated_color : vec3(0.0);
  }

  float difference_alpha = 1.0;
  ${
    useDifferenceMask
      ? `difference_alpha = texture(u_tDifferenceMask, v_uv).r;
  if (u_difference_invert) difference_alpha = 1.0 - difference_alpha;`
      : ''
  }

  ${
    ocioTransform
      ? `float ocioSourceAlpha = src.a;
  src = ${ocioTransform.functionName}(src);
  src.a = ocioSourceAlpha;`
      : ''
  }

  ${
    useDifferenceMask
      ? `if (u_difference_preview_mode == 1) {
    src.rgb = mix(src.rgb, vec3(0.08, 0.92, 0.72), difference_alpha * 0.58);
    src.a *= u_opacity;
  } else if (u_difference_preview_mode == 2) {
    src.rgb = vec3(difference_alpha);
    src.a = inside_image ? u_opacity : 0.0;
  } else {
    src.a *= u_opacity * difference_alpha;
  }`
      : 'src.a *= u_opacity;'
  }
  ${
    compositeOver
      ? `vec4 dst = texture(u_tBackdrop, v_uv);
  fragColor = straight_over(src, dst);`
      : 'fragColor = src;'
  }
}
`;

const buildColorManagedOutputShader = (
  ocioTransform: RendererOcioShaderInfo | null | undefined,
): string => {
  return `
precision highp float;
precision highp int;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_gain;
uniform float u_gamma;
uniform float u_saturation;
uniform int u_channel;
uniform bool u_ignoreAlpha;
uniform bool u_alphaOverlay;
uniform bool u_gamutWarning;
uniform vec3 u_alphaOverlayColor;
uniform float u_alphaOverlayOpacity;
uniform float u_alphaOverlayBgDarken;
out vec4 fragColor;

${ocioTransform?.shaderText ?? ''}

vec3 signed_pow_viewer(vec3 color, float exponent) {
  return sign(color) * pow(abs(color), vec3(exponent));
}

float luminance_viewer(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 clip_display_output(vec3 color) {
  return clamp(color, 0.0, 1.0);
}

void main() {
  vec4 tex = texture(u_tDiffuse, v_uv);
  vec3 color = tex.rgb * u_gain;

  ${ocioTransform ? `vec4 ocioColor = ${ocioTransform.functionName}(vec4(color, tex.a));` : ''}
  ${ocioTransform ? 'color = ocioColor.rgb;' : ''}

  color = signed_pow_viewer(color, 1.0 / max(u_gamma, 0.0001));
  float luma_val = luminance_viewer(color);
  color = mix(vec3(luma_val), color, u_saturation);
  bool gamut_below = any(lessThan(color, vec3(0.0)));
  bool gamut_above = any(greaterThan(color, vec3(1.0)));

  if (u_channel == 1) color = vec3(color.r);
  if (u_channel == 2) color = vec3(color.g);
  if (u_channel == 3) color = vec3(color.b);
  if (u_channel == 4) color = vec3(tex.a);

  if (u_alphaOverlay && u_channel != 4) {
    float matte = clamp(tex.a, 0.0, 1.0);
    float non_matte = 1.0 - matte;
    color *= 1.0 - (clamp(u_alphaOverlayBgDarken, 0.0, 1.0) * non_matte);

    float overlay_mix = clamp(u_alphaOverlayOpacity, 0.0, 1.0) * matte;
    color = mix(color, clamp(u_alphaOverlayColor, 0.0, 1.0), overlay_mix);
  }

  if (u_gamutWarning && u_channel == 0 && (gamut_below || gamut_above)) {
    color = gamut_below && gamut_above
      ? vec3(1.0, 0.75, 0.0)
      : (gamut_below ? vec3(0.0, 0.85, 1.0) : vec3(1.0, 0.0, 0.75));
  }

  bool should_ignore_alpha = u_ignoreAlpha || (u_alphaOverlay && u_channel != 4);
  float final_alpha = (u_channel == 4 || should_ignore_alpha) ? 1.0 : tex.a;
  fragColor = vec4(clip_display_output(color), final_alpha);
}
`;
};

const buildSceneLinearOutputShader = (
  ocioTransform: RendererOcioShaderInfo | null | undefined,
): string => `
precision highp float;
precision highp int;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
out vec4 fragColor;

${ocioTransform?.shaderText ?? ''}

void main() {
  vec4 source = texture(u_tDiffuse, v_uv);
  ${ocioTransform ? `vec4 transformed = ${ocioTransform.functionName}(source);` : ''}
  fragColor = vec4(${ocioTransform ? 'transformed.rgb' : 'source.rgb'}, source.a);
}
`;

const createSceneLinearOutputMaterial = ({
  materialKey,
  inputTexture,
  ocioTransform,
  ocioTextures,
  ownedTextures,
  getMaterial,
}: Pick<
  ColorManagedOutputMaterialOptions,
  | 'materialKey'
  | 'inputTexture'
  | 'ocioTransform'
  | 'ocioTextures'
  | 'ownedTextures'
  | 'getMaterial'
>): THREE.ShaderMaterial =>
  getMaterial(materialKey, buildSceneLinearOutputShader(ocioTransform), {
    u_tDiffuse: { value: inputTexture },
    ...createOcioUniforms(ocioTransform, ocioTextures, ownedTextures),
  });

interface ColorManagedOutputMaterialOptions {
  materialKey: string;
  inputTexture: THREE.Texture;
  ocioTransform: RendererOcioShaderInfo | null;
  viewerSettings?: ViewerSettings;
  preserveAlpha?: boolean;
  alphaOverlayStyle: AlphaOverlayStyle;
  ocioTextures: Map<string, THREE.Texture>;
  ownedTextures?: THREE.Texture[];
  getMaterial: (
    key: string,
    fragmentShader: string,
    uniforms: ShaderUniformMap,
  ) => THREE.ShaderMaterial;
}

const createColorManagedOutputMaterial = ({
  materialKey,
  inputTexture,
  ocioTransform,
  viewerSettings,
  preserveAlpha = true,
  alphaOverlayStyle,
  ocioTextures,
  ownedTextures,
  getMaterial,
}: ColorManagedOutputMaterialOptions): THREE.ShaderMaterial => {
  const channel = viewerSettings?.channels ?? 'RGB';
  const channelIndex = VIEWER_CHANNELS.indexOf(channel);
  const outputChannelIndex = preserveAlpha && channelIndex === 4 ? 0 : channelIndex;
  const alphaOverlayActive =
    !preserveAlpha && viewerSettings?.alphaOverlay === true && channel !== 'A';

  return getMaterial(materialKey, buildColorManagedOutputShader(ocioTransform), {
    u_tDiffuse: { value: inputTexture },
    u_gain: { value: viewerSettings?.gain ?? 1 },
    u_gamma: { value: viewerSettings?.gamma ?? 1 },
    u_saturation: { value: viewerSettings?.saturation ?? 1 },
    u_channel: { value: outputChannelIndex >= 0 ? outputChannelIndex : 0 },
    u_ignoreAlpha: { value: !preserveAlpha && channel !== 'A' },
    u_alphaOverlay: { value: alphaOverlayActive },
    u_gamutWarning: { value: viewerSettings?.gamutWarning === true },
    u_alphaOverlayColor: { value: new THREE.Color(...alphaOverlayStyle.color) },
    u_alphaOverlayOpacity: { value: alphaOverlayStyle.opacity },
    u_alphaOverlayBgDarken: { value: alphaOverlayStyle.bgDarken },
    ...createOcioUniforms(ocioTransform, ocioTextures, ownedTextures),
  });
};

const createDisplayViewOutputMaterial = ({
  materialKey,
  inputTexture,
  sceneColorSpace,
  viewerSettings,
  displayView,
  preserveAlpha = false,
  alphaOverlayStyle,
  colorManagement,
  ocioTextures,
  ownedTextures,
  getMaterial,
}: {
  materialKey: string;
  inputTexture: THREE.Texture;
  sceneColorSpace: SceneNode['colorSpace'];
  viewerSettings: ViewerSettings;
  displayView: DisplayViewSelection;
  preserveAlpha?: boolean;
  alphaOverlayStyle: AlphaOverlayStyle;
  colorManagement: RendererColorManagement;
  ocioTextures: Map<string, THREE.Texture>;
  ownedTextures?: THREE.Texture[];
  getMaterial: ColorManagedOutputMaterialOptions['getMaterial'];
}): THREE.ShaderMaterial =>
  createColorManagedOutputMaterial({
    materialKey,
    inputTexture,
    viewerSettings,
    preserveAlpha,
    alphaOverlayStyle,
    ocioTextures,
    ownedTextures,
    getMaterial,
    ocioTransform: getOcioDisplayViewTransform(sceneColorSpace, displayView, colorManagement),
  });

const buildTextTexture = (
  node: TextNode,
  frame: number,
  dynamicTextures: THREE.Texture[],
): { texture: THREE.Texture; width: number; height: number } => {
  const textCanvas = document.createElement('canvas');
  const context = textCanvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create text rendering context.');
  }

  const fontPadding = 1.2;
  const fontSize = getValueAtFrame(node.fontSize, frame);
  const rotation = getValueAtFrame(node.rotation, frame);
  const font = `${fontSize}px ${node.fontFamily}`;
  context.font = font;
  const metrics = context.measureText(node.text);
  const textWidth = metrics.width;
  const textHeight = fontSize;
  const rotationRadians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(rotationRadians));
  const sine = Math.abs(Math.sin(rotationRadians));
  const canvasWidth = Math.ceil(textWidth * cosine + textHeight * sine);
  const canvasHeight = Math.ceil(textWidth * sine + textHeight * cosine);

  textCanvas.width = canvasWidth * fontPadding;
  textCanvas.height = canvasHeight * fontPadding;
  context.font = font;
  context.fillStyle = 'white';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.translate(textCanvas.width / 2, textCanvas.height / 2);
  context.rotate(rotationRadians);
  context.fillText(node.text, 0, 0);

  const texture = configureRawStraightAlphaTexture(new THREE.CanvasTexture(textCanvas));
  dynamicTextures.push(texture);
  return { texture, width: textCanvas.width, height: textCanvas.height };
};

const getGeneratedColorUniforms = (
  node: AnyNode,
  context: RenderContext,
  nodeRegistry: NodeRegistryLike,
): ShaderUniformMap => {
  const color = nodeRegistry.get(node.type)?.getGeneratedColor?.(node, context);
  if (!color) {
    return {
      u_use_generated_color: { value: false },
      u_generated_color: { value: new THREE.Color(1, 1, 1) },
    };
  }

  return {
    u_use_generated_color: { value: true },
    u_generated_color: { value: new THREE.Color(color[0], color[1], color[2]) },
  };
};

const getEffectUniforms = (
  node: AnyNode,
  context: RenderContext,
  nodeRegistry: NodeRegistryLike,
): ShaderUniformMap => {
  const definition = nodeRegistry.get(node.type);
  if (!definition?.getUniforms) return {};
  return definition.getUniforms(node, context);
};

const getInputPortsForNode = (
  node: AnyNode,
  nodeRegistry: NodeRegistryLike,
): RendererInputPort[] => {
  const inputPorts = nodeRegistry.get(node.type)?.inputPorts;
  if (!inputPorts) return [];
  return typeof inputPorts === 'function' ? inputPorts(node) : inputPorts;
};

const getNumericNodeUniformValue = (
  node: AnyNode,
  uniformName: string | undefined,
  frame: number,
): number | null => {
  if (!uniformName || !('uniforms' in node)) return null;

  const uniform = (node as { uniforms?: Record<string, { value?: unknown }> }).uniforms?.[
    uniformName
  ];
  const value = uniform?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return getValueAtFrame(value as AnimatableNumber, frame);
  return null;
};

const getInputPortFrame = (node: AnyNode, port: RendererInputPort, frame: number): number => {
  const absoluteUniformValue = getNumericNodeUniformValue(node, port.absoluteFrameUniform, frame);
  if (absoluteUniformValue !== null) return Math.round(absoluteUniformValue);

  if (typeof port.absoluteFrame === 'number' && Number.isFinite(port.absoluteFrame)) {
    return Math.round(port.absoluteFrame);
  }

  const relativeUniformValue = getNumericNodeUniformValue(node, port.frameOffsetUniform, frame);
  if (relativeUniformValue !== null) return frame + Math.round(relativeUniformValue);

  return frame + (port.frameOffset ?? 0);
};

const isTemporalInputPort = (port: RendererInputPort): boolean =>
  typeof port.frameOffset === 'number' ||
  typeof port.absoluteFrame === 'number' ||
  !!port.frameOffsetUniform ||
  !!port.absoluteFrameUniform;

const getVisiblePipelineNodes = (nodes: AnyNode[], nodeRegistry: NodeRegistryLike): AnyNode[] => {
  const visibleNodes: AnyNode[] = [];

  for (const node of nodes) {
    const def = nodeRegistry.get(node.type);
    if (def?.flags?.isSceneLike) {
      continue;
    }
    if (def?.renderMode === 'utility' && !def.flags?.isRenderable) {
      continue;
    }

    if (!node.enabled) {
      continue;
    }

    visibleNodes.push(node);
  }

  return visibleNodes;
};

const getEffectShader = (node: AnyNode, nodeRegistry: NodeRegistryLike): string | null => {
  const definition = nodeRegistry.get(node.type);
  const shader = definition?.getShader?.(node);
  return typeof shader === 'string' ? shader : null;
};

const getRenderMode = (node: AnyNode, nodeRegistry: NodeRegistryLike): RenderMode | null => {
  const definition = nodeRegistry.get(node.type);
  return definition?.renderMode ?? null;
};

const getMultipassShaders = (
  node: AnyNode,
  nodeRegistry: NodeRegistryLike,
): { horizontal: string; vertical: string } | null => {
  const definition = nodeRegistry.get(node.type);
  const shader = definition?.getShader?.(node);
  if (shader && typeof shader === 'object' && 'horizontal' in shader) {
    return shader as { horizontal: string; vertical: string };
  }
  return null;
};

const getRenderScale = (
  node: AnyNode,
  context: RenderContext,
  nodeRegistry: NodeRegistryLike,
): number => {
  const definition = nodeRegistry.get(node.type);
  if (definition?.renderScale) {
    return definition.renderScale(node, context);
  }
  return 1;
};

const withDiffuseUniform = (
  uniforms: ShaderUniformMap,
  diffuseTexture: THREE.Texture,
): ShaderUniformMap => {
  return {
    u_tDiffuse: { value: diffuseTexture },
    ...uniforms,
  };
};

const getChannelIndex = (channel: string | undefined, fallback: ChannelPort): number => {
  const resolved = CHANNEL_PORTS.includes(channel as ChannelPort)
    ? (channel as ChannelPort)
    : fallback;
  return CHANNEL_PORTS.indexOf(resolved);
};

const getInputSourcePort = (
  node: AnyNode,
  inputPort: string,
  fallback: ChannelPort | 'output' = 'output',
): string =>
  (node as { inputSourcePorts?: Record<string, string> }).inputSourcePorts?.[inputPort] ?? fallback;

const getSourceAlphaModeUniform = (node: unknown): number => {
  const sourceAlphaMode = (node as { sourceAlphaMode?: string } | null | undefined)
    ?.sourceAlphaMode;
  if (sourceAlphaMode === 'opaque') return SOURCE_ALPHA_MODE_UNIFORM.opaque;
  if (sourceAlphaMode === 'transparent') return SOURCE_ALPHA_MODE_UNIFORM.transparent;
  return SOURCE_ALPHA_MODE_UNIFORM.file;
};

// ---------------------------------------------------------------------------
// Scaled multipass renderer — downsamples before blur, upsamples after.
// Avoids duplicating the downscale/upscale logic across all 4 multipass
// code paths in the two render functions.
// ---------------------------------------------------------------------------

/**
 * Execute a multipass effect (H + V separable) with optional downscale.
 * When renderScale < 1, the input is bilinearly downsampled before the
 * blur passes, then upsampled to the output target after.
 *
 * @returns true if the effect was rendered (shaders found).
 */
function renderScaledMultipass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  quad: THREE.Mesh,
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial,
  nodeRegistry: NodeRegistryLike,
  renderContext: RenderContext,
  node: AnyNode,
  inputTexture: THREE.Texture,
  outputTarget: THREE.WebGLRenderTarget,
  fullWidth: number,
  fullHeight: number,
  radiusScale: number,
  renderTargetOptions: THREE.RenderTargetOptions,
): boolean {
  const shaders = getMultipassShaders(node, nodeRegistry);
  if (!shaders) return false;

  const blurUniforms = getEffectUniforms(node, renderContext, nodeRegistry);
  const radius = getNumericUniformValue(blurUniforms, 'u_radius', 0) * radiusScale;
  const renderScale = getRenderScale(node, renderContext, nodeRegistry);
  const scratchTargets: THREE.WebGLRenderTarget[] = [];
  const createScratchTarget = (width: number, height: number): THREE.WebGLRenderTarget => {
    const target = new THREE.WebGLRenderTarget(width, height, renderTargetOptions);
    scratchTargets.push(target);
    return target;
  };

  const hMatId = `${node.id}_blur_h`;
  const vMatId = `${node.id}_blur_v`;

  try {
    if (renderScale >= 1) {
      // Full-resolution path
      const tempRT = createScratchTarget(fullWidth, fullHeight);

      const hPass = getMaterial(hMatId, shaders.horizontal, {
        u_tDiffuse: { value: inputTexture },
        u_radius: { value: radius },
        u_resolution_x: { value: fullWidth },
      });
      quad.material = hPass;
      renderer.setRenderTarget(tempRT);
      renderer.render(scene, camera);

      const vPass = getMaterial(vMatId, shaders.vertical, {
        u_tDiffuse: { value: tempRT.texture },
        u_radius: { value: radius },
        u_resolution_y: { value: fullHeight },
      });
      quad.material = vPass;
      renderer.setRenderTarget(outputTarget);
      renderer.render(scene, camera);
    } else {
      // Scaled path — downsample, blur at lower res, upsample
      const sW = Math.max(1, Math.round(fullWidth * renderScale));
      const sH = Math.max(1, Math.round(fullHeight * renderScale));
      const scaledRT1 = createScratchTarget(sW, sH);
      const scaledRT2 = createScratchTarget(sW, sH);

      // Downsample
      const downsampleMat = getMaterial(`${node.id}_ds`, RendererShader.TEXTURE, {
        u_tDiffuse: { value: inputTexture },
      });
      quad.material = downsampleMat;
      renderer.setRenderTarget(scaledRT1);
      renderer.render(scene, camera);

      // Horizontal pass at scaled resolution
      const scaledRadius = radius * renderScale;
      const hPass = getMaterial(hMatId, shaders.horizontal, {
        u_tDiffuse: { value: scaledRT1.texture },
        u_radius: { value: scaledRadius },
        u_resolution_x: { value: sW },
      });
      quad.material = hPass;
      renderer.setRenderTarget(scaledRT2);
      renderer.render(scene, camera);

      // Vertical pass at scaled resolution
      const vPass = getMaterial(vMatId, shaders.vertical, {
        u_tDiffuse: { value: scaledRT2.texture },
        u_radius: { value: scaledRadius },
        u_resolution_y: { value: sH },
      });
      quad.material = vPass;
      renderer.setRenderTarget(scaledRT1);
      renderer.render(scene, camera);

      // Upsample back to full resolution
      const upsampleMat = getMaterial(`${node.id}_us`, RendererShader.TEXTURE, {
        u_tDiffuse: { value: scaledRT1.texture },
      });
      quad.material = upsampleMat;
      renderer.setRenderTarget(outputTarget);
      renderer.render(scene, camera);
    }

    return true;
  } finally {
    scratchTargets.forEach((target) => target.dispose());
  }
}

const getNumericUniformValue = (
  uniforms: ShaderUniformMap,
  key: string,
  fallback: number,
): number => {
  const value = uniforms[key]?.value;
  return typeof value === 'number' ? value : fallback;
};

const applyBlendMode = (material: THREE.ShaderMaterial, mode: BlendMode): void => {
  switch (mode) {
    case BlendMode.ADD:
      material.blending = THREE.AdditiveBlending;
      break;
    case BlendMode.MULTIPLY:
      material.blending = THREE.MultiplyBlending;
      break;
    case BlendMode.SCREEN:
      material.blending = THREE.CustomBlending;
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = THREE.OneMinusDstColorFactor;
      material.blendDst = THREE.OneFactor;
      material.blendEquationAlpha = THREE.AddEquation;
      material.blendSrcAlpha = THREE.SrcAlphaFactor;
      material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
    case BlendMode.OVER:
    default:
      material.blending = THREE.NormalBlending;
      break;
  }
  material.transparent = true;
};

const applyNoBlending = (material: THREE.ShaderMaterial): void => {
  material.blending = THREE.NoBlending;
  material.transparent = false;
};

interface DifferenceMaskPassRenderOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  getTarget: (key: string) => THREE.WebGLRenderTarget;
  ensureTarget: (target: THREE.WebGLRenderTarget) => void;
  resourceKey: string;
  outputTexture: THREE.Texture;
  referenceTexture: THREE.Texture;
  layer: RendererMediaCompositeLayer;
  mask: RendererDifferenceMaskLayer;
  sceneSize: RenderFormatSize;
  frame: number;
}

/** Renders a scene-aligned perceptual matte and applies true multipass morphology. */
const renderDifferenceMaskTexture = ({
  renderer,
  scene,
  camera,
  quad,
  getMaterial,
  getTarget,
  ensureTarget,
  resourceKey,
  outputTexture,
  referenceTexture,
  layer,
  mask,
  sceneSize,
  frame,
}: DifferenceMaskPassRenderOptions): THREE.Texture => {
  let readTarget = getTarget(`${resourceKey}:a`);
  let writeTarget = getTarget(`${resourceKey}:b`);
  ensureTarget(readTarget);
  ensureTarget(writeTarget);

  const outputTransform = layer.transform;
  const baseMaterial = getMaterial(`${resourceKey}:base`, buildDifferenceMaskBaseShader(), {
    u_tDiffuse: { value: outputTexture },
    u_tDifferenceReference: { value: referenceTexture },
    u_scaleX: { value: getValueAtFrame(outputTransform?.scaleX ?? 1, frame) },
    u_scaleY: { value: getValueAtFrame(outputTransform?.scaleY ?? 1, frame) },
    u_offset: {
      value: new THREE.Vector2(
        getValueAtFrame(outputTransform?.x ?? 0, frame),
        getValueAtFrame(outputTransform?.y ?? 0, frame),
      ),
    },
    u_scene_res: { value: new THREE.Vector2(sceneSize.width, sceneSize.height) },
    u_image_res: { value: new THREE.Vector2(layer.width, layer.height) },
    u_reference_res: { value: new THREE.Vector2(mask.width, mask.height) },
    u_reference_scaleX: { value: getValueAtFrame(mask.transform?.scaleX ?? 1, frame) },
    u_reference_scaleY: { value: getValueAtFrame(mask.transform?.scaleY ?? 1, frame) },
    u_reference_offset: {
      value: new THREE.Vector2(
        getValueAtFrame(mask.transform?.x ?? 0, frame),
        getValueAtFrame(mask.transform?.y ?? 0, frame),
      ),
    },
    u_difference_low: { value: mask.thresholdLow },
    u_difference_high: { value: mask.thresholdHigh },
    u_difference_comparison_blur: { value: mask.comparisonBlur },
  });
  applyNoBlending(baseMaterial);
  quad.material = baseMaterial;
  renderer.setRenderTarget(readTarget);
  renderer.render(scene, camera);

  const passes = getDifferenceMaskMorphologyPasses(mask);
  const pixelX = 1 / sceneSize.width;
  const pixelY = 1 / sceneSize.height;
  const diagonalScale = Math.SQRT1_2;
  passes.forEach((pass) => {
    const direction =
      pass.axis === 'horizontal'
        ? new THREE.Vector2(pixelX, 0)
        : pass.axis === 'vertical'
          ? new THREE.Vector2(0, pixelY)
          : pass.axis === 'diagonal-down'
            ? new THREE.Vector2(pixelX * diagonalScale, pixelY * diagonalScale)
            : new THREE.Vector2(pixelX * diagonalScale, -pixelY * diagonalScale);
    const morphologyMaterial = getMaterial(
      `${resourceKey}:${pass.operation}:${pass.axis}`,
      DIFFERENCE_MASK_MORPHOLOGY_SHADER,
      {
        u_tMask: { value: readTarget.texture },
        u_direction: { value: direction },
        u_radius: { value: pass.radius },
        u_operation: { value: pass.operation === 'erode' ? 0 : 1 },
      },
    );
    applyNoBlending(morphologyMaterial);
    quad.material = morphologyMaterial;
    renderer.setRenderTarget(writeTarget);
    renderer.render(scene, camera);
    [readTarget, writeTarget] = [writeTarget, readTarget];
  });

  return readTarget.texture;
};

/**
 * Collects all nodes referenced by generic input ports that need texture preloading.
 */
interface InputPreloadTarget {
  node: MediaNode;
  frame: number;
}

const collectInputPreloadTargets = (
  visibleNodes: AnyNode[],
  allNodes: AnyNode[],
  nodeRegistry: NodeRegistryLike,
  frame: number,
): InputPreloadTarget[] => {
  const targets: InputPreloadTarget[] = [];
  let previousMediaNode: AnyNode | null = null;

  for (const node of visibleNodes) {
    const fallbackSourceNode = previousMediaNode;
    const inputs = node.inputs;
    const inputPorts = getInputPortsForNode(node, nodeRegistry);

    if (!inputs && !fallbackSourceNode) {
      if (isMediaNodeWithRegistry(node, nodeRegistry)) {
        previousMediaNode = node;
      }
      continue;
    }

    if (inputPorts.length > 0) {
      for (const port of inputPorts) {
        const sourceId =
          inputs?.[port.name] ??
          (fallbackSourceNode && isTemporalInputPort(port) ? fallbackSourceNode.id : undefined);
        if (sourceId) {
          const sourceNode = allNodes.find((l) => l.id === sourceId);
          if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
            targets.push({
              node: sourceNode as MediaNode,
              frame: getInputPortFrame(node, port, frame),
            });
          }
        }
      }
    } else if (inputs) {
      // No input ports declared but has inputs — still resolve them (forward compat)
      for (const sourceId of Object.values(inputs)) {
        const sourceNode = allNodes.find((l) => l.id === sourceId);
        if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
          targets.push({ node: sourceNode as MediaNode, frame });
        }
      }
    }

    if (isMediaNodeWithRegistry(node, nodeRegistry)) {
      previousMediaNode = node;
    }
  }
  return targets;
};

/**
 * Resolves all declared input port connections for a node and returns shader uniforms.
 */
const resolveInputUniforms = (
  node: AnyNode,
  nodeRegistry: NodeRegistryLike,
  frame: number,
  getTextureForNodeId: (nodeId: string, targetFrame: number) => THREE.Texture | undefined,
  fallbackSourceNode?: AnyNode | null,
): ShaderUniformMap => {
  const inputs = node.inputs;
  const inputPorts = getInputPortsForNode(node, nodeRegistry);

  if (inputPorts.length > 0 && (inputs || fallbackSourceNode)) {
    const uniforms: ShaderUniformMap = {};
    for (const port of inputPorts) {
      const sourceNodeId =
        inputs?.[port.name] ??
        (fallbackSourceNode && isTemporalInputPort(port) ? fallbackSourceNode.id : undefined);
      if (sourceNodeId && port.uniformName) {
        const texture = getTextureForNodeId(sourceNodeId, getInputPortFrame(node, port, frame));
        uniforms[port.uniformName] = { value: texture ?? getTransparentInputTexture() };
      }
    }
    if (Object.keys(uniforms).length > 0) return uniforms;
  } else if (inputs) {
    return {};
  }

  return {};
};

type MaybePromise<T> = T | Promise<T>;
type RenderOutputTexture = (
  nodeId: string,
  sourcePortName?: string,
) => MaybePromise<THREE.Texture | undefined>;

export const isPromiseLike = <T>(value: MaybePromise<T>): value is Promise<T> =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof (value as Promise<T>).then === 'function';

interface AdjustmentRenderOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  nodeRegistry: NodeRegistryLike;
  renderContext: RenderContext;
  node: AnyNode;
  inputTexture: THREE.Texture;
  outputTarget: THREE.WebGLRenderTarget;
  width: number;
  height: number;
  blurRadiusScale: number;
  renderTargetOptions: THREE.RenderTargetOptions;
  sceneColorSpace: SceneNode['colorSpace'];
  colorManagement: RendererColorManagement;
  ocioTextures: Map<string, THREE.Texture>;
  ownedOcioTextures?: THREE.Texture[];
  fallbackSourceNode?: AnyNode | null;
  getInputTextureForNode: (nodeId: string, targetFrame: number) => THREE.Texture | undefined;
  getRotoMaskLayers?: (nodeId: string) => readonly RendererMaskLayer[] | undefined;
  getRotoAlphaMode?: (nodeId: string) => number;
  getScratchRenderTarget?: (key: string) => THREE.WebGLRenderTarget;
  /** Optional custom material ID for shader/warp render modes. */
  shaderId?: string;
}

const renderAdjustmentNodeToTarget = (options: AdjustmentRenderOptions): MaybePromise<boolean> => {
  const {
    renderer,
    scene,
    camera,
    quad,
    getMaterial,
    nodeRegistry,
    renderContext,
    node,
    inputTexture,
    outputTarget,
    width,
    height,
    blurRadiusScale,
    renderTargetOptions,
    sceneColorSpace,
    colorManagement,
    ocioTextures,
    ownedOcioTextures,
    fallbackSourceNode,
    getInputTextureForNode,
    getRotoMaskLayers,
    getRotoAlphaMode,
    getScratchRenderTarget,
    shaderId,
  } = options;
  const renderMode = getRenderMode(node, nodeRegistry);

  if (renderMode === 'ocio') {
    const definition = nodeRegistry.get(node.type);
    if (!definition?.getOcioTransforms) return false;
    const workingColorSpace = colorManagement.resolveColorSpaceName(sceneColorSpace);
    const transforms = definition.getOcioTransforms(node, {
      workingColorSpace,
      textureColorSpace: colorManagement.textureColorSpace,
      logColorSpace: colorManagement.logColorSpace,
    });
    const ocioTransform = transforms.length > 0 ? colorManagement.getTransform(transforms) : null;
    const material = createSceneLinearOutputMaterial({
      materialKey: shaderId ?? `${node.id}_ocio_transform`,
      inputTexture,
      ocioTransform,
      ocioTextures,
      ownedTextures: ownedOcioTextures,
      getMaterial,
    });
    quad.material = material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(scene, camera);
    return true;
  }

  if (renderMode === 'shader' || renderMode === 'warp') {
    const shader = getEffectShader(node, nodeRegistry);
    if (!shader) return false;
    const definition = nodeRegistry.get(node.type);
    if (!definition) return false;
    const processingDomain = resolveRendererNodeProcessingDomain(definition, node);

    const renderShaderPass = (
      sourceTexture: THREE.Texture,
      target: THREE.WebGLRenderTarget,
      materialId: string,
    ) => {
      const uniforms = withDiffuseUniform(
        getEffectUniforms(node, renderContext, nodeRegistry),
        sourceTexture,
      );
      Object.assign(
        uniforms,
        resolveInputUniforms(
          node,
          nodeRegistry,
          renderContext.frame,
          getInputTextureForNode,
          fallbackSourceNode,
        ),
      );
      const material = getMaterial(materialId, shader, uniforms);
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    };

    if (processingDomain !== 'log') {
      renderShaderPass(inputTexture, outputTarget, shaderId ?? node.id);
      return true;
    }

    const logColorSpace = colorManagement.logColorSpace;
    if (!logColorSpace) {
      throw new Error(
        `${node.name || node.type} requires the OCIO "compositing_log" role for log processing.`,
      );
    }
    const sceneSpace = colorManagement.resolveColorSpaceName(sceneColorSpace);
    const toLog = colorManagement.getColorSpaceTransform(sceneSpace, logColorSpace);
    const fromLog = colorManagement.getColorSpaceTransform(logColorSpace, sceneSpace);
    if (!toLog || !fromLog) {
      throw new Error(
        `${node.name || node.type} could not create required OCIO transforms between ` +
          `"${sceneSpace}" and "${logColorSpace}".`,
      );
    }
    const logInputTarget = new THREE.WebGLRenderTarget(width, height, renderTargetOptions);
    const logOutputTarget = new THREE.WebGLRenderTarget(width, height, renderTargetOptions);

    try {
      const toLogMaterial = createSceneLinearOutputMaterial({
        materialKey: `${node.id}_scene_to_log`,
        inputTexture,
        ocioTransform: toLog,
        ocioTextures,
        ownedTextures: ownedOcioTextures,
        getMaterial,
      });
      quad.material = toLogMaterial;
      renderer.setRenderTarget(logInputTarget);
      renderer.render(scene, camera);

      renderShaderPass(logInputTarget.texture, logOutputTarget, shaderId ?? `${node.id}_log`);

      const fromLogMaterial = createSceneLinearOutputMaterial({
        materialKey: `${node.id}_log_to_scene`,
        inputTexture: logOutputTarget.texture,
        ocioTransform: fromLog,
        ocioTextures,
        ownedTextures: ownedOcioTextures,
        getMaterial,
      });
      quad.material = fromLogMaterial;
      renderer.setRenderTarget(outputTarget);
      renderer.render(scene, camera);
      return true;
    } finally {
      logInputTarget.dispose();
      logOutputTarget.dispose();
    }
  }

  if (renderMode === 'multipass') {
    return renderScaledMultipass(
      renderer,
      scene,
      camera,
      quad,
      getMaterial,
      nodeRegistry,
      renderContext,
      node,
      inputTexture,
      outputTarget,
      width,
      height,
      blurRadiusScale,
      renderTargetOptions,
    );
  }

  // Check for renderOutput on the node definition (handles paint, mask, and other custom modes)
  const renderOutputDef = nodeRegistry.get(node.type)?.renderOutput;
  if (renderOutputDef) {
    const roCtx: ResolveOutputContext = {
      executionMode: 'sync',
      frame: renderContext.frame,
      nodes: renderContext.nodes as AnyNode[],
      sceneNode: {
        ...renderContext.scene,
        colorSpace: sceneColorSpace,
      } as SceneNode,
      renderer,
      scene,
      camera,
      quad,
      getMaterial,
      resolveOutput: (nodeId) => getInputTextureForNode(nodeId, renderContext.frame) ?? undefined,
      transformColorPickingToSceneLinear: renderContext.transformColorPickingToSceneLinear,
      compositeBuffer: outputTarget,
      getMediaTexture: (n, f) => getInputTextureForNode(n.id, f) ?? undefined,
      getRotoMaskLayers,
      getRotoAlphaMode,
      nodeRegistry,
      clearRenderTargetTransparent: (t) => clearRenderTargetTransparent(renderer, t),
      applyNoBlending,
      getInputSourcePort,
      getChannelIndex: (ch, fallback) => getChannelIndex(ch, (fallback || 'r') as ChannelPort),
      getTransparentInputTexture,
      getScratchRenderTarget,
    };
    const roResult = renderOutputDef(node, outputTarget, inputTexture, roCtx);
    if (roResult) {
      if (isPromiseLike(roResult)) {
        throw new Error(
          'Asynchronous renderOutput is not supported in renderAdjustmentNodeToTarget',
        );
      }
      return true;
    }
  }

  return false;
};

const collectAdjacentStackedNodes = (
  visibleNodes: AnyNode[],
  startIndex: number,
  isStackedNode: (node: AnyNode) => boolean,
): { stackedNodes: AnyNode[]; consumedCount: number } => {
  const stackedNodes: AnyNode[] = [];
  let consumedCount = 0;
  for (let upperIndex = startIndex + 1; upperIndex < visibleNodes.length; upperIndex += 1) {
    const upperNode = visibleNodes[upperIndex];
    if (!isStackedNode(upperNode)) break;
    stackedNodes.push(upperNode);
    consumedCount += 1;
  }
  return { stackedNodes, consumedCount };
};

interface UtilityOutputRenderOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  node: AnyNode;
  sourcePortName?: string;
  outputTarget: THREE.WebGLRenderTarget;
  renderNodeOutputTexture: RenderOutputTexture;
}

const renderUtilityNodeToTarget = (options: UtilityOutputRenderOptions): MaybePromise<boolean> => {
  const {
    renderer,
    scene,
    camera,
    quad,
    getMaterial,
    node,
    sourcePortName = 'output',
    outputTarget,
    renderNodeOutputTexture,
  } = options;

  const textureResult = renderNodeOutputTexture(node.id, sourcePortName);
  const renderTexture = (texture: THREE.Texture | undefined): boolean => {
    if (!texture) return false;

    const material = getMaterial(`${node.id}_utility_output`, RendererShader.TEXTURE, {
      u_tDiffuse: { value: texture },
    });
    applyNoBlending(material);
    quad.material = material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(scene, camera);
    return true;
  };

  return isPromiseLike(textureResult)
    ? textureResult.then(renderTexture)
    : renderTexture(textureResult);
};

interface MergeNodeRenderOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  node: AnyNode;
  nodes: AnyNode[];
  frame: number;
  outputTarget: THREE.WebGLRenderTarget;
  renderNodeOutputTexture: RenderOutputTexture;
}

const renderMergeNodeToTarget = (options: MergeNodeRenderOptions): MaybePromise<boolean> => {
  const {
    renderer,
    scene,
    camera,
    quad,
    getMaterial,
    node,
    nodes,
    frame,
    outputTarget,
    renderNodeOutputTexture,
  } = options;
  const mergeInputs = (node as { inputs?: Record<string, string> }).inputs ?? {};
  const pipeTextureResult = mergeInputs.pipe
    ? renderNodeOutputTexture(mergeInputs.pipe, getInputSourcePort(node, 'pipe'))
    : undefined;

  const renderWithPipe = (pipeTexture: THREE.Texture | undefined): MaybePromise<boolean> => {
    const sourceNodeId = mergeInputs.source;
    const sourceNode = sourceNodeId
      ? nodes.find((candidate) => candidate.id === sourceNodeId)
      : null;

    const renderResolvedMerge = (sourceOutputTexture: THREE.Texture | undefined): boolean => {
      const backdropTexture = pipeTexture ?? getTransparentInputTexture();

      if (!sourceOutputTexture) {
        const pipeCopyMaterial = getMaterial(
          `${node.id}_merge_pipe_input`,
          RendererShader.TEXTURE,
          {
            u_tDiffuse: { value: backdropTexture },
          },
        );
        applyNoBlending(pipeCopyMaterial);
        quad.material = pipeCopyMaterial;
        renderer.setRenderTarget(outputTarget);
        renderer.render(scene, camera);
        return true;
      }

      const { opacity: blendOpacity, operator } = getNodeBlendProps(node);
      const opacity = getValueAtFrame(blendOpacity, frame);
      const mergeComposite =
        operator === BlendMode.OVER
          ? getMaterial(
              `${node.id}_merge_comp_straight_over`,
              RendererShader.STRAIGHT_TEXTURE_OVER,
              {
                u_tBackdrop: { value: backdropTexture },
                u_tDiffuse: { value: sourceOutputTexture },
                u_opacity: { value: opacity / 100 },
              },
            )
          : getMaterial(`${node.id}_merge_comp`, RendererShader.TEXTURE_OPACITY, {
              u_tDiffuse: { value: sourceOutputTexture },
              u_opacity: { value: opacity / 100 },
            });

      if (operator === BlendMode.OVER) {
        applyNoBlending(mergeComposite);
      } else {
        const pipeCopyMaterial = getMaterial(
          `${node.id}_merge_pipe_input`,
          RendererShader.TEXTURE,
          {
            u_tDiffuse: { value: backdropTexture },
          },
        );
        applyNoBlending(pipeCopyMaterial);
        quad.material = pipeCopyMaterial;
        renderer.setRenderTarget(outputTarget);
        renderer.render(scene, camera);
        applyBlendMode(mergeComposite, operator);
      }

      quad.material = mergeComposite;
      renderer.setRenderTarget(outputTarget);
      renderer.render(scene, camera);
      return true;
    };

    if (!sourceNode?.enabled) {
      return renderResolvedMerge(undefined);
    }

    const sourceOutputTextureResult = renderNodeOutputTexture(
      sourceNodeId,
      getInputSourcePort(node, 'source'),
    );

    return isPromiseLike(sourceOutputTextureResult)
      ? sourceOutputTextureResult.then(renderResolvedMerge)
      : renderResolvedMerge(sourceOutputTextureResult);
  };

  return isPromiseLike(pipeTextureResult)
    ? pipeTextureResult.then(renderWithPipe)
    : renderWithPipe(pipeTextureResult);
};

// ---------------------------------------------------------------------------
// Shared node output resolver — handles dispatch for all node types.
// Used by both export and viewport paths to eliminate ~700 lines of
// duplicated renderNodeOutputTexture code.
// ---------------------------------------------------------------------------

interface NodeOutputResolveContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  nodes: AnyNode[];
  frame: number;
  sceneNode: SceneNode;
  currentSceneSize: RenderFormatSize;
  blurRadiusScale: number;
  renderTargetOptions: THREE.RenderTargetOptions;
  nodeRegistry: NodeRegistryLike;
  compositeBuffer: THREE.WebGLRenderTarget;
  renderContext: RenderContext;
  colorManagement: RendererColorManagement;
  ocioTextures: Map<string, THREE.Texture>;
  ownedOcioTextures?: THREE.Texture[];
  getUtilityOutputTarget: (key: string) => THREE.WebGLRenderTarget;
  utilityRenderStack: Set<string>;
  checkCache: (cacheKey: string) => boolean;
  markCache: (cacheKey: string) => void;
  getMediaTexture: (node: AnyNode, frame: number) => MaybePromise<THREE.Texture | null | undefined>;
  getTextTexture: (
    node: TextNode,
  ) => { texture: THREE.Texture; width: number; height: number } | undefined;
  renderCompositeMediaToTarget: (
    node: AnyNode,
    layers: RendererMediaCompositeLayer[],
    target: THREE.WebGLRenderTarget,
  ) => MaybePromise<boolean>;
  renderFullFrameTextureToTarget: (
    node: AnyNode,
    texture: THREE.Texture,
    target: THREE.WebGLRenderTarget,
    textureSize?: { width: number; height: number },
  ) => void;
  getCachedMediaTexture: (node: AnyNode, frame: number) => THREE.Texture | undefined;
  getRotoMaskLayers?: (nodeId: string) => readonly RendererMaskLayer[] | undefined;
  getRotoAlphaMode?: (nodeId: string) => number;
  onAsyncInSync?: () => never;
}

function resolveNodeOutputTexture(
  nodeId: string,
  sourcePortName: string,
  ctx: NodeOutputResolveContext,
  resolveOutput: RenderOutputTexture,
): MaybePromise<THREE.Texture | undefined> {
  const cacheKey = `${nodeId}:${sourcePortName}`;
  if (ctx.checkCache(cacheKey)) {
    const existing = ctx.getUtilityOutputTarget(cacheKey);
    return existing.texture;
  }
  if (ctx.utilityRenderStack.has(cacheKey)) return getTransparentInputTexture();

  const node = ctx.nodes.find((candidate) => candidate.id === nodeId);
  if (!node?.enabled) return undefined;
  const target = ctx.getUtilityOutputTarget(cacheKey);
  ctx.utilityRenderStack.add(cacheKey);

  const tryReturn = (
    result: MaybePromise<THREE.Texture | undefined>,
  ): MaybePromise<THREE.Texture | undefined> => {
    if (isPromiseLike(result)) {
      return result.then((r) => {
        if (r) ctx.markCache(cacheKey);
        return r;
      });
    }
    if (result) ctx.markCache(cacheKey);
    return result;
  };

  try {
    if (isMediaNodeWithRegistry(node, ctx.nodeRegistry)) {
      // When a non-default output port is requested, check for renderOutput
      if (sourcePortName !== 'output') {
        const renderOutputDef = ctx.nodeRegistry.get(node.type)?.renderOutput;
        if (renderOutputDef) {
          const roCtx: ResolveOutputContext = {
            executionMode: ctx.onAsyncInSync ? 'sync' : 'async',
            frame: ctx.frame,
            nodes: ctx.nodes,
            sceneNode: ctx.sceneNode,
            renderer: ctx.renderer,
            scene: ctx.scene,
            camera: ctx.camera,
            quad: ctx.quad,
            getMaterial: ctx.getMaterial,
            resolveOutput,
            transformColorPickingToSceneLinear:
              ctx.renderContext.transformColorPickingToSceneLinear,
            compositeBuffer: ctx.compositeBuffer,
            getMediaTexture: (n, f) => ctx.getCachedMediaTexture(n, f),
            getRotoMaskLayers: ctx.getRotoMaskLayers,
            getRotoAlphaMode: ctx.getRotoAlphaMode,
            nodeRegistry: ctx.nodeRegistry,
            clearRenderTargetTransparent: (t) => clearRenderTargetTransparent(ctx.renderer, t),
            applyNoBlending,
            getInputSourcePort,
            getChannelIndex: (ch, fallback) =>
              getChannelIndex(ch, (fallback || 'r') as ChannelPort),
            getTransparentInputTexture,
            getScratchRenderTarget: (key) => ctx.getUtilityOutputTarget(`__scratch:${key}`),
          };
          const roResult = renderOutputDef(node, target, undefined, roCtx, sourcePortName);
          if (roResult) {
            if (isPromiseLike(roResult)) {
              ctx.onAsyncInSync?.();
              return (roResult as Promise<boolean>).then((ok) => (ok ? target.texture : undefined));
            }
            return target.texture;
          }
        }
      }
      const compositeLayers = getMediaCompositeLayersFromRegistry(
        node,
        ctx.frame,
        ctx.sceneNode,
        ctx.nodeRegistry,
        ctx.nodes,
      );
      if (compositeLayers.length > 0) {
        const renderedComposite = ctx.renderCompositeMediaToTarget(node, compositeLayers, target);
        const compositeResult = isPromiseLike(renderedComposite)
          ? renderedComposite.then((ok) => (ok ? target.texture : undefined))
          : renderedComposite
            ? target.texture
            : undefined;
        return tryReturn(compositeResult);
      }
      const mediaTexture = ctx.getMediaTexture(node, ctx.frame);
      const renderMedia = (tex: THREE.Texture | null | undefined): THREE.Texture | undefined => {
        if (!tex) return undefined;
        ctx.renderFullFrameTextureToTarget(node, tex, target);
        return target.texture;
      };
      const result = isPromiseLike(mediaTexture)
        ? mediaTexture.then(renderMedia)
        : renderMedia(mediaTexture);
      return tryReturn(result);
    }

    if (getRenderMode(node, ctx.nodeRegistry) === 'text') {
      const textTexture = ctx.getTextTexture(node as TextNode);
      if (!textTexture) return undefined;
      ctx.renderFullFrameTextureToTarget(node, textTexture.texture, target, textTexture);
      ctx.markCache(cacheKey);
      return target.texture;
    }

    const nodeDefinition = ctx.nodeRegistry.get(node.type);
    if (getRenderMode(node, ctx.nodeRegistry) === 'merge' && !nodeDefinition?.renderOutput) {
      const mergeResult = renderMergeNodeToTarget({
        renderer: ctx.renderer,
        scene: ctx.scene,
        camera: ctx.camera,
        quad: ctx.quad,
        getMaterial: ctx.getMaterial,
        node,
        nodes: ctx.nodes,
        frame: ctx.frame,
        outputTarget: target,
        renderNodeOutputTexture: resolveOutput,
      });
      const resolvedMergeTexture = (rendered: boolean): THREE.Texture | undefined =>
        rendered ? target.texture : undefined;
      return tryReturn(
        isPromiseLike(mergeResult)
          ? mergeResult.then(resolvedMergeTexture)
          : resolvedMergeTexture(mergeResult),
      );
    }

    // Resolve input texture for renderOutput and generic fallback
    const hasPipeSource = !!(node as { inputs?: Record<string, string> }).inputs?.pipe;
    const compositeInputTexture = ctx.compositeBuffer?.texture ?? getTransparentInputTexture();

    const resolveInputAndRender = (): MaybePromise<THREE.Texture | undefined> => {
      let inputResolved: MaybePromise<THREE.Texture | undefined>;
      if (hasPipeSource) {
        const pipeSource = (node as { inputs?: Record<string, string> }).inputs!.pipe!;
        inputResolved = resolveOutput(pipeSource, getInputSourcePort(node, 'pipe'));
      } else {
        inputResolved = compositeInputTexture;
      }

      const renderWithInput = (
        resolvedInputTexture: THREE.Texture | undefined,
      ): MaybePromise<THREE.Texture | undefined> => {
        const inputTex = resolvedInputTexture ?? compositeInputTexture;

        // Phase 2: check for renderOutput on the node definition
        const renderOutputDef = ctx.nodeRegistry.get(node.type)?.renderOutput;
        if (renderOutputDef) {
          const roCtx: ResolveOutputContext = {
            executionMode: ctx.onAsyncInSync ? 'sync' : 'async',
            frame: ctx.frame,
            nodes: ctx.nodes,
            sceneNode: ctx.sceneNode,
            renderer: ctx.renderer,
            scene: ctx.scene,
            camera: ctx.camera,
            quad: ctx.quad,
            getMaterial: ctx.getMaterial,
            resolveOutput,
            transformColorPickingToSceneLinear:
              ctx.renderContext.transformColorPickingToSceneLinear,
            compositeBuffer: ctx.compositeBuffer,
            getMediaTexture: (n, f) => ctx.getCachedMediaTexture(n, f),
            getRotoMaskLayers: ctx.getRotoMaskLayers,
            getRotoAlphaMode: ctx.getRotoAlphaMode,
            nodeRegistry: ctx.nodeRegistry,
            clearRenderTargetTransparent: (t) => clearRenderTargetTransparent(ctx.renderer, t),
            applyNoBlending,
            getInputSourcePort,
            getChannelIndex: (ch, fallback) =>
              getChannelIndex(ch, (fallback || 'r') as ChannelPort),
            getTransparentInputTexture,
            getScratchRenderTarget: (key) => ctx.getUtilityOutputTarget(`__scratch:${key}`),
          };
          const roResult = renderOutputDef(node, target, inputTex, roCtx, sourcePortName);
          if (roResult) {
            if (isPromiseLike(roResult)) {
              ctx.onAsyncInSync?.();
              return (roResult as Promise<boolean>).then((ok) => (ok ? target.texture : undefined));
            }
            return target.texture;
          }
        }

        // Generic fallback
        const genericRenderMode = getRenderMode(node, ctx.nodeRegistry);
        if (
          genericRenderMode &&
          (genericRenderMode === 'shader' ||
            genericRenderMode === 'ocio' ||
            genericRenderMode === 'multipass' ||
            genericRenderMode === 'mask' ||
            genericRenderMode === 'paint' ||
            genericRenderMode === 'warp')
        ) {
          const adjResult = renderAdjustmentNodeToTarget({
            renderer: ctx.renderer,
            scene: ctx.scene,
            camera: ctx.camera,
            quad: ctx.quad,
            getMaterial: ctx.getMaterial,
            nodeRegistry: ctx.nodeRegistry,
            renderContext: ctx.renderContext,
            node,
            inputTexture: inputTex,
            outputTarget: target,
            width: ctx.currentSceneSize.width,
            height: ctx.currentSceneSize.height,
            blurRadiusScale: ctx.blurRadiusScale,
            renderTargetOptions: ctx.renderTargetOptions,
            sceneColorSpace: ctx.sceneNode.colorSpace,
            colorManagement: ctx.colorManagement,
            ocioTextures: ctx.ocioTextures,
            ownedOcioTextures: ctx.ownedOcioTextures,
            fallbackSourceNode: null,
            getInputTextureForNode: (nodeId, targetFrame) => {
              const sourceNode = ctx.nodes.find((l) => l.id === nodeId);
              if (sourceNode && isMediaNodeWithRegistry(sourceNode, ctx.nodeRegistry)) {
                return ctx.getCachedMediaTexture(sourceNode, targetFrame);
              }
              return undefined;
            },
            getRotoMaskLayers: ctx.getRotoMaskLayers,
            getRotoAlphaMode: ctx.getRotoAlphaMode,
            getScratchRenderTarget: (key) => ctx.getUtilityOutputTarget(`__scratch:${key}`),
          }) as MaybePromise<boolean>;
          const adjThen = (ok: boolean): THREE.Texture | undefined =>
            ok ? target.texture : undefined;
          return isPromiseLike(adjResult)
            ? (adjResult as Promise<boolean>).then(adjThen)
            : adjThen(adjResult);
        }

        return undefined;
      };

      return isPromiseLike(inputResolved)
        ? inputResolved.then(renderWithInput)
        : renderWithInput(inputResolved);
    };

    const result = resolveInputAndRender();
    return tryReturn(result);
  } finally {
    ctx.utilityRenderStack.delete(cacheKey);
  }
}

export const renderWithSharedPipeline = async (
  options: RenderPipelineOptions,
): Promise<RenderPipelineResult> => {
  const frame = options.frame ?? 0;
  const blurRadiusScale = options.blurRadiusScale ?? 1;
  const textureCacheMode = options.textureCacheMode ?? 'none';
  const presentToCanvas = options.presentToCanvas ?? true;
  const keepRendererAlive = options.keepRendererAlive ?? false;
  const alphaOverlayStyle = resolveAlphaOverlayStyle(options.alphaOverlayStyle);
  const { nodeRegistry, getAsset } = options;
  const resolutionNodes = [...options.nodes];
  const resolutionNodeIds = new Set(resolutionNodes.map((node) => node.id));
  for (const node of options.captureSourceNodes ?? []) {
    if (!resolutionNodeIds.has(node.id)) {
      resolutionNodes.push(node);
      resolutionNodeIds.add(node.id);
    }
  }
  assertRendererProcessingDomainsSupported(resolutionNodes, (nodeType) =>
    nodeRegistry.get(nodeType),
  );
  const { isStackedExportAdjustmentNode, isExportAdjustmentType } =
    createNodePredicates(nodeRegistry);
  const finalSceneSize = { width: options.sceneNode.width, height: options.sceneNode.height };
  const outputRenderScale = {
    width: options.width / Math.max(1, finalSceneSize.width),
    height: options.height / Math.max(1, finalSceneSize.height),
  };
  let currentSceneSize = getInitialSceneSize(options.nodes, nodeRegistry, finalSceneSize);
  const renderContext: RenderContext = {
    frame,
    fps: options.sceneNode.fps || 30,
    scene: { ...currentSceneSize },
    nodes: options.nodes,
    transformColorPickingToSceneLinear: (color) =>
      options.colorManagement.transformRgb(
        options.colorManagement.colorPickingColorSpace,
        options.colorManagement.resolveColorSpaceName(options.sceneNode.colorSpace),
        color,
      ),
  };
  const setCurrentSceneSize = (size: RenderFormatSize) => {
    currentSceneSize = size;
    renderContext.scene = { ...size };
  };

  const canvas = options.canvas ?? options.renderer?.domElement ?? document.createElement('canvas');
  const ownsRenderer = !options.renderer;
  const renderer =
    options.renderer ??
    createStudioRenderer({
      canvas,
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
  assertWebGL2Renderer(renderer);
  assertFloatRenderTargetSupport(renderer);
  renderer.setSize(options.width, options.height);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const plane = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(plane);
  scene.add(quad);

  const materials = new Map<string, THREE.ShaderMaterial>();
  const renderTargetOptions = getRenderTargetOptionsForOutput(
    options.sceneNode,
    options.outputDomain,
  );
  const initialTargetSize = getScaledRenderTargetSize(currentSceneSize, outputRenderScale);
  const renderTargets = [
    new THREE.WebGLRenderTarget(
      initialTargetSize.width,
      initialTargetSize.height,
      renderTargetOptions,
    ),
    new THREE.WebGLRenderTarget(
      initialTargetSize.width,
      initialTargetSize.height,
      renderTargetOptions,
    ),
    new THREE.WebGLRenderTarget(
      initialTargetSize.width,
      initialTargetSize.height,
      renderTargetOptions,
    ),
  ];
  const finalOutputTarget = options.captureFinalOutput
    ? new THREE.WebGLRenderTarget(options.width, options.height, renderTargetOptions)
    : null;
  const capturedOutputTargets = new Map<string, THREE.WebGLRenderTarget>();

  const dynamicTextures: THREE.Texture[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const loadedTextures = new Map<string, THREE.Texture>();
  const ocioTextures = new Map<string, THREE.Texture>();
  const videos: HTMLVideoElement[] = [];
  const objectUrls: string[] = [];
  const extraTargets: THREE.WebGLRenderTarget[] = [];

  const dispose = () => {
    dynamicTextures.forEach((texture) => texture.dispose());
    ownedTextures.forEach((texture) => texture.dispose());
    videos.forEach((video) => {
      video.pause();
      video.src = '';
      video.load();
    });
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    materials.forEach((material) => material.dispose());
    renderTargets.forEach((target) => target.dispose());
    extraTargets.forEach((target) => target.dispose());
    finalOutputTarget?.dispose();
    plane.dispose();
    if (ownsRenderer && !keepRendererAlive) {
      renderer.dispose();
    }
  };

  try {
    const getMaterial = new StudioShaderMaterialCache({
      materials,
      renderer,
      scene,
      camera,
      mesh: quad,
    }).get;

    const loadTextureForMediaAsset = async ({
      key,
      assetId,
      isVideoLike,
      node,
      targetFrame,
    }: {
      key: string;
      assetId: string;
      isVideoLike: boolean;
      node: AnyNode;
      targetFrame: number;
    }): Promise<THREE.Texture | null> => {
      const existing = loadedTextures.get(key);
      if (existing) return existing;

      // Video nodes generate a new texture per frame — skip persistent cache.
      if (textureCacheMode === 'persistent' && !isVideoLike) {
        const cached = persistentTextureCache.get(assetId);
        if (cached) {
          loadedTextures.set(key, cached);
          return cached;
        }
      }

      const blob = await getAsset(assetId);
      if (!blob) return null;

      if (isVideoLike) {
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
          const video = document.createElement('video');
          videos.push(video);
          video.src = objectUrl;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.crossOrigin = 'anonymous';
          const fps = options.sceneNode.fps || 30;
          const targetTime = targetFrame / fps + 0.0001;

          const captureFrame = () => {
            try {
              // Draw the current video frame to a canvas so the pixel data
              // is available synchronously — THREE.VideoTexture relies on
              // requestVideoFrameCallback / rAF which may not have fired yet,
              // producing a blank texture for one-shot renders (thumbnails).
              const vw = video.videoWidth || 1;
              const vh = video.videoHeight || 1;
              const captureCanvas = document.createElement('canvas');
              captureCanvas.width = vw;
              captureCanvas.height = vh;
              const ctx = captureCanvas.getContext('2d');
              if (!ctx) {
                reject(new Error('Failed to create 2D context for video capture'));
                return;
              }
              ctx.drawImage(video, 0, 0, vw, vh);
              const canvasTexture = configureRawStraightAlphaTexture(
                new THREE.CanvasTexture(captureCanvas),
              );
              ownedTextures.push(canvasTexture);
              resolve(canvasTexture);
            } catch (err) {
              reject(new Error(`Failed to capture video frame: ${err}`));
            }
          };

          video.onloadedmetadata = () => {
            video.currentTime = Math.max(0, Math.min(targetTime, video.duration || targetTime));
          };
          video.onseeked = () => {
            captureFrame();
          };
          video.onerror = () => {
            reject(new Error(`Failed to decode video asset: ${assetId}`));
          };
        });

        loadedTextures.set(key, texture);
        return texture;
      }

      if (options.loadAssetTexture) {
        const customTexture = await options.loadAssetTexture({
          assetId,
          blob,
          node,
          frame: targetFrame,
        });
        if (customTexture) {
          if (textureCacheMode === 'persistent') {
            persistentTextureCache.set(assetId, customTexture);
          } else {
            ownedTextures.push(customTexture);
          }
          loadedTextures.set(key, customTexture);
          return customTexture;
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);

      const texture = await new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(
          objectUrl,
          (loadedTexture) => {
            configureRawStraightAlphaTexture(loadedTexture);
            resolve(loadedTexture);
          },
          undefined,
          () => reject(new Error(`Failed to decode image asset: ${assetId}`)),
        );
      });

      if (textureCacheMode === 'persistent') {
        persistentTextureCache.set(assetId, texture);
      } else {
        ownedTextures.push(texture);
      }
      loadedTextures.set(key, texture);
      return texture;
    };

    const loadTextureForMediaNode = async (
      node: AnyNode,
      targetFrame = frame,
    ): Promise<THREE.Texture | null> => {
      const sourceFrame = resolveMediaFrameFromRegistry(node, targetFrame, nodeRegistry);
      if (sourceFrame === null) return null;
      const key = getMediaTextureKeyFromRegistry(node, targetFrame, nodeRegistry);
      if (!key) return null;

      // For most media types the texture key doubles as the asset ID
      // (image, image-sequence). For video the key encodes the frame
      // number (`${src}:${frame}`) so we fall back to getAssetIds.
      const isVideoLike = isVideoFileNodeWithRegistry(node, nodeRegistry);
      const assetId = isVideoLike
        ? (getMediaAssetIdsFromRegistry(node, targetFrame, nodeRegistry)[0] ?? null)
        : key;
      if (!assetId) return null;

      return loadTextureForMediaAsset({
        key,
        assetId,
        isVideoLike,
        node,
        targetFrame: sourceFrame,
      });
    };

    const loadTextureForMediaLayer = async (
      node: AnyNode,
      layer: RendererMediaCompositeLayer,
      targetFrame = frame,
    ): Promise<THREE.Texture | null> => {
      const assetId = layer.assetId ?? layer.textureKey;
      if (!assetId) return null;
      return loadTextureForMediaAsset({
        key: layer.textureKey,
        assetId,
        isVideoLike: layer.isVideoFile === true,
        node,
        targetFrame,
      });
    };

    const visibleNodes = getVisiblePipelineNodes(options.nodes, nodeRegistry);
    const resolutionVisibleNodes = getVisiblePipelineNodes(resolutionNodes, nodeRegistry);

    const preloadTargets = new Map<string, InputPreloadTarget>();
    const addPreloadTarget = (node: AnyNode, targetFrame: number) => {
      preloadTargets.set(`${node.id}:${targetFrame}`, {
        node: node as MediaNode,
        frame: targetFrame,
      });
    };
    resolutionVisibleNodes.forEach((node) => {
      if (isMediaNodeWithRegistry(node, nodeRegistry)) {
        addPreloadTarget(node, frame);
      }
    });
    // Preload textures for all generic input port references
    collectInputPreloadTargets(
      resolutionVisibleNodes,
      resolutionNodes,
      nodeRegistry,
      frame,
    ).forEach((target) => addPreloadTarget(target.node, target.frame));
    await Promise.all(
      Array.from(preloadTargets.values(), async (target) => {
        const layers = getMediaCompositeLayersFromRegistry(
          target.node,
          target.frame,
          options.sceneNode,
          nodeRegistry,
          resolutionNodes,
        );
        if (layers.length > 0) {
          await Promise.all(
            layers.map((layer) => loadTextureForMediaLayer(target.node, layer, target.frame)),
          );
          return;
        }
        await loadTextureForMediaNode(target.node, target.frame);
      }),
    );

    let [readBuffer, writeBuffer] = renderTargets;
    const auxBuffer = renderTargets[2];
    const ensureTargetForSceneSize = (
      target: THREE.WebGLRenderTarget,
      size: RenderFormatSize = currentSceneSize,
    ) => ensureRenderTargetSize(target, size, outputRenderScale);
    const getCurrentPhysicalSize = () =>
      getScaledRenderTargetSize(currentSceneSize, outputRenderScale);
    const swapMainBuffers = () => {
      [readBuffer, writeBuffer] = [writeBuffer, readBuffer];
    };
    const copyTargetToWriteBuffer = (sourceTarget: THREE.WebGLRenderTarget) => {
      ensureTargetForSceneSize(writeBuffer);
      const copyMaterial = getMaterial('copy_to_main_write', RendererShader.TEXTURE, {
        u_tDiffuse: { value: sourceTarget.texture },
      });
      applyNoBlending(copyMaterial);
      quad.material = copyMaterial;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(scene, camera);
    };
    const utilityOutputTargets = new Map<string, THREE.WebGLRenderTarget>();
    const utilityRenderStack = new Set<string>();

    const getUtilityOutputTarget = (key: string): THREE.WebGLRenderTarget => {
      const existing = utilityOutputTargets.get(key);
      if (existing) {
        ensureTargetForSceneSize(existing);
        return existing;
      }
      const targetSize = getScaledRenderTargetSize(currentSceneSize, outputRenderScale);
      const target = new THREE.WebGLRenderTarget(
        targetSize.width,
        targetSize.height,
        renderTargetOptions,
      );
      utilityOutputTargets.set(key, target);
      extraTargets.push(target);
      return target;
    };

    const renderFullFrameTextureToTarget = (
      node: AnyNode,
      texture: THREE.Texture,
      target: THREE.WebGLRenderTarget,
    ) => {
      let width = currentSceneSize.width;
      let height = currentSceneSize.height;
      let scaleX = 1;
      let scaleY = 1;
      const offset = new THREE.Vector2(0, 0);
      if (isMediaNodeWithRegistry(node, nodeRegistry)) {
        width = node.width ?? width;
        height = node.height ?? height;
        if (node.transform) {
          scaleX = getValueAtFrame(node.transform.scaleX, frame);
          scaleY = getValueAtFrame(node.transform.scaleY, frame);
          offset.set(
            getValueAtFrame(node.transform.x, frame),
            getValueAtFrame(node.transform.y, frame),
          );
        }
      } else if (getRenderMode(node, nodeRegistry) === 'text') {
        const textNode = node as TextNode;
        width = texture.image?.width ?? width;
        height = texture.image?.height ?? height;
        offset.set(
          getValueAtFrame(textNode.position.x, frame),
          getValueAtFrame(textNode.position.y, frame),
        );
      }

      const ocioTransform = isMediaNodeWithRegistry(node, nodeRegistry)
        ? getMediaOcioColorSpaceTransform(
            node,
            nodeRegistry,
            options.sceneNode.colorSpace,
            options.colorManagement,
          )
        : null;
      const material = getMaterial(
        `${node.id}_utility_full_frame`,
        buildOcioTransformedTextureShader(ocioTransform, false),
        {
          u_tDiffuse: { value: texture },
          u_opacity: { value: 1 },
          u_scaleX: { value: scaleX },
          u_scaleY: { value: scaleY },
          u_offset: { value: offset },
          u_scene_res: {
            value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
          },
          u_image_res: { value: new THREE.Vector2(width, height) },
          u_source_alpha_mode: { value: getSourceAlphaModeUniform(node) },
          u_flipY: { value: false },
          ...getGeneratedColorUniforms(node, renderContext, nodeRegistry),
          ...createOcioUniforms(ocioTransform, ocioTextures, ownedTextures),
        },
      );
      applyNoBlending(material);
      quad.material = material;
      ensureTargetForSceneSize(target);
      clearRenderTargetTransparent(renderer, target);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    };

    const renderCompositeMediaLayersToTarget = async (
      node: AnyNode,
      layers: RendererMediaCompositeLayer[],
      target: THREE.WebGLRenderTarget,
    ): Promise<boolean> => {
      if (layers.length === 0) return false;

      const layerRead = getUtilityOutputTarget(`${node.id}:media-composite:read`);
      const layerWrite = getUtilityOutputTarget(`${node.id}:media-composite:write`);
      let readTarget = layerRead;
      let writeTarget = layerWrite;
      let renderedAnyLayer = false;
      clearRenderTargetTransparent(renderer, readTarget);

      for (const layer of layers) {
        const texture = await loadTextureForMediaLayer(node, layer, frame);
        if (!texture) continue;

        const differenceMask = layer.differenceMask;
        const differenceReferenceTexture = differenceMask
          ? await loadTextureForMediaAsset({
              key: differenceMask.textureKey,
              assetId: differenceMask.assetId ?? differenceMask.textureKey,
              isVideoLike: false,
              node,
              targetFrame: frame,
            })
          : null;
        const useDifferenceMask = Boolean(differenceMask && differenceReferenceTexture);

        const transform = layer.transform;
        const renderedDifferenceMask =
          differenceMask && differenceReferenceTexture
            ? renderDifferenceMaskTexture({
                renderer,
                scene,
                camera,
                quad,
                getMaterial,
                getTarget: (key) => getUtilityOutputTarget(key),
                ensureTarget: (maskTarget) => ensureTargetForSceneSize(maskTarget),
                resourceKey: `${node.id}:media-composite:difference-mask`,
                outputTexture: texture,
                referenceTexture: differenceReferenceTexture,
                layer,
                mask: differenceMask,
                sceneSize: currentSceneSize,
                frame,
              })
            : null;
        const ocioTransform = getMediaLayerOcioColorSpaceTransform(
          layer,
          options.sceneNode.colorSpace,
          options.colorManagement,
        );
        const material = getMaterial(
          `${node.id}:media-composite:${layer.id}:${useDifferenceMask ? 'difference-mask' : 'plain'}`,
          buildOcioTransformedTextureShader(ocioTransform, true, useDifferenceMask),
          {
            u_tBackdrop: { value: readTarget.texture },
            u_tDiffuse: { value: texture },
            u_opacity: { value: getValueAtFrame(layer.opacity ?? 100, frame) / 100 },
            u_scaleX: { value: getValueAtFrame(transform?.scaleX ?? 1, frame) },
            u_scaleY: { value: getValueAtFrame(transform?.scaleY ?? 1, frame) },
            u_offset: {
              value: new THREE.Vector2(
                getValueAtFrame(transform?.x ?? 0, frame),
                getValueAtFrame(transform?.y ?? 0, frame),
              ),
            },
            u_scene_res: {
              value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
            },
            u_image_res: { value: new THREE.Vector2(layer.width, layer.height) },
            u_source_alpha_mode: { value: getSourceAlphaModeUniform(layer) },
            u_flipY: { value: false },
            ...(useDifferenceMask && differenceMask && renderedDifferenceMask
              ? {
                  u_tDifferenceMask: { value: renderedDifferenceMask },
                  u_difference_invert: { value: differenceMask.invert === true },
                  u_difference_preview_mode: { value: 0 },
                }
              : {}),
            ...getGeneratedColorUniforms(node, renderContext, nodeRegistry),
            ...createOcioUniforms(ocioTransform, ocioTextures, ownedTextures),
          },
        );
        applyNoBlending(material);
        quad.material = material;
        ensureTargetForSceneSize(writeTarget);
        renderer.setRenderTarget(writeTarget);
        renderer.render(scene, camera);
        renderedAnyLayer = true;
        [readTarget, writeTarget] = [writeTarget, readTarget];
      }

      if (!renderedAnyLayer) return false;

      const copyMaterial = getMaterial(`${node.id}:media-composite:copy`, RendererShader.TEXTURE, {
        u_tDiffuse: { value: readTarget.texture },
      });
      applyNoBlending(copyMaterial);
      quad.material = copyMaterial;
      ensureTargetForSceneSize(target);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      return true;
    };

    const renderNodeOutputTexture = async (
      nodeId: string,
      sourcePortName = 'output',
    ): Promise<THREE.Texture | undefined> => {
      const resolveCtx: NodeOutputResolveContext = {
        renderer,
        scene,
        camera,
        quad,
        getMaterial,
        nodes: resolutionNodes,
        frame,
        sceneNode: options.sceneNode,
        currentSceneSize,
        blurRadiusScale,
        renderTargetOptions,
        nodeRegistry,
        compositeBuffer: readBuffer,
        getUtilityOutputTarget,
        utilityRenderStack,
        checkCache: (key) => utilityOutputTargets.has(key),
        markCache: () => {},
        renderContext,
        colorManagement: options.colorManagement,
        ocioTextures,
        ownedOcioTextures: ownedTextures,
        getMediaTexture: (n, f) => loadTextureForMediaNode(n, f),
        getTextTexture: (n) => {
          const tt = buildTextTexture(n as TextNode, frame, dynamicTextures);
          return { texture: tt.texture, width: tt.width, height: tt.height };
        },
        renderCompositeMediaToTarget: renderCompositeMediaLayersToTarget,
        renderFullFrameTextureToTarget,
        getCachedMediaTexture: (n, f) => {
          if (isMediaNodeWithRegistry(n, nodeRegistry)) {
            const key = getMediaTextureKeyFromRegistry(n, f, nodeRegistry);
            return key ? loadedTextures.get(key) : undefined;
          }
          return undefined;
        },
        getRotoMaskLayers: options.getRotoMaskLayers,
        getRotoAlphaMode: options.getRotoAlphaMode,
      };
      const result = resolveNodeOutputTexture(
        nodeId,
        sourcePortName,
        resolveCtx,
        renderNodeOutputTexture,
      );
      return isPromiseLike(result) ? result : Promise.resolve(result);
    };
    const getPipeInputTexture = async (node: AnyNode): Promise<THREE.Texture> => {
      const sourceNodeId = (node as { inputs?: Record<string, string> }).inputs?.pipe;
      if (!sourceNodeId) return getTransparentInputTexture();

      // Source nodes with visible branch inputs are already composited into the
      // active branch buffer; preserve that complete canonical input branch.
      const sourceNode = resolutionNodes.find((n) => n.id === sourceNodeId);
      if (sourceNode) {
        const def = nodeRegistry.get(sourceNode.type);
        if (def?.flags?.isSource) {
          const hiddenPortIds = new Set(
            (sourceNode as { hiddenInputPortIds?: string[] }).hiddenInputPortIds ?? [],
          );
          const nonPipeInputs = Object.entries(sourceNode.inputs ?? {}).filter(
            ([portName]) => portName !== 'pipe' && !hiddenPortIds.has(portName),
          );
          const hasEnabledInput = nonPipeInputs.some(([_portName, sourceId]) => {
            const upstreamNode = resolutionNodes.find((n) => n.id === sourceId);
            return upstreamNode && upstreamNode.enabled !== false;
          });
          if (hasEnabledInput) {
            return readBuffer.texture;
          }
        }
      }

      return (
        (await renderNodeOutputTexture(sourceNodeId, getInputSourcePort(node, 'pipe'))) ??
        getTransparentInputTexture()
      );
    };
    const renderStraightOverToMain = (
      material: THREE.ShaderMaterial,
      target: THREE.WebGLRenderTarget = writeBuffer,
    ) => {
      applyNoBlending(material);
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (target !== writeBuffer) {
        copyTargetToWriteBuffer(target);
      }
      swapMainBuffers();
    };
    ensureTargetForSceneSize(readBuffer);
    ensureTargetForSceneSize(writeBuffer);
    ensureTargetForSceneSize(auxBuffer);
    clearRenderTargetTransparent(renderer, readBuffer);

    let previousMediaNode: AnyNode | null = null;
    for (let i = 0; i < visibleNodes.length; i += 1) {
      const baseNode = visibleNodes[i];
      ensureTargetForSceneSize(readBuffer);
      ensureTargetForSceneSize(writeBuffer);
      ensureTargetForSceneSize(auxBuffer);

      const baseMode = getRenderMode(baseNode, nodeRegistry);

      if (baseMode === 'utility') {
        const renderedUtility = await renderUtilityNodeToTarget({
          renderer,
          scene,
          camera,
          quad,
          getMaterial,
          node: baseNode,
          sourcePortName:
            options.outputDomain?.sourceNodeId === baseNode.id
              ? options.outputDomain.sourcePort
              : undefined,
          outputTarget: writeBuffer,
          renderNodeOutputTexture,
        });
        if (renderedUtility) {
          swapMainBuffers();
        }
      } else if (baseMode === 'media' || baseMode === 'text') {
        if (isMediaNodeWithRegistry(baseNode, nodeRegistry)) {
          previousMediaNode = baseNode;
        }
        let texture: THREE.Texture | null = null;
        let width = 0;
        let height = 0;
        let isDynamicTexture = false;
        let scaleX = 1;
        let scaleY = 1;
        const offset = new THREE.Vector2(0, 0);
        let opacity = 100;
        let baseOcioTransform: RendererOcioShaderInfo | null = null;

        if (isMediaNodeWithRegistry(baseNode, nodeRegistry)) {
          const compositeLayers = getMediaCompositeLayersFromRegistry(
            baseNode,
            frame,
            options.sceneNode,
            nodeRegistry,
            options.nodes,
          );
          if (compositeLayers.length > 0) {
            const compositeTarget = getUtilityOutputTarget(`${baseNode.id}:media-composite:main`);
            const renderedComposite = await renderCompositeMediaLayersToTarget(
              baseNode,
              compositeLayers,
              compositeTarget,
            );
            if (!renderedComposite) continue;
            texture = compositeTarget.texture;
            width = currentSceneSize.width;
            height = currentSceneSize.height;
          } else {
            texture = await loadTextureForMediaNode(baseNode);
            if (!texture) {
              continue;
            }
            width = baseNode.width;
            height = baseNode.height;
            if (baseNode.transform) {
              scaleX = getValueAtFrame(baseNode.transform.scaleX, frame);
              scaleY = getValueAtFrame(baseNode.transform.scaleY, frame);
              offset.set(
                getValueAtFrame(baseNode.transform.x, frame),
                getValueAtFrame(baseNode.transform.y, frame),
              );
            }
            baseOcioTransform = getMediaOcioColorSpaceTransform(
              baseNode,
              nodeRegistry,
              options.sceneNode.colorSpace,
              options.colorManagement,
            );
          }
          opacity = getValueAtFrame(baseNode.opacity, frame);
        } else {
          const textNode = baseNode as TextNode;
          const textTexture = buildTextTexture(textNode, frame, dynamicTextures);
          texture = textTexture.texture;
          width = textTexture.width;
          height = textTexture.height;
          offset.set(
            getValueAtFrame(textNode.position.x, frame),
            getValueAtFrame(textNode.position.y, frame),
          );
          opacity = getValueAtFrame(textNode.opacity, frame);
          isDynamicTexture = true;
        }

        const { stackedNodes, consumedCount } = collectAdjacentStackedNodes(
          visibleNodes,
          i,
          isStackedExportAdjustmentNode,
        );

        let finalComposite: THREE.ShaderMaterial;
        let straightOverTarget = writeBuffer;
        if (stackedNodes.length > 0) {
          let stackRead = writeBuffer;
          let stackWrite = auxBuffer;

          clearRenderTargetTransparent(renderer, stackRead);
          const basePass = getMaterial(
            `${baseNode.id}_stack_base`,
            buildOcioTransformedTextureShader(baseOcioTransform, false),
            {
              u_tDiffuse: { value: texture },
              u_opacity: { value: 1 },
              u_scaleX: { value: scaleX },
              u_scaleY: { value: scaleY },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
              u_flipY: { value: false },
              ...getGeneratedColorUniforms(baseNode, renderContext, nodeRegistry),
              ...createOcioUniforms(baseOcioTransform, ocioTextures, ownedTextures),
            },
          );
          quad.material = basePass;
          renderer.render(scene, camera);

          for (const stackedNode of stackedNodes) {
            const physicalSize = getCurrentPhysicalSize();
            const shouldSwap = await renderAdjustmentNodeToTarget({
              renderer,
              scene,
              camera,
              quad,
              getMaterial,
              nodeRegistry,
              renderContext,
              node: stackedNode,
              inputTexture: stackRead.texture,
              outputTarget: stackWrite,
              width: physicalSize.width,
              height: physicalSize.height,
              blurRadiusScale,
              renderTargetOptions,
              sceneColorSpace: options.sceneNode.colorSpace,
              colorManagement: options.colorManagement,
              ocioTextures,
              ownedOcioTextures: ownedTextures,
              fallbackSourceNode: baseNode,
              getInputTextureForNode: (nodeId, targetFrame) => {
                const sourceNode = options.nodes.find((l) => l.id === nodeId);
                if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
                  const key = getMediaTextureKeyFromRegistry(sourceNode, targetFrame, nodeRegistry);
                  return key ? loadedTextures.get(key) : undefined;
                }
                return undefined;
              },
              getRotoMaskLayers: options.getRotoMaskLayers,
              getRotoAlphaMode: options.getRotoAlphaMode,
              getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
            });

            if (shouldSwap) {
              [stackRead, stackWrite] = [stackWrite, stackRead];
            }
          }

          const { operator } = getNodeBlendProps(baseNode);
          if (operator === BlendMode.OVER) {
            straightOverTarget = stackRead === writeBuffer ? auxBuffer : writeBuffer;
            finalComposite = getMaterial(
              `${baseNode.id}_stack_comp_straight_over`,
              RendererShader.STRAIGHT_TEXTURE_OVER,
              {
                u_tBackdrop: { value: readBuffer.texture },
                u_tDiffuse: { value: stackRead.texture },
                u_opacity: { value: opacity / 100 },
              },
            );
          } else {
            finalComposite = getMaterial(
              `${baseNode.id}_stack_comp`,
              RendererShader.TEXTURE_OPACITY,
              {
                u_tDiffuse: { value: stackRead.texture },
                u_opacity: { value: opacity / 100 },
              },
            );
          }
        } else {
          const { operator } = getNodeBlendProps(baseNode);
          if (operator === BlendMode.OVER) {
            finalComposite = getMaterial(
              `${baseNode.id}_comp_straight_over`,
              buildOcioTransformedTextureShader(baseOcioTransform, true),
              {
                u_tBackdrop: { value: readBuffer.texture },
                u_tDiffuse: { value: texture },
                u_opacity: { value: opacity / 100 },
                u_scaleX: { value: scaleX },
                u_scaleY: { value: scaleY },
                u_offset: { value: offset },
                u_scene_res: {
                  value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
                },
                u_image_res: { value: new THREE.Vector2(width, height) },
                u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
                u_flipY: { value: false },
                ...getGeneratedColorUniforms(baseNode, renderContext, nodeRegistry),
                ...createOcioUniforms(baseOcioTransform, ocioTextures, ownedTextures),
              },
            );
          } else {
            finalComposite = getMaterial(
              `${baseNode.id}_comp`,
              buildOcioTransformedTextureShader(baseOcioTransform, false),
              {
                u_tDiffuse: { value: texture },
                u_opacity: { value: opacity / 100 },
                u_scaleX: { value: scaleX },
                u_scaleY: { value: scaleY },
                u_offset: { value: offset },
                u_scene_res: {
                  value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
                },
                u_image_res: { value: new THREE.Vector2(width, height) },
                u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
                u_flipY: { value: false },
                ...getGeneratedColorUniforms(baseNode, renderContext, nodeRegistry),
                ...createOcioUniforms(baseOcioTransform, ocioTextures, ownedTextures),
              },
            );
          }
        }

        const { operator } = getNodeBlendProps(baseNode);
        if (operator === BlendMode.OVER) {
          renderStraightOverToMain(finalComposite, straightOverTarget);
        } else {
          quad.material = finalComposite;
          applyBlendMode(finalComposite, operator);
          renderer.setRenderTarget(readBuffer);
          renderer.render(scene, camera);
        }

        if (isDynamicTexture) {
          texture?.dispose();
        }
        i += consumedCount;
      } else if (baseMode === 'merge') {
        await renderMergeNodeToTarget({
          renderer,
          scene,
          camera,
          quad,
          getMaterial,
          node: baseNode,
          nodes: options.nodes,
          frame,
          outputTarget: readBuffer,
          renderNodeOutputTexture,
        });
      } else if (
        isExportAdjustmentType(baseNode.type) &&
        !isStackedExportAdjustmentNode(baseNode)
      ) {
        const adjustmentInputTexture = await getPipeInputTexture(baseNode);
        const outputSceneSizeOverride = getNodeOutputSceneSize(
          baseNode,
          nodeRegistry,
          renderContext,
        );
        const outputSceneSize = outputSceneSizeOverride ?? currentSceneSize;
        ensureTargetForSceneSize(writeBuffer, outputSceneSize);
        const physicalSize = getCurrentPhysicalSize();
        const rendered = await renderAdjustmentNodeToTarget({
          renderer,
          scene,
          camera,
          quad,
          getMaterial,
          nodeRegistry,
          renderContext,
          node: baseNode,
          inputTexture: adjustmentInputTexture,
          outputTarget: writeBuffer,
          width: physicalSize.width,
          height: physicalSize.height,
          blurRadiusScale,
          renderTargetOptions,
          sceneColorSpace: options.sceneNode.colorSpace,
          colorManagement: options.colorManagement,
          ocioTextures,
          ownedOcioTextures: ownedTextures,
          fallbackSourceNode: previousMediaNode,
          getInputTextureForNode: (nodeId, targetFrame) => {
            const sourceNode = options.nodes.find((l) => l.id === nodeId);
            if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
              const key = getMediaTextureKeyFromRegistry(sourceNode, targetFrame, nodeRegistry);
              return key ? loadedTextures.get(key) : undefined;
            }
            return undefined;
          },
          getRotoMaskLayers: options.getRotoMaskLayers,
          getRotoAlphaMode: options.getRotoAlphaMode,
          getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
          shaderId: `${baseNode.id}_global`,
        });

        if (rendered) {
          swapMainBuffers();
          if (outputSceneSizeOverride) {
            setCurrentSceneSize(outputSceneSizeOverride);
          }
        }
      }
    }

    for (const capture of options.captureOutputs ?? []) {
      if (capturedOutputTargets.has(capture.id)) {
        throw new Error(`Duplicate render output capture id "${capture.id}".`);
      }
      const texture = await renderNodeOutputTexture(capture.nodeId, capture.sourcePort);
      if (!texture) {
        throw new Error(
          `Failed to resolve render output capture "${capture.id}" from ${capture.nodeId}/${capture.sourcePort}.`,
        );
      }

      const target = new THREE.WebGLRenderTarget(options.width, options.height, {
        ...renderTargetOptions,
        type: THREE.FloatType,
      });
      extraTargets.push(target);
      capturedOutputTargets.set(capture.id, target);

      const material = getMaterial(`capture:${capture.id}`, RendererShader.TEXTURE, {
        u_tDiffuse: { value: texture },
      });
      applyNoBlending(material);
      quad.material = material;
      clearRenderTargetTransparent(renderer, target);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }

    let finalMaterial: THREE.ShaderMaterial;
    if (
      options.outputDomain?.kind === 'data' ||
      options.finalColorSpace === 'raw_texture' ||
      options.finalColorSpace === 'scene_linear'
    ) {
      finalMaterial = getMaterial('final_raw', RendererShader.TEXTURE, {
        u_tDiffuse: { value: readBuffer.texture },
      });
    } else if (options.finalColorSpace === 'color_space') {
      const ocioTransform = getOcioOutputColorSpaceTransform(
        options.sceneNode.colorSpace,
        options.outputColorSpace,
        options.colorManagement,
      );
      finalMaterial = createSceneLinearOutputMaterial({
        materialKey: 'final_color_space',
        inputTexture: readBuffer.texture,
        ocioTransform,
        ocioTextures,
        ownedTextures,
        getMaterial,
      });
    } else if (options.finalColorSpace === 'srgb') {
      const ocioTransform = getOcioOutputColorSpaceTransform(
        options.sceneNode.colorSpace,
        options.outputColorSpace || options.colorManagement.textureColorSpace,
        options.colorManagement,
      );
      finalMaterial = createColorManagedOutputMaterial({
        materialKey: 'final_srgb',
        inputTexture: readBuffer.texture,
        ocioTransform,
        alphaOverlayStyle,
        ocioTextures,
        ownedTextures,
        getMaterial,
      });
    } else {
      const viewerSettings = options.viewerSettings;
      if (!viewerSettings) {
        throw new Error('viewerSettings is required when finalColorSpace is match_viewport.');
      }
      const displayView = options.displayView;
      if (!displayView) {
        throw new Error('displayView is required when finalColorSpace is match_viewport.');
      }
      finalMaterial = createDisplayViewOutputMaterial({
        materialKey: 'final_viewport',
        inputTexture: readBuffer.texture,
        sceneColorSpace: options.sceneNode.colorSpace,
        viewerSettings,
        displayView,
        preserveAlpha: options.preserveAlpha,
        alphaOverlayStyle,
        colorManagement: options.colorManagement,
        ocioTextures,
        ownedTextures,
        getMaterial,
      });
    }

    quad.material = finalMaterial;

    if (finalOutputTarget) {
      clearRenderTargetTransparent(renderer, finalOutputTarget);
      renderer.render(scene, camera);
    }

    if (presentToCanvas) {
      clearRenderTargetTransparent(renderer, null);
      renderer.render(scene, camera);
    }
    return { canvas, renderer, finalOutputTarget, capturedOutputTargets, dispose };
  } catch (error) {
    dispose();
    if (ownsRenderer && keepRendererAlive) {
      renderer.dispose();
    }
    throw error;
  }
};

/**
 * Unified pipeline resources — same shape as ViewportPipelineResources.
 * Used by the unified renderPipeline() entry point.
 */
export type PipelineResources = ViewportPipelineResources;

/**
 * Unified render pipeline entry point.
 * The primary export for rendering. For async export/offscreen rendering this
 * delegates to renderWithSharedPipeline. The renderNodeOutputTexture dispatch
 * logic is shared between both export and viewport paths via the module-level
 * resolveNodeOutputTexture() function.
 */
export const renderPipeline = renderWithSharedPipeline;

export interface ViewportPipelineResources {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  materials: Map<string, THREE.ShaderMaterial>;
  renderTargets: THREE.WebGLRenderTarget[];
  utilityTargets?: Map<string, THREE.WebGLRenderTarget>;
  ocioTextures?: Map<string, THREE.Texture>;
}

export interface ViewportPipelineOptions {
  resources: ViewportPipelineResources;
  nodes: AnyNode[];
  sceneNode: SceneNode;
  frame: number;
  viewerSettings: ViewerSettings;
  displayView: DisplayViewSelection;
  outputDomain?: RenderOutputDomain;
  alphaOverlayStyle?: AlphaOverlayStyle;
  colorManagement: RendererColorManagement;
  getMediaTexture: (node: MediaNode, frame: number) => THREE.Texture | undefined;
  getMediaTextureByKey?: (
    key: string,
    assetId: string | undefined,
    isVideoLike: boolean,
  ) => THREE.Texture | undefined;
  getTextTexture: (
    node: TextNode,
  ) => { texture: THREE.Texture; width: number; height: number } | undefined;
  getRotoMaskLayers?: (nodeId: string) => readonly RendererMaskLayer[] | undefined;
  getRotoAlphaMode?: (nodeId: string) => number;
  captureDisplayOutput?: boolean;
  /**
   * Whether to resize and present the viewer output to the renderer canvas.
   * Disable this for offscreen passes whose captured output is composited later.
   */
  presentToCanvas?: boolean;
  nodeRegistry: NodeRegistryLike;
}

export interface ViewportPipelineResult {
  renderTargets: THREE.WebGLRenderTarget[];
  /** Scene-linear composite before the terminal display/view transform. */
  finalCompositeTarget: THREE.WebGLRenderTarget | null;
  /** Terminal viewer output captured with the same material used for canvas presentation. */
  displayOutputTarget: THREE.WebGLRenderTarget | null;
}

export const renderViewportFrameWithSharedPipeline = (
  options: ViewportPipelineOptions,
): ViewportPipelineResult => {
  const {
    resources,
    nodes,
    sceneNode,
    frame,
    viewerSettings,
    displayView,
    colorManagement,
    getMediaTexture,
    getMediaTextureByKey,
    getTextTexture,
    getRotoMaskLayers,
    getRotoAlphaMode,
    nodeRegistry,
  } = options;
  assertRendererProcessingDomainsSupported(nodes, (nodeType) => nodeRegistry.get(nodeType));
  const alphaOverlayStyle = resolveAlphaOverlayStyle(options.alphaOverlayStyle);
  const { isStackedAdjustmentNode, isStackAdjustmentType } = createNodePredicates(nodeRegistry);
  const finalSceneSize = { width: sceneNode.width, height: sceneNode.height };
  const outputRenderScale = { width: 1, height: 1 };
  let currentSceneSize = getInitialSceneSize(nodes, nodeRegistry, finalSceneSize);
  const renderContext: RenderContext = {
    frame,
    fps: sceneNode.fps || 30,
    scene: { ...currentSceneSize },
    nodes: nodes,
    transformColorPickingToSceneLinear: (color) =>
      colorManagement.transformRgb(
        colorManagement.colorPickingColorSpace,
        colorManagement.resolveColorSpaceName(sceneNode.colorSpace),
        color,
      ),
  };
  const setCurrentSceneSize = (size: RenderFormatSize) => {
    currentSceneSize = size;
    renderContext.scene = { ...size };
  };

  const renderer = resources.renderer;
  resources.ocioTextures ??= new Map<string, THREE.Texture>();
  assertWebGL2Renderer(renderer);
  assertFloatRenderTargetSupport(renderer);
  const presentToCanvas = options.presentToCanvas !== false;
  if (presentToCanvas) {
    const rendererSize =
      typeof renderer.getSize === 'function' ? renderer.getSize(new THREE.Vector2()) : null;
    if (
      !rendererSize ||
      rendererSize.x !== sceneNode.width ||
      rendererSize.y !== sceneNode.height
    ) {
      renderer.setSize(sceneNode.width, sceneNode.height);
    }
  }
  renderer.autoClear = false;

  const renderTargetOptions = getRenderTargetOptionsForOutput(sceneNode, options.outputDomain);

  let renderTargets = resources.renderTargets;
  if (
    renderTargets.length !== 3 ||
    renderTargets.some((target) => !renderTargetMatchesOptions(target, renderTargetOptions))
  ) {
    renderTargets.forEach((target) => target.dispose());
    resources.utilityTargets?.forEach((target) => target.dispose());
    resources.utilityTargets?.clear();

    renderTargets = [
      new THREE.WebGLRenderTarget(
        currentSceneSize.width,
        currentSceneSize.height,
        renderTargetOptions,
      ),
      new THREE.WebGLRenderTarget(
        currentSceneSize.width,
        currentSceneSize.height,
        renderTargetOptions,
      ),
      new THREE.WebGLRenderTarget(
        currentSceneSize.width,
        currentSceneSize.height,
        renderTargetOptions,
      ),
    ];
  }
  // The resources object owns the active pool. Keeping this assignment inside
  // the pipeline prevents callers from accidentally retaining the old empty or
  // wrong-sized array and leaking the newly allocated targets.
  resources.renderTargets = renderTargets;

  let [readBuffer, writeBuffer] = renderTargets;
  const auxBuffer = renderTargets[2];
  const ensureTargetForSceneSize = (
    target: THREE.WebGLRenderTarget,
    size: RenderFormatSize = currentSceneSize,
  ) => ensureRenderTargetSize(target, size, outputRenderScale);
  const getMaterial = new StudioShaderMaterialCache({
    materials: resources.materials,
    renderer,
    scene: resources.scene,
    camera: resources.camera,
    mesh: resources.quad,
  }).get;
  const swapMainBuffers = () => {
    [readBuffer, writeBuffer] = [writeBuffer, readBuffer];
  };
  const copyTargetToWriteBuffer = (sourceTarget: THREE.WebGLRenderTarget) => {
    ensureTargetForSceneSize(writeBuffer);
    const copyMaterial = getMaterial('copy_to_main_write', RendererShader.TEXTURE, {
      u_tDiffuse: { value: sourceTarget.texture },
    });
    applyNoBlending(copyMaterial);
    resources.quad.material = copyMaterial;
    renderer.setRenderTarget(writeBuffer);
    renderer.render(resources.scene, resources.camera);
  };
  resources.utilityTargets ??= new Map<string, THREE.WebGLRenderTarget>();
  const utilityRenderedThisFrame = new Set<string>();
  const utilityRenderStack = new Set<string>();

  const getUtilityOutputTarget = (key: string): THREE.WebGLRenderTarget => {
    const existing = resources.utilityTargets?.get(key);
    if (existing) {
      ensureTargetForSceneSize(existing);
      return existing;
    }
    const target = new THREE.WebGLRenderTarget(
      currentSceneSize.width,
      currentSceneSize.height,
      renderTargetOptions,
    );
    resources.utilityTargets!.set(key, target);
    return target;
  };

  const renderFullFrameTextureToTarget = (
    node: AnyNode,
    texture: THREE.Texture,
    target: THREE.WebGLRenderTarget,
    textureSize?: { width: number; height: number },
  ) => {
    let width = textureSize?.width ?? currentSceneSize.width;
    let height = textureSize?.height ?? currentSceneSize.height;
    let scaleX = 1;
    let scaleY = 1;
    const offset = new THREE.Vector2(0, 0);

    if (isMediaNodeWithRegistry(node, nodeRegistry)) {
      width = (node as MediaNode).width ?? width;
      height = (node as MediaNode).height ?? height;
      scaleX = getValueAtFrame((node as MediaNode).transform.scaleX, frame);
      scaleY = getValueAtFrame((node as MediaNode).transform.scaleY, frame);
      offset.set(
        getValueAtFrame((node as MediaNode).transform.x, frame),
        getValueAtFrame((node as MediaNode).transform.y, frame),
      );
    } else if (getRenderMode(node, nodeRegistry) === 'text') {
      const textNode = node as TextNode;
      offset.set(
        getValueAtFrame(textNode.position.x, frame),
        getValueAtFrame(textNode.position.y, frame),
      );
    }

    const ocioTransform = isMediaNodeWithRegistry(node, nodeRegistry)
      ? getMediaOcioColorSpaceTransform(node, nodeRegistry, sceneNode.colorSpace, colorManagement)
      : null;
    const material = getMaterial(
      `${node.id}_utility_full_frame`,
      buildOcioTransformedTextureShader(ocioTransform, false),
      {
        u_tDiffuse: { value: texture },
        u_opacity: { value: 1 },
        u_scaleX: { value: scaleX },
        u_scaleY: { value: scaleY },
        u_offset: { value: offset },
        u_scene_res: { value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height) },
        u_image_res: { value: new THREE.Vector2(width, height) },
        u_source_alpha_mode: { value: getSourceAlphaModeUniform(node) },
        u_flipY: { value: false },
        ...getGeneratedColorUniforms(node, renderContext, nodeRegistry),
        ...createOcioUniforms(ocioTransform, resources.ocioTextures!),
      },
    );
    applyNoBlending(material);
    resources.quad.material = material;
    ensureTargetForSceneSize(target);
    clearRenderTargetTransparent(renderer, target);
    renderer.setRenderTarget(target);
    renderer.render(resources.scene, resources.camera);
  };

  const renderCompositeMediaLayersToTarget = (
    node: AnyNode,
    layers: RendererMediaCompositeLayer[],
    target: THREE.WebGLRenderTarget,
  ): boolean => {
    if (layers.length === 0) return false;

    const layerRead = getUtilityOutputTarget(`${node.id}:media-composite:read`);
    const layerWrite = getUtilityOutputTarget(`${node.id}:media-composite:write`);
    let readTarget = layerRead;
    let writeTarget = layerWrite;
    let renderedAnyLayer = false;
    clearRenderTargetTransparent(renderer, readTarget);

    for (const layer of layers) {
      const texture = getMediaTextureByKey?.(
        layer.textureKey,
        layer.assetId,
        layer.isVideoFile === true,
      );
      if (!texture) continue;

      const differenceMask = layer.differenceMask;
      const differenceReferenceTexture = differenceMask
        ? getMediaTextureByKey?.(differenceMask.textureKey, differenceMask.assetId, false)
        : null;
      const useDifferenceMask = Boolean(differenceMask && differenceReferenceTexture);

      const transform = layer.transform;
      const renderedDifferenceMask =
        differenceMask && differenceReferenceTexture
          ? renderDifferenceMaskTexture({
              renderer,
              scene: resources.scene,
              camera: resources.camera,
              quad: resources.quad,
              getMaterial,
              getTarget: (key) => getUtilityOutputTarget(key),
              ensureTarget: (maskTarget) => ensureTargetForSceneSize(maskTarget),
              resourceKey: `${node.id}:media-composite:difference-mask`,
              outputTexture: texture,
              referenceTexture: differenceReferenceTexture,
              layer,
              mask: differenceMask,
              sceneSize: currentSceneSize,
              frame,
            })
          : null;
      const ocioTransform = getMediaLayerOcioColorSpaceTransform(
        layer,
        sceneNode.colorSpace,
        colorManagement,
      );
      const material = getMaterial(
        `${node.id}:media-composite:${layer.id}:${useDifferenceMask ? 'difference-mask' : 'plain'}`,
        buildOcioTransformedTextureShader(ocioTransform, true, useDifferenceMask),
        {
          u_tBackdrop: { value: readTarget.texture },
          u_tDiffuse: { value: texture },
          u_opacity: { value: getValueAtFrame(layer.opacity ?? 100, frame) / 100 },
          u_scaleX: { value: getValueAtFrame(transform?.scaleX ?? 1, frame) },
          u_scaleY: { value: getValueAtFrame(transform?.scaleY ?? 1, frame) },
          u_offset: {
            value: new THREE.Vector2(
              getValueAtFrame(transform?.x ?? 0, frame),
              getValueAtFrame(transform?.y ?? 0, frame),
            ),
          },
          u_scene_res: {
            value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
          },
          u_image_res: { value: new THREE.Vector2(layer.width, layer.height) },
          u_source_alpha_mode: { value: getSourceAlphaModeUniform(layer) },
          u_flipY: { value: false },
          ...(useDifferenceMask && differenceMask && renderedDifferenceMask
            ? {
                u_tDifferenceMask: { value: renderedDifferenceMask },
                u_difference_invert: { value: differenceMask.invert === true },
                u_difference_preview_mode: {
                  value:
                    differenceMask.previewMode === 'overlay'
                      ? 1
                      : differenceMask.previewMode === 'matte'
                        ? 2
                        : 0,
                },
              }
            : {}),
          ...getGeneratedColorUniforms(node, renderContext, nodeRegistry),
          ...createOcioUniforms(ocioTransform, resources.ocioTextures!),
        },
      );
      applyNoBlending(material);
      resources.quad.material = material;
      ensureTargetForSceneSize(writeTarget);
      renderer.setRenderTarget(writeTarget);
      renderer.render(resources.scene, resources.camera);
      renderedAnyLayer = true;
      [readTarget, writeTarget] = [writeTarget, readTarget];
    }

    if (!renderedAnyLayer) return false;

    const copyMaterial = getMaterial(`${node.id}:media-composite:copy`, RendererShader.TEXTURE, {
      u_tDiffuse: { value: readTarget.texture },
    });
    applyNoBlending(copyMaterial);
    resources.quad.material = copyMaterial;
    ensureTargetForSceneSize(target);
    renderer.setRenderTarget(target);
    renderer.render(resources.scene, resources.camera);
    return true;
  };

  const renderNodeOutputTexture = (
    nodeId: string,
    sourcePortName = 'output',
  ): THREE.Texture | undefined => {
    const resolveCtx: NodeOutputResolveContext = {
      renderer,
      scene: resources.scene,
      camera: resources.camera,
      quad: resources.quad,
      getMaterial,
      nodes,
      frame,
      sceneNode,
      currentSceneSize,
      blurRadiusScale: 1,
      renderTargetOptions,
      nodeRegistry,
      compositeBuffer: readBuffer,
      getUtilityOutputTarget,
      utilityRenderStack,
      checkCache: (key) => utilityRenderedThisFrame.has(key),
      markCache: (key) => utilityRenderedThisFrame.add(key),
      renderContext,
      colorManagement,
      ocioTextures: resources.ocioTextures!,
      getMediaTexture: (n, f) => getMediaTexture(n as MediaNode, f),
      getTextTexture: (n) => getTextTexture(n as TextNode),
      renderCompositeMediaToTarget: renderCompositeMediaLayersToTarget,
      renderFullFrameTextureToTarget,
      getCachedMediaTexture: (n, f) => getMediaTexture(n as MediaNode, f),
      getRotoMaskLayers,
      getRotoAlphaMode,
      onAsyncInSync: () => {
        throw new Error('Viewport renderNodeOutputTexture must remain synchronous.');
      },
    };
    const result = resolveNodeOutputTexture(
      nodeId,
      sourcePortName,
      resolveCtx,
      renderNodeOutputTexture,
    );
    if (isPromiseLike(result)) {
      throw new Error('Viewport renderNodeOutputTexture must remain synchronous.');
    }
    return result;
  };
  const getPipeInputTexture = (node: AnyNode): THREE.Texture => {
    const sourceNodeId = (node as { inputs?: Record<string, string> }).inputs?.pipe;
    if (!sourceNodeId) return getTransparentInputTexture();

    // Source nodes with visible branch inputs are already composited into the
    // active branch buffer; preserve that complete canonical input branch.
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    if (sourceNode) {
      const def = nodeRegistry.get(sourceNode.type);
      if (def?.flags?.isSource) {
        const hiddenPortIds = new Set(
          (sourceNode as { hiddenInputPortIds?: string[] }).hiddenInputPortIds ?? [],
        );
        const nonPipeInputs = Object.entries(sourceNode.inputs ?? {}).filter(
          ([portName]) => portName !== 'pipe' && !hiddenPortIds.has(portName),
        );
        const hasEnabledInput = nonPipeInputs.some(([_portName, sourceId]) => {
          const upstreamNode = nodes.find((n) => n.id === sourceId);
          return upstreamNode && upstreamNode.enabled !== false;
        });
        if (hasEnabledInput) {
          return readBuffer.texture;
        }
      }
    }

    return (
      renderNodeOutputTexture(sourceNodeId, getInputSourcePort(node, 'pipe')) ??
      getTransparentInputTexture()
    );
  };
  const renderStraightOverToMain = (
    material: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget = writeBuffer,
  ) => {
    applyNoBlending(material);
    resources.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(resources.scene, resources.camera);
    if (target !== writeBuffer) {
      copyTargetToWriteBuffer(target);
    }
    swapMainBuffers();
  };

  ensureTargetForSceneSize(readBuffer);
  ensureTargetForSceneSize(writeBuffer);
  ensureTargetForSceneSize(auxBuffer);
  clearRenderTargetTransparent(renderer, readBuffer);

  const visibleNodes = getVisiblePipelineNodes(nodes, nodeRegistry);
  let previousMediaNode: AnyNode | null = null;
  for (let index = 0; index < visibleNodes.length; index += 1) {
    const baseNode = visibleNodes[index];
    ensureTargetForSceneSize(readBuffer);
    ensureTargetForSceneSize(writeBuffer);
    ensureTargetForSceneSize(auxBuffer);
    const baseMode = getRenderMode(baseNode, nodeRegistry);

    if (baseMode === 'utility') {
      const renderedUtility = renderUtilityNodeToTarget({
        renderer,
        scene: resources.scene,
        camera: resources.camera,
        quad: resources.quad,
        getMaterial,
        node: baseNode,
        sourcePortName:
          options.outputDomain?.sourceNodeId === baseNode.id
            ? options.outputDomain.sourcePort
            : undefined,
        outputTarget: writeBuffer,
        renderNodeOutputTexture,
      });
      if (isPromiseLike(renderedUtility)) {
        throw new Error('Viewport utility rendering must remain synchronous.');
      }
      if (renderedUtility) {
        swapMainBuffers();
      }
    } else if (baseMode === 'media' || baseMode === 'text') {
      if (isMediaNodeWithRegistry(baseNode, nodeRegistry)) {
        previousMediaNode = baseNode;
      }
      let texture: THREE.Texture | undefined;
      let width = 0;
      let height = 0;
      let scaleX = 1;
      let scaleY = 1;
      const offset = new THREE.Vector2(0, 0);
      let opacity = 100;
      let isCompositeMediaTexture = false;

      if (isMediaNodeWithRegistry(baseNode, nodeRegistry)) {
        const compositeLayers = getMediaCompositeLayersFromRegistry(
          baseNode,
          frame,
          sceneNode,
          nodeRegistry,
          nodes,
        );
        if (compositeLayers.length > 0) {
          const compositeTarget = getUtilityOutputTarget(`${baseNode.id}:media-composite:main`);
          const renderedComposite = renderCompositeMediaLayersToTarget(
            baseNode,
            compositeLayers,
            compositeTarget,
          );
          if (!renderedComposite) continue;
          texture = compositeTarget.texture;
          width = currentSceneSize.width;
          height = currentSceneSize.height;
          isCompositeMediaTexture = true;
        } else {
          texture = getMediaTexture(baseNode as MediaNode, frame);
          if (!texture) {
            continue;
          }
          width = baseNode.width;
          height = baseNode.height;
          scaleX = getValueAtFrame(baseNode.transform.scaleX, frame);
          scaleY = getValueAtFrame(baseNode.transform.scaleY, frame);
          offset.set(
            getValueAtFrame(baseNode.transform.x, frame),
            getValueAtFrame(baseNode.transform.y, frame),
          );
        }
        opacity = getValueAtFrame(baseNode.opacity, frame);
      } else {
        const textTexture = getTextTexture(baseNode as TextNode);
        if (!textTexture) {
          continue;
        }
        texture = textTexture.texture;
        width = textTexture.width;
        height = textTexture.height;
        offset.set(
          getValueAtFrame((baseNode as TextNode).position.x, frame),
          getValueAtFrame((baseNode as TextNode).position.y, frame),
        );
        opacity = getValueAtFrame((baseNode as TextNode).opacity, frame);
      }

      const baseOcioTransform =
        !isCompositeMediaTexture && isMediaNodeWithRegistry(baseNode, nodeRegistry)
          ? getMediaOcioColorSpaceTransform(
              baseNode,
              nodeRegistry,
              sceneNode.colorSpace,
              colorManagement,
            )
          : null;

      const { stackedNodes, consumedCount } = collectAdjacentStackedNodes(
        visibleNodes,
        index,
        isStackedAdjustmentNode,
      );

      let finalCompositeMaterial: THREE.ShaderMaterial;
      let straightOverTarget = writeBuffer;
      if (stackedNodes.length > 0) {
        let stackRead = writeBuffer;
        let stackWrite = auxBuffer;
        clearRenderTargetTransparent(renderer, stackRead);

        const baseMaterial = getMaterial(
          `${baseNode.id}_base_transformed`,
          buildOcioTransformedTextureShader(baseOcioTransform, false),
          {
            u_tDiffuse: { value: texture },
            u_opacity: { value: 1 },
            u_scaleX: { value: scaleX },
            u_scaleY: { value: scaleY },
            u_offset: { value: offset },
            u_scene_res: {
              value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
            },
            u_image_res: { value: new THREE.Vector2(width, height) },
            u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
            u_flipY: { value: false },
            ...getGeneratedColorUniforms(baseNode, renderContext, nodeRegistry),
            ...createOcioUniforms(baseOcioTransform, resources.ocioTextures!),
          },
        );
        resources.quad.material = baseMaterial;
        renderer.render(resources.scene, resources.camera);

        for (const stackedNode of stackedNodes) {
          const shouldSwap = renderAdjustmentNodeToTarget({
            renderer,
            scene: resources.scene,
            camera: resources.camera,
            quad: resources.quad,
            getMaterial,
            nodeRegistry,
            renderContext,
            node: stackedNode,
            inputTexture: stackRead.texture,
            outputTarget: stackWrite,
            width: currentSceneSize.width,
            height: currentSceneSize.height,
            blurRadiusScale: 1,
            renderTargetOptions,
            sceneColorSpace: sceneNode.colorSpace,
            colorManagement,
            ocioTextures: resources.ocioTextures!,
            fallbackSourceNode: baseNode,
            getInputTextureForNode: (nodeId, targetFrame) => {
              const sourceNode = nodes.find((l) => l.id === nodeId);
              if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
                return getMediaTexture(sourceNode as MediaNode, targetFrame);
              }
              return undefined;
            },
            getRotoMaskLayers,
            getRotoAlphaMode,
            getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
          });

          if (isPromiseLike(shouldSwap)) {
            throw new Error('Viewport stacked adjustment rendering must remain synchronous.');
          }

          if (shouldSwap) {
            [stackRead, stackWrite] = [stackWrite, stackRead];
          }
        }

        const { operator } = getNodeBlendProps(baseNode);
        if (operator === BlendMode.OVER) {
          straightOverTarget = stackRead === writeBuffer ? auxBuffer : writeBuffer;
          finalCompositeMaterial = getMaterial(
            `${baseNode.id}_comp_straight_over`,
            RendererShader.STRAIGHT_TEXTURE_OVER,
            {
              u_tBackdrop: { value: readBuffer.texture },
              u_tDiffuse: { value: stackRead.texture },
              u_opacity: { value: opacity / 100 },
            },
          );
        } else {
          finalCompositeMaterial = getMaterial(
            `${baseNode.id}_comp`,
            RendererShader.TEXTURE_OPACITY,
            {
              u_tDiffuse: { value: stackRead.texture },
              u_opacity: { value: opacity / 100 },
            },
          );
        }
      } else {
        const { operator } = getNodeBlendProps(baseNode);
        if (operator === BlendMode.OVER) {
          finalCompositeMaterial = getMaterial(
            `${baseNode.id}_comp_transformed_straight_over`,
            buildOcioTransformedTextureShader(baseOcioTransform, true),
            {
              u_tBackdrop: { value: readBuffer.texture },
              u_tDiffuse: { value: texture },
              u_opacity: { value: opacity / 100 },
              u_scaleX: { value: scaleX },
              u_scaleY: { value: scaleY },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
              u_flipY: { value: false },
              ...getGeneratedColorUniforms(baseNode, renderContext, nodeRegistry),
              ...createOcioUniforms(baseOcioTransform, resources.ocioTextures!),
            },
          );
        } else {
          finalCompositeMaterial = getMaterial(
            `${baseNode.id}_comp_transformed`,
            buildOcioTransformedTextureShader(baseOcioTransform, false),
            {
              u_tDiffuse: { value: texture },
              u_opacity: { value: opacity / 100 },
              u_scaleX: { value: scaleX },
              u_scaleY: { value: scaleY },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
              u_flipY: { value: false },
              ...getGeneratedColorUniforms(baseNode, renderContext, nodeRegistry),
              ...createOcioUniforms(baseOcioTransform, resources.ocioTextures!),
            },
          );
        }
      }

      const { operator } = getNodeBlendProps(baseNode);
      if (operator === BlendMode.OVER) {
        renderStraightOverToMain(finalCompositeMaterial, straightOverTarget);
      } else {
        resources.quad.material = finalCompositeMaterial;
        applyBlendMode(finalCompositeMaterial, operator);
        renderer.setRenderTarget(readBuffer);
        renderer.render(resources.scene, resources.camera);
      }
      index += consumedCount;
    } else if (baseMode === 'merge') {
      const renderedMerge = renderMergeNodeToTarget({
        renderer,
        scene: resources.scene,
        camera: resources.camera,
        quad: resources.quad,
        getMaterial,
        node: baseNode,
        nodes,
        frame,
        outputTarget: readBuffer,
        renderNodeOutputTexture,
      });
      if (isPromiseLike(renderedMerge)) {
        throw new Error('Viewport merge rendering must remain synchronous.');
      }
    } else if (isStackAdjustmentType(baseNode.type) && !isStackedAdjustmentNode(baseNode)) {
      const adjustmentInputTexture = getPipeInputTexture(baseNode);
      const outputSceneSizeOverride = getNodeOutputSceneSize(baseNode, nodeRegistry, renderContext);
      const outputSceneSize = outputSceneSizeOverride ?? currentSceneSize;
      ensureTargetForSceneSize(writeBuffer, outputSceneSize);
      const rendered = renderAdjustmentNodeToTarget({
        renderer,
        scene: resources.scene,
        camera: resources.camera,
        quad: resources.quad,
        getMaterial,
        nodeRegistry,
        renderContext,
        node: baseNode,
        inputTexture: adjustmentInputTexture,
        outputTarget: writeBuffer,
        width: currentSceneSize.width,
        height: currentSceneSize.height,
        blurRadiusScale: 1,
        renderTargetOptions,
        sceneColorSpace: sceneNode.colorSpace,
        colorManagement,
        ocioTextures: resources.ocioTextures!,
        fallbackSourceNode: previousMediaNode,
        getInputTextureForNode: (nodeId, targetFrame) => {
          const sourceNode = nodes.find((l) => l.id === nodeId);
          if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
            return getMediaTexture(sourceNode as MediaNode, targetFrame);
          }
          return undefined;
        },
        getRotoMaskLayers,
        getRotoAlphaMode,
        getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
      });

      if (isPromiseLike(rendered)) {
        throw new Error('Viewport adjustment rendering must remain synchronous.');
      }

      if (rendered) {
        swapMainBuffers();
        if (outputSceneSizeOverride) {
          setCurrentSceneSize(outputSceneSizeOverride);
        }
      }
    }
  }

  const viewerMaterial =
    options.outputDomain?.kind === 'data'
      ? getMaterial('viewer_data', RendererShader.DATA_VIEW, {
          u_tDiffuse: { value: readBuffer.texture },
          u_channel: { value: getDataViewerChannel(options.outputDomain) },
        })
      : createDisplayViewOutputMaterial({
          materialKey: 'viewer',
          inputTexture: readBuffer.texture,
          sceneColorSpace: sceneNode.colorSpace,
          viewerSettings,
          displayView,
          alphaOverlayStyle,
          colorManagement,
          ocioTextures: resources.ocioTextures!,
          getMaterial,
        });
  resources.quad.material = viewerMaterial;
  let displayOutputTarget: THREE.WebGLRenderTarget | null = null;
  if (options.captureDisplayOutput) {
    displayOutputTarget = getUtilityOutputTarget('__viewer:display-output');
    clearRenderTargetTransparent(renderer, displayOutputTarget);
    renderer.render(resources.scene, resources.camera);
  }
  if (presentToCanvas) {
    clearRenderTargetTransparent(renderer, null);
    renderer.render(resources.scene, resources.camera);
  } else {
    // Do not leave a captured offscreen target bound for the caller's next
    // presentation pass.
    renderer.setRenderTarget(null);
  }

  return { renderTargets, finalCompositeTarget: readBuffer, displayOutputTarget };
};
