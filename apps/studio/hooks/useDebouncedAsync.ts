import { useState, useEffect, useRef } from 'react';

export interface UseDebouncedAsyncOptions {
  delay?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function useDebouncedAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList,
  options: UseDebouncedAsyncOptions = {},
): T | undefined {
  const { delay = 200, enabled = true, onError } = options;
  const [value, setValue] = useState<T | undefined>();
  const generationRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    let isCancelled = false;

    if (!enabled) {
      setValue(undefined);
      return () => {
        isCancelled = true;
      };
    }

    const timeoutId = setTimeout(async () => {
      if (isCancelled) return;
      try {
        const result = await fnRef.current();
        if (!isCancelled && generationRef.current === generation) {
          setValue(result);
        }
      } catch (e) {
        if (!isCancelled && generationRef.current === generation) {
          onErrorRef.current?.(e);
        }
      }
    }, delay);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [delay, enabled, ...deps]);

  return value;
}
