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

/**
 * Check whether a value is a finite number.
 */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Check whether a value is an object with finite positive `width` and `height` properties.
 */
export const hasPositiveSize = (value: unknown): value is { width: number; height: number } =>
  typeof value === 'object' &&
  value !== null &&
  isFiniteNumber((value as { width?: unknown }).width) &&
  (value as { width: number }).width > 0 &&
  isFiniteNumber((value as { height?: unknown }).height) &&
  (value as { height: number }).height > 0;

/**
 * Extract a human-readable error message from an unknown value.
 * Handles `Error` instances, string errors, and falls back to a default message.
 */
export const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
