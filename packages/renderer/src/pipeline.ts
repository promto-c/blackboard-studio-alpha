import * as THREE from 'three';
import {
  AnyNode,
  BlendMode,
  ImageNode,
  ImageSequenceNode,
  SceneNode,
  TextNode,
  VideoNode,
  ViewerSettings,
} from '@blackboard/types';
import type {
  ShaderUniformMap,
  EffectRenderContext,
  RenderMode,
  EffectRegistryLike,
  RendererInputPort,
} from './types';
import {
  PAINT_OVER_SHADER,
  ROTO_SHADER,
  STRAIGHT_TEXTURE_OVER_SHADER,
  STRAIGHT_TRANSFORMED_TEXTURE_OVER_SHADER,
  TEXTURE_SHADER,
  TEXTURE_OPACITY_SHADER,
  TRANSFORMED_TEXTURE_SHADER,
  VERTEX_SHADER,
  VIEWER_SHADER,
} from './glsl';
import { getValueAtFrame } from './animation';
import { createNodePredicates } from './nodePredicates';
import { assertWebGL2Renderer, createStudioRenderer, createStudioShaderMaterial } from './webgl';

type MediaNode = ImageNode | VideoNode | ImageSequenceNode;

const VIEWER_CHANNELS: ViewerSettings['channels'][] = ['RGB', 'R', 'G', 'B', 'A'];

export interface AlphaOverlayStyle {
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
const isMediaNodeWithRegistry = (node: AnyNode, reg: EffectRegistryLike): node is MediaNode => {
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
  effectRegistry: EffectRegistryLike;
  getAsset: (id: string) => Promise<Blob | null>;
  getRotoMaskTexture?: (nodeId: string) => THREE.Texture | undefined;
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

const getSceneRenderTargetOptions = (sceneNode: SceneNode): THREE.RenderTargetOptions => {
  const targetType =
    sceneNode.bitDepth === 32
      ? THREE.FloatType
      : sceneNode.bitDepth === 16
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType;

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

// ---------------------------------------------------------------------------
// Registry-aware texture key and asset ID helpers
// ---------------------------------------------------------------------------

/**
 * Get the media texture key for a node using the registry's media descriptor.
 */
const getMediaTextureKeyFromRegistry = (
  node: AnyNode,
  frame: number,
  reg: EffectRegistryLike,
): string | null => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.getMediaTextureKey?.(node, frame) || null;
};

/**
 * Get asset IDs from a node using the registry's media descriptor.
 */
const getMediaAssetIdsFromRegistry = (
  node: AnyNode,
  frame: number,
  reg: EffectRegistryLike,
): string[] => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.getAssetIds?.(node) ?? [];
};

/**
 * Get color space for a media node using the registry's media descriptor.
 */
const getColorSpaceFromRegistry = (node: AnyNode, reg: EffectRegistryLike): string | undefined => {
  const def = reg.get(node.type);
  return def?.mediaDescriptor?.getColorSpace?.(node);
};

const getPaintInputTransform = (sceneColorSpace: SceneNode['colorSpace']): number =>
  sceneColorSpace === 'Linear' ? 0 : 1;

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
  context: EffectRenderContext,
  effectRegistry: EffectRegistryLike,
): ShaderUniformMap => {
  const definition = effectRegistry.get(node.type);
  if (!definition?.getUniforms) return {};
  return definition.getUniforms(node, context);
};

const getInputPortsForNode = (
  node: AnyNode,
  effectRegistry: EffectRegistryLike,
): RendererInputPort[] => {
  const inputPorts = effectRegistry.get(node.type)?.inputPorts;
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
  if (Array.isArray(value)) return getValueAtFrame(value as any, frame);
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

const getVisiblePipelineNodes = (
  nodes: AnyNode[],
  effectRegistry: EffectRegistryLike,
): AnyNode[] => {
  const visibleNodes: AnyNode[] = [];
  let skippingDetachedStack = false;

  for (const node of nodes) {
    const def = effectRegistry.get(node.type);
    if (def?.flags?.isSceneLike) {
      skippingDetachedStack = false;
      continue;
    }

    const isStacked = !!(node as { stacked?: boolean }).stacked;
    if (!isStacked) {
      skippingDetachedStack = !!(node as { detachedFromPipe?: boolean }).detachedFromPipe;
    }

    if (skippingDetachedStack || !node.visible) {
      continue;
    }

    visibleNodes.push(node);
  }

  return visibleNodes;
};

const getEffectShader = (node: AnyNode, effectRegistry: EffectRegistryLike): string | null => {
  const definition = effectRegistry.get(node.type);
  const shader = definition?.getShader?.(node);
  return typeof shader === 'string' ? shader : null;
};

const getRenderMode = (node: AnyNode, effectRegistry: EffectRegistryLike): RenderMode | null => {
  const definition = effectRegistry.get(node.type);
  return definition?.renderMode ?? null;
};

const getMultipassShaders = (
  node: AnyNode,
  effectRegistry: EffectRegistryLike,
): { horizontal: string; vertical: string } | null => {
  const definition = effectRegistry.get(node.type);
  const shader = definition?.getShader?.(node);
  if (shader && typeof shader === 'object' && 'horizontal' in shader) {
    return shader as { horizontal: string; vertical: string };
  }
  return null;
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
  effectRegistry: EffectRegistryLike,
  frame: number,
): InputPreloadTarget[] => {
  const targets: InputPreloadTarget[] = [];
  let previousMediaNode: AnyNode | null = null;

  for (const node of visibleNodes) {
    const fallbackSourceNode = previousMediaNode;
    const inputs = (node as any).inputs as Record<string, string> | undefined;
    const inputPorts = getInputPortsForNode(node, effectRegistry);

    if (!inputs && !fallbackSourceNode) {
      if (isMediaNodeWithRegistry(node, effectRegistry)) {
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
          if (sourceNode && isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
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
        if (sourceNode && isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
          targets.push({ node: sourceNode as MediaNode, frame });
        }
      }
    }

    if (isMediaNodeWithRegistry(node, effectRegistry)) {
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
  effectRegistry: EffectRegistryLike,
  frame: number,
  getTextureForNodeId: (nodeId: string, targetFrame: number) => THREE.Texture | undefined,
  fallbackSourceNode?: AnyNode | null,
): ShaderUniformMap => {
  const inputs = (node as any).inputs as Record<string, string> | undefined;
  const inputPorts = getInputPortsForNode(node, effectRegistry);

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

export const renderWithSharedPipeline = async (
  options: RenderPipelineOptions,
): Promise<RenderPipelineResult> => {
  const frame = options.frame ?? 0;
  const blurRadiusScale = options.blurRadiusScale ?? 1;
  const textureCacheMode = options.textureCacheMode ?? 'none';
  const presentToCanvas = options.presentToCanvas ?? true;
  const keepRendererAlive = options.keepRendererAlive ?? false;
  const alphaOverlayStyle = resolveAlphaOverlayStyle(options.alphaOverlayStyle);
  const { effectRegistry, getAsset } = options;
  const { isStackedExportAdjustmentNode, isExportAdjustmentType } =
    createNodePredicates(effectRegistry);
  const renderContext: EffectRenderContext = {
    frame,
    fps: options.sceneNode.fps || 30,
    scene: { width: options.sceneNode.width, height: options.sceneNode.height },
    nodes: options.nodes,
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
  renderer.setSize(options.width, options.height);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const plane = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(plane);
  scene.add(quad);

  const materials = new Map<string, THREE.ShaderMaterial>();
  const renderTargetOptions = getSceneRenderTargetOptions(options.sceneNode);
  const renderTargets = [
    new THREE.WebGLRenderTarget(options.width, options.height, renderTargetOptions),
    new THREE.WebGLRenderTarget(options.width, options.height, renderTargetOptions),
    new THREE.WebGLRenderTarget(options.width, options.height, renderTargetOptions),
  ];
  const finalOutputTarget = options.captureFinalOutput
    ? new THREE.WebGLRenderTarget(options.width, options.height, renderTargetOptions)
    : null;

  const dynamicTextures: THREE.Texture[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const loadedTextures = new Map<string, THREE.Texture>();
  const videos: HTMLVideoElement[] = [];
  const objectUrls: string[] = [];

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
        vertexShader: VERTEX_SHADER,
        fragmentShader: shader,
        uniforms,
      });
      materials.set(id, material);
      return material;
    };

    const loadTextureForMediaNode = async (
      node: AnyNode,
      targetFrame = frame,
    ): Promise<THREE.Texture | null> => {
      const key = getMediaTextureKeyFromRegistry(node, targetFrame, effectRegistry);
      if (!key) return null;

      // For most media types the texture key doubles as the asset ID
      // (image, image-sequence). For video the key encodes the frame
      // number (`${src}:${frame}`) so we fall back to getAssetIds.
      const def = effectRegistry.get(node.type);
      const isVideoLike = !!def?.flags?.isVideoFile;
      const assetId = isVideoLike
        ? (getMediaAssetIdsFromRegistry(node, targetFrame, effectRegistry)[0] ?? null)
        : key;
      if (!assetId) return null;

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

    const visibleNodes = getVisiblePipelineNodes(options.nodes, effectRegistry);

    const preloadTargets = new Map<string, InputPreloadTarget>();
    const addPreloadTarget = (node: AnyNode, targetFrame: number) => {
      preloadTargets.set(`${node.id}:${targetFrame}`, {
        node: node as MediaNode,
        frame: targetFrame,
      });
    };
    visibleNodes.forEach((node) => {
      if (isMediaNodeWithRegistry(node, effectRegistry)) {
        addPreloadTarget(node, frame);
      }
    });
    // Preload textures for all generic input port references
    collectInputPreloadTargets(visibleNodes, options.nodes, effectRegistry, frame).forEach(
      (target) => addPreloadTarget(target.node, target.frame),
    );
    await Promise.all(
      Array.from(preloadTargets.values(), (target) =>
        loadTextureForMediaNode(target.node, target.frame),
      ),
    );

    let [readBuffer, writeBuffer] = renderTargets;
    const auxBuffer = renderTargets[2];
    const swapMainBuffers = () => {
      [readBuffer, writeBuffer] = [writeBuffer, readBuffer];
    };
    const copyTargetToWriteBuffer = (sourceTarget: THREE.WebGLRenderTarget) => {
      const copyMaterial = getMaterial('copy_to_main_write', TEXTURE_SHADER, {
        u_tDiffuse: { value: sourceTarget.texture },
      });
      applyNoBlending(copyMaterial);
      quad.material = copyMaterial;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(scene, camera);
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
    clearRenderTargetTransparent(renderer, readBuffer);

    let previousMediaNode: AnyNode | null = null;
    for (let i = 0; i < visibleNodes.length; i += 1) {
      const baseNode = visibleNodes[i];

      const baseMode = getRenderMode(baseNode, effectRegistry);

      if (baseMode === 'media' || baseMode === 'text') {
        if (isMediaNodeWithRegistry(baseNode, effectRegistry)) {
          previousMediaNode = baseNode;
        }
        let texture: THREE.Texture | null = null;
        let width = 0;
        let height = 0;
        let isDynamicTexture = false;
        let scale = 1;
        const offset = new THREE.Vector2(0, 0);
        let opacity = 100;
        let inputTransform = 1;

        if (isMediaNodeWithRegistry(baseNode, effectRegistry)) {
          texture = await loadTextureForMediaNode(baseNode);
          if (!texture) {
            continue;
          }
          width = (baseNode as any).width;
          height = (baseNode as any).height;
          if ((baseNode as any).transform) {
            scale = getValueAtFrame((baseNode as any).transform.scale, frame);
            offset.set(
              getValueAtFrame((baseNode as any).transform.x, frame),
              getValueAtFrame((baseNode as any).transform.y, frame),
            );
            opacity = getValueAtFrame((baseNode as any).opacity, frame);
          }
          // Registry-aware color space conversion
          const mediaCS = getColorSpaceFromRegistry(baseNode, effectRegistry);
          const sceneCS = options.sceneNode.colorSpace;
          if (mediaCS === 'sRGB' && sceneCS === 'Linear') inputTransform = 0;
          else if ((mediaCS === 'Linear' || mediaCS === 'Raw') && sceneCS === 'sRGB')
            inputTransform = 2;
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

        const stackedNodes: AnyNode[] = [];
        let consumedCount = 0;
        for (let j = i + 1; j < visibleNodes.length; j += 1) {
          const upper = visibleNodes[j];
          if (isStackedExportAdjustmentNode(upper)) {
            stackedNodes.push(upper);
            consumedCount += 1;
          } else {
            break;
          }
        }

        let finalComposite: THREE.ShaderMaterial;
        let straightOverTarget = writeBuffer;
        if (stackedNodes.length > 0) {
          let stackRead = writeBuffer;
          let stackWrite = auxBuffer;

          clearRenderTargetTransparent(renderer, stackRead);
          const basePass = getMaterial(`${baseNode.id}_stack_base`, TRANSFORMED_TEXTURE_SHADER, {
            u_tDiffuse: { value: texture },
            u_opacity: { value: 1 },
            u_scale: { value: scale },
            u_offset: { value: offset },
            u_scene_res: {
              value: new THREE.Vector2(options.sceneNode.width, options.sceneNode.height),
            },
            u_image_res: { value: new THREE.Vector2(width, height) },
            u_input_transform: { value: inputTransform },
          });
          quad.material = basePass;
          renderer.render(scene, camera);

          for (const stackedNode of stackedNodes) {
            let shouldSwap = true;
            const stackedMode = getRenderMode(stackedNode, effectRegistry);

            if (stackedMode === 'shader' || stackedMode === 'warp') {
              const uniforms = withDiffuseUniform(
                getEffectUniforms(stackedNode, renderContext, effectRegistry),
                stackRead.texture,
              );
              // Resolve generic input port connections
              const inputUniforms = resolveInputUniforms(
                stackedNode,
                effectRegistry,
                frame,
                (nodeId, targetFrame) => {
                  const sourceNode = options.nodes.find((l) => l.id === nodeId);
                  if (sourceNode && isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
                    const key = getMediaTextureKeyFromRegistry(
                      sourceNode,
                      targetFrame,
                      effectRegistry,
                    );
                    return key ? loadedTextures.get(key) : undefined;
                  }
                  return undefined;
                },
                baseNode,
              );
              Object.assign(uniforms, inputUniforms);
              const shader = getEffectShader(stackedNode, effectRegistry);
              if (shader) {
                const material = getMaterial(stackedNode.id, shader, uniforms);
                quad.material = material;
                renderer.setRenderTarget(stackWrite);
                renderer.render(scene, camera);
              } else {
                shouldSwap = false;
              }
            } else if (stackedMode === 'multipass') {
              const shaders = getMultipassShaders(stackedNode, effectRegistry);
              if (shaders) {
                const blurUniforms = getEffectUniforms(stackedNode, renderContext, effectRegistry);
                const radius =
                  getNumericUniformValue(blurUniforms, 'u_radius', 0) * blurRadiusScale;
                const hPass = getMaterial(`${stackedNode.id}_blur_h`, shaders.horizontal, {
                  u_tDiffuse: { value: stackRead.texture },
                  u_radius: { value: radius },
                  u_resolution_x: { value: options.width },
                });
                quad.material = hPass;
                renderer.setRenderTarget(readBuffer);
                renderer.render(scene, camera);
                const vPass = getMaterial(`${stackedNode.id}_blur_v`, shaders.vertical, {
                  u_tDiffuse: { value: readBuffer.texture },
                  u_radius: { value: radius },
                  u_resolution_y: { value: options.height },
                });
                quad.material = vPass;
                renderer.setRenderTarget(stackWrite);
                renderer.render(scene, camera);
              } else {
                shouldSwap = false;
              }
            } else if (stackedMode === 'paint') {
              const paintTextures = await loadPaintTextures(stackedNode);
              if (paintTextures) {
                const material = getMaterial(`${stackedNode.id}_paint`, PAINT_OVER_SHADER, {
                  u_tDiffuse: { value: stackRead.texture },
                  u_tPaint: { value: paintTextures.color },
                  u_tPaintAlpha: { value: paintTextures.alpha },
                  u_input_transform: {
                    value: getPaintInputTransform(options.sceneNode.colorSpace),
                  },
                });
                quad.material = material;
                renderer.setRenderTarget(stackWrite);
                renderer.render(scene, camera);
              } else {
                shouldSwap = false;
              }
            } else if (stackedMode === 'mask') {
              const maskTexture = options.getRotoMaskTexture?.(stackedNode.id);
              if (maskTexture) {
                const material = getMaterial(stackedNode.id, ROTO_SHADER, {
                  u_tDiffuse: { value: stackRead.texture },
                  u_tMask: { value: maskTexture },
                });
                quad.material = material;
                renderer.setRenderTarget(stackWrite);
                renderer.render(scene, camera);
              } else {
                shouldSwap = false;
              }
            } else {
              shouldSwap = false;
            }

            if (shouldSwap) {
              [stackRead, stackWrite] = [stackWrite, stackRead];
            }
          }

          const operator = (baseNode as any).operator ?? BlendMode.OVER;
          if (operator === BlendMode.OVER) {
            straightOverTarget = stackRead === writeBuffer ? auxBuffer : writeBuffer;
            finalComposite = getMaterial(
              `${baseNode.id}_stack_comp_straight_over`,
              STRAIGHT_TEXTURE_OVER_SHADER,
              {
                u_tBackdrop: { value: readBuffer.texture },
                u_tDiffuse: { value: stackRead.texture },
                u_opacity: { value: opacity / 100 },
              },
            );
          } else {
            finalComposite = getMaterial(`${baseNode.id}_stack_comp`, TEXTURE_OPACITY_SHADER, {
              u_tDiffuse: { value: stackRead.texture },
              u_opacity: { value: opacity / 100 },
            });
          }
        } else {
          const operator = (baseNode as any).operator ?? BlendMode.OVER;
          if (operator === BlendMode.OVER) {
            finalComposite = getMaterial(
              `${baseNode.id}_comp_straight_over`,
              STRAIGHT_TRANSFORMED_TEXTURE_OVER_SHADER,
              {
                u_tBackdrop: { value: readBuffer.texture },
                u_tDiffuse: { value: texture },
                u_opacity: { value: opacity / 100 },
                u_scale: { value: scale },
                u_offset: { value: offset },
                u_scene_res: {
                  value: new THREE.Vector2(options.sceneNode.width, options.sceneNode.height),
                },
                u_image_res: { value: new THREE.Vector2(width, height) },
                u_input_transform: { value: inputTransform },
                u_flipY: { value: false },
              },
            );
          } else {
            finalComposite = getMaterial(`${baseNode.id}_comp`, TRANSFORMED_TEXTURE_SHADER, {
              u_tDiffuse: { value: texture },
              u_opacity: { value: opacity / 100 },
              u_scale: { value: scale },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(options.sceneNode.width, options.sceneNode.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_input_transform: { value: inputTransform },
            });
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
        const sourceNodeId = (baseNode as { inputs?: Record<string, string> }).inputs?.source;
        const sourceNode = sourceNodeId
          ? options.nodes.find((candidate) => candidate.id === sourceNodeId)
          : null;

        if (!sourceNode?.visible) {
          continue;
        }

        let texture: THREE.Texture | null = null;
        let width = 0;
        let height = 0;
        let isDynamicTexture = false;
        let scale = 1;
        const offset = new THREE.Vector2(0, 0);
        let inputTransform = 1;

        const sourceMode = getRenderMode(sourceNode, effectRegistry);
        if (isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
          texture = await loadTextureForMediaNode(sourceNode);
          if (!texture) {
            continue;
          }
          width = (sourceNode as any).width;
          height = (sourceNode as any).height;
          if ((sourceNode as any).transform) {
            scale = getValueAtFrame((sourceNode as any).transform.scale, frame);
            offset.set(
              getValueAtFrame((sourceNode as any).transform.x, frame),
              getValueAtFrame((sourceNode as any).transform.y, frame),
            );
          }
          const mediaCS = getColorSpaceFromRegistry(sourceNode, effectRegistry);
          const sceneCS = options.sceneNode.colorSpace;
          if (mediaCS === 'sRGB' && sceneCS === 'Linear') inputTransform = 0;
          else if ((mediaCS === 'Linear' || mediaCS === 'Raw') && sceneCS === 'sRGB')
            inputTransform = 2;
        } else if (sourceMode === 'text') {
          const textNode = sourceNode as TextNode;
          const textTexture = buildTextTexture(textNode, frame, dynamicTextures);
          texture = textTexture.texture;
          width = textTexture.width;
          height = textTexture.height;
          offset.set(
            getValueAtFrame(textNode.position.x, frame),
            getValueAtFrame(textNode.position.y, frame),
          );
          isDynamicTexture = true;
        }

        if (!texture) {
          continue;
        }

        const opacity = getValueAtFrame((baseNode as any).opacity ?? 100, frame);
        const operator = (baseNode as any).operator ?? BlendMode.OVER;
        const mergeComposite =
          operator === BlendMode.OVER
            ? getMaterial(
                `${baseNode.id}_merge_comp_straight_over`,
                STRAIGHT_TRANSFORMED_TEXTURE_OVER_SHADER,
                {
                  u_tBackdrop: { value: readBuffer.texture },
                  u_tDiffuse: { value: texture },
                  u_opacity: { value: opacity / 100 },
                  u_scale: { value: scale },
                  u_offset: { value: offset },
                  u_scene_res: {
                    value: new THREE.Vector2(options.sceneNode.width, options.sceneNode.height),
                  },
                  u_image_res: { value: new THREE.Vector2(width, height) },
                  u_input_transform: { value: inputTransform },
                  u_flipY: { value: false },
                },
              )
            : getMaterial(`${baseNode.id}_merge_comp`, TRANSFORMED_TEXTURE_SHADER, {
                u_tDiffuse: { value: texture },
                u_opacity: { value: opacity / 100 },
                u_scale: { value: scale },
                u_offset: { value: offset },
                u_scene_res: {
                  value: new THREE.Vector2(options.sceneNode.width, options.sceneNode.height),
                },
                u_image_res: { value: new THREE.Vector2(width, height) },
                u_input_transform: { value: inputTransform },
                u_flipY: { value: false },
              });
        if (operator === BlendMode.OVER) {
          renderStraightOverToMain(mergeComposite);
        } else {
          quad.material = mergeComposite;
          applyBlendMode(mergeComposite, operator);
          renderer.setRenderTarget(readBuffer);
          renderer.render(scene, camera);
        }

        if (isDynamicTexture) {
          texture.dispose();
        }
      } else if (
        isExportAdjustmentType(baseNode.type) &&
        !isStackedExportAdjustmentNode(baseNode)
      ) {
        const adjMode = getRenderMode(baseNode, effectRegistry);

        if (adjMode === 'shader' || adjMode === 'warp') {
          const uniforms = withDiffuseUniform(
            getEffectUniforms(baseNode, renderContext, effectRegistry),
            readBuffer.texture,
          );
          // Resolve generic input port connections
          const inputUniforms = resolveInputUniforms(
            baseNode,
            effectRegistry,
            frame,
            (nodeId, targetFrame) => {
              const sourceNode = options.nodes.find((l) => l.id === nodeId);
              if (sourceNode && isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
                const key = getMediaTextureKeyFromRegistry(sourceNode, targetFrame, effectRegistry);
                return key ? loadedTextures.get(key) : undefined;
              }
              return undefined;
            },
            previousMediaNode,
          );
          Object.assign(uniforms, inputUniforms);
          const shader = getEffectShader(baseNode, effectRegistry);
          if (shader) {
            const material = getMaterial(`${baseNode.id}_global`, shader, uniforms);
            quad.material = material;
            renderer.setRenderTarget(writeBuffer);
            renderer.render(scene, camera);
            swapMainBuffers();
          }
        } else if (adjMode === 'paint') {
          const paintTextures = await loadPaintTextures(baseNode);
          if (paintTextures) {
            const material = getMaterial(`${baseNode.id}_global_paint`, PAINT_OVER_SHADER, {
              u_tDiffuse: { value: readBuffer.texture },
              u_tPaint: { value: paintTextures.color },
              u_tPaintAlpha: { value: paintTextures.alpha },
              u_input_transform: { value: getPaintInputTransform(options.sceneNode.colorSpace) },
            });
            quad.material = material;
            renderer.setRenderTarget(writeBuffer);
            renderer.render(scene, camera);
            swapMainBuffers();
          }
        } else if (adjMode === 'multipass') {
          const shaders = getMultipassShaders(baseNode, effectRegistry);
          if (shaders) {
            const blurUniforms = getEffectUniforms(baseNode, renderContext, effectRegistry);
            const radius = getNumericUniformValue(blurUniforms, 'u_radius', 0) * blurRadiusScale;
            const hPass = getMaterial(`${baseNode.id}_global_blur_h`, shaders.horizontal, {
              u_tDiffuse: { value: readBuffer.texture },
              u_radius: { value: radius },
              u_resolution_x: { value: options.width },
            });
            quad.material = hPass;
            renderer.setRenderTarget(auxBuffer);
            renderer.render(scene, camera);
            const vPass = getMaterial(`${baseNode.id}_global_blur_v`, shaders.vertical, {
              u_tDiffuse: { value: auxBuffer.texture },
              u_radius: { value: radius },
              u_resolution_y: { value: options.height },
            });
            quad.material = vPass;
            renderer.setRenderTarget(writeBuffer);
            renderer.render(scene, camera);
            swapMainBuffers();
          }
        } else if (adjMode === 'mask') {
          const maskTexture = options.getRotoMaskTexture?.(baseNode.id);
          if (maskTexture) {
            const material = getMaterial(`${baseNode.id}_global_mask`, ROTO_SHADER, {
              u_tDiffuse: { value: readBuffer.texture },
              u_tMask: { value: maskTexture },
            });
            quad.material = material;
            renderer.setRenderTarget(writeBuffer);
            renderer.render(scene, camera);
            swapMainBuffers();
          }
        }
      }
    }

    let finalMaterial: THREE.ShaderMaterial;
    if (options.finalColorSpace === 'raw_texture' || options.finalColorSpace === 'scene_linear') {
      finalMaterial = getMaterial('final_raw', TEXTURE_SHADER, {
        u_tDiffuse: { value: readBuffer.texture },
      });
    } else if (options.finalColorSpace === 'srgb') {
      finalMaterial = getMaterial('final_srgb', VIEWER_SHADER, {
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
      finalMaterial = getMaterial('final_viewport', VIEWER_SHADER, {
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

export interface ViewportPipelineResources {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  materials: Map<string, THREE.ShaderMaterial>;
  renderTargets: THREE.WebGLRenderTarget[];
}

export interface ViewportPipelineOptions {
  resources: ViewportPipelineResources;
  nodes: AnyNode[];
  sceneNode: SceneNode;
  frame: number;
  viewerSettings: ViewerSettings;
  alphaOverlayStyle?: AlphaOverlayStyle;
  getMediaTexture: (node: MediaNode, frame: number) => THREE.Texture | undefined;
  getTextTexture: (
    node: TextNode,
  ) => { texture: THREE.Texture; width: number; height: number } | undefined;
  getRotoMaskTexture?: (nodeId: string) => THREE.Texture | undefined;
  getPaintTextures?: (nodeId: string) => { color: THREE.Texture; alpha: THREE.Texture } | undefined;
  effectRegistry: EffectRegistryLike;
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
    getMediaTexture,
    getTextTexture,
    getRotoMaskTexture,
    getPaintTextures,
    effectRegistry,
  } = options;
  const alphaOverlayStyle = resolveAlphaOverlayStyle(options.alphaOverlayStyle);
  const { isStackedAdjustmentNode, isStackAdjustmentType } = createNodePredicates(effectRegistry);
  const renderContext: EffectRenderContext = {
    frame,
    fps: sceneNode.fps || 30,
    scene: { width: sceneNode.width, height: sceneNode.height },
    nodes: nodes,
  };

  const renderer = resources.renderer;
  assertWebGL2Renderer(renderer);
  renderer.setSize(sceneNode.width, sceneNode.height);
  renderer.autoClear = false;

  let renderTargets = resources.renderTargets;
  if (
    renderTargets.length === 0 ||
    renderTargets[0].width !== sceneNode.width ||
    renderTargets[0].height !== sceneNode.height
  ) {
    renderTargets.forEach((target) => target.dispose());

    const targetType =
      sceneNode.bitDepth === 32
        ? THREE.FloatType
        : sceneNode.bitDepth === 16
          ? THREE.HalfFloatType
          : THREE.UnsignedByteType;
    const targetOptions = {
      type: targetType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    };
    renderTargets = [
      new THREE.WebGLRenderTarget(sceneNode.width, sceneNode.height, targetOptions),
      new THREE.WebGLRenderTarget(sceneNode.width, sceneNode.height, targetOptions),
      new THREE.WebGLRenderTarget(sceneNode.width, sceneNode.height, targetOptions),
    ];
  }

  let [readBuffer, writeBuffer] = renderTargets;
  const auxBuffer = renderTargets[2];
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
      vertexShader: VERTEX_SHADER,
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
    const copyMaterial = getMaterial('copy_to_main_write', TEXTURE_SHADER, {
      u_tDiffuse: { value: sourceTarget.texture },
    });
    applyNoBlending(copyMaterial);
    resources.quad.material = copyMaterial;
    renderer.setRenderTarget(writeBuffer);
    renderer.render(resources.scene, resources.camera);
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

  clearRenderTargetTransparent(renderer, readBuffer);

  const visibleNodes = getVisiblePipelineNodes(nodes, effectRegistry);
  let previousMediaNode: AnyNode | null = null;
  for (let index = 0; index < visibleNodes.length; index += 1) {
    const baseNode = visibleNodes[index];
    const baseMode = getRenderMode(baseNode, effectRegistry);

    if (baseMode === 'media' || baseMode === 'text') {
      if (isMediaNodeWithRegistry(baseNode, effectRegistry)) {
        previousMediaNode = baseNode;
      }
      let texture: THREE.Texture | undefined;
      let width = 0;
      let height = 0;
      let scale = 1;
      const offset = new THREE.Vector2(0, 0);
      let opacity = 100;

      if (isMediaNodeWithRegistry(baseNode, effectRegistry)) {
        texture = getMediaTexture(baseNode as MediaNode, frame);
        if (!texture) {
          continue;
        }
        width = baseNode.width;
        height = baseNode.height;
        scale = getValueAtFrame(baseNode.transform.scale, frame);
        offset.set(
          getValueAtFrame(baseNode.transform.x, frame),
          getValueAtFrame(baseNode.transform.y, frame),
        );
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

      let inputTransform = 1;
      const mediaCS = getColorSpaceFromRegistry(baseNode, effectRegistry);
      if (mediaCS) {
        if (mediaCS === 'sRGB' && sceneNode.colorSpace === 'Linear') {
          inputTransform = 0;
        } else if ((mediaCS === 'Linear' || mediaCS === 'Raw') && sceneNode.colorSpace === 'sRGB') {
          inputTransform = 2;
        }
      }

      const stackedNodes: AnyNode[] = [];
      let consumedCount = 0;
      for (let upperIndex = index + 1; upperIndex < visibleNodes.length; upperIndex += 1) {
        const upperNode = visibleNodes[upperIndex];
        if (isStackedAdjustmentNode(upperNode)) {
          stackedNodes.push(upperNode);
          consumedCount += 1;
        } else {
          break;
        }
      }

      let finalCompositeMaterial: THREE.ShaderMaterial;
      let straightOverTarget = writeBuffer;
      if (stackedNodes.length > 0) {
        let stackRead = writeBuffer;
        let stackWrite = auxBuffer;
        clearRenderTargetTransparent(renderer, stackRead);

        const baseMaterial = getMaterial(
          `${baseNode.id}_base_transformed`,
          TRANSFORMED_TEXTURE_SHADER,
          {
            u_tDiffuse: { value: texture },
            u_opacity: { value: 1 },
            u_scale: { value: scale },
            u_offset: { value: offset },
            u_scene_res: {
              value: new THREE.Vector2(sceneNode.width, sceneNode.height),
            },
            u_image_res: { value: new THREE.Vector2(width, height) },
            u_input_transform: { value: inputTransform },
            u_flipY: { value: false },
          },
        );
        resources.quad.material = baseMaterial;
        renderer.render(resources.scene, resources.camera);

        for (const stackedNode of stackedNodes) {
          let shouldSwap = true;
          const stackedMode = getRenderMode(stackedNode, effectRegistry);

          if (stackedMode === 'shader' || stackedMode === 'warp') {
            const uniforms = withDiffuseUniform(
              getEffectUniforms(stackedNode, renderContext, effectRegistry),
              stackRead.texture,
            );
            // Resolve generic input port connections
            const inputUniforms = resolveInputUniforms(
              stackedNode,
              effectRegistry,
              frame,
              (nodeId, targetFrame) => {
                const sourceNode = nodes.find((l) => l.id === nodeId);
                if (sourceNode && isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
                  return getMediaTexture(sourceNode as MediaNode, targetFrame);
                }
                return undefined;
              },
              baseNode,
            );
            Object.assign(uniforms, inputUniforms);
            const shader = getEffectShader(stackedNode, effectRegistry);
            if (shader) {
              const material = getMaterial(stackedNode.id, shader, uniforms);
              resources.quad.material = material;
              renderer.setRenderTarget(stackWrite);
              renderer.render(resources.scene, resources.camera);
            } else {
              shouldSwap = false;
            }
          } else if (stackedMode === 'multipass') {
            const shaders = getMultipassShaders(stackedNode, effectRegistry);
            if (shaders) {
              const blurUniforms = getEffectUniforms(stackedNode, renderContext, effectRegistry);
              const radius = getNumericUniformValue(blurUniforms, 'u_radius', 0);
              const hMaterial = getMaterial(`${stackedNode.id}_h`, shaders.horizontal, {
                u_tDiffuse: { value: stackRead.texture },
                u_radius: { value: radius },
                u_resolution_x: { value: sceneNode.width },
              });
              resources.quad.material = hMaterial;
              renderer.setRenderTarget(stackWrite);
              renderer.render(resources.scene, resources.camera);

              const vMaterial = getMaterial(`${stackedNode.id}_v`, shaders.vertical, {
                u_tDiffuse: { value: stackWrite.texture },
                u_radius: { value: radius },
                u_resolution_y: { value: sceneNode.height },
              });
              resources.quad.material = vMaterial;
              renderer.setRenderTarget(stackRead);
              renderer.render(resources.scene, resources.camera);
              shouldSwap = false;
            } else {
              shouldSwap = false;
            }
          } else if (stackedMode === 'mask') {
            const maskTexture = getRotoMaskTexture?.(stackedNode.id);
            if (maskTexture) {
              const material = getMaterial(stackedNode.id, ROTO_SHADER, {
                u_tDiffuse: { value: stackRead.texture },
                u_tMask: { value: maskTexture },
              });
              resources.quad.material = material;
              renderer.setRenderTarget(stackWrite);
              renderer.render(resources.scene, resources.camera);
            } else {
              shouldSwap = false;
            }
          } else if (stackedMode === 'paint') {
            const paintTextures = getPaintTextures?.(stackedNode.id);
            if (paintTextures) {
              const material = getMaterial(`${stackedNode.id}_paint`, PAINT_OVER_SHADER, {
                u_tDiffuse: { value: stackRead.texture },
                u_tPaint: { value: paintTextures.color },
                u_tPaintAlpha: { value: paintTextures.alpha },
                u_input_transform: { value: getPaintInputTransform(sceneNode.colorSpace) },
              });
              resources.quad.material = material;
              renderer.setRenderTarget(stackWrite);
              renderer.render(resources.scene, resources.camera);
            } else {
              shouldSwap = false;
            }
          } else {
            shouldSwap = false;
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
            STRAIGHT_TEXTURE_OVER_SHADER,
            {
              u_tBackdrop: { value: readBuffer.texture },
              u_tDiffuse: { value: stackRead.texture },
              u_opacity: { value: opacity / 100 },
            },
          );
        } else {
          finalCompositeMaterial = getMaterial(`${baseNode.id}_comp`, TEXTURE_OPACITY_SHADER, {
            u_tDiffuse: { value: stackRead.texture },
            u_opacity: { value: opacity / 100 },
          });
        }
      } else {
        const operator = (baseNode as any).operator ?? BlendMode.OVER;
        if (operator === BlendMode.OVER) {
          finalCompositeMaterial = getMaterial(
            `${baseNode.id}_comp_transformed_straight_over`,
            STRAIGHT_TRANSFORMED_TEXTURE_OVER_SHADER,
            {
              u_tBackdrop: { value: readBuffer.texture },
              u_tDiffuse: { value: texture },
              u_opacity: { value: opacity / 100 },
              u_scale: { value: scale },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(sceneNode.width, sceneNode.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_input_transform: { value: inputTransform },
              u_flipY: { value: false },
            },
          );
        } else {
          finalCompositeMaterial = getMaterial(
            `${baseNode.id}_comp_transformed`,
            TRANSFORMED_TEXTURE_SHADER,
            {
              u_tDiffuse: { value: texture },
              u_opacity: { value: opacity / 100 },
              u_scale: { value: scale },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(sceneNode.width, sceneNode.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_input_transform: { value: inputTransform },
              u_flipY: { value: false },
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
      const sourceNodeId = (baseNode as { inputs?: Record<string, string> }).inputs?.source;
      const sourceNode = sourceNodeId
        ? nodes.find((candidate) => candidate.id === sourceNodeId)
        : null;

      if (!sourceNode?.visible) {
        continue;
      }

      let texture: THREE.Texture | undefined;
      let width = 0;
      let height = 0;
      let scale = 1;
      const offset = new THREE.Vector2(0, 0);

      const sourceMode = getRenderMode(sourceNode, effectRegistry);
      if (isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
        texture = getMediaTexture(sourceNode as MediaNode, frame);
        if (!texture) {
          continue;
        }
        width = (sourceNode as MediaNode).width;
        height = (sourceNode as MediaNode).height;
        scale = getValueAtFrame((sourceNode as MediaNode).transform.scale, frame);
        offset.set(
          getValueAtFrame((sourceNode as MediaNode).transform.x, frame),
          getValueAtFrame((sourceNode as MediaNode).transform.y, frame),
        );
      } else if (sourceMode === 'text') {
        const textTexture = getTextTexture(sourceNode as TextNode);
        if (!textTexture) {
          continue;
        }
        texture = textTexture.texture;
        width = textTexture.width;
        height = textTexture.height;
        offset.set(
          getValueAtFrame((sourceNode as TextNode).position.x, frame),
          getValueAtFrame((sourceNode as TextNode).position.y, frame),
        );
      }

      if (!texture) {
        continue;
      }

      let inputTransform = 1;
      const mediaCS = getColorSpaceFromRegistry(sourceNode, effectRegistry);
      if (mediaCS) {
        if (mediaCS === 'sRGB' && sceneNode.colorSpace === 'Linear') {
          inputTransform = 0;
        } else if ((mediaCS === 'Linear' || mediaCS === 'Raw') && sceneNode.colorSpace === 'sRGB') {
          inputTransform = 2;
        }
      }

      const opacity = getValueAtFrame((baseNode as any).opacity ?? 100, frame);
      const operator = (baseNode as any).operator ?? BlendMode.OVER;
      const mergeCompositeMaterial =
        operator === BlendMode.OVER
          ? getMaterial(
              `${baseNode.id}_merge_comp_transformed_straight_over`,
              STRAIGHT_TRANSFORMED_TEXTURE_OVER_SHADER,
              {
                u_tBackdrop: { value: readBuffer.texture },
                u_tDiffuse: { value: texture },
                u_opacity: { value: opacity / 100 },
                u_scale: { value: scale },
                u_offset: { value: offset },
                u_scene_res: {
                  value: new THREE.Vector2(sceneNode.width, sceneNode.height),
                },
                u_image_res: { value: new THREE.Vector2(width, height) },
                u_input_transform: { value: inputTransform },
                u_flipY: { value: false },
              },
            )
          : getMaterial(`${baseNode.id}_merge_comp_transformed`, TRANSFORMED_TEXTURE_SHADER, {
              u_tDiffuse: { value: texture },
              u_opacity: { value: opacity / 100 },
              u_scale: { value: scale },
              u_offset: { value: offset },
              u_scene_res: {
                value: new THREE.Vector2(sceneNode.width, sceneNode.height),
              },
              u_image_res: { value: new THREE.Vector2(width, height) },
              u_input_transform: { value: inputTransform },
              u_flipY: { value: false },
            });

      if (operator === BlendMode.OVER) {
        renderStraightOverToMain(mergeCompositeMaterial);
      } else {
        resources.quad.material = mergeCompositeMaterial;
        applyBlendMode(mergeCompositeMaterial, operator);
        renderer.setRenderTarget(readBuffer);
        renderer.render(resources.scene, resources.camera);
      }
    } else if (isStackAdjustmentType(baseNode.type) && !isStackedAdjustmentNode(baseNode)) {
      const adjMode = getRenderMode(baseNode, effectRegistry);

      if (adjMode === 'shader' || adjMode === 'warp') {
        const uniforms = withDiffuseUniform(
          getEffectUniforms(baseNode, renderContext, effectRegistry),
          readBuffer.texture,
        );
        // Resolve generic input port connections
        const inputUniforms = resolveInputUniforms(
          baseNode,
          effectRegistry,
          frame,
          (nodeId, targetFrame) => {
            const sourceNode = nodes.find((l) => l.id === nodeId);
            if (sourceNode && isMediaNodeWithRegistry(sourceNode, effectRegistry)) {
              return getMediaTexture(sourceNode as MediaNode, targetFrame);
            }
            return undefined;
          },
          previousMediaNode,
        );
        Object.assign(uniforms, inputUniforms);
        const shader = getEffectShader(baseNode, effectRegistry);
        if (shader) {
          const material = getMaterial(baseNode.id, shader, uniforms);
          resources.quad.material = material;
          renderer.setRenderTarget(writeBuffer);
          renderer.render(resources.scene, resources.camera);
          swapMainBuffers();
        }
      } else if (adjMode === 'paint') {
        const paintTextures = getPaintTextures?.(baseNode.id);
        if (paintTextures) {
          const material = getMaterial(`${baseNode.id}_paint`, PAINT_OVER_SHADER, {
            u_tDiffuse: { value: readBuffer.texture },
            u_tPaint: { value: paintTextures.color },
            u_tPaintAlpha: { value: paintTextures.alpha },
            u_input_transform: { value: getPaintInputTransform(sceneNode.colorSpace) },
          });
          resources.quad.material = material;
          renderer.setRenderTarget(writeBuffer);
          renderer.render(resources.scene, resources.camera);
          swapMainBuffers();
        }
      } else if (adjMode === 'multipass') {
        const shaders = getMultipassShaders(baseNode, effectRegistry);
        if (shaders) {
          const blurUniforms = getEffectUniforms(baseNode, renderContext, effectRegistry);
          const radius = getNumericUniformValue(blurUniforms, 'u_radius', 0);
          const hMaterial = getMaterial(`${baseNode.id}_h`, shaders.horizontal, {
            u_tDiffuse: { value: readBuffer.texture },
            u_radius: { value: radius },
            u_resolution_x: { value: sceneNode.width },
          });
          resources.quad.material = hMaterial;
          renderer.setRenderTarget(auxBuffer);
          renderer.render(resources.scene, resources.camera);
          const vMaterial = getMaterial(`${baseNode.id}_v`, shaders.vertical, {
            u_tDiffuse: { value: auxBuffer.texture },
            u_radius: { value: radius },
            u_resolution_y: { value: sceneNode.height },
          });
          resources.quad.material = vMaterial;
          renderer.setRenderTarget(writeBuffer);
          renderer.render(resources.scene, resources.camera);
          swapMainBuffers();
        }
      } else if (adjMode === 'mask') {
        const maskTexture = getRotoMaskTexture?.(baseNode.id);
        if (maskTexture) {
          const material = getMaterial(baseNode.id, ROTO_SHADER, {
            u_tDiffuse: { value: readBuffer.texture },
            u_tMask: { value: maskTexture },
          });
          resources.quad.material = material;
          renderer.setRenderTarget(writeBuffer);
          renderer.render(resources.scene, resources.camera);
          swapMainBuffers();
        }
      }
    }
  }

  const viewerChannelIndex = VIEWER_CHANNELS.indexOf(viewerSettings.channels);
  const alphaOverlayActive = viewerSettings.alphaOverlay && viewerSettings.channels !== 'A';
  const viewerMaterial = getMaterial('viewer', VIEWER_SHADER, {
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
  });
  resources.quad.material = viewerMaterial;
  clearRenderTargetTransparent(renderer, null);
  renderer.render(resources.scene, resources.camera);

  return { renderTargets, finalCompositeTarget: readBuffer };
};
