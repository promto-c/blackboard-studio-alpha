// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreviewPerformance } from './usePreviewPerformance';

const baseProps = {
  renderRevision: {} as unknown,
  currentFrame: 1,
  fps: 30,
  isPlaying: false,
  isFrameScrubbing: false,
  editingPreviewActive: false,
  hasAdaptivePreviewWork: true,
  optimizeWhileEditing: true,
  optimizeFrameChanges: true,
  refineDelayMs: 120,
  playbackMode: 'auto' as const,
  sceneSize: { width: 3840, height: 2160 },
  viewportSize: { width: 1920, height: 1080 },
  maxDimension: 1280,
  sampleLimit: 16,
};

describe('usePreviewPerformance', () => {
  afterEach(() => vi.useRealTimers());

  it('renders an edit optimized, then refines after quiet time', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props) => usePreviewPerformance(props), {
      initialProps: baseProps,
    });

    rerender({ ...baseProps, renderRevision: {} });
    expect(result.current.previewOptimized).toBe(true);
    expect(result.current.quality).toMatchObject({
      mode: 'preview',
      resolutionScale: 1 / 3,
      sampleLimit: 16,
    });

    act(() => vi.advanceTimersByTime(120));
    expect(result.current.previewOptimized).toBe(false);
    expect(result.current.quality.mode).toBe('full');
  });

  it('keeps inexpensive frame changes full quality without a redundant refine', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props) => usePreviewPerformance(props), {
      initialProps: baseProps,
    });

    act(() => result.current.reportRenderDuration(5));
    rerender({ ...baseProps, currentFrame: 2 });
    expect(result.current.previewOptimized).toBe(false);

    act(() => vi.advanceTimersByTime(120));
    expect(result.current.previewOptimized).toBe(false);
  });

  it('uses coarse-to-fine only after full frame changes miss their budget', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props) => usePreviewPerformance(props), {
      initialProps: baseProps,
    });

    act(() => result.current.reportRenderDuration(40));
    rerender({ ...baseProps, currentFrame: 2 });
    expect(result.current.previewOptimized).toBe(false);
    act(() => result.current.reportRenderDuration(40));

    rerender({ ...baseProps, currentFrame: 3 });
    expect(result.current.previewOptimized).toBe(true);
    act(() => vi.advanceTimersByTime(120));
    expect(result.current.previewOptimized).toBe(false);
  });

  it('keeps healthy auto playback full and drops after two misses', () => {
    const { result, rerender } = renderHook((props) => usePreviewPerformance(props), {
      initialProps: { ...baseProps, isPlaying: true },
    });

    act(() => result.current.reportRenderDuration(5));
    expect(result.current.previewOptimized).toBe(false);

    act(() => {
      result.current.reportRenderDuration(40);
      result.current.reportRenderDuration(40);
    });
    rerender({ ...baseProps, isPlaying: true, currentFrame: 2 });
    expect(result.current.previewOptimized).toBe(true);
  });

  it('can keep editing and frame changes at reliable full quality', () => {
    const { result, rerender } = renderHook((props) => usePreviewPerformance(props), {
      initialProps: {
        ...baseProps,
        optimizeWhileEditing: false,
        optimizeFrameChanges: false,
      },
    });

    rerender({
      ...baseProps,
      renderRevision: {},
      currentFrame: 2,
      editingPreviewActive: true,
      optimizeWhileEditing: false,
      optimizeFrameChanges: false,
    });
    expect(result.current.previewOptimized).toBe(false);
    expect(result.current.quality.mode).toBe('full');
  });

  it('never schedules proxy work when the active branch cannot use it', () => {
    const { result, rerender } = renderHook((props) => usePreviewPerformance(props), {
      initialProps: { ...baseProps, hasAdaptivePreviewWork: false },
    });

    rerender({
      ...baseProps,
      hasAdaptivePreviewWork: false,
      renderRevision: {},
      currentFrame: 2,
      editingPreviewActive: true,
    });
    expect(result.current.previewOptimized).toBe(false);
  });
});
