/**
 * Helpers — Shared functions for querying the node registry and
 * creating shader-based node definitions.
 *
 * Provides resolved, default-aware access to registry-declared
 * flags, media descriptors, and other node-type metadata. Replaces
 * scattered hardcoded type-list checks throughout the codebase.
 */

import { nodeRegistry } from './registry';
import type { NodeFlags, MediaDescriptor, InputPortDescriptor } from './NodeDefinition';
import { type AnyNode, NodeType, type ComfyNode } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Default NodeFlags — all false unless the node definition says otherwise.
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
  showInputDataWindow: false,
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
  const def = nodeRegistry.get(type);
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
  return nodeRegistry.get(type)?.mediaDescriptor;
}

export function getInputPorts(node: AnyNode): InputPortDescriptor[] {
  const inputPorts = nodeRegistry.get(node.type)?.inputPorts;
  if (!inputPorts) return [];
  return typeof inputPorts === 'function' ? inputPorts(node) : inputPorts;
}

/**
 * Resolve the default viewport tool for a node type.
 * Returns `null` when the node does not declare one.
 */
export function getDefaultViewportTool(type: string | null | undefined): string | null {
  if (!type) return null;
  return nodeRegistry.get(type)?.defaultViewportTool ?? null;
}

/**
 * Extract asset IDs from a node using its media descriptor.
 * Returns an empty array if the node type has no media descriptor.
 */
export function getNodeAssetIds(node: AnyNode): string[] {
  const def = nodeRegistry.get(node.type);
  if (!def) return [];
  return def.mediaDescriptor?.getAssetIds?.(node) ?? [];
}

/**
 * Type guard that checks whether a node is a Comfy node.
 * Accepts nullable nodes for convenience.
 */
export function isComfyNode(node: AnyNode | null | undefined): node is ComfyNode {
  return !!node && node.type === NodeType.COMFY;
}

// Re-export types directly from NodeDefinition (not through nodeFactoryHelpers)
// to keep the dependency chain explicit and shallow.
export type { ShaderUniformMap, RenderContext } from './NodeDefinition';

// Re-export helpers from the isolated factory-helpers module
// (kept separate to avoid circular dependency chains with THREE / renderer imports).
export {
  createUniformGetter,
  type CreateUniformGetterOptions,
  createShaderNodeDefinition,
  type CreateShaderNodeDefinitionOptions,
} from './nodeFactoryHelpers';
