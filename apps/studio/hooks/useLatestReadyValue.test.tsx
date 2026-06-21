// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatestReadyValue } from './useLatestReadyValue';

describe('useLatestReadyValue', () => {
  it('marks a same-value replacement pending until its resources are ready', () => {
    const { result, rerender } = renderHook(({ ready }) => useLatestReadyValue(12, ready), {
      initialProps: { ready: true },
    });

    expect(result.current).toEqual({ value: 12, isPending: false });

    rerender({ ready: false });
    expect(result.current).toEqual({ value: 12, isPending: true });

    rerender({ ready: true });
    expect(result.current).toEqual({ value: 12, isPending: false });
  });

  it('retains the last ready value until the replacement is ready', () => {
    const { result, rerender } = renderHook(
      ({ value, ready }) => useLatestReadyValue(value, ready),
      { initialProps: { value: 4, ready: true } },
    );

    rerender({ value: 5, ready: false });
    expect(result.current).toEqual({ value: 4, isPending: true });

    rerender({ value: 5, ready: true });
    expect(result.current).toEqual({ value: 5, isPending: false });
  });
});
