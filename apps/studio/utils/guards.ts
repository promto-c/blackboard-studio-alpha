import { NodeType, type AnyNode, type SceneNode } from '@blackboard/types';

export const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const getNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim() || undefined;
};

/**
 * Check whether an error is an AbortError, handling both DOMException
 * and regular Error instances for cross-environment compatibility.
 */
export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

export const isSceneNode = (node: AnyNode): node is SceneNode => node.type === NodeType.SCENE;
