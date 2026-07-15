import { describe, expect, it } from 'vitest';
import { PaintStrokeSession } from './paintStrokeSession';

describe('PaintStrokeSession', () => {
  it('never rewrites the finalized prefix while new input extends the tail', () => {
    const session = new PaintStrokeSession({ x: 0, y: 0 }, 0, {
      brushSize: 20,
      stabilization: 0,
    });
    const first = session.add({ x: 20, y: 0 }, 16);
    const second = session.add({ x: 40, y: 0 }, 32);
    const finalizedEndIndex = first.points.findIndex(
      (point) => Math.abs(point.x - 10) < 0.0001 && Math.abs(point.y) < 0.0001,
    );

    expect(first.mode).toBe('polyline');
    expect(second.mode).toBe(first.mode);
    expect(finalizedEndIndex).toBeGreaterThan(0);
    expect(second.points.slice(0, finalizedEndIndex + 1)).toEqual(
      first.points.slice(0, finalizedEndIndex + 1),
    );
  });

  it('curves and sub-samples sparse fast direction changes instead of joining hard chords', () => {
    const session = new PaintStrokeSession({ x: 0, y: 0 }, 0, {
      brushSize: 20,
      stabilization: 0,
    });
    session.add({ x: 100, y: 0 }, 8);
    const path = session.add({ x: 100, y: 100 }, 16);
    const largestGap = path.points.slice(1).reduce((largest, point, index) => {
      const previous = path.points[index];
      return Math.max(largest, Math.hypot(point.x - previous.x, point.y - previous.y));
    }, 0);

    expect(path.points.length).toBeGreaterThan(100);
    expect(largestGap).toBeLessThanOrEqual(1.6);
    expect(
      path.points.some((point) => point.x > 55 && point.x < 99 && point.y > 1 && point.y < 49),
    ).toBe(true);
  });

  it('suppresses slow input jitter without clamping the path coordinates', () => {
    const session = new PaintStrokeSession({ x: 0, y: 0 }, 0, {
      brushSize: 24,
      stabilization: 70,
    });
    const path = session.add({ x: 1, y: 4 }, 16);
    const tail = path.points[path.points.length - 1];

    expect(tail.x).toBeGreaterThan(0);
    expect(tail.y).toBeGreaterThan(0);
    expect(tail.y).toBeLessThan(4);
  });

  it('finishes at the exact pointer position and returns that same path thereafter', () => {
    const session = new PaintStrokeSession({ x: 0, y: 0 }, 0, {
      brushSize: 24,
      stabilization: 50,
    });
    session.add({ x: 15, y: 2 }, 16);
    const finished = session.finish({ x: 25, y: 3 }, 32);

    expect(finished.points.at(-1)).toEqual({ x: 25, y: 3 });
    expect(session.getPath()).toEqual(finished);
  });

  it('bypasses filtering completely at zero stabilization', () => {
    const session = new PaintStrokeSession({ x: 0, y: 0 }, 0, {
      brushSize: 24,
      stabilization: 0,
    });
    const path = session.add({ x: 3, y: -8 }, 16);

    expect(path.points.at(-1)).toEqual({ x: 3, y: -8 });
  });
});
