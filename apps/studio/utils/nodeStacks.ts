import { AnyNode, NodeType } from '@blackboard/types';
import { isStackedAdjustmentNode } from '@/utils/nodePredicates';

export function buildNodeStacks(nodes: AnyNode[]): AnyNode[][] {
  const stacks: AnyNode[][] = [];
  const otherNodes = nodes.filter((node) => node.type !== NodeType.SCENE);

  if (otherNodes.length === 0) {
    return stacks;
  }

  let currentStack: AnyNode[] = [];

  for (const node of otherNodes) {
    if (currentStack.length === 0) {
      currentStack.push(node);
      continue;
    }

    if (isStackedAdjustmentNode(node)) {
      currentStack.push(node);
      continue;
    }

    stacks.push(currentStack);
    currentStack = [node];
  }

  if (currentStack.length > 0) {
    stacks.push(currentStack);
  }

  return stacks;
}

export function hasPreviousStackTarget(nodes: AnyNode[], nodeId: string): boolean {
  const nodeIndex = nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex <= 0) {
    return false;
  }

  return nodes.slice(0, nodeIndex).some((node) => node.type !== NodeType.SCENE);
}
