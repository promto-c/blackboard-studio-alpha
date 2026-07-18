import { describe, expect, it } from 'vitest';
import {
  calculateCompareLeadingViewProjection,
  calculateComparePaneLayout,
  calculateComparePresentationScale,
  calculateComparePresetTarget,
  calculateCompareViewportFrame,
} from './comparePresentation';

describe('compare presentation sizing', () => {
  const squarePane = { width: 600, height: 600 };
  const widescreenDisplay = { width: 1920, height: 1080 };

  it('fits the complete native display window and centers the letterbox', () => {
    expect(calculateComparePresentationScale(squarePane, widescreenDisplay, 'fit')).toBeCloseTo(
      0.3125,
    );
    expect(
      calculateCompareViewportFrame({ x: 0, y: 0, ...squarePane }, widescreenDisplay, 'fit'),
    ).toEqual({ x: 0, y: 131.25, width: 600, height: 337.5, scale: 0.3125 });
  });

  it('fills the pane and centers the cropped overflow', () => {
    const frame = calculateCompareViewportFrame(
      { x: 0, y: 0, ...squarePane },
      widescreenDisplay,
      'fill',
    );

    expect(frame.scale).toBeCloseTo(5 / 9);
    expect(frame.x).toBeCloseTo(-700 / 3);
    expect(frame.y).toBe(0);
    expect(frame.width).toBeCloseTo(3200 / 3);
    expect(frame.height).toBe(600);
  });

  it('calculates each pane from its own native display-window aspect ratio', () => {
    const pane = { width: 640, height: 720 };

    expect(calculateComparePresentationScale(pane, widescreenDisplay, 'fit')).toBeCloseTo(1 / 3);
    expect(
      calculateComparePresentationScale(pane, { width: 1080, height: 1920 }, 'fit'),
    ).toBeCloseTo(0.375);
  });

  it('keeps native pixels unscaled and centers them in None mode', () => {
    expect(
      calculateCompareViewportFrame({ x: 0, y: 0, ...squarePane }, widescreenDisplay, 'none'),
    ).toEqual({ x: -660, y: -240, width: 1920, height: 1080, scale: 1 });
  });

  it('positions presentation frames in viewport space with editor pan conventions', () => {
    expect(
      calculateCompareViewportFrame(
        { x: 200, y: 100, width: 600, height: 600 },
        widescreenDisplay,
        'fit',
        { scaleMultiplier: 2, pan: { x: 30, y: 20 } },
      ),
    ).toEqual({
      x: -70,
      y: 42.5,
      width: 1200,
      height: 675,
      scale: 0.625,
    });
  });

  it('uses the same canonical pane for the Fit target and presentation', () => {
    const layout = calculateComparePaneLayout({
      viewportSize: { width: 1280, height: 720 },
      interactiveRect: { x: 160, y: 90, width: 960, height: 540 },
      mode: 'wipe',
      orientation: 'vertical',
      sidesSwapped: false,
    });

    expect(calculateComparePresetTarget(layout, widescreenDisplay, 'fit')).toEqual({
      zoom: 0.5,
      pan: { x: 0, y: 0 },
    });
  });

  it('targets slot A in its actual split pane after swapping sides', () => {
    const layout = calculateComparePaneLayout({
      viewportSize: { width: 1281, height: 720 },
      interactiveRect: { x: 160, y: 90, width: 961, height: 540 },
      mode: 'split',
      orientation: 'vertical',
      sidesSwapped: true,
    });
    const target = calculateComparePresetTarget(layout, widescreenDisplay, 'fit');

    expect(layout.slotAPane).toBe(layout.trailingPane);
    expect(layout.slotAVisualPane).toEqual({ x: 640, y: 0, width: 641, height: 720 });
    expect(target.zoom).toBeCloseTo(481 / 1920);
    expect(target.pan).toEqual({ x: 0, y: 0 });
  });

  it('projects overlays from the leading side after the compared slots are swapped', () => {
    const viewportSize = { width: 1280, height: 720 };
    const layout = calculateComparePaneLayout({
      viewportSize,
      interactiveRect: { x: 160, y: 90, width: 960, height: 540 },
      mode: 'split',
      orientation: 'vertical',
      sidesSwapped: true,
    });
    const projection = calculateCompareLeadingViewProjection({
      viewportSize,
      layout,
      slotASize: widescreenDisplay,
      leadingSize: { width: 1080, height: 1920 },
      sizingMode: 'fit',
      zoom: 0.25,
      pan: { x: 0, y: 0 },
    });

    expect(projection.frame).toEqual({
      x: 248.125,
      y: 90,
      width: 303.75,
      height: 540,
      scale: 0.28125,
    });
    expect(projection.clipRect).toEqual({ x: 0, y: 0, width: 640, height: 720 });
    expect(projection.overlayPan).toEqual({ x: -240, y: 0 });
  });

  it('uses a stable fallback for unusable dimensions', () => {
    expect(
      calculateComparePresentationScale({ width: 0, height: 600 }, widescreenDisplay, 'fit'),
    ).toBe(1);
  });
});
