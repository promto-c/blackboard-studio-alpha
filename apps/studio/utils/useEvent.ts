/**
 * useEvent — stable identity callback that always reads the latest closure values.
 *
 * Unlike useCallback, which requires dependency arrays and recreates the function
 * when deps change, useEvent returns a stable function reference that internally
 * delegates to the latest callback via a ref. This is useful for callbacks passed
 * as props to memoized children or stored in context objects.
 *
 * Based on the proposed React useEvent RFC.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useEvent<T extends (...args: any[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, []);
}

/**
 * useLatestRef — returns a stable ref whose `.current` is always the latest value.
 *
 * Useful for imperative event handlers (mouse/canvas dispatchers) that need to
 * read the most recent state without creating new closures.
 */
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const valueRef = useRef(value);
  valueRef.current = value;
  return valueRef;
}
