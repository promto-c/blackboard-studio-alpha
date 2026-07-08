// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRotoTemporalPreview } from './useRotoTemporalPreview';

const baseProps = {
  currentFrame: 1,
  fps: 30,
  isPlaying: false,
  isFrameScrubbing: false,
  frameChangePreviewEnabled: true,
  refineDelayMs: 120,
  playbackMode: 'auto' as const,
};

describe('useRotoTemporalPreview', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a changed frame optimized first and refines after the delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props) => useRotoTemporalPreview(props), {
      initialProps: baseProps,
    });

    rerender({ ...baseProps, currentFrame: 2 });
    expect(result.current.temporalPreviewActive).toBe(true);

    act(() => vi.advanceTimersByTime(120));
    expect(result.current.temporalPreviewActive).toBe(false);
  });

  it('keeps full quality during healthy auto playback and drops after two misses', () => {
    const { result } = renderHook(() => useRotoTemporalPreview({ ...baseProps, isPlaying: true }));

    act(() => result.current.reportRenderDuration(5));
    expect(result.current.temporalPreviewActive).toBe(false);

    act(() => {
      result.current.reportRenderDuration(40);
      result.current.reportRenderDuration(40);
    });
    expect(result.current.temporalPreviewActive).toBe(true);
  });
});
