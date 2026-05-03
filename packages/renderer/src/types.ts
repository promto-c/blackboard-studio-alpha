// Rendering-domain types used by the pipeline and supporting modules.
// These are structurally compatible with the full EffectDefinition from apps/studio.

export type ShaderUniformMap = Record<string, { value: unknown }>;

export type RenderMode =
  | 'shader'
  | 'multipass'
  | 'mask'
  | 'paint'
  | 'warp'
  | 'merge'
  | 'media'
  | 'text'
  | 'scene';

export interface EffectRenderContext {
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

export type RendererInputPorts = RendererInputPort[] | ((node: unknown) => RendererInputPort[]);

// ---------------------------------------------------------------------------
// Node flags — renderer-relevant subset used by the pipeline to replace
// hardcoded type checks like `isMediaNode()`, `getMediaTextureKey()`, etc.
// ---------------------------------------------------------------------------

/**
 * Declarative flags that the render pipeline can query instead of
 * checking node types directly. Structurally compatible with the
 * full `NodeFlags` from apps/studio EffectDefinition.
 */
export interface RendererNodeFlags {
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
 * full `MediaDescriptor` from apps/studio EffectDefinition.
 */
export interface RendererMediaDescriptor {
  /** Extract asset IDs that this node references. */
  getAssetIds: (node: any) => string[];
  /**
   * Return the texture key used to look up/store this node's media texture
   * in the pipeline's texture cache.
   */
  getMediaTextureKey?: (node: any, frame: number) => string;
  /** Optional color space identifier for this media (e.g. 'sRGB', 'Linear'). */
  getColorSpace?: (node: any) => string | undefined;
}

/**
 * Minimal effect definition shape required by the render pipeline.
 * Structurally compatible with the full EffectDefinition from apps/studio
 * and the EffectDefinition from @blackboard/plugin-sdk.
 */
export interface RendererEffectEntry {
  renderMode: RenderMode;
  category: 'Image' | 'Adjustment' | 'Effect';
  getShader?: (node: any) => string | { horizontal: string; vertical: string };
  getUniforms?: (node: any, context: EffectRenderContext) => ShaderUniformMap;
  inputPorts?: RendererInputPorts;

  // --- Phase 0 additions ---

  /** Declarative flags replacing hardcoded type checks in the pipeline. */
  flags?: RendererNodeFlags;
  /** Media descriptor for texture key resolution, asset IDs, color space. */
  mediaDescriptor?: RendererMediaDescriptor;
}

export type EffectRegistryLike = Map<string, RendererEffectEntry>;
