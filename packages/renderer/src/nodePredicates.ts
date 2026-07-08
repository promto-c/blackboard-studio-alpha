import { AnyNode } from '@blackboard/types';
import type { NodeRegistryLike } from './types';

const isPipelineAdjustmentRenderMode = (renderMode?: string): boolean =>
  renderMode === 'shader' ||
  renderMode === 'multipass' ||
  renderMode === 'paint' ||
  renderMode === 'mask' ||
  renderMode === 'warp';

const isStackAdjustmentCategory = (category?: string): boolean =>
  category === 'Spatial' || category === 'Adjustment' || category === 'Effect';

export const createNodePredicates = (nodeRegistry: NodeRegistryLike) => ({
  isStackAdjustmentType: (type: string): boolean => {
    const def = nodeRegistry.get(type);
    return (
      !!def &&
      def.renderMode !== 'merge' &&
      def.renderMode !== 'utility' &&
      isStackAdjustmentCategory(def.category)
    );
  },

  isExportAdjustmentType: (type: string): boolean => {
    const def = nodeRegistry.get(type);
    return !!def && isPipelineAdjustmentRenderMode(def.renderMode);
  },

  isStackedAdjustmentNode: (node: AnyNode): boolean => {
    const def = nodeRegistry.get(node.type);
    const isStackAdj =
      !!def &&
      def.renderMode !== 'merge' &&
      def.renderMode !== 'utility' &&
      isStackAdjustmentCategory(def.category);
    return isStackAdj && 'stacked' in node && node.stacked === true;
  },

  isStackedExportAdjustmentNode: (node: AnyNode): boolean => {
    const def = nodeRegistry.get(node.type);
    const isExportAdj = !!def && isPipelineAdjustmentRenderMode(def.renderMode);
    return isExportAdj && 'stacked' in node && node.stacked === true;
  },

  /**
   * Registry-aware check: the node type has `isLooping` flag AND the
   * instance has `loop` set to true.
   */
  isLoopingTimelineNode: (node: AnyNode): boolean => {
    const def = nodeRegistry.get(node.type);
    if (def?.flags?.isLooping) {
      return 'loop' in node && node.loop === true;
    }
    return false;
  },

  /**
   * Registry-aware check: the node type has `isMediaNode` flag.
   */
  isMediaNodeType: (type: string): boolean => {
    const def = nodeRegistry.get(type);
    return !!def?.flags?.isMediaNode;
  },
});

// Registry-independent predicates exported directly
export const hasStackedFlag = <T extends AnyNode>(node: T): node is T & { stacked: boolean } =>
  'stacked' in node;
