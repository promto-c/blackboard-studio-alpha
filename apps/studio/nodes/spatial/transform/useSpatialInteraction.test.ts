import { describe, expect, it } from 'vitest';
import { movePivotPreservingView, type SpatialDragValues } from './useSpatialInteraction';

const transformPoint = (values: SpatialDragValues, point: { x: number; y: number }) => {
  const radians = (values.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaledX = (point.x - values.pivotX) * values.scaleX;
  const scaledY = (point.y + values.pivotY) * values.scaleY;
  const rotatedX = cos * scaledX - sin * scaledY;
  const rotatedY = sin * scaledX + cos * scaledY;

  return {
    x: rotatedX + values.translateX + values.pivotX,
    y: rotatedY - values.translateY - values.pivotY,
  };
};

describe('movePivotPreservingView', () => {
  it('moves the pivot while keeping transformed points stationary', () => {
    const values: SpatialDragValues = {
      translateX: 25,
      translateY: -12,
      scaleX: 1.8,
      scaleY: 0.65,
      rotation: 32,
      pivotX: 14,
      pivotY: -9,
    };
    const point = { x: 120, y: -48 };

    const before = transformPoint(values, point);
    const afterValues = movePivotPreservingView(values, 18, -11);
    const after = transformPoint(afterValues, point);

    expect(afterValues.pivotX).toBe(32);
    expect(afterValues.pivotY).toBe(-20);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });
});
