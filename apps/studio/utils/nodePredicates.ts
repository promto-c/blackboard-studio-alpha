import type { AnyNode } from '@blackboard/types';
import { getInputPorts } from '@/nodes/helpers';
import { nodeRegistry } from '@/nodes/registry';

/** Transient list/graph projection derived from Flow.stacks. */
export const isNodeStacked = (node: AnyNode): boolean =>
  (node as AnyNode & { stacked?: boolean }).stacked === true;

export const isStackedNode = isNodeStacked;

/** Adds or removes transient compaction state without changing canonical node data. */
export const setNodeStackedPresentation = (node: AnyNode, stacked: boolean): AnyNode => {
  const { stacked: _stacked, ...canonicalNode } = node as AnyNode & { stacked?: boolean };
  return (stacked ? { ...canonicalNode, stacked: true } : canonicalNode) as unknown as AnyNode;
};

/**
 * Returns true if the node type belongs to the "Image" category (source/media).
 * These nodes produce their own pixel data and are composited via merge,
 * as opposed to Adjustment/Effect nodes that modify an existing buffer.
 */
export const isSourceNodeType = (type: string): boolean => {
  const def = nodeRegistry.get(type);
  return !!def && (def.flags?.isSource ?? def.category === 'Image');
};

/** Whether a node accepts the canonical primary image input on its `pipe` port. */
export const usesPipelineInput = (type: string): boolean => {
  const def = nodeRegistry.get(type);
  if (!def) return false;
  if (def.renderMode === 'merge' || def.renderMode === 'utility' || def.renderMode === 'scene') {
    return false;
  }
  if (def.flags?.isSceneLike || isSourceNodeType(type)) return false;
  return true;
};

/** Any unary node may be compacted with the card before it. */
export const isStackableNode = (node: AnyNode): boolean => {
  const inputPortNames = new Set(getInputPorts(node).map((port) => port.name));
  if (usesPipelineInput(node.type)) inputPortNames.add('pipe');
  for (const portName of Object.keys(node.inputs ?? {})) inputPortNames.add(portName);
  return inputPortNames.size === 1;
};

/** Whether a node can participate in the primary output pipeline. */
export const participatesInPipeline = (type: string): boolean => {
  const def = nodeRegistry.get(type);
  if (!def) return false;
  return def.renderMode !== 'utility' && def.renderMode !== 'scene' && !def.flags?.isSceneLike;
};
