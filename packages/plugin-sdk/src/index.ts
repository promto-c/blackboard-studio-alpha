// @blackboard/plugin-sdk — Plugin authoring API
//
// Plugin authors use the types and functions exported here to define
// custom effects and register them with the Blackboard Studio host app.

import React from 'react';
import type { TransformData } from '@blackboard/types';

// Re-export TransformData for plugin authors
export type { TransformData } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Core types re-exported for plugin authors
// ---------------------------------------------------------------------------

export type ShaderUniformMap = Record<string, { value: unknown }>;

export type RenderMode =
  | 'shader'
  | 'multipass'
  | 'mask'
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

export type UniformsGetter = (node: unknown, context: EffectRenderContext) => ShaderUniformMap;

/** What kind of data an input port accepts. */
export type InputPortType = 'texture' | 'mask' | 'data';

/** Declares a secondary input port on an effect (e.g. depth map, mask, displacement). */
export interface InputPortDescriptor {
  name: string;
  label: string;
  type: InputPortType;
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

export interface MediaCacheContext {
  imageCache: Map<string, unknown>;
  videoElements: Map<string, HTMLVideoElement>;
  sequenceCache: Map<string, unknown>;
}

/**
 * Media descriptor — extensions with `renderMode: 'media'` implement
 * this to declare how their textures are obtained and checked.
 */
export interface MediaDescriptor {
  getAssetIds: (node: unknown) => string[];
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
  isLooping?: boolean;
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
// EffectDefinition (a.k.a. NodeExtension)
// ---------------------------------------------------------------------------

export interface EffectDefinition {
  type: string;
  name: string;
  description?: string;
  category: 'Image' | 'Adjustment' | 'Effect';
  renderMode: RenderMode;

  IconComponent: React.FC<{ className?: string }>;
  ToolComponent?: React.FC;
  AdjustmentComponent: React.FC<{ node: unknown }>;
  ViewportToolsComponent?: React.FC<{ node: unknown }>;

  /** Optional SVG overlay component rendered in the viewport for this node. */
  ViewportOverlayComponent?: React.FC<ViewportOverlayProps>;
  /** Optional side-panel component shown when this node's viewport tool is active. */
  ViewportToolPanelComponent?: React.FC<{ node: unknown }>;

  getInitialNodeProps: () => Record<string, unknown>;
  toolHotkeys?: { [key: string]: string };
  hotkeys?: HotkeyBinding[];

  getShader?: (node: unknown) => string | { horizontal: string; vertical: string };
  getUniforms?: UniformsGetter;
  getStabilizeTransform?: (node: unknown, frame: number, context?: unknown) => TransformData | null;

  /** Optional secondary input ports this effect declares. */
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
 * Alias for EffectDefinition — community-facing name for the extension system.
 * Built-in effects and community extensions use the same manifest shape.
 */
export type NodeExtension = EffectDefinition;

export interface ToolDefinition {
  type: string;
  name: string;
  description?: string;
  category: 'Image' | 'Adjustment' | 'Effect';
  ToolComponent?: React.FC;
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
  IconComponent: React.FC<{ className?: string }>;
  /** Tool UI rendered inside the viewport when active. */
  ToolComponent: React.FC;
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
  IconComponent: React.FC<{ className?: string }>;
  /** The panel content component. */
  PanelComponent: React.FC;
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
  /**
   * Node extensions provided by this plugin.
   * @deprecated Use `nodeExtensions` instead. Kept for backward compatibility.
   */
  effects: EffectDefinition[];
  /**
   * Node extensions provided by this plugin (preferred over `effects`).
   * If both are specified, `nodeExtensions` takes precedence.
   */
  nodeExtensions?: EffectDefinition[];
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

type EffectRegistry = Map<string, EffectDefinition>;
type ToolRegistry = ToolDefinition[];

let _effectRegistry: EffectRegistry | null = null;
let _toolRegistry: ToolRegistry | null = null;
const _registeredPlugins = new Map<string, PluginManifest>();

/**
 * Called once by the host app during initialisation to connect the
 * plugin-sdk to the live effect and tool registries.
 */
export function connectRegistries(
  effectRegistry: EffectRegistry,
  toolRegistry: ToolRegistry,
): void {
  _effectRegistry = effectRegistry;
  _toolRegistry = toolRegistry;
}

// ---------------------------------------------------------------------------
// Plugin registration / unregistration
// ---------------------------------------------------------------------------

/**
 * Register a plugin's effects into the host app.
 *
 * @throws if registries are not connected, the plugin is already registered,
 *         or an effect type conflicts with an existing registration.
 */
export function registerPlugin(manifest: PluginManifest): void {
  if (!_effectRegistry || !_toolRegistry) {
    throw new Error(
      'Plugin registries not connected. The host app must call connectRegistries() before plugins can register.',
    );
  }
  if (_registeredPlugins.has(manifest.id)) {
    throw new Error(`Plugin "${manifest.id}" is already registered.`);
  }

  // Prefer nodeExtensions over deprecated effects field
  const extensions = manifest.nodeExtensions ?? manifest.effects;

  // Validate no type conflicts before mutating anything
  for (const effect of extensions) {
    if (_effectRegistry.has(effect.type)) {
      throw new Error(
        `Effect type "${effect.type}" conflicts with an existing registration (plugin: "${manifest.id}").`,
      );
    }
  }

  // Apply all registrations
  for (const effect of extensions) {
    _effectRegistry.set(effect.type, effect as any);
    if (effect.ToolComponent) {
      _toolRegistry.push(effect as any);
    }
  }

  _registeredPlugins.set(manifest.id, manifest);
}

/**
 * Unregister a previously registered plugin, removing all its effects.
 * No-op if the plugin was not registered.
 */
export function unregisterPlugin(pluginId: string): void {
  if (!_effectRegistry || !_toolRegistry) {
    throw new Error(
      'Plugin registries not connected. The host app must call connectRegistries() before plugins can unregister.',
    );
  }

  const manifest = _registeredPlugins.get(pluginId);
  if (!manifest) return;

  // Prefer nodeExtensions over deprecated effects field
  const extensions = manifest.nodeExtensions ?? manifest.effects;

  for (const effect of extensions) {
    _effectRegistry.delete(effect.type);
    const idx = _toolRegistry.findIndex((t) => t.type === effect.type);
    if (idx !== -1) _toolRegistry.splice(idx, 1);
  }

  _registeredPlugins.delete(pluginId);
}

/** Returns a read-only view of all currently registered plugins. */
export function getRegisteredPlugins(): ReadonlyMap<string, PluginManifest> {
  return _registeredPlugins;
}
