// Rendering-domain types used by the pipeline and supporting modules.
// These are structurally compatible with the full NodeDefinition from apps/studio.

import * as THREE from 'three';
import type { AnyNode, SceneNode } from '@blackboard/types';

export type ShaderUniformMap = Record<string, { value: unknown }>;

export type RenderMode =
  | 'shader'
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
}

/** Minimal input port descriptor for the render pipeline. */
export interface RendererInputPort {
  name: string;
  label: string;
  type: 'texture' | 'mask' | 'data';
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
  /** Media node supports looping playback. */
  isLooping?: boolean;
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
  getAssetIds: (node: any) => string[];
  /**
   * Return the texture key used to look up/store this node's media texture
   * in the pipeline's texture cache.
   */
  getMediaTextureKey?: (node: any, frame: number) => string;
  /** Optional visible media layers that should be composited inside this media node. */
  getCompositeLayers?: (
    node: any,
    frame: number,
    context: RendererMediaCompositeContext,
  ) => RendererMediaCompositeLayer[];
  /** Return true when this node's active media should be decoded as a video file. */
  isVideoFile?: (node: any) => boolean;
  /** Optional color space identifier for this media (e.g. 'sRGB', 'Linear'). */
  getColorSpace?: (node: any) => string | undefined;
}

interface RendererMediaCompositeContext {
  frame: number;
  sceneNode: { width: number; height: number; colorSpace?: string; fps?: number };
}

export interface RendererMediaCompositeLayer {
  id: string;
  textureKey: string;
  assetId?: string;
  isVideoFile?: boolean;
  width: number;
  height: number;
  transform?: {
    x?: any;
    y?: any;
    scaleX?: any;
    scaleY?: any;
  };
  opacity?: any;
  colorSpace?: string;
  sourceAlphaMode?: string;
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
  kind: 'colorspace' | 'display';
  key: string;
  shaderText: string;
  functionName: string;
  language: string;
  cacheId: string;
  textures: RendererOcioGpuTexture[];
  uniforms: RendererOcioGpuUniform[];
}

export interface RendererColorManagement {
  getColorSpaceTransform?: (
    source: string | undefined,
    destination: string | undefined,
  ) => RendererOcioShaderInfo | null;
  getDisplayViewTransform?: (
    source: string | undefined,
    display: string | undefined,
    view: string | undefined,
  ) => RendererOcioShaderInfo | null;
  resolveColorSpaceName?: (value: string | undefined) => string;
  defaultDisplay?: string;
  defaultView?: string;
  workingColorSpace?: string;
  textureColorSpace?: string;
  dataColorSpace?: string;
}

// ---------------------------------------------------------------------------
// ResolveOutputContext — the context object passed to node renderOutput()
// handlers and used internally by resolveOutput().
// ---------------------------------------------------------------------------

export interface PaintTextureBundle {
  color: THREE.Texture;
  alpha: THREE.Texture;
}

/**
 * Context provided to resolveOutput() and node renderOutput() handlers.
 * Provides all the rendering primitives and callbacks needed to render
 * any node's output to a utility target.
 */
export interface ResolveOutputContext {
  frame: number;
  nodes: AnyNode[];
  sceneNode: SceneNode;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  getMaterial: (id: string, shader: string, uniforms: ShaderUniformMap) => THREE.ShaderMaterial;
  /** Recursively resolve any upstream node's output texture by node ID + port name. */
  resolveOutput: (nodeId: string, portName?: string) => THREE.Texture | undefined;
  /** The current composite buffer (implicit pipeline input). Undefined outside main loop. */
  compositeBuffer?: THREE.WebGLRenderTarget;
  getMediaTexture: (node: AnyNode, frame: number) => THREE.Texture | undefined;
  getRotoMaskTexture?: (nodeId: string) => THREE.Texture | undefined;
  getRotoAddMaskTexture?: (nodeId: string) => THREE.Texture | undefined;
  getRotoSubMaskTexture?: (nodeId: string) => THREE.Texture | undefined;
  getRotoAlphaMode?: (nodeId: string) => number;
  getPaintTextures?: (nodeId: string) => PaintTextureBundle | undefined;
  nodeRegistry: NodeRegistryLike;
  clearRenderTargetTransparent: (target: THREE.WebGLRenderTarget) => void;
  applyNoBlending: (material: THREE.ShaderMaterial) => void;
  /** Get the source port name for a given input port (resolves inputSourcePorts mapping). */
  getInputSourcePort: (node: AnyNode, inputPort: string, fallback?: string) => string;
  /** Get the channel index (0=R, 1=G, 2=B, 3=A) for a port name. */
  getChannelIndex: (channel: string | undefined, fallback: string) => number;
  /** Get transparent fallback texture. */
  getTransparentInputTexture: () => THREE.Texture;
}

/**
 * The minimal entry the render pipeline needs from the node registry.
 * Structurally compatible with the full NodeDefinition from apps/studio
 * and the NodeDefinition from @blackboard/plugin-sdk.
 */
export interface RendererNodeEntry {
  renderMode: RenderMode;
  category: RendererToolCategory;
  getShader?: (node: any) => string | { horizontal: string; vertical: string };
  getUniforms?: (node: any, context: RenderContext) => ShaderUniformMap;
  inputPorts?: RendererInputPorts;
  outputPorts?: RendererOutputPorts;

  // --- Phase 0 additions ---

  /** Declarative flags replacing hardcoded type checks in the pipeline. */
  flags?: RendererNodeFlags;
  /** Media descriptor for texture key resolution, asset IDs, color space. */
  mediaDescriptor?: RendererMediaDescriptor;

  /**
   * Optional render scale hint — return a value in (0, 1] to render at
   * reduced resolution. Used by large-kernel effects like blur.
   */
  renderScale?: (node: any, context: RenderContext) => number;

  /**
   * Optional custom render handler. When provided, the pipeline calls this
   * to render the node's output to a target. If not provided, the pipeline
   * uses a generic path based on renderMode + getShader/getUniforms.
   */
  /**
   * Optional custom render handler. When provided, the pipeline calls this
   * to render the node's output to a target. If not provided, the pipeline
   * uses a generic path based on renderMode + getShader/getUniforms.
   */
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

export type NodeRegistryLike = Map<string, RendererNodeEntry>;
