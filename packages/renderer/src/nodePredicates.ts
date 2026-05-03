import { AnyNode } from '@blackboard/types';
import type { EffectRegistryLike } from './types';

export const createNodePredicates = (effectRegistry: EffectRegistryLike) => ({
  isStackAdjustmentType: (type: string): boolean => {
    const def = effectRegistry.get(type);
    return (
      !!def &&
      def.renderMode !== 'merge' &&
      (def.category === 'Adjustment' || def.category === 'Effect')
    );
  },

  isExportAdjustmentType: (type: string): boolean => {
    const def = effectRegistry.get(type);
    return (
      !!def &&
      (def.renderMode === 'shader' || def.renderMode === 'multipass' || def.renderMode === 'paint')
    );
  },

  isAutoStackedNewNodeType: (type: string): boolean => {
    const def = effectRegistry.get(type);
    return (
      !!def &&
      (def.renderMode === 'shader' || def.renderMode === 'multipass' || def.renderMode === 'paint')
    );
  },

  isStackedAdjustmentNode: (node: AnyNode): boolean => {
    const def = effectRegistry.get(node.type);
    const isStackAdj =
      !!def &&
      def.renderMode !== 'merge' &&
      (def.category === 'Adjustment' || def.category === 'Effect');
    return isStackAdj && 'stacked' in node && !!(node as any).stacked;
  },

  isStackedExportAdjustmentNode: (node: AnyNode): boolean => {
    const def = effectRegistry.get(node.type);
    const isExportAdj =
      !!def &&
      (def.renderMode === 'shader' || def.renderMode === 'multipass' || def.renderMode === 'paint');
    return isExportAdj && 'stacked' in node && !!(node as any).stacked;
  },

  /**
   * Registry-aware check: the node type has `isLooping` flag AND the
   * instance has `loop` set to true.
   */
  isLoopingTimelineNode: (node: AnyNode): boolean => {
    const def = effectRegistry.get(node.type);
    if (def?.flags?.isLooping) {
      return !!(node as any).loop;
    }
    return false;
  },

  /**
   * Registry-aware check: the node type has `isMediaNode` flag.
   */
  isMediaNodeType: (type: string): boolean => {
    const def = effectRegistry.get(type);
    return !!def?.flags?.isMediaNode;
  },
});

// Registry-independent predicates exported directly
export const hasStackedFlag = <T extends AnyNode>(node: T): node is T & { stacked: boolean } =>
  'stacked' in node;
