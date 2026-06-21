import { useLayoutEffect, useState } from 'react';

interface LatestReadyValue<T> {
  value: T;
  isPending: boolean;
}

/**
 * Retains the last ready value while its requested replacement is preparing.
 * Useful for presentation surfaces that should update atomically instead of
 * briefly displaying an incomplete state.
 */
export const useLatestReadyValue = <T>(
  requestedValue: T,
  isReady: boolean,
): LatestReadyValue<T> => {
  const [value, setValue] = useState(requestedValue);

  useLayoutEffect(() => {
    if (isReady) setValue(requestedValue);
  }, [isReady, requestedValue]);

  return {
    value,
    isPending: !isReady || !Object.is(value, requestedValue),
  };
};
