import { createNodePredicates, hasStackedFlag } from '@blackboard/renderer';
import type { AnyNode } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';

const predicates = createNodePredicates({
  get: (type) => nodeRegistry.get(type),
});

export const isStackAdjustmentType = predicates.isStackAdjustmentType;
export const isExportAdjustmentType = predicates.isExportAdjustmentType;
export const isStackedAdjustmentNode = predicates.isStackedAdjustmentNode;
export const isStackedExportAdjustmentNode = predicates.isStackedExportAdjustmentNode;

/**
 * Returns true if the node type belongs to the "Image" category (source/media).
 * These nodes produce their own pixel data and are composited via merge,
 * as opposed to Adjustment/Effect nodes that modify an existing buffer.
 */
export const isSourceNodeType = (type: string): boolean => {
  const def = nodeRegistry.get(type);
  return !!def && (def.flags?.isSource ?? def.category === 'Image');
};

export const usesImplicitPipelineInput = (type: string): boolean => {
  const def = nodeRegistry.get(type);
  if (!def) return false;
  if (def.renderMode === 'merge' || def.renderMode === 'utility' || def.renderMode === 'scene') {
    return false;
  }
  if (def.flags?.isSceneLike || isSourceNodeType(type)) return false;
  return true;
};

export const participatesInImplicitPipeline = (type: string): boolean => {
  const def = nodeRegistry.get(type);
  if (!def) return false;
  return def.renderMode !== 'utility' && def.renderMode !== 'scene' && !def.flags?.isSceneLike;
};

export const isNodeStacked = (node: AnyNode): boolean =>
  hasStackedFlag(node) ? node.stacked : false;

export { hasStackedFlag };
