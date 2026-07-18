import { AnyNode, NodeType } from '@blackboard/types';
import { isStackedNode } from '@/utils/nodePredicates';

/**
 * From a starting index in `nodes`, collect the node at that index and all
 * consecutive nodes compacted with it in list/graph presentation.
 */
export function getStackedGroup(nodes: readonly AnyNode[], startIndex: number): AnyNode[] {
  const group: AnyNode[] = [nodes[startIndex]];
  for (let i = startIndex + 1; i < nodes.length; i++) {
    if (isStackedNode(nodes[i])) {
      group.push(nodes[i]);
    } else {
      break;
    }
  }
  return group;
}

/**
 * Returns the last index of the stacked group starting at `startIndex`.
 */
export function getStackedGroupEndIndex(nodes: readonly AnyNode[], startIndex: number): number {
  let endIndex = startIndex;
  for (let i = startIndex + 1; i < nodes.length; i++) {
    if (isStackedNode(nodes[i])) {
      endIndex = i;
    } else {
      break;
    }
  }
  return endIndex;
}

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

    if (isStackedNode(node)) {
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
