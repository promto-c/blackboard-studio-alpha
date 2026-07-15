// Rendering-domain types used by the pipeline and supporting modules.
// These are structurally compatible with the full NodeDefinition from apps/studio.

import * as THREE from 'three';
import type {
  AnimatableNumber,
  AnyNode,
  ColorProcessingDomain,
  DataChannelSemantic,
  DifferenceMaskMorphologyShape,
  GeneratedColorResolver,
  ImageTransform,
  RenderSceneSize,
  RenderSceneSizeBehavior,
  RgbaChannel,
  SceneNode,
  SourceAlphaMode,
} from '@blackboard/types';

export type ShaderUniformMap = Record<string, { value: unknown }>;

export type RenderMode =
  | 'shader'
  | 'ocio'
  | 'multipass'
  | 'mask'
  | 'paint'
  | 'warp'
  | 'merge'
  | 'merge_channels'
  | 'extract_channels'
  | 'media'
  | 'text'
  | 'scene'
  | 'utility';

type RendererToolCategory = 'Image' | 'Spatial' | 'Adjustment' | 'Effect' | 'Utility';

export interface RenderContext {
  frame: number;
  fps: number;
  scene: { width: number; height: number };
  nodes: unknown[];
  flow?: unknown;
  transformColorPickingToSceneLinear: (
    color: readonly [number, number, number],
  ) => [number, number, number];
}

/**
 * Declarative scene-size behavior for nodes that establish or change the
 * pipeline format. The renderer validates returned dimensions before use.
 */
export type RendererSceneSize = RenderSceneSize;
export type RendererSceneSizeBehavior = RenderSceneSizeBehavior<AnyNode, RenderContext>;

/** Minimal input port descriptor for the render pipeline. */
export interface RendererInputPort {
  name: string;
  label: string;
  type: 'texture' | 'mask' | 'data';
  dataSemantic?: DataChannelSemantic;
  /** RGBA component sampled when a full image is connected to this scalar channel input. */
  channel?: RgbaChannel;
  processingDomain?: ColorProcessingDomain;
  /** Optional host-UI color for graph sockets and wires. */
  color?: string;
  required: boolean;
  description?: string;
  uniformName?: string;
  /** Optional relative frame offset for texture inputs, e.g. -1 for previous frame. */
  frameOffset?: number;
  /** Optional absolute timeline frame for texture inputs. Takes precedence over frameOffset. */
  absoluteFrame?: number;
  /** Optional numeric uniform name used as a dynamic relative frame offset. */
  frameOffsetUniform?: string;
  /** Optional numeric uniform name used as a dynamic absolute timeline frame. */
  absoluteFrameUniform?: string;
}

type RendererInputPorts = RendererInputPort[] | ((node: unknown) => RendererInputPort[]);

/** Minimal output port descriptor for source-port-aware graph edges. */
export interface RendererOutputPort {
  name: string;
  label: string;
  dataSemantic?: DataChannelSemantic;
  /** Component carrying this scalar output; the remaining RGBA components must be zero. */
  channel?: RgbaChannel;
  processingDomain?: ColorProcessingDomain;
  /** Optional host-UI color for graph sockets and wires. */
  color?: string;
  description?: string;
}

type RendererOutputPorts = RendererOutputPort[] | ((node: unknown) => RendererOutputPort[]);

// ---------------------------------------------------------------------------
// Node flags — renderer-relevant subset used by the pipeline to replace
// hardcoded type checks like `isMediaNode()`, `getMediaTextureKey()`, etc.
// ---------------------------------------------------------------------------

/**
 * Declarative flags that the render pipeline can query instead of
 * checking node types directly. Structurally compatible with the
 * full `NodeFlags` from apps/studio NodeDefinition.
 */
interface RendererNodeFlags {
  /** Node should be counted/rendered when checking for renderable content. */
  isRenderable?: boolean;
  /** Node provides a media texture (image/video/sequence). */
  isMediaNode?: boolean;
  /** Node produces its own visual content (image, video, text, etc.). */
  isSource?: boolean;
  /** Node acts as the scene/canvas root. */
  isSceneLike?: boolean;
  /** Media node stores a single video file (decoded via HTMLVideoElement). */
  isVideoFile?: boolean;
}

// ---------------------------------------------------------------------------
// Media descriptor — renderer-relevant subset. The pipeline uses this to
// obtain texture keys, asset IDs, and color space transforms without
// hardcoding per-type branches.
// ---------------------------------------------------------------------------

/**
 * Renderer-relevant media descriptor. Structurally compatible with the
 * full `MediaDescriptor` from apps/studio NodeDefinition.
 */
interface RendererMediaDescriptor {
  /** Extract asset IDs that this node references. */
  getAssetIds: (node: AnyNode) => string[];
  /** Resolve a timeline frame to a source frame, or null for transparent black. */
  resolveFrame?: (node: AnyNode, frame: number) => number | null;
  /**
   * Return the texture key used to look up/store this node's media texture
   * in the pipeline's texture cache.
   */
  getMediaTextureKey?: (node: AnyNode, frame: number) => string;
  /** Optional visible media layers that should be composited inside this media node. */
  getCompositeLayers?: (
    node: AnyNode,
    frame: number,
    context: RendererMediaCompositeContext,
  ) => RendererMediaCompositeLayer[];
  /** Return true when this node's active media should be decoded as a video file. */
  isVideoFile?: (node: AnyNode) => boolean;
  /** Return true when this media should bypass RGB color transforms. */
  isData?: (node: AnyNode) => boolean;
  /** Optional canonical OCIO color-space identifier for this media. */
  getColorSpace?: (node: AnyNode) => string | undefined;
}

interface RendererMediaCompositeContext {
  frame: number;
  sceneNode: SceneNode;
  /** Full node list from the render context, for resolving graph-edge inputs. */
  nodes?: readonly AnyNode[];
}

export interface RendererMediaCompositeLayer {
  id: string;
  textureKey: string;
  assetId?: string;
  isVideoFile?: boolean;
  width: number;
  height: number;
  transform?: Partial<Pick<ImageTransform, 'x' | 'y' | 'scaleX' | 'scaleY'>>;
  opacity?: AnimatableNumber;
  colorSpace?: string;
  isData?: boolean;
  sourceAlphaMode?: SourceAlphaMode;
  differenceMask?: RendererDifferenceMaskLayer;
}

export interface RendererDifferenceMaskLayer {
  textureKey: string;
  assetId?: string;
  width: number;
  height: number;
  transform?: Partial<Pick<ImageTransform, 'x' | 'y' | 'scaleX' | 'scaleY'>>;
  thresholdLow: number;
  thresholdHigh: number;
  comparisonBlur: number;
  edgeAdjustment: number;
  removeSpecks: number;
  fillHoles: number;
  morphologyShape: DifferenceMaskMorphologyShape;
  invert?: boolean;
  previewMode?: 'result' | 'overlay' | 'matte';
}

export interface RendererOcioGpuTexture {
  name: string;
  samplerName: string;
  width: number;
  height: number;
  depth: number;
  dimensions: 1 | 2 | 3;
  channels: 1 | 3;
  interpolation: string;
  values: Float32Array;
}

export interface RendererOcioGpuUniform {
  name: string;
  type: 'double' | 'bool' | 'float3' | 'vector_float' | 'vector_int' | 'unknown';
  bufferOffset: number;
  value: number | boolean | number[];
}

export interface RendererOcioShaderInfo {
  kind: 'colorspace' | 'display' | 'transform';
  key: string;
  shaderText: string;
  functionName: string;
  language: string;
  cacheId: string;
  textures: RendererOcioGpuTexture[];
  uniforms: RendererOcioGpuUniform[];
}

export type RendererOcioTransformDirection = 'forward' | 'inverse';

export type RendererOcioTransformDescriptor =
  | {
      type: 'colorSpace';
      source: string;
      destination: string;
      direction?: RendererOcioTransformDirection;
      dataBypass?: boolean;
    }
  | {
      type: 'file';
      assetId: string;
      direction?: RendererOcioTransformDirection;
      interpolation?: 'default' | 'nearest' | 'linear' | 'tetrahedral' | 'best';
      cccId?: string;
      cdlStyle?: 'asc' | 'no-clamp';
    }
  | {
      type: 'look';
      source: string;
      destination: string;
      looks: string;
      direction?: RendererOcioTransformDirection;
      skipColorSpaceConversion?: boolean;
    }
  | {
      type: 'displayView';
      source: string;
      display: string;
      view: string;
      direction?: RendererOcioTransformDirection;
      looksBypass?: boolean;
      dataBypass?: boolean;
    }
  | {
      type: 'named';
      name: string;
      direction?: RendererOcioTransformDirection;
    };

export interface RendererOcioTransformContext {
  workingColorSpace: string;
  textureColorSpace: string;
  logColorSpace?: string;
}

export interface RendererColorManagement {
  getColorSpaceTransform: (
    source: string | undefined,
    destination: string | undefined,
  ) => RendererOcioShaderInfo | null;
  getDisplayViewTransform: (
    source: string | undefined,
    display: string | undefined,
    view: string | undefined,
    look?: string,
  ) => RendererOcioShaderInfo | null;
  getTransform: (
    transforms: readonly RendererOcioTransformDescriptor[],
  ) => RendererOcioShaderInfo | null;
  transformRgb: (
    source: string,
    destination: string,
    color: readonly [number, number, number],
  ) => [number, number, number];
  resolveColorSpaceName: (value: string | undefined) => string;
  defaultDisplay: string;
  defaultView: string;
  workingColorSpace: string;
  textureColorSpace: string;
  colorPickingColorSpace: string;
  dataColorSpace: string;
  logColorSpace?: string;
}

// ---------------------------------------------------------------------------
// ResolveOutputContext — the context object passed to node renderOutput()
// handlers and used internally by resolveOutput().
// ---------------------------------------------------------------------------

/** One hard-edged matte layer, composited and feathered by the GPU pipeline. */
export interface RendererMaskLayer {
  /** One already-composited texture, including any temporal shutter samples. */
  texture: THREE.Texture;
  prepare?: () => void;
  feather: number;
  opacity: number;
  operation: 'add' | 'subtract';
}

/**
 * Context provided to resolveOutput() and node renderOutput() handlers.
 * Provides all the rendering primitives and callbacks needed to render
 * any node's output to a utility target.
 */
export interface ResolveOutputContext {
  /** Whether this render may await asset preparation or must complete in the current frame. */
  executionMode?: 'sync' | 'async';
  frame: number;
  nodes: AnyNode[];
  sceneNode: SceneNode;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  /** Recursively resolve any upstream node's output texture by node ID + port name. */
  resolveOutput: (
    nodeId: string,
    portName?: string,
  ) => THREE.Texture | undefined | Promise<THREE.Texture | undefined>;
  transformColorPickingToSceneLinear: (
    color: readonly [number, number, number],
  ) => [number, number, number];
  /** The current canonical branch composite. Undefined outside the main render loop. */
  compositeBuffer?: THREE.WebGLRenderTarget;
  getMediaTexture: (node: AnyNode, frame: number) => THREE.Texture | undefined;
  getRotoMaskLayers?: (nodeId: string) => readonly RendererMaskLayer[] | undefined;
  getRotoAlphaMode?: (nodeId: string) => number;
  nodeRegistry: NodeRegistryLike;
  clearRenderTargetTransparent: (target: THREE.WebGLRenderTarget) => void;
  applyNoBlending: (material: THREE.ShaderMaterial) => void;
  /** Get the source port name for a given input port (resolves inputSourcePorts mapping). */
  getInputSourcePort: (node: AnyNode, inputPort: string, fallback?: string) => string;
  /** Get the channel index (0=R, 1=G, 2=B, 3=A) for a port name. */
  getChannelIndex: (channel: string | undefined, fallback: string) => number;
  /** Get transparent fallback texture. */
  getTransparentInputTexture: () => THREE.Texture;
  /** Returns a reusable full-frame target with the scene working precision. */
  getScratchRenderTarget?: (key: string) => THREE.WebGLRenderTarget;
}

/**
 * The minimal entry the render pipeline needs from the node registry.
 * Structurally compatible with the full NodeDefinition from apps/studio
 * and the NodeDefinition from @blackboard/plugin-sdk.
 */
export interface RendererNodeEntry {
  renderMode: RenderMode;
  category: RendererToolCategory;
  processingDomain: ColorProcessingDomain | ((node: AnyNode) => ColorProcessingDomain);
  /** Optional domain accepted by the primary `pipe` input when it differs from the output. */
  primaryInputDomain?: ColorProcessingDomain | ((node: AnyNode) => ColorProcessingDomain);
  /** `reinterpret` permits color-domain mismatches at an explicit conversion boundary. */
  primaryInputDomainPolicy?: 'strict' | 'reinterpret';
  getShader?: (node: AnyNode) => string | { horizontal: string; vertical: string };
  getUniforms?: (node: AnyNode, context: RenderContext) => ShaderUniformMap;
  getOcioTransforms?: (
    node: AnyNode,
    context: RendererOcioTransformContext,
  ) => readonly RendererOcioTransformDescriptor[];
  inputPorts?: RendererInputPorts;
  outputPorts?: RendererOutputPorts;

  // --- Phase 0 additions ---

  /** Declarative flags replacing hardcoded type checks in the pipeline. */
  flags?: RendererNodeFlags;
  /** Media descriptor for texture key resolution, asset IDs, color space. */
  mediaDescriptor?: RendererMediaDescriptor;

  /** Declarative scene-size behavior for format-changing nodes. */
  sceneSize?: RendererSceneSizeBehavior;

  /**
   * Return a scene-linear color for generated alpha-mask sources. When
   * omitted, the generated source keeps the RGB values from its texture.
   */
  getGeneratedColor?: GeneratedColorResolver<AnyNode, RenderContext>;

  /**
   * Optional render scale hint — return a value in (0, 1] to render at
   * reduced resolution. Used by large-kernel effects like blur.
   */
  renderScale?: (node: AnyNode, context: RenderContext) => number;

  /**
   * Optional custom render handler. When provided, the pipeline calls this
   * to render the node's output to a target. If not provided, the pipeline
   * uses a generic path based on renderMode + getShader/getUniforms.
   *
   * @param node The node instance to render.
   * @param target The render target to write the output into.
   * @param inputTexture The resolved input texture for this node.
   * @param context Full pipeline context with resolveOutput and other helpers.
   * @param portName The requested output port name (e.g. 'r', 'output').
   *   Nodes with multiple outputs (Extract Channels) use this to determine
   *   which output to render.
   */
  renderOutput?: (
    node: AnyNode,
    target: THREE.WebGLRenderTarget,
    inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
    portName?: string,
  ) => boolean | Promise<boolean>;
}

export type NodeRegistryLike = Pick<ReadonlyMap<string, RendererNodeEntry>, 'get'>;
