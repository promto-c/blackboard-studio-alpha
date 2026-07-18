import type { AnyNode } from '@blackboard/types';

export const GRAPH_INTERACTIVE_TARGET_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [data-graph-node], [data-port-input], [data-connection-wire]';

/** True when a pointer target belongs to the graph canvas rather than graph UI. */
export const isGraphCanvasBackgroundTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.closest(GRAPH_INTERACTIVE_TARGET_SELECTOR);

export const shouldCancelWireCutGesture = (
  event: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey'>,
): boolean =>
  event.type === 'keyup' &&
  (event.key === 'Control' || event.key === 'Meta') &&
  !event.ctrlKey &&
  !event.metaKey;

/** Map a selected/viewed child row to the stack card that owns its external ports. */
export const resolveVisibleGraphNodeId = (
  nodeId: string | null | undefined,
  nodeStacks: readonly (readonly AnyNode[])[],
): string | null => {
  if (!nodeId) return null;
  const ownerStack = nodeStacks.find((stack) => stack.some((node) => node.id === nodeId));
  return ownerStack?.[0]?.id ?? nodeId;
};
