import { createNodePredicates, hasStackedFlag } from '@blackboard/renderer';
import type { AnyNode } from '@blackboard/types';
import { effectRegistry } from '@/effects/effectRegistry';

export const predicates = createNodePredicates(effectRegistry);

export const isStackAdjustmentType = predicates.isStackAdjustmentType;
export const isExportAdjustmentType = predicates.isExportAdjustmentType;
export const isStackedAdjustmentNode = predicates.isStackedAdjustmentNode;
export const isStackedExportAdjustmentNode = predicates.isStackedExportAdjustmentNode;

/** Registry-aware: uses the `isLooping` flag from the effect definition. */
export const isLoopingTimelineNode = predicates.isLoopingTimelineNode;

/** Registry-aware: uses the `isMediaNode` flag from the effect definition. */
export const isMediaNodeType = predicates.isMediaNodeType;

/**
 * Returns true if the node type belongs to the "Image" category (source/media).
 * These nodes produce their own pixel data and are composited via merge,
 * as opposed to Adjustment/Effect nodes that modify an existing buffer.
 */
export const isSourceNodeType = (type: string): boolean => {
  const def = effectRegistry.get(type);
  return !!def && (def.flags?.isSource ?? def.category === 'Image');
};

export const isNodeStacked = (node: AnyNode): boolean =>
  hasStackedFlag(node) ? node.stacked : false;

export { hasStackedFlag };
