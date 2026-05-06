import React from 'react';
import { AnyNode, InputPortType, TransformData } from '@blackboard/types';
import type { HotkeyBinding } from '@/hotkeys';
import type { EffectAnimationBehavior } from './effectAnimationHelpers';

export type ShaderUniformMap = Record<string, { value: unknown }>;

/** How the render pipeline should process this effect. */
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
  flow?: unknown;
  nodes: AnyNode[];
}

// A function that takes a node and render context and returns shader uniforms.
export type UniformsGetter = (node: AnyNode, context: EffectRenderContext) => ShaderUniformMap;

/** Declares a secondary input port on an effect (e.g. depth map, mask, displacement). */
export interface InputPortDescriptor {
  /** Internal port identifier, used as key in node.inputs. E.g. 'depth', 'mask'. */
  name: string;
  /** Human-readable label for UI. E.g. 'Depth Map'. */
  label: string;
  /** What kind of data this port accepts. */
  type: InputPortType;
  /** Whether this input is required for the effect to function. */
  required: boolean;
  /** Tooltip / description for the port. */
  description?: string;
  /** The shader uniform name to inject when connected. E.g. 'u_tDepth'. */
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

export type InputPortDescriptors =
  | InputPortDescriptor[]
  | ((node: AnyNode) => InputPortDescriptor[]);

// ---------------------------------------------------------------------------
// Viewport interaction handler — allows each effect to declare how it
// responds to mouse events in the viewport, replacing hardcoded if/else
// chains in Viewport.tsx.
// ---------------------------------------------------------------------------

/** Scene-space point. */
export interface ViewportScenePoint {
  x: number;
  y: number;
}

/** Context passed to every viewport interaction callback. */
export interface ViewportInteractionContext {
  /** The node the interaction applies to. */
  node: AnyNode;
  /** Mouse position in scene coordinates. */
  scenePoint: ViewportScenePoint;
  /** Mouse position in client/screen coordinates. */
  clientPoint: ViewportScenePoint;
  /** Currently active viewport tool for this node type (e.g. 'select', 'add_pin'). */
  activeTool: string | null;
  /** Keyboard modifier state at the time of the event. */
  modifiers: { alt: boolean; shift: boolean; ctrl: boolean; meta: boolean };
  /** Current animation frame number. */
  frame: number;
  /** Current viewport zoom level. */
  zoom: number;
  /** The original DOM event, available for advanced use. */
  nativeEvent: MouseEvent;
}

/** Mutation API provided to interaction handlers so they can update state. */
export interface ViewportInteractionActions {
  updateNode: (nodeId: string, changes: Record<string, unknown>) => void;
  pushHistory: (label: string) => void;
  setActiveViewportTool: (tool: string | null) => void;
  setSelectedRotoPathIds: (ids: string[]) => void;
  setSelectedRotoSelection: (selection: {
    layerIds: string[];
    pathIds: string[];
    pointRefs?: import('@blackboard/types').RotoPointRef[];
  }) => void;
  setKeyframe: (nodeId: string, path: string, frame: number, value: number) => void;
  startDrawingShape: (pathData: unknown) => void;
  addPointToDrawingShape: (point: unknown) => void;
  updateDrawingPoint: (point: unknown) => void;
  commitDrawingShape: () => void;
  cancelDrawingShape: () => void;
  addRotoPointToPath: (nodeId: string, pathId: string, index: number, point: unknown) => void;
}

/** Result returned by interaction handlers to control cursor and event propagation. */
export interface ViewportInteractionResult {
  /** CSS cursor class to apply. Omit to leave cursor unchanged. */
  cursor?: string;
  /** If true, the event should not propagate to default pan/zoom behavior. */
  handled?: boolean;
}

/**
 * Viewport interaction handler — each effect can implement these methods
 * to handle mouse events in the viewport. This replaces the per-type
 * if/else chains in Viewport.tsx with registry-driven dispatch.
 */
export interface ViewportInteractionHandler {
  onMouseDown?: (
    ctx: ViewportInteractionContext,
    actions: ViewportInteractionActions,
  ) => ViewportInteractionResult | void;
  onMouseMove?: (
    ctx: ViewportInteractionContext,
    actions: ViewportInteractionActions,
  ) => ViewportInteractionResult | void;
  onMouseUp?: (
    ctx: ViewportInteractionContext,
    actions: ViewportInteractionActions,
  ) => ViewportInteractionResult | void;
  onDoubleClick?: (
    ctx: ViewportInteractionContext,
    actions: ViewportInteractionActions,
  ) => ViewportInteractionResult | void;
  /** Return a CSS cursor class for the current state (hover feedback). */
  getCursor?: (ctx: Omit<ViewportInteractionContext, 'nativeEvent'>) => string | undefined;
}

// ---------------------------------------------------------------------------
// Viewport overlay component — allows each effect to render its own SVG
// overlays (warp pins, roto paths, bokeh focus) instead of inlining them
// in Viewport.tsx.
// ---------------------------------------------------------------------------

/** Props passed to a viewport overlay component. */
export interface ViewportOverlayProps {
  /** The node to render overlays for. */
  node: AnyNode;
  /** Current animation frame number. */
  frame: number;
  /** Current viewport zoom level. */
  zoom: number;
  /** Viewport pan offset. */
  pan: { x: number; y: number };
  /** Scene dimensions. */
  scene: { width: number; height: number };
  /** Currently active viewport tool. */
  activeTool: string | null;
  /** Selected roto path IDs (relevant for roto overlay). */
  selectedRotoPathIds: string[];
  /** Selected roto point refs (relevant for roto overlay). */
  selectedRotoPointRefs: import('@blackboard/types').RotoPointRef[];
  /** Convert scene coordinates to viewport (SVG) coordinates. */
  sceneToViewport: (x: number, y: number) => ViewportScenePoint;
  /** Convert viewport coordinates to scene coordinates. */
  viewportToScene: (x: number, y: number) => ViewportScenePoint;
}

// ---------------------------------------------------------------------------
// Media descriptor — allows media-type effects (image, video, sequence)
// to declare how they load and provide textures, replacing hardcoded
// type branches in Viewport.tsx, pipeline.ts, useViewportMediaCache.ts.
// ---------------------------------------------------------------------------

/** Caches/resources available to media descriptor methods. */
export interface MediaCacheContext {
  imageCache: Map<string, unknown>;
  videoElements: Map<string, HTMLVideoElement>;
  sequenceCache: Map<string, unknown>;
}

/**
 * Media descriptor — effects with `renderMode: 'media'` (or similar)
 * implement this to declare how their textures are obtained, checked,
 * and synced.
 */
export interface MediaDescriptor {
  /** Extract asset IDs that this node references (for preloading/caching). */
  getAssetIds: (node: AnyNode) => string[];
  /** Check whether the frame is ready to render (all textures available). */
  checkFrameReady: (node: AnyNode, frame: number, caches: MediaCacheContext) => boolean;
  /**
   * Return the texture key used to look up/store this node's media texture
   * in the pipeline's texture cache.
   */
  getMediaTextureKey?: (node: AnyNode, frame: number) => string;
  /** Optional color space identifier for this media (e.g. 'sRGB', 'Linear'). */
  getColorSpace?: (node: AnyNode) => string | undefined;
}

// ---------------------------------------------------------------------------
// Node flags — declarative boolean flags that replace scattered hardcoded
// type-list checks like `type === IMAGE || type === VIDEO || ...`.
// ---------------------------------------------------------------------------

/**
 * Declarative flags for a node type. These replace hardcoded type checks
 * scattered across Viewport.tsx, pipeline.ts, nodeActions.ts, etc.
 *
 * All flags default to `false` when not specified. The `nodeFlags()` helper
 * in effectHelpers.ts resolves defaults.
 */
export interface NodeFlags {
  /** Node produces its own visual content (image, video, text, etc.). */
  isSource?: boolean;
  /** Node should be counted when checking if a project has renderable content. */
  isRenderable?: boolean;
  /** Node provides a media texture (image/video/sequence). */
  isMediaNode?: boolean;
  /** Media node supports looping playback. */
  isLooping?: boolean;
  /** Media node stores a single video file (decoded via HTMLVideoElement). */
  isVideoFile?: boolean;
  /** Node can be reordered via drag in the list view. */
  isDraggable?: boolean;
  /** Node acts as the scene/canvas root (only one per project). */
  isSceneLike?: boolean;
  /** Show a data-window border overlay in the viewport. */
  showDataWindow?: boolean;
  /** Node cannot be deleted by the user. */
  isProtected?: boolean;
  /** Node has a thumbnail preview (e.g. image nodes in list view). */
  hasThumbnail?: boolean;
}

// ---------------------------------------------------------------------------
// Node update hook — allows effects to normalize/validate property changes
// when updateNode is called, replacing the switch block in nodeActions.ts.
// ---------------------------------------------------------------------------

/** Context passed to node update hooks. */
export interface NodeUpdateContext {
  /** The scene node (if one exists). Useful for transform calculations. */
  sceneNode?: AnyNode;
}

/** Result returned by a node update hook. */
export interface NodeUpdateResult {
  /** The (potentially modified) property changes to apply. */
  changes: Record<string, unknown>;
  /** Custom history label. If omitted, the generic "Update Node" is used. */
  label?: string;
}

/**
 * Called when properties of a node are being updated. The effect can
 * modify or augment the changes before they're applied.
 *
 * @param node The current node state (before changes).
 * @param changes The incoming property changes.
 * @param context Additional context (e.g. sceneNode dimensions).
 * @returns A result containing the (possibly modified) changes and an optional label.
 */
export type NodeUpdateHook = (
  node: AnyNode,
  changes: Record<string, unknown>,
  context: NodeUpdateContext,
) => NodeUpdateResult;

export interface NodeExecutionDefinition {
  /** Label shown by flow/list node action menus. */
  label?: string;
  /** Optional availability check for disabling execution in node action menus. */
  canExecute?: (node: AnyNode) => boolean;
}

// ---------------------------------------------------------------------------
// EffectDefinition — the core type for registering a node type's behavior.
// ---------------------------------------------------------------------------

export interface EffectDefinition {
  // Core properties
  type: string;
  name: string;
  description?: string;
  category: 'Image' | 'Adjustment' | 'Effect';
  renderMode: RenderMode;

  // UI components
  IconComponent: React.FC<{ className?: string }>;
  ToolComponent?: React.FC;
  AdjustmentComponent: React.FC<{ node: AnyNode }>;
  /** Optional items list panel for nodes that manage a collection of sub-items (e.g. Roto shapes). */
  ItemsComponent?: React.FC<{
    node: AnyNode;
    inspectorLevel?: string;
    onInspectorLevelChange?: (level: string) => void;
  }>;
  ViewportToolsComponent?: React.FC<{
    node: AnyNode;
    openPanels: ReadonlySet<string>;
    onPanelToggle: (panel: string) => void;
  }>;
  /**
   * Optional side-panel rendered next to the viewport toolbar.
   * Receives the active tool so it can show/hide sections per tool.
   * The toolbar layout manager stacks multiple panels vertically,
   * preventing overlaps when several tools emit panels simultaneously.
   */
  ViewportToolPanelComponent?: React.FC<{
    node: AnyNode;
    activeTool: string | null;
    openPanels: ReadonlySet<string>;
    onPanelClose: (panel: string) => void;
  }>;

  /**
   * Optional SVG overlay component rendered in the viewport for this node.
   * Replaces hardcoded overlay rendering for roto paths, warp pins, etc.
   */
  ViewportOverlayComponent?: React.FC<ViewportOverlayProps>;

  // Node creation logic
  getInitialNodeProps: () => Record<string, unknown>;

  // Default viewport tool to activate when this node is created/selected
  defaultViewportTool?: string;

  // Hotkeys for viewport tools specific to this node type
  toolHotkeys?: { [key: string]: string };

  // Context-aware hotkeys active when this node type is selected
  hotkeys?: HotkeyBinding[];

  // Rendering properties for GPU-based effects
  // For multi-pass effects, this returns an object with shaders for each pass.
  getShader?: (node: AnyNode) => string | { horizontal: string; vertical: string };
  getUniforms?: UniformsGetter;

  // Stabilization support
  getStabilizeTransform?: (node: AnyNode, frame: number, context?: unknown) => TransformData | null;

  /** Optional secondary input ports this effect declares. */
  inputPorts?: InputPortDescriptors;

  // --- Phase 0 additions: registry-driven dispatch hooks ---

  /**
   * Viewport interaction handler — declares how this node type responds
   * to mouse events in the viewport. Replaces per-type if/else chains.
   */
  viewportInteraction?: ViewportInteractionHandler;

  /**
   * Media descriptor — for `renderMode: 'media'` (or any effect that
   * manages its own texture). Declares asset IDs, frame readiness,
   * texture provision, and color space.
   */
  mediaDescriptor?: MediaDescriptor;

  /**
   * Declarative flags replacing hardcoded type-list checks throughout
   * the codebase (e.g. `isSource`, `isRenderable`, `isMediaNode`).
   */
  flags?: NodeFlags;

  /**
   * Called when properties of this node type are being updated via
   * `updateNode`. The hook can normalize, validate, or augment
   * the incoming changes before they're applied to state.
   */
  onNodeUpdate?: NodeUpdateHook;

  /** Optional node-level command surfaced by flow/list views and handled by the node UI. */
  nodeExecution?: NodeExecutionDefinition;

  /**
   * Extract asset IDs that this node references.
   * Convenience shorthand — also available via `mediaDescriptor.getAssetIds`.
   * If both are defined, `mediaDescriptor.getAssetIds` takes precedence.
   */
  getAssetIds?: (node: AnyNode) => string[];

  /** Studio-side animation behavior used by timeline property lookup and keyed mutations. */
  animation?: EffectAnimationBehavior;
}

export interface ToolDefinition {
  type: string;
  name: string;
  description?: string;
  category: 'Image' | 'Adjustment' | 'Effect';
  ToolComponent?: React.FC;
}
