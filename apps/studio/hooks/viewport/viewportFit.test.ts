import { describe, expect, it } from 'vitest';
import { calculateViewportFitTarget, normalizeViewportInsets } from './viewportFit';

describe('calculateViewportFitTarget', () => {
  it('fits a scene within the full viewport when no app panels are present', () => {
    const target = calculateViewportFitTarget({
      viewportSize: { width: 1600, height: 1000 },
      sceneSize: { width: 800, height: 600 },
    });

    expect(target.zoom).toBeCloseTo(1.5);
    expect(target.pan).toEqual({ x: 0, y: 0 });
  });

  it('centers the scene inside the viewport area remaining after the Flow panel', () => {
    const target = calculateViewportFitTarget({
      viewportSize: { width: 1600, height: 1000 },
      sceneSize: { width: 800, height: 600 },
      insets: { left: 400 },
    });

    expect(target.zoom).toBeCloseTo(1.35);
    expect(target.pan).toEqual({ x: 200, y: 0 });
  });

  it('centers and scales the scene above the Timeline panel', () => {
    const target = calculateViewportFitTarget({
      viewportSize: { width: 1600, height: 1000 },
      sceneSize: { width: 800, height: 600 },
      insets: { bottom: 240 },
    });

    expect(target.zoom).toBeCloseTo(1.14);
    expect(target.pan).toEqual({ x: 0, y: 120 });
  });

  it('balances app panels on all sides when calculating fit pan', () => {
    const target = calculateViewportFitTarget({
      viewportSize: { width: 1600, height: 1000 },
      sceneSize: { width: 800, height: 600 },
      insets: { top: 40, right: 100, bottom: 240, left: 400 },
    });

    expect(target.zoom).toBeCloseTo(1.08);
    expect(target.pan).toEqual({ x: 150, y: 100 });
  });

  it('can fill a viewport exactly for compare presentation', () => {
    const target = calculateViewportFitTarget({
      viewportSize: { width: 600, height: 600 },
      sceneSize: { width: 1920, height: 1080 },
      mode: 'fill',
      paddingScale: 1,
    });

    expect(target.zoom).toBeCloseTo(5 / 9);
    expect(target.pan).toEqual({ x: 0, y: 0 });
  });

  it('uses native 1:1 scale for a Compare None preset', () => {
    const target = calculateViewportFitTarget({
      viewportSize: { width: 600, height: 600 },
      sceneSize: { width: 1920, height: 1080 },
      mode: 'none',
      paddingScale: 1,
    });

    expect(target.zoom).toBe(1);
    expect(target.pan).toEqual({ x: 0, y: 0 });
  });
});

describe('normalizeViewportInsets', () => {
  it('drops negative and non-finite values', () => {
    expect(
      normalizeViewportInsets({
        top: -10,
        right: Number.NaN,
        bottom: Number.POSITIVE_INFINITY,
        left: 80,
      }),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 80 });
  });
});
