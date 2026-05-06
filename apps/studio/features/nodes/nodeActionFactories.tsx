import React from 'react';
import { AnyNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { effectRegistry } from '@/effects/effectRegistry';
import { isNodeStacked, isStackAdjustmentType } from '@/utils/nodePredicates';
import type { NodeAction } from './NodeActionMenu';

export function createStackingAction(
  node: AnyNode,
  canStackOntoPreviousStack: boolean,
  onToggleStacking: (nodeId: string) => void,
): NodeAction | null {
  if (!isStackAdjustmentType(node.type)) {
    return null;
  }

  const isStacked = isNodeStacked(node);
  const canToggleStacking = isStacked || canStackOntoPreviousStack;

  return {
    id: 'stacking',
    label: !canToggleStacking
      ? "This node can't be stacked"
      : isStacked
        ? 'Unstack from layer below'
        : 'Stack onto layer below',
    icon: <Icons.Stack className="h-4 w-4" />,
    iconClassName: `w-6 h-6 flex items-center justify-center rounded transition-colors ${
      !canToggleStacking
        ? 'text-gray-700 cursor-not-allowed'
        : isStacked
          ? 'text-primary-400 bg-primary-900/50'
          : 'text-gray-500 hover:text-white hover:bg-gray-700'
    }`,
    inline: true,
    disabled: !canToggleStacking,
    onClick: (e) => {
      e.stopPropagation();
      if (canToggleStacking) {
        onToggleStacking(node.id);
      }
    },
  };
}

export function createExecutionAction(
  node: AnyNode,
  onExecuteNode: (nodeId: string) => void,
): NodeAction | null {
  const execution = effectRegistry.get(node.type)?.nodeExecution;
  if (!execution) return null;

  const canExecute = execution.canExecute ? execution.canExecute(node) : true;
  const label = execution.label ?? 'Execute';

  return {
    id: 'execute',
    label,
    icon: <Icons.Play className="h-4 w-4" />,
    iconClassName: `w-6 h-6 flex items-center justify-center rounded transition-colors ${
      canExecute
        ? 'text-gray-400 hover:text-primary-400 hover:bg-primary-500/20'
        : 'text-gray-700 cursor-not-allowed'
    }`,
    disabled: !canExecute,
    onClick: (e) => {
      e.stopPropagation();
      if (!canExecute) return;
      onExecuteNode(node.id);
    },
  };
}
