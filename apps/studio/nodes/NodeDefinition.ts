import type React from 'react';
import * as THREE from 'three';
import type {
  RendererOcioTransformContext,
  RendererOcioTransformDescriptor,
  ResolveOutputContext,
} from '@blackboard/renderer';
import {
  AnimatableNumber,
  AnyNode,
  ColorProcessingDomain,
  DataChannelSemantic,
  DifferenceMaskMorphologyShape,
  GeneratedColorResolver,
  ImageTransform,
  InputPortType,
  RenderSceneSize,
  RenderSceneSizeBehavior,
  RotoPointRef,
  SceneNode,
  SourceAlphaMode,
  TransformData,
} from '@blackboard/types';
import type { HotkeyBinding } from '@/hotkeys';
import type { NodeAnimationBehavior } from './animationHelpers';

export type ShaderUniformMap = Record<string, { value: unknown }>;
export type ToolCategory = 'Image' | 'Spatial' | 'Adjustment' | 'Effect' | 'Utility';

/** How the render pipeline should process this node. */
export type RenderMode =
  | 'shader'
  | 'ocio'
  | 'multipass'
  | 'mask'
  | 'paint'
  | 'warp'
  | 'merge'
  | 'utility'
  | 'media'
  | 'text'
  | 'scene';

export type RenderOutputContract = 'pipeline' | 'viewport_preview' | 'none';

export interface RenderContext {
  frame: number;
  fps: number;
  scene: { width: number; height: number };
  flow?: unknown;
  nodes: AnyNode[];
  transformColorPickingToSceneLinear: (
    color: readonly [number, number, number],
  ) => [number, number, number];
}

export type RendererSceneSize = RenderSceneSize;
export type RendererSceneSizeBehavior = RenderSceneSizeBehavior<AnyNode, RenderContext>;

// A function that takes a node and render context and returns shader uniforms.
export type UniformsGetter = (node: AnyNode, context: RenderContext) => ShaderUniformMap;

/** Declares a secondary input port on a node (e.g. depth map, mask, displacement). */
export interface InputPortDescriptor {
  /** Internal port identifier, used as key in node.inputs. E.g. 'depth', 'mask'. */
  name: string;
  /** Human-readable label for UI. E.g. 'Depth Map'. */
  label: string;
  /** What kind of data this port accepts. */
  type: InputPortType;
  /** Optional technical channel semantic for data/alpha/vector/depth ports. */
  dataSemantic?: DataChannelSemantic;
  /** Accepted color/data processing domain. Omit only for intentionally polymorphic inputs. */
  processingDomain?: ColorProcessingDomain;
  /** Whether this input is required for the node to function. */
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

export interface OutputPortDescriptor {
  /** Internal port identifier, used as FlowEdge.sourcePort. */
  name: string;
  /** Human-readable label for UI. */
  label: string;
  /** Optional technical channel semantic for data/alpha/vector/depth outputs. */
  dataSemantic?: DataChannelSemantic;
  /** Output processing domain. Port declarations override the node-level domain. */
  processingDomain?: ColorProcessingDomain;
  /** Tooltip / description for the port. */
  description?: string;
}

export type OutputPortDescriptors =
  | OutputPortDescriptor[]
  | ((node: AnyNode) => OutputPortDescriptor[]);

// ---------------------------------------------------------------------------
// Viewport interaction handler — allows each node to declare how it
// responds to mouse events in the viewport, replacing hardcoded if/else
// chains in Viewport.tsx.
// ---------------------------------------------------------------------------

/** Scene-space point centered on the canvas; X increases right and Y increases down. */
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
  setHierarchySelection: (nodeId: string, layerIds: string[], itemIds: string[]) => void;
  setSelectedRotoPointRefs: (pointRefs: RotoPointRef[]) => void;
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
 * Viewport interaction handler — each node can implement these methods
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
// Viewport overlay component — allows each node to render its own SVG
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
  /**
   * Extra context provided by Viewport.tsx, containing interaction hook
   * results, selection state, motion cue data, stabilization matrix,
   * preferences, and handlers — everything an overlay component needs
   * to render beyond the basic props above.
   */
  context?: unknown;
}

// ---------------------------------------------------------------------------
// Media descriptor — allows media-type nodes (image, video, sequence)
// to declare how they load and provide textures, replacing hardcoded
// type branches in Viewport.tsx, pipeline.ts, useViewportMediaCache.ts.
// ---------------------------------------------------------------------------

/** Minimal cache reader exposed to media descriptor methods. */
export interface MediaTextureCache {
  has(id: string): boolean;
  get(id: string): unknown;
}

/** Caches/resources available to media descriptor methods. */
export interface MediaCacheContext {
  imageCache: MediaTextureCache;
  videoElements: ReadonlyMap<string, HTMLVideoElement>;
  sequenceCache: MediaTextureCache;
}

export interface MediaCompositeContext {
  frame: number;
  sceneNode: SceneNode;
  /**
   * The full list of nodes from the render context. Provided by the pipeline
   * when available so getCompositeLayers implementations can resolve
   * graph-edge connected inputs as additional layers.
   */
  nodes?: readonly AnyNode[];
}

export interface MediaCompositeLayer {
  id: string;
  textureKey: string;
  assetId?: string;
  isVideoFile?: boolean;
  width: number;
  height: number;
  transform?: ImageTransform;
  opacity?: AnimatableNumber;
  colorSpace?: string;
  isData?: boolean;
  sourceAlphaMode?: SourceAlphaMode;
  differenceMask?: MediaDifferenceMaskLayer;
}

export interface MediaDifferenceMaskLayer {
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

/**
 * Media descriptor — nodes with `renderMode: 'media'` (or similar)
 * implement this to declare how their textures are obtained, checked,
 * and synced.
 */
export interface MediaDescriptor {
  /** Extract asset IDs that this node references (for preloading/caching). */
  getAssetIds: (node: AnyNode) => string[];
  /**
   * Resolve a timeline frame to the frame that should be decoded from the
   * source. Returning null produces transparent black for this source.
   */
  resolveFrame?: (node: AnyNode, frame: number) => number | null;
  /** Check whether the frame is ready to render (all textures available). */
  checkFrameReady: (node: AnyNode, frame: number, caches: MediaCacheContext) => boolean;
  /**
   * Return the texture key used to look up/store this node's media texture
   * in the pipeline's texture cache.
   */
  getMediaTextureKey?: (node: AnyNode, frame: number) => string;
  /** Optional visible media layers that should be composited inside this media node. */
  getCompositeLayers?: (
    node: AnyNode,
    frame: number,
    context: MediaCompositeContext,
  ) => MediaCompositeLayer[];
  /** Return true when this node's active media should be decoded as a video file. */
  isVideoFile?: (node: AnyNode) => boolean;
  /** Return true when this media should bypass RGB color transforms. */
  isData?: (node: AnyNode) => boolean;
  /** Optional canonical OCIO color-space identifier for this media. */
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
 * resolves defaults.
 */
export interface NodeFlags {
  /** Node produces its own visual content (image, video, text, etc.). */
  isSource?: boolean;
  /** Node should be counted when checking if a project has renderable content. */
  isRenderable?: boolean;
  /** Node provides a media texture (image/video/sequence). */
  isMediaNode?: boolean;
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
  /** Show the input data window overlay (used by transform nodes to show pre-transform bounds). */
  showInputDataWindow?: boolean;
}

// ---------------------------------------------------------------------------
// Viewport interaction interface — plain object that each node type can
// implement to handle viewport mouse events without Viewport.tsx needing
// to know about the node type. Replaces per-type if/else chains.
// ---------------------------------------------------------------------------

/** Normalized pointer event passed to ViewportInteraction handlers. */
export interface ViewportPointerEvent {
  /** Mouse position in viewport-relative pixels. */
  clientX: number;
  clientY: number;
  /** Mouse position relative to scene center. X increases right and Y increases down. */
  sceneX: number;
  sceneY: number;
  /** Mouse button: 0 = left, 1 = middle, 2 = right. */
  button: number;
  /** Keyboard modifier state at the time of the event. */
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** The original DOM event for advanced use (e.g. preventDefault). */
  nativeEvent: MouseEvent;
}

/**
 * ViewportInteraction — a plain TypeScript object that encapsulates
 * viewport mouse handling for a specific node type.
 *
 * Viewport.tsx creates this via `nodeRegistry.get(node.type)?.createViewportInteraction(context)`
 * and delegates mouse events to it without knowing the node type.
 */
export interface ViewportInteraction {
  /**
   * Return a CSS cursor class name (e.g. "cursor-crosshair", "cursor-grabbing")
   * or null to keep the current cursor.
   */
  getCursor(): string | null;

  /**
   * Whether the interaction is in an active preview/editing state
   * (e.g., drawing roto paths). Used to suspend non-interactive cache
   * updates during editing.
   */
  isPreviewActive?(): boolean;

  /**
   * Whether the interaction currently needs to capture mouse events globally
   * (window-level mousemove/mouseup). When true, Viewport.tsx adds window
   * listeners and routes events back to handleMouseMove/handleMouseUp.
   */
  hasGlobalMouseCapture(): boolean;

  /**
   * Handle a mousedown event. Return true if the event was consumed
   * (prevents default viewport behavior like pan/zoom).
   */
  handleMouseDown(event: ViewportPointerEvent): boolean;

  /**
   * Handle a mousemove event. Return true if consumed.
   */
  handleMouseMove(event: ViewportPointerEvent): boolean;

  /**
   * Handle a mouseup event. Return true if consumed.
   */
  handleMouseUp(event: ViewportPointerEvent): boolean;

  /**
   * Called when the mouse leaves the viewport area.
   */
  handleMouseLeave(): void;

  /**
   * Called when the active viewport tool changes.
   */
  cleanupOnToolChange(previousTool: string | null): void;

  /**
   * Handle a context menu event. Return true if consumed.
   */
  handleContextMenu?(event: ViewportPointerEvent): boolean;

  /**
   * Whether this interaction should force overlays to be shown
   * (e.g., during active editing, cursor-only mode, etc.).
   * When true, Viewport.tsx forces overlay SVG rendering even if
   * the global showOverlays setting is off.
   */
  shouldForceOverlays(): boolean;

  /**
   * Handle a runtime command by ID.
   * Returns true if the command was handled, false otherwise.
   * This replaces type-specific command dispatch in Viewport.tsx
   * with a generic interface call.
   */
  handleCommand(commandId: string): boolean;
}

// ---------------------------------------------------------------------------
// Viewport clipboard handlers — allows nodes to provide copy/cut/paste
// behavior for the viewport, replacing per-type if/else chains.
// ---------------------------------------------------------------------------

export interface ViewportClipboardHandlers {
  onCopy?: () => boolean;
  onCut?: () => boolean;
  onPaste?: () => boolean;
}

export interface ViewportClipboardContext {
  rotoClipboard?: ViewportClipboardHandlers;
  paintClipboard?: ViewportClipboardHandlers;
}

export interface ViewportOverlayVisibilityContext {
  viewport: {
    showOverlays: boolean;
    activeViewportTool: string | null;
  };
  roto?: {
    interaction?: {
      isAdjustingRadius?: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// Node update hook — allows nodes to normalize/validate property changes
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
 * Called when properties of a node are being updated. The node can
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
// Viewport tool definition — declarative description of a viewport tool
// that lives on the NodeDefinition (via `viewportTools`).
// ---------------------------------------------------------------------------

/**
 * Declarative viewport tool descriptor. When a node definition provides a
 * `viewportTools` array, ViewportToolbar can render the tool strip directly
 * without a custom ViewportToolsComponent.
 *
 * For nodes that need custom interactivity (complex panel-toggle logic,
 * custom preferences toggles, etc.), keep the ViewportToolsComponent and
 * have it use the shared ViewportToolsRenderer internally.
 */
export interface ViewportToolDefinition {
  /** Unique tool identifier, e.g. `'select'`, `'add_pin'`, `'bokeh_pick'`. */
  id: string;
  /** Human-readable label, e.g. `'Select Tool'`. */
  label: string;
  /** Icon component (rendered at h-5 w-5). */
  icon: React.ComponentType<{ className?: string }>;
  /** Optional keyboard shortcut hint shown in tooltip, e.g. `'Q'`. */
  hotkey?: string;
  /**
   * If true, clicking toggles the tool on/off instead of one-way activation.
   * Default false.
   */
  isToggle?: boolean;
  /**
   * When set, clicking the tool opens/closes this panel.
   * Overrides the default one-click activation.
   */
  panelId?: string;
  /**
   * When true, the tool acts as a panel toggle (isActive = openPanels.has(panelId ?? id)).
   * Default false.
   */
  isPanel?: boolean;
}

/**
 * Renders a separator line between tool groups.
 * Use in `viewportTools` arrays (type discriminator).
 */
export interface ViewportToolSeparator {
  kind: 'separator';
}

export type ViewportToolEntry = ViewportToolDefinition | ViewportToolSeparator;

// ---------------------------------------------------------------------------
// NodeDefinition — the core type for registering a node type's behavior.

export interface NodeDefinition {
  // Core properties
  type: string;
  name: string;
  description?: string;
  category: ToolCategory;
  renderMode: RenderMode;
  /**
   * Declares whether this node participates in the compositing pipeline,
   * owns a viewport-only preview, or produces no visual output.
   */
  renderOutputContract?: RenderOutputContract;
  /** Domain in which this node reads and produces its primary image pipe. */
  processingDomain: ColorProcessingDomain | ((node: AnyNode) => ColorProcessingDomain);
  /** Domain accepted by the primary `pipe` input when it differs from the output domain. */
  primaryInputDomain?: ColorProcessingDomain | ((node: AnyNode) => ColorProcessingDomain);
  /** `reinterpret` permits color-domain mismatches at an explicit conversion boundary. */
  primaryInputDomainPolicy?: 'strict' | 'reinterpret';

  // UI components
  IconComponent: React.ComponentType<{ className?: string }>;
  ToolComponent?: React.ComponentType;
  AdjustmentComponent: React.ComponentType<{ node: AnyNode }>;
  /** Optional items list panel for nodes that manage a collection of sub-items (e.g. Roto shapes). */
  ItemsComponent?: React.ComponentType<{
    node: AnyNode;
    inspectorLevel?: string;
    onInspectorLevelChange?: (level: string) => void;
  }>;

  /**
   * Declarative viewport tool definitions. When provided (and
   * `ViewportToolsComponent` is not set), ViewportToolbar renders a
   * default tool strip from these definitions.
   */
  viewportTools?: ViewportToolEntry[];

  ViewportToolsComponent?: React.ComponentType<{
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
  ViewportToolPanelComponent?: React.ComponentType<{
    node: AnyNode;
    activeTool: string | null;
    openPanels: ReadonlySet<string>;
    onPanelClose: (panel: string) => void;
  }>;

  /**
   * Optional SVG overlay component rendered inside the viewport overlay
   * SVG element (scene-centered coordinates). Replaces hardcoded overlay
   * rendering for roto paths, warp pins, etc.
   */
  ViewportOverlayComponent?: React.ComponentType<ViewportOverlayProps>;

  /**
   * Optional SVG overlay component rendered directly in the SVG element
   * (outside the scene-centered `<g>` group, so coordinates are absolute
   * scene-space with origin at top-left). Used for overlays that need
   * absolute positioning rather than scene-centered coordinates.
   */
  ViewportOverlayDirectComponent?: React.ComponentType<ViewportOverlayProps>;

  /**
   * Optional HTML overlay component rendered outside the viewport SVG
   * (as a regular React div overlay). Used for overlays that need HTML
   * layout (e.g. positioned prompt overlays that overlay the viewport).
   */
  ViewportHtmlOverlayComponent?: React.ComponentType<ViewportOverlayProps>;

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
  /** Ordered OCIO transforms rendered as one optimized GPU processor. */
  getOcioTransforms?: (
    node: AnyNode,
    context: RendererOcioTransformContext,
  ) => readonly RendererOcioTransformDescriptor[];

  // Stabilization support
  getStabilizeTransform?: (node: AnyNode, frame: number, context?: unknown) => TransformData | null;

  /** Optional secondary input ports. The primary `pipe` port is reserved and implicit. */
  inputPorts?: InputPortDescriptors;

  /** Optional output ports this node declares. Defaults to a single `output` port. */
  outputPorts?: OutputPortDescriptors;

  // --- Phase 0 additions: registry-driven dispatch hooks ---

  /**
   * Viewport interaction handler — declares how this node type responds
   * to mouse events in the viewport. Replaces per-type if/else chains.
   */
  viewportInteraction?: ViewportInteractionHandler;

  /**
   * Factory that creates a ViewportInteraction for this node type.
   * Viewport.tsx calls this to get a plain object that handles mouse events
   * without needing to know the node type at the call site.
   *
   * When defined, Viewport.tsx delegates all mouse events to this instead of
   * using individual interaction hooks directly.
   */
  createViewportInteraction?: (context: unknown) => ViewportInteraction;

  /**
   * Return clipboard handlers (onCopy/onCut/onPaste) for this node type.
   * Called with the selected node and a context object containing the
   * clipboard hook results (stored as `rotoClipboard`, `paintClipboard`).
   * When undefined, Viewport.tsx uses a default no-op handler.
   */
  getClipboardHandlers?: (
    node: AnyNode,
    context: ViewportClipboardContext,
  ) => ViewportClipboardHandlers;

  /**
   * Media descriptor — for `renderMode: 'media'` (or any node that
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
   * Return overlay visibility hints for this node type.
   * Used by Viewport.tsx to determine whether to render the SVG overlay container
   * even when the global `showOverlays` setting is off.
   *
   * @param node The selected node.
   * @param context Extra runtime context (showOverlays, activeViewportTool, interaction state, etc.)
   */
  getOverlayVisibility?: (
    node: AnyNode,
    context: ViewportOverlayVisibilityContext,
  ) => {
    /** When true, the SVG overlay container should render even if showOverlays is false. */
    forceShowSvg?: boolean;
  };

  /**
   * Extract asset IDs that this node references.
   * Convenience shorthand — also available via `mediaDescriptor.getAssetIds`.
   * If both are defined, `mediaDescriptor.getAssetIds` takes precedence.
   */
  getAssetIds?: (node: AnyNode) => string[];

  /** Studio-side animation behavior used by timeline property lookup and keyed mutations. */
  animation?: NodeAnimationBehavior;

  /** Declarative scene-size behavior for nodes that establish or change the render format. */
  sceneSize?: RendererSceneSizeBehavior;

  /**
   * Return the scene-linear color applied to a generated alpha-mask source.
   * Omit this hook when the source texture already contains its final RGB.
   */
  getGeneratedColor?: GeneratedColorResolver<AnyNode, RenderContext>;

  /**
   * Optional render scale hint for the pipeline.
   * Return a value in (0, 1] to render this node at reduced resolution
   * (e.g. for large blurs). The pipeline will downsample before the first
   * pass, run the node at the scaled resolution, and upsample after.
   * Return 1 for full-resolution rendering (default).
   */
  renderScale?: (node: AnyNode, context: RenderContext) => number;

  /**
   * Optional custom render handler. When provided, the pipeline calls this
   * to render the node's output to a target instead of using the generic
   * path based on renderMode + getShader/getUniforms.
   *
   * This is how utility nodes (Extract/Merge Channels), mask nodes (Roto),
   * and paint nodes declare their own rendering logic, keeping node-specific
   * shaders and logic in the node definition rather than in the renderer pipeline.
   */
  renderOutput?: (
    node: AnyNode,
    target: THREE.WebGLRenderTarget,
    inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
    portName?: string,
  ) => boolean | Promise<boolean>;
}

export interface ToolDefinition {
  type: string;
  name: string;
  description?: string;
  category: ToolCategory;
  ToolComponent?: React.ComponentType;
}
