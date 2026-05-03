import { describe, expect, it } from 'vitest';
import {
  applyRotoTransform,
  getRotoTransformBounds,
  getTransformOperationForHandle,
} from './rotoTransform';

describe('rotoTransform', () => {
  it('maps Alt corners to perspective and Ctrl/Cmd corners to bilinear', () => {
    expect(getTransformOperationForHandle('nw', true, false)).toBe('bilinear');
    expect(getTransformOperationForHandle('ne', true, false)).toBe('bilinear');
    expect(getTransformOperationForHandle('nw', false, true)).toBe('perspective');
    expect(getTransformOperationForHandle('e', true, false)).toBe('scale_shear');
    expect(getTransformOperationForHandle('nw', false, false)).toBe('scale');
  });

  it('keeps the other three bbox corners fixed during perspective corner drags', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 50, y: 50 },
    ];
    const bounds = getRotoTransformBounds(points);

    expect(bounds).not.toBeNull();

    const transformed = applyRotoTransform({
      operation: 'perspective',
      handle: 'nw',
      points,
      bounds: bounds!,
      startMouse: { x: 0, y: 0 },
      currentMouse: { x: -20, y: -10 },
    });

    expect(transformed[0].x).toBeCloseTo(-20, 6);
    expect(transformed[0].y).toBeCloseTo(-10, 6);
    expect(transformed[1].x).toBeCloseTo(100, 6);
    expect(transformed[1].y).toBeCloseTo(0, 6);
    expect(transformed[2].x).toBeCloseTo(100, 6);
    expect(transformed[2].y).toBeCloseTo(100, 6);
    expect(transformed[3].x).toBeCloseTo(0, 6);
    expect(transformed[3].y).toBeCloseTo(100, 6);

    expect(Number.isFinite(transformed[4].x)).toBe(true);
    expect(Number.isFinite(transformed[4].y)).toBe(true);
    expect(transformed[4].x).not.toBeCloseTo(50, 6);
    expect(transformed[4].y).not.toBeCloseTo(50, 6);
  });

  it('uses a bilinear interior warp for Ctrl/Cmd corner drags', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 50, y: 50 },
    ];
    const bounds = getRotoTransformBounds(points);

    expect(bounds).not.toBeNull();

    const transformed = applyRotoTransform({
      operation: 'bilinear',
      handle: 'nw',
      points,
      bounds: bounds!,
      startMouse: { x: 0, y: 0 },
      currentMouse: { x: -20, y: -10 },
    });

    expect(transformed[0].x).toBeCloseTo(-20, 6);
    expect(transformed[0].y).toBeCloseTo(-10, 6);
    expect(transformed[1].x).toBeCloseTo(100, 6);
    expect(transformed[1].y).toBeCloseTo(0, 6);
    expect(transformed[2].x).toBeCloseTo(100, 6);
    expect(transformed[2].y).toBeCloseTo(100, 6);
    expect(transformed[3].x).toBeCloseTo(0, 6);
    expect(transformed[3].y).toBeCloseTo(100, 6);
    expect(transformed[4].x).toBeCloseTo(45, 6);
    expect(transformed[4].y).toBeCloseTo(47.5, 6);
  });

  it('keeps the dragged edge handle under the cursor for affine edge drags', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 50, y: 0 },
    ];
    const bounds = getRotoTransformBounds(points);

    expect(bounds).not.toBeNull();

    const transformed = applyRotoTransform({
      operation: 'scale_shear',
      handle: 'n',
      points,
      bounds: bounds!,
      startMouse: { x: 50, y: 0 },
      currentMouse: { x: 80, y: 20 },
    });

    expect(transformed[4].x).toBeCloseTo(80, 6);
    expect(transformed[4].y).toBeCloseTo(20, 6);
    expect(transformed[2].x).toBeCloseTo(100, 6);
    expect(transformed[2].y).toBeCloseTo(100, 6);
    expect(transformed[3].x).toBeCloseTo(0, 6);
    expect(transformed[3].y).toBeCloseTo(100, 6);
  });
});
