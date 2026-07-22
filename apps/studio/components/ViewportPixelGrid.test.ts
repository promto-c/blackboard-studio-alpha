import { describe, expect, it } from 'vitest';
import {
  getEffectiveViewportPixelZoom,
  getViewportPixelGridStyle,
  getViewportPixelGridVisibility,
} from './ViewportPixelGrid';

describe('viewport pixel grid', () => {
  it('smoothly fades in during the zoom level before the configured threshold', () => {
    expect(getViewportPixelGridVisibility({ enabled: true, zoom: 7, thresholdZoom: 8 })).toBe(0);
    expect(getViewportPixelGridVisibility({ enabled: true, zoom: 7.5, thresholdZoom: 8 })).toBe(
      0.5,
    );
    expect(getViewportPixelGridVisibility({ enabled: true, zoom: 8, thresholdZoom: 8 })).toBe(1);
    expect(getViewportPixelGridVisibility({ enabled: false, zoom: 16, thresholdZoom: 8 })).toBe(0);
  });

  it('keeps grid lines one screen pixel wide as scene zoom changes', () => {
    expect(getViewportPixelGridStyle(8).backgroundImage).toContain('0.125px');
    expect(getViewportPixelGridStyle(16).backgroundImage).toContain('0.0625px');
    expect(getViewportPixelGridStyle(8).mixBlendMode).toBe('difference');
  });

  it('includes stabilization magnification in the displayed pixel scale', () => {
    expect(getEffectiveViewportPixelZoom(4, 2)).toBe(8);
    expect(getEffectiveViewportPixelZoom(8, 0.5)).toBe(4);
    expect(getEffectiveViewportPixelZoom(8, Number.NaN)).toBe(8);
  });

  it('applies the eased visibility to the grid opacity', () => {
    expect(getViewportPixelGridStyle(8, 0).opacity).toBe(0);
    expect(getViewportPixelGridStyle(8, 0.5).opacity).toBe(0.05);
    expect(getViewportPixelGridStyle(8, 1).opacity).toBe(0.1);
  });
});
