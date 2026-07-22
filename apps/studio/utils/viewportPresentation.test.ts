import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createViewportPresentation } from './viewportPresentation';

describe('viewport presentation', () => {
  it('projects a row-major 2D homography into the GPU Matrix3 uniform', () => {
    const presentation = createViewportPresentation(
      [
        [2, 3, 0, 4],
        [5, 6, 0, 7],
        [0, 0, 1, 0],
        [8, 9, 0, 10],
      ],
      'nearest',
      {
        size: { width: 801.4, height: 599.6 },
        zoom: 1,
        pan: { x: 0, y: 0 },
        pixelGrid: { opacity: 0.1, thresholdZoom: 8, fadeZoomSpan: 1 },
      },
    );

    expect(presentation?.inverseTransform.elements).toEqual([2, 5, 8, 3, 6, 9, 4, 7, 10]);
    expect(presentation?.destinationSize).toEqual({ width: 801, height: 600 });
    expect(presentation?.interpolation).toBe('nearest');
    expect(presentation?.pixelGrid).toEqual({
      opacity: 0.1,
      thresholdZoom: 8,
      fadeZoomSpan: 1,
    });
  });

  it('composes inverse viewport pan and zoom before inverse stabilization', () => {
    const presentation = createViewportPresentation(
      [
        [1, 0, 0, -5],
        [0, 1, 0, 7],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      'linear',
      { size: { width: 640, height: 480 }, zoom: 4, pan: { x: 20, y: 12 } },
    );

    const source = new THREE.Vector3(100, 40, 1).applyMatrix3(presentation!.inverseTransform);
    expect(source.x).toBeCloseTo(15);
    expect(source.y).toBeCloseTo(20);
  });

  it('does not create a GPU presentation without stabilization', () => {
    expect(
      createViewportPresentation(null, 'linear', {
        size: { width: 640, height: 480 },
        zoom: 1,
        pan: { x: 0, y: 0 },
      }),
    ).toBeUndefined();
  });
});
