// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createInitialCompareViewState } from '@/state/editor/compareView';
import {
  calculateCompareInteractiveRect,
  useCompareViewportPresentation,
} from './useCompareViewportPresentation';

describe('useCompareViewportPresentation', () => {
  it('normalizes layout insets into one reusable interactive rectangle', () => {
    expect(
      calculateCompareInteractiveRect(
        { width: 1280, height: 720 },
        { left: 160, top: 90, right: 160, bottom: 90 },
      ),
    ).toEqual({ x: 160, y: 90, width: 960, height: 540 });
  });

  it('returns the leading projection while preserving slot A as the fit target', () => {
    const { result } = renderHook(() =>
      useCompareViewportPresentation({
        viewportRef: { current: null },
        viewportSize: { width: 1280, height: 720 },
        compareView: {
          ...createInitialCompareViewState(),
          isActive: true,
          mode: 'split',
          sidesSwapped: true,
        },
        isActive: true,
        slotASize: { width: 1920, height: 1080 },
        leadingSize: { width: 1080, height: 1920 },
        zoom: 0.25,
        pan: { x: 0, y: 0 },
      }),
    );

    expect(result.current.presetTarget?.zoom).toBeCloseTo(1 / 3);
    expect(result.current.leadingProjection?.frame).toEqual({
      x: 168.125,
      y: 90,
      width: 303.75,
      height: 540,
      scale: 0.28125,
    });
    expect(result.current.leadingProjection?.clipRect).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 720,
    });
    expect(result.current.overlayZoom).toBe(0.28125);
    expect(result.current.overlayPan).toEqual({ x: -320, y: 0 });
  });
});
