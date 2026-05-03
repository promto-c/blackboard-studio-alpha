/**
 * effectHelpers.ts — Shared helper functions for querying the effect registry.
 *
 * These helpers provide resolved, default-aware access to registry-declared
 * flags, media descriptors, and other node-type metadata. They replace
 * scattered hardcoded type-list checks throughout the codebase.
 */

import { effectRegistry } from './effectRegistry';
import type { NodeFlags, MediaDescriptor, InputPortDescriptor } from './EffectDefinition';
import type { AnyNode } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Default NodeFlags — all false unless the effect definition says otherwise.
// ---------------------------------------------------------------------------

const DEFAULT_FLAGS: Required<NodeFlags> = {
  isSource: false,
  isRenderable: false,
  isMediaNode: false,
  isLooping: false,
  isVideoFile: false,
  isDraggable: true,
  isSceneLike: false,
  showDataWindow: false,
  isProtected: false,
  hasThumbnail: false,
};

/**
 * Resolve the full set of `NodeFlags` for a given node type.
 * Returns `DEFAULT_FLAGS` if the type is not in the registry or
 * has no flags declared. Every flag is guaranteed to be a boolean.
 *
 * @example
 * ```ts
 * const flags = nodeFlags('image');
 * if (flags.isRenderable) { ... }
 * ```
 */
export function nodeFlags(type: string): Required<NodeFlags> {
  const def = effectRegistry.get(type);
  if (!def?.flags) return DEFAULT_FLAGS;
  return { ...DEFAULT_FLAGS, ...def.flags };
}

/**
 * Check whether a project's node list contains at least one renderable node.
 * Replaces hardcoded `type === IMAGE || type === TEXT || ...` checks in
 * Viewport.tsx and OutputAdjustments.tsx.
 */
export function hasRenderableNodes(nodes: { type: string }[]): boolean {
  return nodes.some((node) => nodeFlags(node.type).isRenderable);
}

/**
 * Get the media descriptor for a node type, if any.
 * Returns `undefined` for node types that don't have a media descriptor.
 */
export function getMediaDescriptor(type: string): MediaDescriptor | undefined {
  return effectRegistry.get(type)?.mediaDescriptor;
}

export function getInputPorts(node: AnyNode): InputPortDescriptor[] {
  const inputPorts = effectRegistry.get(node.type)?.inputPorts;
  if (!inputPorts) return [];
  return typeof inputPorts === 'function' ? inputPorts(node) : inputPorts;
}

/**
 * Resolve the default viewport tool for a node type.
 * Returns `null` when the effect does not declare one.
 */
export function getDefaultViewportTool(type: string | null | undefined): string | null {
  if (!type) return null;
  return effectRegistry.get(type)?.defaultViewportTool ?? null;
}

/**
 * Extract asset IDs from a node, using either the media descriptor or
 * the top-level `getAssetIds` convenience method. Returns an empty array
 * if neither is defined.
 */
export function getNodeAssetIds(node: AnyNode): string[] {
  const def = effectRegistry.get(node.type);
  if (!def) return [];
  const getter = def.mediaDescriptor?.getAssetIds ?? def.getAssetIds;
  return getter ? getter(node) : [];
}
