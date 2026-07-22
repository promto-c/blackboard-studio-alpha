import { describe, expect, it } from 'vitest';
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, getZoomedCanvasViewport } from './useCanvasViewport';

describe('getZoomedCanvasViewport', () => {
  it('keeps the graph point beneath the pointer fixed while zooming', () => {
    const focalPoint = { x: 300, y: 200 };
    const current = { panX: 100, panY: 50, zoom: 1 };
    const graphPoint = {
      x: (focalPoint.x - current.panX) / current.zoom,
      y: (focalPoint.y - current.panY) / current.zoom,
    };

    const next = getZoomedCanvasViewport(current, 2, focalPoint);

    expect(graphPoint.x * next.zoom + next.panX).toBe(focalPoint.x);
    expect(graphPoint.y * next.zoom + next.panY).toBe(focalPoint.y);
  });

  it('clamps zoom to the shared canvas limits', () => {
    const current = { panX: 0, panY: 0, zoom: 1 };
    const focalPoint = { x: 0, y: 0 };

    expect(getZoomedCanvasViewport(current, 0.01, focalPoint).zoom).toBe(CANVAS_MIN_ZOOM);
    expect(getZoomedCanvasViewport(current, 10, focalPoint).zoom).toBe(CANVAS_MAX_ZOOM);
  });
});
