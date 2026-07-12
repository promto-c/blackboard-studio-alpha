// @blackboard/plugin-sdk — Plugin authoring API
//
// Plugin authors use the types and functions exported here to define
// custom nodes and register them with the Blackboard Studio host app.

import React from 'react';
import type {
  ColorProcessingDomain,
  GeneratedColorResolver,
  RenderSceneSize,
  RenderSceneSizeBehavior,
  TransformData,
} from '@blackboard/types';

// Re-export TransformData for plugin authors
export type { TransformData } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Core types re-exported for plugin authors
// ---------------------------------------------------------------------------

export type ShaderUniformMap = Record<string, { value: unknown }>;

export type RenderMode =
  | 'shader'
  | 'ocio'
  | 'multipass'
  | 'mask'
  | 'warp'
  | 'merge'
  | 'utility'
  | 'media'
  | 'text'
  | 'scene';

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

export type RendererSceneSize = RenderSceneSize;
export type RendererSceneSizeBehavior = RenderSceneSizeBehavior<unknown, RenderContext>;

export type UniformsGetter = (node: unknown, context: RenderContext) => ShaderUniformMap;

/** What kind of data an input port accepts. */
export type InputPortType = 'texture' | 'mask' | 'data';

/** Declares a secondary input port on a node (e.g. depth map, mask, displacement). */
export interface InputPortDescriptor {
  name: string;
  label: string;
  type: InputPortType;
  processingDomain?: ColorProcessingDomain;
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

export type InputPortDescriptors =
  | InputPortDescriptor[]
  | ((node: unknown) => InputPortDescriptor[]);

// ---------------------------------------------------------------------------
// Viewport interaction handler — enables extensions to declare viewport
// mouse event behavior without modifying Viewport.tsx.
// ---------------------------------------------------------------------------

/** Scene-space point. */
export interface ViewportScenePoint {
  x: number;
  y: number;
}

/** Context passed to every viewport interaction callback. */
export interface ViewportInteractionContext {
  node: unknown;
  scenePoint: ViewportScenePoint;
  clientPoint: ViewportScenePoint;
  activeTool: string | null;
  modifiers: { alt: boolean; shift: boolean; ctrl: boolean; meta: boolean };
  frame: number;
  zoom: number;
  nativeEvent: MouseEvent;
}

/** Mutation API provided to interaction handlers. */
export interface ViewportInteractionActions {
  updateNode: (nodeId: string, changes: Record<string, unknown>) => void;
  pushHistory: (label: string) => void;
  setActiveViewportTool: (tool: string | null) => void;
  setKeyframe: (nodeId: string, path: string, frame: number, value: number) => void;
}

/** Result returned by interaction handlers. */
export interface ViewportInteractionResult {
  cursor?: string;
  handled?: boolean;
}

/**
 * Viewport interaction handler — implement these methods to handle
 * mouse events in the viewport for your extension's node type.
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
  getCursor?: (ctx: Omit<ViewportInteractionContext, 'nativeEvent'>) => string | undefined;
}

// ---------------------------------------------------------------------------
// Viewport overlay — enables extensions to render SVG overlays in the
// viewport for their node type.
// ---------------------------------------------------------------------------

/** Props passed to a viewport overlay component. */
export interface ViewportOverlayProps {
  node: unknown;
  frame: number;
  zoom: number;
  pan: { x: number; y: number };
  scene: { width: number; height: number };
  activeTool: string | null;
  selectedRotoPathIds: string[];
  selectedRotoPointRefs: { pathId: string; pointIndex: number }[];
  sceneToViewport: (x: number, y: number) => ViewportScenePoint;
  viewportToScene: (x: number, y: number) => ViewportScenePoint;
}

// ---------------------------------------------------------------------------
// Media descriptor — for extensions that produce their own textures.
// ---------------------------------------------------------------------------

export interface MediaTextureCache {
  has(id: string): boolean;
  get(id: string): unknown;
}

export interface MediaCacheContext {
  imageCache: MediaTextureCache;
  videoElements: ReadonlyMap<string, HTMLVideoElement>;
  sequenceCache: MediaTextureCache;
}

/**
 * Media descriptor — extensions with `renderMode: 'media'` implement
 * this to declare how their textures are obtained and checked.
 */
export interface MediaDescriptor {
  getAssetIds: (node: unknown) => string[];
  /** Resolve a timeline frame to a source frame, or null for transparent black. */
  resolveFrame?: (node: unknown, frame: number) => number | null;
  checkFrameReady: (node: unknown, frame: number, caches: MediaCacheContext) => boolean;
  getMediaTextureKey?: (node: unknown, frame: number) => string;
  getColorSpace?: (node: unknown) => string | undefined;
}

// ---------------------------------------------------------------------------
// Node flags — declarative boolean flags for node type behavior.
// ---------------------------------------------------------------------------

/**
 * Declarative flags for a node type. All flags default to `false`.
 */
export interface NodeFlags {
  isSource?: boolean;
  isRenderable?: boolean;
  isMediaNode?: boolean;
  isVideoFile?: boolean;
  isDraggable?: boolean;
  isSceneLike?: boolean;
  showDataWindow?: boolean;
  isProtected?: boolean;
  hasThumbnail?: boolean;
}

// ---------------------------------------------------------------------------
// Node update hook
// ---------------------------------------------------------------------------

/** Context passed to node update hooks. */
export interface NodeUpdateContext {
  /** The scene node (if one exists). Useful for transform calculations. */
  sceneNode?: unknown;
}

/** Result returned by a node update hook. */
export interface NodeUpdateResult {
  /** The (potentially modified) property changes to apply. */
  changes: Record<string, unknown>;
  /** Custom history label. If omitted, the generic "Update Node" is used. */
  label?: string;
}

export type NodeUpdateHook = (
  node: unknown,
  changes: Record<string, unknown>,
  context: NodeUpdateContext,
) => NodeUpdateResult;

export type HotkeyScopeId =
  | 'global'
  | 'flow'
  | 'flow.list'
  | 'flow.graph'
  | 'viewport'
  | 'timeline'
  | 'timeline.dopesheet'
  | 'timeline.graph';

export interface HotkeyBinding<TArgs = unknown> {
  keys: string | string[];
  command: string;
  args?: TArgs;
  scope?: HotkeyScopeId | HotkeyScopeId[];
  when?: (context: unknown) => boolean;
  weight?: number;
  preventDefault?: boolean;
  allowInTextEntry?: boolean;
  repeat?: boolean;
}

// ---------------------------------------------------------------------------
// NodeDefinition (a.k.a. NodeExtension)
// ---------------------------------------------------------------------------

export interface NodeDefinition {
  type: string;
  name: string;
  description?: string;
  category: 'Image' | 'Spatial' | 'Adjustment' | 'Effect' | 'Utility';
  renderMode: RenderMode;
  processingDomain: ColorProcessingDomain | ((node: unknown) => ColorProcessingDomain);
  /** Domain accepted by the implicit primary `pipe` input when it differs from the output. */
  primaryInputDomain?: ColorProcessingDomain | ((node: unknown) => ColorProcessingDomain);
  /** `reinterpret` permits color-domain mismatches at an explicit conversion boundary. */
  primaryInputDomainPolicy?: 'strict' | 'reinterpret';

  IconComponent: React.ComponentType<{ className?: string }>;
  ToolComponent?: React.ComponentType;
  AdjustmentComponent: React.ComponentType<{ node: unknown }>;
  ViewportToolsComponent?: React.ComponentType<{ node: unknown }>;

  /** Optional SVG overlay component rendered in the viewport for this node. */
  ViewportOverlayComponent?: React.ComponentType<ViewportOverlayProps>;
  /** Optional side-panel component shown when this node's viewport tool is active. */
  ViewportToolPanelComponent?: React.ComponentType<{ node: unknown }>;

  getInitialNodeProps: () => Record<string, unknown>;
  toolHotkeys?: { [key: string]: string };
  hotkeys?: HotkeyBinding[];

  getShader?: (node: unknown) => string | { horizontal: string; vertical: string };
  getUniforms?: UniformsGetter;
  getStabilizeTransform?: (node: unknown, frame: number, context?: unknown) => TransformData | null;
  sceneSize?: RendererSceneSizeBehavior;
  getGeneratedColor?: GeneratedColorResolver<unknown, RenderContext>;

  /** Optional secondary input ports. The primary `pipe` port is reserved and implicit. */
  inputPorts?: InputPortDescriptors;

  /** Viewport interaction handler for mouse events. */
  viewportInteraction?: ViewportInteractionHandler;
  /** Media descriptor for texture/asset management. */
  mediaDescriptor?: MediaDescriptor;
  /** Declarative flags for node type behavior. */
  flags?: NodeFlags;
  /** Property change normalization/validation hook. */
  onNodeUpdate?: NodeUpdateHook;
  /** Extract asset IDs for this node. */
  getAssetIds?: (node: unknown) => string[];
}

/**
 * Alias for NodeDefinition — community-facing name for the extension system.
 * Built-in nodes and community extensions use the same manifest shape.
 */
export type NodeExtension = NodeDefinition;

export interface ToolDefinition {
  type: string;
  name: string;
  description?: string;
  category: 'Image' | 'Spatial' | 'Adjustment' | 'Effect' | 'Utility';
  ToolComponent?: React.ComponentType;
}

// ---------------------------------------------------------------------------
// Future extension types — placeholders for multi-registry architecture.
// These are not yet implemented in the host but are reserved so that plugin
// manifests can declare them ahead of time.
// ---------------------------------------------------------------------------

/**
 * A standalone viewport tool that isn't tied to a specific node type.
 * Example: a ruler tool, a color sampler, or a crop guide.
 *
 * @future Not yet consumed by the host — reserved for future releases.
 */
export interface ViewportToolDefinition {
  /** Unique tool identifier (e.g. "ruler", "color-picker"). */
  id: string;
  name: string;
  description?: string;
  /** Icon rendered in the viewport toolbar. */
  IconComponent: React.ComponentType<{ className?: string }>;
  /** Tool UI rendered inside the viewport when active. */
  ToolComponent: React.ComponentType;
  /** Optional hotkey bindings for this tool. */
  hotkeys?: Record<string, string>;
}

/**
 * A custom editor panel extension (e.g. a metadata inspector, a color palette).
 *
 * @future Not yet consumed by the host — reserved for future releases.
 */
export interface PanelDefinition {
  /** Unique panel identifier (e.g. "metadata-inspector"). */
  id: string;
  name: string;
  description?: string;
  /** Icon shown in the panel tab bar. */
  IconComponent: React.ComponentType<{ className?: string }>;
  /** The panel content component. */
  PanelComponent: React.ComponentType;
  /** Default panel location hint. */
  defaultPosition?: 'left' | 'right' | 'bottom';
}

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** Unique plugin identifier (e.g. "com.example.my-plugin"). */
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** Node extensions provided by this plugin. */
  nodeExtensions: NodeDefinition[];
  /**
   * Standalone viewport tools provided by this plugin.
   * @future Not yet consumed by the host — reserved for future releases.
   */
  viewportToolExtensions?: ViewportToolDefinition[];
  /**
   * Custom editor panels provided by this plugin.
   * @future Not yet consumed by the host — reserved for future releases.
   */
  panelExtensions?: PanelDefinition[];
}

// ---------------------------------------------------------------------------
// Registry connection (called by the host app, not by plugins)
// ---------------------------------------------------------------------------

type NodeRegistry = Map<string, NodeDefinition>;
type ToolRegistry = ToolDefinition[];

let _nodeRegistry: NodeRegistry | null = null;
let _toolRegistry: ToolRegistry | null = null;
const _registeredPlugins = new Map<string, PluginManifest>();

/**
 * Called once by the host app during initialisation to connect the
 * plugin-sdk to the live node and tool registries.
 */
export function connectRegistries(nodeRegistry: NodeRegistry, toolRegistry: ToolRegistry): void {
  _nodeRegistry = nodeRegistry;
  _toolRegistry = toolRegistry;
}

// ---------------------------------------------------------------------------
// Plugin registration / unregistration
// ---------------------------------------------------------------------------

/**
 * Register a plugin's node extensions into the host app.
 *
 * @throws if registries are not connected, the plugin is already registered,
 *         or a node type conflicts with an existing registration.
 */
export function registerPlugin(manifest: PluginManifest): void {
  if (!_nodeRegistry || !_toolRegistry) {
    throw new Error(
      'Plugin registries not connected. The host app must call connectRegistries() before plugins can register.',
    );
  }
  if (_registeredPlugins.has(manifest.id)) {
    throw new Error(`Plugin "${manifest.id}" is already registered.`);
  }

  const extensions = manifest.nodeExtensions;

  // Validate no type conflicts before mutating anything
  for (const extension of extensions) {
    if (_nodeRegistry.has(extension.type)) {
      throw new Error(
        `Node type "${extension.type}" conflicts with an existing registration (plugin: "${manifest.id}").`,
      );
    }
  }

  // Apply all registrations
  for (const extension of extensions) {
    _nodeRegistry.set(extension.type, extension);
    if (extension.ToolComponent) {
      _toolRegistry.push(extension);
    }
  }

  _registeredPlugins.set(manifest.id, manifest);
}

/**
 * Unregister a previously registered plugin, removing all its node extensions.
 * No-op if the plugin was not registered.
 */
export function unregisterPlugin(pluginId: string): void {
  if (!_nodeRegistry || !_toolRegistry) {
    throw new Error(
      'Plugin registries not connected. The host app must call connectRegistries() before plugins can unregister.',
    );
  }

  const manifest = _registeredPlugins.get(pluginId);
  if (!manifest) return;

  const extensions = manifest.nodeExtensions;

  for (const extension of extensions) {
    _nodeRegistry.delete(extension.type);
    const idx = _toolRegistry.findIndex((t) => t.type === extension.type);
    if (idx !== -1) _toolRegistry.splice(idx, 1);
  }

  _registeredPlugins.delete(pluginId);
}

/** Returns a read-only view of all currently registered plugins. */
export function getRegisteredPlugins(): ReadonlyMap<string, PluginManifest> {
  return _registeredPlugins;
}
