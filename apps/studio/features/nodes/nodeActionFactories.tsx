import React from 'react';
import { AnyNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { hasStackedFlag, isStackAdjustmentType } from '@/utils/nodePredicates';
import type { NodeAction } from './NodeActionMenu';

export function createStackingAction(
  node: AnyNode,
  canStackOntoPreviousNode: boolean,
  onToggleStacking: (nodeId: string) => void,
): NodeAction | null {
  if (!isStackAdjustmentType(node.type)) {
    return null;
  }

  const hasStackState = hasStackedFlag(node);
  const isStackable = canStackOntoPreviousNode && hasStackState;
  const isStacked = hasStackState ? node.stacked : false;

  return {
    id: 'stacking',
    label: !isStackable
      ? "This node can't be stacked"
      : isStacked
        ? 'Unstack from layer below'
        : 'Stack onto layer below',
    icon: <Icons.Stack className="h-4 w-4" />,
    iconClassName: `w-6 h-6 flex items-center justify-center rounded transition-colors ${
      !isStackable
        ? 'text-gray-700 cursor-not-allowed'
        : isStacked
          ? 'text-primary-400 bg-primary-900/50'
          : 'text-gray-500 hover:text-white hover:bg-gray-700'
    }`,
    inline: true,
    disabled: !isStackable,
    onClick: (e) => {
      e.stopPropagation();
      if (isStackable) {
        onToggleStacking(node.id);
      }
    },
  };
}
