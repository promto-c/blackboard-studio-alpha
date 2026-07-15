import type { AnyNode } from '@blackboard/types';

/** Map a selected/viewed child row to the stack card that owns its external ports. */
export const resolveVisibleGraphNodeId = (
  nodeId: string | null | undefined,
  nodeStacks: readonly (readonly AnyNode[])[],
): string | null => {
  if (!nodeId) return null;
  const ownerStack = nodeStacks.find((stack) => stack.some((node) => node.id === nodeId));
  return ownerStack?.[0]?.id ?? nodeId;
};
