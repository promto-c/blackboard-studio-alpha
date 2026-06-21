import * as THREE from 'three';
import {
  AnimatableNumber,
  AnyNode,
  BlendMode,
  ImageSequenceNode,
  MediaSourceNode,
  NodeType,
  SceneNode,
  TextNode,
  ViewerSettings,
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
  ResolveOutputContext,
} from './types';
import { RendererShader } from './glsl';
import { getValueAtFrame } from './animation';
import { createNodePredicates } from './nodePredicates';
import {
  assertFloatRenderTargetSupport,
  assertWebGL2Renderer,
  createStudioRenderer,
  createStudioShaderMaterial,
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
let transparentPaintTexture: THREE.DataTexture | null = null;
let transparentInputTexture: THREE.DataTexture | null = null;

const getTransparentPaintTexture = (): THREE.Texture => {
  if (!transparentPaintTexture) {
    transparentPaintTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
    );
    transparentPaintTexture.colorSpace = THREE.NoColorSpace;
    transparentPaintTexture.minFilter = THREE.LinearFilter;
    transparentPaintTexture.magFilter = THREE.LinearFilter;
    transparentPaintTexture.generateMipmaps = false;
    transparentPaintTexture.needsUpdate = true;
  }

  return transparentPaintTexture;
};

const getTransparentInputTexture = (): THREE.Texture => {
  if (!transparentInputTexture) {
    transparentInputTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
    );
    transparentInputTexture.colorSpace = THREE.NoColorSpace;
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

export interface RenderPipelineOptions {
  nodes: AnyNode[];
  sceneNode: SceneNode;
  frame?: number;
  width: number;
  height: number;
  blurRadiusScale?: number;
  finalColorSpace: 'raw_texture' | 'scene_linear' | 'srgb' | 'match_viewport';
  viewerSettings?: ViewerSettings;
  alphaOverlayStyle?: AlphaOverlayStyle;
  colorManagement?: RendererColorManagement;
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

export interface RenderPipelineResult {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  finalOutputTarget: THREE.WebGLRenderTarget | null;
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
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
  };
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
  target.texture.colorSpace === options.colorSpace;

const getPositiveIntegerDimension = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value));
};

const getReformatSourceSize = (nodes: AnyNode[], fallback: RenderFormatSize): RenderFormatSize => {
  const reformatNode = nodes.find(
    (node) => node.enabled !== false && node.type === NodeType.REFORMAT,
  ) as (AnyNode & { sourceWidth?: unknown; sourceHeight?: unknown }) | undefined;
  const width = getPositiveIntegerDimension(reformatNode?.sourceWidth);
  const height = getPositiveIntegerDimension(reformatNode?.sourceHeight);
  return width && height ? { width, height } : fallback;
};

const getReformatTargetSize = (node: AnyNode): RenderFormatSize | null => {
  if (node.type !== NodeType.REFORMAT) return null;
  const width = getPositiveIntegerDimension((node as { width?: unknown }).width);
  const height = getPositiveIntegerDimension((node as { height?: unknown }).height);
  return width && height ? { width, height } : null;
};

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

const getMediaCompositeLayersFromRegistry = (
  node: AnyNode,
  frame: number,
  sceneNode: SceneNode,
  reg: NodeRegistryLike,
): RendererMediaCompositeLayer[] => {
  const def = reg.get(node.type);
  return (
    def?.mediaDescriptor?.getCompositeLayers?.(node, frame, {
      frame,
      sceneNode,
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

const isVideoFileNodeWithRegistry = (node: AnyNode, reg: NodeRegistryLike): boolean => {
  const def = reg.get(node.type);
  return !!(def?.mediaDescriptor?.isVideoFile?.(node) ?? def?.flags?.isVideoFile);
};

const getInputColorTransform = (
  sourceColorSpace: string | undefined,
  sceneColorSpace: SceneNode['colorSpace'],
): number => {
  if (sourceColorSpace === 'sRGB' && sceneColorSpace === 'Linear') return 0;
  if ((sourceColorSpace === 'Linear' || sourceColorSpace === 'Raw') && sceneColorSpace === 'sRGB') {
    return 2;
  }
  return 1;
};

const getNodeInputColorTransform = (
  node: AnyNode,
  sceneColorSpace: SceneNode['colorSpace'],
  reg: NodeRegistryLike,
): number => getInputColorTransform(getColorSpaceFromRegistry(node, reg), sceneColorSpace);

const getLayerInputColorTransform = (
  layer: RendererMediaCompositeLayer,
  sceneColorSpace: SceneNode['colorSpace'],
): number => getInputColorTransform(layer.colorSpace, sceneColorSpace);

const getResolvedColorSpace = (
  colorSpace: string | undefined,
  colorManagement?: RendererColorManagement,
): string | undefined => colorManagement?.resolveColorSpaceName?.(colorSpace) ?? colorSpace;

const getOcioColorSpaceTransform = (
  sourceColorSpace: string | undefined,
  sceneColorSpace: SceneNode['colorSpace'],
  colorManagement?: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  if (!colorManagement?.getColorSpaceTransform) return null;
  return colorManagement.getColorSpaceTransform(
    sourceColorSpace,
    getResolvedColorSpace(sceneColorSpace, colorManagement),
  );
};

const getOcioDisplayViewTransform = (
  sceneColorSpace: SceneNode['colorSpace'],
  viewerSettings: ViewerSettings,
  colorManagement?: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  if (!colorManagement?.getDisplayViewTransform) return null;
  return colorManagement.getDisplayViewTransform(
    getResolvedColorSpace(sceneColorSpace, colorManagement),
    (viewerSettings as { ocioDisplay?: string }).ocioDisplay || colorManagement.defaultDisplay,
    viewerSettings.ocioView || colorManagement.defaultView,
  );
};

const getOcioSrgbOutputTransform = (
  sceneColorSpace: SceneNode['colorSpace'],
  colorManagement?: RendererColorManagement,
): RendererOcioShaderInfo | null => {
  if (!colorManagement?.getColorSpaceTransform) return null;
  return colorManagement.getColorSpaceTransform(
    getResolvedColorSpace(sceneColorSpace, colorManagement),
    colorManagement.textureColorSpace ?? 'sRGB',
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
    dataTexture.colorSpace = THREE.NoColorSpace;
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
  dataTexture.colorSpace = THREE.NoColorSpace;
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

const buildOcioTransformedTextureShader = (
  ocioTransform: RendererOcioShaderInfo | null | undefined,
  compositeOver: boolean,
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
uniform int u_input_transform;
uniform bool u_flipY;
uniform int u_source_alpha_mode;

${
  ocioTransform
    ? ocioTransform.shaderText
    : `
vec3 srgb_to_linear(vec3 color) {
  return pow(color, vec3(2.2));
}

vec3 linear_to_srgb(vec3 color) {
  return pow(color, vec3(1.0/2.2));
}
`
}

${
  compositeOver
    ? `
vec4 straight_over(vec4 src, vec4 dst) {
  src.a = clamp(src.a, 0.0, 1.0);
  dst.a = clamp(dst.a, 0.0, 1.0);
  float inv_src_a = 1.0 - src.a;
  float out_a = src.a + dst.a * inv_src_a;
  vec3 weighted_rgb = src.rgb * src.a + dst.rgb * dst.a * inv_src_a;
  vec3 out_rgb = out_a > 0.000001 ? weighted_rgb / out_a : src.rgb;
  return vec4(out_rgb, out_a);
}
`
    : ''
}

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

  ${
    ocioTransform
      ? `src = ${ocioTransform.functionName}(src);`
      : `if (u_input_transform == 0) {
    src.rgb = srgb_to_linear(src.rgb);
  } else if (u_input_transform == 2) {
    src.rgb = linear_to_srgb(src.rgb);
  }`
  }

  src.a *= u_opacity;
  ${
    compositeOver
      ? `vec4 dst = texture(u_tBackdrop, v_uv);
  fragColor = straight_over(src, dst);`
      : 'fragColor = src;'
  }
}
`;

const buildOcioViewerShader = (
  ocioTransform: RendererOcioShaderInfo | null | undefined,
): string => {
  if (!ocioTransform) return RendererShader.VIEWER;

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
uniform vec3 u_alphaOverlayColor;
uniform float u_alphaOverlayOpacity;
uniform float u_alphaOverlayBgDarken;
out vec4 fragColor;

${ocioTransform.shaderText}

vec3 signed_pow_viewer(vec3 color, float exponent) {
  return sign(color) * pow(abs(color), vec3(exponent));
}

float luminance_viewer(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 tex = texture(u_tDiffuse, v_uv);
  vec3 color = tex.rgb * u_gain;

  vec4 ocioColor = ${ocioTransform.functionName}(vec4(color, tex.a));
  color = ocioColor.rgb;

  color = signed_pow_viewer(color, 1.0 / max(u_gamma, 0.0001));
  float luma_val = luminance_viewer(color);
  color = mix(vec3(luma_val), color, u_saturation);

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

  bool should_ignore_alpha = u_ignoreAlpha || (u_alphaOverlay && u_channel != 4);
  float final_alpha = (u_channel == 4 || should_ignore_alpha) ? 1.0 : tex.a;
  fragColor = vec4(clamp(color, 0.0, 1.0), final_alpha);
}
`;
};

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
  context.fillStyle = `rgb(${node.color.map((c) => c * 255).join(',')})`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.translate(textCanvas.width / 2, textCanvas.height / 2);
  context.rotate(rotationRadians);
  context.fillText(node.text, 0, 0);

  const texture = new THREE.CanvasTexture(textCanvas);
  texture.needsUpdate = true;
  dynamicTextures.push(texture);
  return { texture, width: textCanvas.width, height: textCanvas.height };
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
  let skippingDetachedStack = false;

  for (const node of nodes) {
    const def = nodeRegistry.get(node.type);
    if (def?.flags?.isSceneLike) {
      skippingDetachedStack = false;
      continue;
    }
    if (def?.renderMode === 'utility' && !def.flags?.isRenderable) {
      continue;
    }

    const isStacked = !!node.stacked;
    if (!isStacked) {
      skippingDetachedStack = !!node.detachedFromPipe;
    }

    if (skippingDetachedStack || !node.enabled) {
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
type PaintTextureBundle = { color: THREE.Texture; alpha: THREE.Texture };
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
  fallbackSourceNode?: AnyNode | null;
  getInputTextureForNode: (nodeId: string, targetFrame: number) => THREE.Texture | undefined;
  getPaintTextures: (node: AnyNode) => MaybePromise<PaintTextureBundle | null | undefined>;
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
    fallbackSourceNode,
    getInputTextureForNode,
    getPaintTextures,
    getRotoMaskLayers,
    getRotoAlphaMode,
    getScratchRenderTarget,
    shaderId,
  } = options;
  const renderMode = getRenderMode(node, nodeRegistry);

  if (renderMode === 'shader' || renderMode === 'warp') {
    const uniforms = withDiffuseUniform(
      getEffectUniforms(node, renderContext, nodeRegistry),
      inputTexture,
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
    const shader = getEffectShader(node, nodeRegistry);
    if (!shader) return false;

    const material = getMaterial(shaderId ?? node.id, shader, uniforms);
    quad.material = material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(scene, camera);
    return true;
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
      compositeBuffer: outputTarget,
      getMediaTexture: (n, f) => getInputTextureForNode(n.id, f) ?? undefined,
      getRotoMaskLayers,
      getRotoAlphaMode,
      getPaintTextures: (_nId) => {
        const ptResult = getPaintTextures(node);
        if (isPromiseLike(ptResult)) return undefined;
        return ptResult ?? undefined;
      },
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
    outputTarget,
    renderNodeOutputTexture,
  } = options;

  const textureResult = renderNodeOutputTexture(node.id);
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
  readBuffer: THREE.WebGLRenderTarget;
  renderNodeOutputTexture: RenderOutputTexture;
  clearReadBuffer: () => void;
  renderStraightOverToMain: (material: THREE.ShaderMaterial) => void;
}

const renderMergeNodeToMain = (options: MergeNodeRenderOptions): MaybePromise<boolean> => {
  const {
    renderer,
    scene,
    camera,
    quad,
    getMaterial,
    node,
    nodes,
    frame,
    readBuffer,
    renderNodeOutputTexture,
    clearReadBuffer,
    renderStraightOverToMain,
  } = options;
  const mergeInputs = (node as { inputs?: Record<string, string> }).inputs ?? {};
  const explicitPipeTextureResult = mergeInputs.pipe
    ? renderNodeOutputTexture(mergeInputs.pipe, getInputSourcePort(node, 'pipe'))
    : undefined;

  const renderWithPipe = (
    explicitPipeTexture: THREE.Texture | undefined,
  ): MaybePromise<boolean> => {
    if (explicitPipeTexture) {
      const pipeCopyMaterial = getMaterial(`${node.id}_merge_pipe_input`, RendererShader.TEXTURE, {
        u_tDiffuse: { value: explicitPipeTexture },
      });
      applyNoBlending(pipeCopyMaterial);
      quad.material = pipeCopyMaterial;
      renderer.setRenderTarget(readBuffer);
      renderer.render(scene, camera);
    } else {
      clearReadBuffer();
    }

    const sourceNodeId = mergeInputs.source;
    const sourceNode = sourceNodeId
      ? nodes.find((candidate) => candidate.id === sourceNodeId)
      : null;

    if (!sourceNode?.enabled) {
      return false;
    }

    const sourceOutputTextureResult = renderNodeOutputTexture(
      sourceNodeId,
      getInputSourcePort(node, 'source'),
    );

    const renderWithSource = (sourceOutputTexture: THREE.Texture | undefined): boolean => {
      if (!sourceOutputTexture) {
        return false;
      }

      const opacity = getValueAtFrame((node as any).opacity ?? 100, frame);
      const operator = (node as any).operator ?? BlendMode.OVER;
      const mergeComposite =
        operator === BlendMode.OVER
          ? getMaterial(
              `${node.id}_merge_comp_straight_over`,
              RendererShader.STRAIGHT_TEXTURE_OVER,
              {
                u_tBackdrop: { value: readBuffer.texture },
                u_tDiffuse: { value: sourceOutputTexture },
                u_opacity: { value: opacity / 100 },
              },
            )
          : getMaterial(`${node.id}_merge_comp`, RendererShader.TEXTURE_OPACITY, {
              u_tDiffuse: { value: sourceOutputTexture },
              u_opacity: { value: opacity / 100 },
            });

      if (operator === BlendMode.OVER) {
        renderStraightOverToMain(mergeComposite);
      } else {
        quad.material = mergeComposite;
        applyBlendMode(mergeComposite, operator);
        renderer.setRenderTarget(readBuffer);
        renderer.render(scene, camera);
      }

      return true;
    };

    return isPromiseLike(sourceOutputTextureResult)
      ? sourceOutputTextureResult.then(renderWithSource)
      : renderWithSource(sourceOutputTextureResult);
  };

  return isPromiseLike(explicitPipeTextureResult)
    ? explicitPipeTextureResult.then(renderWithPipe)
    : renderWithPipe(explicitPipeTextureResult);
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
  getUtilityOutputTarget: (key: string) => THREE.WebGLRenderTarget;
  utilityRenderStack: Set<string>;
  checkCache: (cacheKey: string) => boolean;
  markCache: (cacheKey: string) => void;
  getMediaTexture: (node: AnyNode, frame: number) => MaybePromise<THREE.Texture | null | undefined>;
  getPaintTextures: (node: AnyNode) => MaybePromise<PaintTextureBundle | null | undefined>;
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
            frame: ctx.frame,
            nodes: ctx.nodes,
            sceneNode: ctx.sceneNode,
            renderer: ctx.renderer,
            scene: ctx.scene,
            camera: ctx.camera,
            quad: ctx.quad,
            getMaterial: ctx.getMaterial,
            resolveOutput,
            compositeBuffer: ctx.compositeBuffer,
            getMediaTexture: (n, f) => ctx.getCachedMediaTexture(n, f),
            getRotoMaskLayers: ctx.getRotoMaskLayers,
            getRotoAlphaMode: ctx.getRotoAlphaMode,
            getPaintTextures: (_nId) => {
              const ptResult = ctx.getPaintTextures(node);
              if (isPromiseLike(ptResult)) {
                ctx.onAsyncInSync?.();
                return undefined;
              }
              return ptResult ?? undefined;
            },
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
            frame: ctx.frame,
            nodes: ctx.nodes,
            sceneNode: ctx.sceneNode,
            renderer: ctx.renderer,
            scene: ctx.scene,
            camera: ctx.camera,
            quad: ctx.quad,
            getMaterial: ctx.getMaterial,
            resolveOutput,
            compositeBuffer: ctx.compositeBuffer,
            getMediaTexture: (n, f) => ctx.getCachedMediaTexture(n, f),
            getRotoMaskLayers: ctx.getRotoMaskLayers,
            getRotoAlphaMode: ctx.getRotoAlphaMode,
            getPaintTextures: (_nId) => {
              const ptResult = ctx.getPaintTextures(node);
              // Coerce async to undefined (sync path shouldn't get promises)
              if (isPromiseLike(ptResult)) {
                ctx.onAsyncInSync?.();
                return undefined;
              }
              return ptResult ?? undefined;
            },
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
            fallbackSourceNode: null,
            getInputTextureForNode: (nodeId, targetFrame) => {
              const sourceNode = ctx.nodes.find((l) => l.id === nodeId);
              if (sourceNode && isMediaNodeWithRegistry(sourceNode, ctx.nodeRegistry)) {
                return ctx.getCachedMediaTexture(sourceNode, targetFrame);
              }
              return undefined;
            },
            getPaintTextures: ctx.getPaintTextures,
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
  const { isStackedExportAdjustmentNode, isExportAdjustmentType } =
    createNodePredicates(nodeRegistry);
  const finalSceneSize = { width: options.sceneNode.width, height: options.sceneNode.height };
  const outputRenderScale = {
    width: options.width / Math.max(1, finalSceneSize.width),
    height: options.height / Math.max(1, finalSceneSize.height),
  };
  let currentSceneSize = getReformatSourceSize(options.nodes, finalSceneSize);
  const renderContext: RenderContext = {
    frame,
    fps: options.sceneNode.fps || 30,
    scene: { ...currentSceneSize },
    nodes: options.nodes,
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
      premultipliedAlpha: false,
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
  const renderTargetOptions = getSceneRenderTargetOptions(options.sceneNode);
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
    const getMaterial = (
      id: string,
      shader: string,
      uniforms: ShaderUniformMap,
    ): THREE.ShaderMaterial => {
      const existing = materials.get(id);
      if (existing) {
        Object.assign(existing.uniforms, uniforms);
        if (existing.fragmentShader !== shader) {
          existing.fragmentShader = shader;
          existing.needsUpdate = true;
        }
        return existing;
      }
      const material = createStudioShaderMaterial({
        vertexShader: RendererShader.VERTEX,
        fragmentShader: shader,
        uniforms,
      });
      materials.set(id, material);
      return material;
    };

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
              const canvasTexture = new THREE.CanvasTexture(captureCanvas);
              // Keep media textures raw here; shader transforms handle color management
              // so offscreen renders match the live viewport path exactly.
              canvasTexture.colorSpace = THREE.NoColorSpace;
              canvasTexture.minFilter = THREE.LinearFilter;
              canvasTexture.magFilter = THREE.LinearFilter;
              canvasTexture.generateMipmaps = false;
              canvasTexture.needsUpdate = true;
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
            // Keep media textures raw here; shader transforms handle color management
            // so offscreen renders match the live viewport path exactly.
            loadedTexture.colorSpace = THREE.NoColorSpace;
            loadedTexture.minFilter = THREE.LinearFilter;
            loadedTexture.magFilter = THREE.LinearFilter;
            loadedTexture.generateMipmaps = false;
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
        targetFrame,
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

    const loadPaintTexture = async (
      nodeId: string,
      dataUrl: string,
      textureRole: 'rgb' | 'alpha',
    ): Promise<THREE.Texture> => {
      if (!dataUrl) {
        return getTransparentPaintTexture();
      }

      const cacheKey = `paint:${nodeId}:${textureRole}:${dataUrl}`;
      const existing = loadedTextures.get(cacheKey);
      if (existing) return existing;

      if (textureCacheMode === 'persistent') {
        const cached = persistentTextureCache.get(dataUrl);
        if (cached) {
          loadedTextures.set(cacheKey, cached);
          return cached;
        }
      }

      const texture = await new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(
          dataUrl,
          (loadedTexture) => {
            loadedTexture.colorSpace = THREE.NoColorSpace;
            loadedTexture.minFilter = THREE.LinearFilter;
            loadedTexture.magFilter = THREE.LinearFilter;
            loadedTexture.generateMipmaps = false;
            resolve(loadedTexture);
          },
          undefined,
          () => reject(new Error(`Failed to decode paint texture for node: ${nodeId}`)),
        );
      });

      if (textureCacheMode === 'persistent') {
        persistentTextureCache.set(dataUrl, texture);
      } else {
        ownedTextures.push(texture);
      }

      loadedTextures.set(cacheKey, texture);
      return texture;
    };

    const loadPaintTextures = async (
      node: AnyNode,
    ): Promise<{ color: THREE.Texture; alpha: THREE.Texture } | null> => {
      const colorDataUrl = (node as { paintComposite?: string }).paintComposite ?? '';
      const alphaDataUrl = (node as { paintAlphaComposite?: string }).paintAlphaComposite ?? '';
      if (!colorDataUrl && !alphaDataUrl) return null;

      const [color, alpha] = await Promise.all([
        loadPaintTexture(node.id, colorDataUrl, 'rgb'),
        loadPaintTexture(node.id, alphaDataUrl, 'alpha'),
      ]);

      return { color, alpha };
    };

    const visibleNodes = getVisiblePipelineNodes(options.nodes, nodeRegistry);

    const preloadTargets = new Map<string, InputPreloadTarget>();
    const addPreloadTarget = (node: AnyNode, targetFrame: number) => {
      preloadTargets.set(`${node.id}:${targetFrame}`, {
        node: node as MediaNode,
        frame: targetFrame,
      });
    };
    visibleNodes.forEach((node) => {
      if (isMediaNodeWithRegistry(node, nodeRegistry)) {
        addPreloadTarget(node, frame);
      }
    });
    // Preload textures for all generic input port references
    collectInputPreloadTargets(visibleNodes, options.nodes, nodeRegistry, frame).forEach((target) =>
      addPreloadTarget(target.node, target.frame),
    );
    await Promise.all(
      Array.from(preloadTargets.values(), async (target) => {
        const layers = getMediaCompositeLayersFromRegistry(
          target.node,
          target.frame,
          options.sceneNode,
          nodeRegistry,
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
      let inputTransform = 1;

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
        inputTransform = getNodeInputColorTransform(
          node,
          options.sceneNode.colorSpace,
          nodeRegistry,
        );
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
        ? getOcioColorSpaceTransform(
            getColorSpaceFromRegistry(node, nodeRegistry),
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
          u_input_transform: { value: inputTransform },
          u_source_alpha_mode: { value: getSourceAlphaModeUniform(node) },
          u_flipY: { value: false },
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

        const transform = layer.transform;
        const ocioTransform = getOcioColorSpaceTransform(
          layer.colorSpace,
          options.sceneNode.colorSpace,
          options.colorManagement,
        );
        const material = getMaterial(
          `${node.id}:media-composite:${layer.id}`,
          buildOcioTransformedTextureShader(ocioTransform, true),
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
            u_input_transform: {
              value: getLayerInputColorTransform(layer, options.sceneNode.colorSpace),
            },
            u_source_alpha_mode: { value: getSourceAlphaModeUniform(layer) },
            u_flipY: { value: false },
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
        nodes: options.nodes,
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
        getMediaTexture: (n, f) => loadTextureForMediaNode(n, f),
        getPaintTextures: loadPaintTextures,
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
    const getExplicitPipeTexture = async (node: AnyNode): Promise<THREE.Texture | undefined> => {
      const sourceNodeId = (node as { inputs?: Record<string, string> }).inputs?.pipe;
      if (!sourceNodeId) return undefined;
      return renderNodeOutputTexture(sourceNodeId, getInputSourcePort(node, 'pipe'));
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
        let inputTransform = 1;
        let baseOcioTransform: RendererOcioShaderInfo | null = null;

        if (isMediaNodeWithRegistry(baseNode, nodeRegistry)) {
          const compositeLayers = getMediaCompositeLayersFromRegistry(
            baseNode,
            frame,
            options.sceneNode,
            nodeRegistry,
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
            inputTransform = getNodeInputColorTransform(
              baseNode,
              options.sceneNode.colorSpace,
              nodeRegistry,
            );
            baseOcioTransform = getOcioColorSpaceTransform(
              getColorSpaceFromRegistry(baseNode, nodeRegistry),
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
              u_input_transform: { value: inputTransform },
              u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
              u_flipY: { value: false },
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
              fallbackSourceNode: baseNode,
              getInputTextureForNode: (nodeId, targetFrame) => {
                const sourceNode = options.nodes.find((l) => l.id === nodeId);
                if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
                  const key = getMediaTextureKeyFromRegistry(sourceNode, targetFrame, nodeRegistry);
                  return key ? loadedTextures.get(key) : undefined;
                }
                return undefined;
              },
              getPaintTextures: loadPaintTextures,
              getRotoMaskLayers: options.getRotoMaskLayers,
              getRotoAlphaMode: options.getRotoAlphaMode,
              getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
            });

            if (shouldSwap) {
              [stackRead, stackWrite] = [stackWrite, stackRead];
            }
          }

          const operator = (baseNode as any).operator ?? BlendMode.OVER;
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
          const operator = (baseNode as any).operator ?? BlendMode.OVER;
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
                u_input_transform: { value: inputTransform },
                u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
                u_flipY: { value: false },
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
                u_input_transform: { value: inputTransform },
                u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
                u_flipY: { value: false },
                ...createOcioUniforms(baseOcioTransform, ocioTextures, ownedTextures),
              },
            );
          }
        }

        const operator = (baseNode as any).operator ?? BlendMode.OVER;
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
        await renderMergeNodeToMain({
          renderer,
          scene,
          camera,
          quad,
          getMaterial,
          node: baseNode,
          nodes: options.nodes,
          frame,
          readBuffer,
          renderNodeOutputTexture,
          clearReadBuffer: () => clearRenderTargetTransparent(renderer, readBuffer),
          renderStraightOverToMain,
        });
      } else if (
        isExportAdjustmentType(baseNode.type) &&
        !isStackedExportAdjustmentNode(baseNode)
      ) {
        const adjMode = getRenderMode(baseNode, nodeRegistry);
        const explicitPipeTexture = await getExplicitPipeTexture(baseNode);
        const adjustmentInputTexture = explicitPipeTexture ?? readBuffer.texture;
        const reformatTargetSize =
          adjMode === 'shader' || adjMode === 'warp' ? getReformatTargetSize(baseNode) : null;
        const outputSceneSize = reformatTargetSize ?? currentSceneSize;
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
          fallbackSourceNode: previousMediaNode,
          getInputTextureForNode: (nodeId, targetFrame) => {
            const sourceNode = options.nodes.find((l) => l.id === nodeId);
            if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
              const key = getMediaTextureKeyFromRegistry(sourceNode, targetFrame, nodeRegistry);
              return key ? loadedTextures.get(key) : undefined;
            }
            return undefined;
          },
          getPaintTextures: loadPaintTextures,
          getRotoMaskLayers: options.getRotoMaskLayers,
          getRotoAlphaMode: options.getRotoAlphaMode,
          getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
          shaderId: `${baseNode.id}_global`,
        });

        if (rendered) {
          swapMainBuffers();
          if (reformatTargetSize) {
            setCurrentSceneSize(reformatTargetSize);
          }
        }
      }
    }

    let finalMaterial: THREE.ShaderMaterial;
    if (options.finalColorSpace === 'raw_texture' || options.finalColorSpace === 'scene_linear') {
      finalMaterial = getMaterial('final_raw', RendererShader.TEXTURE, {
        u_tDiffuse: { value: readBuffer.texture },
      });
    } else if (options.finalColorSpace === 'srgb') {
      const ocioTransform = getOcioSrgbOutputTransform(
        options.sceneNode.colorSpace,
        options.colorManagement,
      );
      finalMaterial = getMaterial('final_srgb', buildOcioViewerShader(ocioTransform), {
        u_tDiffuse: { value: readBuffer.texture },
        u_gain: { value: 1 },
        u_gamma: { value: 1 },
        u_saturation: { value: 1 },
        u_view_transform: { value: options.sceneNode.colorSpace === 'Linear' ? 1 : 0 },
        u_channel: { value: 0 },
        u_ignoreAlpha: { value: false },
        u_alphaOverlay: { value: false },
        u_alphaOverlayColor: { value: new THREE.Color(...alphaOverlayStyle.color) },
        u_alphaOverlayOpacity: { value: alphaOverlayStyle.opacity },
        u_alphaOverlayBgDarken: { value: alphaOverlayStyle.bgDarken },
        ...createOcioUniforms(ocioTransform, ocioTextures, ownedTextures),
      });
    } else {
      const viewerSettings = options.viewerSettings;
      if (!viewerSettings) {
        throw new Error('viewerSettings is required when finalColorSpace is match_viewport.');
      }
      const channelIndex = VIEWER_CHANNELS.indexOf(viewerSettings.channels);
      const outputChannelIndex = options.preserveAlpha && channelIndex === 4 ? 0 : channelIndex;
      const alphaOverlayActive =
        !options.preserveAlpha && viewerSettings.alphaOverlay && viewerSettings.channels !== 'A';
      const ocioTransform = getOcioDisplayViewTransform(
        options.sceneNode.colorSpace,
        viewerSettings,
        options.colorManagement,
      );
      finalMaterial = getMaterial('final_viewport', buildOcioViewerShader(ocioTransform), {
        u_tDiffuse: { value: readBuffer.texture },
        u_gain: { value: viewerSettings.gain },
        u_gamma: { value: viewerSettings.gamma },
        u_saturation: { value: viewerSettings.saturation },
        u_view_transform: {
          value:
            viewerSettings.ocioView !== 'Raw' && options.sceneNode.colorSpace === 'Linear' ? 1 : 0,
        },
        u_channel: { value: outputChannelIndex >= 0 ? outputChannelIndex : 0 },
        u_ignoreAlpha: { value: !options.preserveAlpha && viewerSettings.channels !== 'A' },
        u_alphaOverlay: { value: alphaOverlayActive },
        u_alphaOverlayColor: { value: new THREE.Color(...alphaOverlayStyle.color) },
        u_alphaOverlayOpacity: { value: alphaOverlayStyle.opacity },
        u_alphaOverlayBgDarken: { value: alphaOverlayStyle.bgDarken },
        ...createOcioUniforms(ocioTransform, ocioTextures, ownedTextures),
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

    return { canvas, renderer, finalOutputTarget, dispose };
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
  alphaOverlayStyle?: AlphaOverlayStyle;
  colorManagement?: RendererColorManagement;
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
  getPaintTextures?: (nodeId: string) => { color: THREE.Texture; alpha: THREE.Texture } | undefined;
  nodeRegistry: NodeRegistryLike;
}

export interface ViewportPipelineResult {
  renderTargets: THREE.WebGLRenderTarget[];
  finalCompositeTarget: THREE.WebGLRenderTarget | null;
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
    colorManagement,
    getMediaTexture,
    getMediaTextureByKey,
    getTextTexture,
    getRotoMaskLayers,
    getRotoAlphaMode,
    getPaintTextures,
    nodeRegistry,
  } = options;
  const alphaOverlayStyle = resolveAlphaOverlayStyle(options.alphaOverlayStyle);
  const { isStackedAdjustmentNode, isStackAdjustmentType } = createNodePredicates(nodeRegistry);
  const finalSceneSize = { width: sceneNode.width, height: sceneNode.height };
  const outputRenderScale = { width: 1, height: 1 };
  let currentSceneSize = getReformatSourceSize(nodes, finalSceneSize);
  const renderContext: RenderContext = {
    frame,
    fps: sceneNode.fps || 30,
    scene: { ...currentSceneSize },
    nodes: nodes,
  };
  const setCurrentSceneSize = (size: RenderFormatSize) => {
    currentSceneSize = size;
    renderContext.scene = { ...size };
  };

  const renderer = resources.renderer;
  resources.ocioTextures ??= new Map<string, THREE.Texture>();
  assertWebGL2Renderer(renderer);
  assertFloatRenderTargetSupport(renderer);
  renderer.setSize(sceneNode.width, sceneNode.height);
  renderer.autoClear = false;

  const renderTargetOptions = getSceneRenderTargetOptions(sceneNode);

  let renderTargets = resources.renderTargets;
  if (
    renderTargets.length === 0 ||
    renderTargets[0].width !== currentSceneSize.width ||
    renderTargets[0].height !== currentSceneSize.height ||
    !renderTargetMatchesOptions(renderTargets[0], renderTargetOptions)
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

  let [readBuffer, writeBuffer] = renderTargets;
  const auxBuffer = renderTargets[2];
  const ensureTargetForSceneSize = (
    target: THREE.WebGLRenderTarget,
    size: RenderFormatSize = currentSceneSize,
  ) => ensureRenderTargetSize(target, size, outputRenderScale);
  const getMaterial = (
    id: string,
    shader: string,
    uniforms: ShaderUniformMap,
  ): THREE.ShaderMaterial => {
    const existing = resources.materials.get(id);
    if (existing) {
      Object.assign(existing.uniforms, uniforms);
      if (existing.fragmentShader !== shader) {
        existing.fragmentShader = shader;
        existing.needsUpdate = true;
      }
      return existing;
    }

    const material = createStudioShaderMaterial({
      vertexShader: RendererShader.VERTEX,
      fragmentShader: shader,
      uniforms,
    });
    resources.materials.set(id, material);
    return material;
  };
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
    let inputTransform = 1;

    if (isMediaNodeWithRegistry(node, nodeRegistry)) {
      width = (node as MediaNode).width ?? width;
      height = (node as MediaNode).height ?? height;
      scaleX = getValueAtFrame((node as MediaNode).transform.scaleX, frame);
      scaleY = getValueAtFrame((node as MediaNode).transform.scaleY, frame);
      offset.set(
        getValueAtFrame((node as MediaNode).transform.x, frame),
        getValueAtFrame((node as MediaNode).transform.y, frame),
      );
      inputTransform = getNodeInputColorTransform(node, sceneNode.colorSpace, nodeRegistry);
    } else if (getRenderMode(node, nodeRegistry) === 'text') {
      const textNode = node as TextNode;
      offset.set(
        getValueAtFrame(textNode.position.x, frame),
        getValueAtFrame(textNode.position.y, frame),
      );
    }

    const ocioTransform = isMediaNodeWithRegistry(node, nodeRegistry)
      ? getOcioColorSpaceTransform(
          getColorSpaceFromRegistry(node, nodeRegistry),
          sceneNode.colorSpace,
          colorManagement,
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
        u_scene_res: { value: new THREE.Vector2(currentSceneSize.width, currentSceneSize.height) },
        u_image_res: { value: new THREE.Vector2(width, height) },
        u_input_transform: { value: inputTransform },
        u_source_alpha_mode: { value: getSourceAlphaModeUniform(node) },
        u_flipY: { value: false },
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

      const transform = layer.transform;
      const ocioTransform = getOcioColorSpaceTransform(
        layer.colorSpace,
        sceneNode.colorSpace,
        colorManagement,
      );
      const material = getMaterial(
        `${node.id}:media-composite:${layer.id}`,
        buildOcioTransformedTextureShader(ocioTransform, true),
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
          u_input_transform: { value: getLayerInputColorTransform(layer, sceneNode.colorSpace) },
          u_source_alpha_mode: { value: getSourceAlphaModeUniform(layer) },
          u_flipY: { value: false },
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
      getMediaTexture: (n, f) => getMediaTexture(n as MediaNode, f),
      getPaintTextures: (n) => getPaintTextures?.(n.id),
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
  const getExplicitPipeTexture = (node: AnyNode): THREE.Texture | undefined => {
    const sourceNodeId = (node as { inputs?: Record<string, string> }).inputs?.pipe;
    if (!sourceNodeId) return undefined;
    return renderNodeOutputTexture(sourceNodeId, getInputSourcePort(node, 'pipe'));
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

      const inputTransform = isCompositeMediaTexture
        ? 1
        : getNodeInputColorTransform(baseNode, sceneNode.colorSpace, nodeRegistry);
      const baseOcioTransform =
        !isCompositeMediaTexture && isMediaNodeWithRegistry(baseNode, nodeRegistry)
          ? getOcioColorSpaceTransform(
              getColorSpaceFromRegistry(baseNode, nodeRegistry),
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
            u_input_transform: { value: inputTransform },
            u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
            u_flipY: { value: false },
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
            fallbackSourceNode: baseNode,
            getInputTextureForNode: (nodeId, targetFrame) => {
              const sourceNode = nodes.find((l) => l.id === nodeId);
              if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
                return getMediaTexture(sourceNode as MediaNode, targetFrame);
              }
              return undefined;
            },
            getPaintTextures: (node) => getPaintTextures?.(node.id),
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

        const operator = (baseNode as any).operator ?? BlendMode.OVER;
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
        const operator = (baseNode as any).operator ?? BlendMode.OVER;
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
              u_input_transform: { value: inputTransform },
              u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
              u_flipY: { value: false },
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
              u_input_transform: { value: inputTransform },
              u_source_alpha_mode: { value: getSourceAlphaModeUniform(baseNode) },
              u_flipY: { value: false },
              ...createOcioUniforms(baseOcioTransform, resources.ocioTextures!),
            },
          );
        }
      }

      const operator = (baseNode as any).operator ?? BlendMode.OVER;
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
      const renderedMerge = renderMergeNodeToMain({
        renderer,
        scene: resources.scene,
        camera: resources.camera,
        quad: resources.quad,
        getMaterial,
        node: baseNode,
        nodes,
        frame,
        readBuffer,
        renderNodeOutputTexture,
        clearReadBuffer: () => clearRenderTargetTransparent(renderer, readBuffer),
        renderStraightOverToMain,
      });
      if (isPromiseLike(renderedMerge)) {
        throw new Error('Viewport merge rendering must remain synchronous.');
      }
    } else if (isStackAdjustmentType(baseNode.type) && !isStackedAdjustmentNode(baseNode)) {
      const adjMode = getRenderMode(baseNode, nodeRegistry);
      const explicitPipeTexture = getExplicitPipeTexture(baseNode);
      const adjustmentInputTexture = explicitPipeTexture ?? readBuffer.texture;
      const reformatTargetSize =
        adjMode === 'shader' || adjMode === 'warp' ? getReformatTargetSize(baseNode) : null;
      const outputSceneSize = reformatTargetSize ?? currentSceneSize;
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
        fallbackSourceNode: previousMediaNode,
        getInputTextureForNode: (nodeId, targetFrame) => {
          const sourceNode = nodes.find((l) => l.id === nodeId);
          if (sourceNode && isMediaNodeWithRegistry(sourceNode, nodeRegistry)) {
            return getMediaTexture(sourceNode as MediaNode, targetFrame);
          }
          return undefined;
        },
        getPaintTextures: (node) => getPaintTextures?.(node.id),
        getRotoMaskLayers,
        getRotoAlphaMode,
        getScratchRenderTarget: (key) => getUtilityOutputTarget(`__scratch:${key}`),
      });

      if (isPromiseLike(rendered)) {
        throw new Error('Viewport adjustment rendering must remain synchronous.');
      }

      if (rendered) {
        swapMainBuffers();
        if (reformatTargetSize) {
          setCurrentSceneSize(reformatTargetSize);
        }
      }
    }
  }

  const viewerChannelIndex = VIEWER_CHANNELS.indexOf(viewerSettings.channels);
  const alphaOverlayActive = viewerSettings.alphaOverlay && viewerSettings.channels !== 'A';
  const ocioTransform = getOcioDisplayViewTransform(
    sceneNode.colorSpace,
    viewerSettings,
    colorManagement,
  );
  const viewerMaterial = getMaterial('viewer', buildOcioViewerShader(ocioTransform), {
    u_tDiffuse: { value: readBuffer.texture },
    u_gain: { value: viewerSettings.gain },
    u_gamma: { value: viewerSettings.gamma },
    u_saturation: { value: viewerSettings.saturation },
    u_view_transform: {
      value: viewerSettings.ocioView !== 'Raw' && sceneNode.colorSpace === 'Linear' ? 1 : 0,
    },
    u_channel: { value: viewerChannelIndex >= 0 ? viewerChannelIndex : 0 },
    u_ignoreAlpha: { value: viewerSettings.channels !== 'A' },
    u_alphaOverlay: { value: alphaOverlayActive },
    u_alphaOverlayColor: { value: new THREE.Color(...alphaOverlayStyle.color) },
    u_alphaOverlayOpacity: { value: alphaOverlayStyle.opacity },
    u_alphaOverlayBgDarken: { value: alphaOverlayStyle.bgDarken },
    ...createOcioUniforms(ocioTransform, resources.ocioTextures!),
  });
  resources.quad.material = viewerMaterial;
  clearRenderTargetTransparent(renderer, null);
  renderer.render(resources.scene, resources.camera);

  return { renderTargets, finalCompositeTarget: readBuffer };
};
