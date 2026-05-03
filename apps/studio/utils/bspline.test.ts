import { describe, expect, it } from 'vitest';
import type { RotoPointWeightMode } from '@blackboard/types';
import {
  drawBSplineOnCanvas,
  generateBSplinePath,
  generateBSplineSegments,
  sampleBSplinePoints,
} from './bspline';

describe('bspline utilities', () => {
  const includesPoint = (
    sampledPoints: Array<{ x: number; y: number }>,
    target: { x: number; y: number },
  ): boolean =>
    sampledPoints.some(
      (point) => Math.abs(point.x - target.x) < 1e-6 && Math.abs(point.y - target.y) < 1e-6,
    );

  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 4 },
    { x: 22, y: 14 },
    { x: 32, y: 8 },
  ];

  it('clamps open spline segments to the first and last point', () => {
    const segments = generateBSplineSegments(points, false);

    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.start).toEqual(points[0]);
    expect(segments.at(-1)?.end).toEqual(points.at(-1));
  });

  it('emits open spline svg paths that start and end on the clicked endpoints', () => {
    const path = generateBSplinePath(points, false);

    expect(path.startsWith('M 0,0')).toBe(true);
    expect(path.endsWith('32,8')).toBe(true);
  });

  it('draws open spline canvas paths from the first point to the last point', () => {
    const calls: Array<{ type: 'moveTo' | 'bezierCurveTo'; args: number[] }> = [];
    const ctx = {
      moveTo: (...args: number[]) => calls.push({ type: 'moveTo', args }),
      bezierCurveTo: (...args: number[]) => calls.push({ type: 'bezierCurveTo', args }),
      lineTo: () => undefined,
    } as unknown as CanvasRenderingContext2D;

    drawBSplineOnCanvas(ctx, points, false);

    expect(calls[0]).toEqual({ type: 'moveTo', args: [points[0].x, points[0].y] });
    expect(calls.at(-1)).toEqual({ type: 'bezierCurveTo', args: [32, 8, 32, 8, 32, 8] });
  });

  it('keeps closed spline generation closed', () => {
    const segments = generateBSplineSegments(points, true);
    const path = generateBSplinePath(points, true);

    expect(segments).toHaveLength(points.length);
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('pulls the curve toward heavier weighted points', () => {
    const unweightedPoints = sampleBSplinePoints(points, false);
    const weightedPoints = sampleBSplinePoints(points, false, [1, 1, 4, 1]);
    const midpointIndex = Math.floor(Math.min(unweightedPoints.length, weightedPoints.length) / 2);
    const weightedPath = generateBSplinePath(points, false, [1, 1, 4, 1]);

    expect(weightedPoints[midpointIndex].y).toBeGreaterThan(unweightedPoints[midpointIndex].y);
    expect(weightedPath.startsWith('M 0 0')).toBe(true);
    expect(weightedPath.endsWith('32 8')).toBe(true);
  });

  it('keeps local point weights confined to the adjacent spans', () => {
    const extendedPoints = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 20, y: 14 },
      { x: 30, y: 4 },
      { x: 40, y: 2 },
      { x: 50, y: 0 },
    ];
    const unweightedPoints = sampleBSplinePoints(extendedPoints, false, undefined, 4);
    const localWeightedPoints = sampleBSplinePoints(
      extendedPoints,
      false,
      [1, 1, 4, 1, 1, 1],
      4,
      'local',
    );

    expect(localWeightedPoints[8]).toEqual(unweightedPoints[8]);
    expect(localWeightedPoints[11].y).toBeGreaterThan(unweightedPoints[11].y);
    expect(localWeightedPoints[20]).toEqual(unweightedPoints[20]);
  });

  it('lets per-point local pull override a full-pull default', () => {
    const extendedPoints = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 20, y: 14 },
      { x: 30, y: 4 },
      { x: 40, y: 2 },
      { x: 50, y: 0 },
    ];
    const defaultLocalPoints = sampleBSplinePoints(
      extendedPoints,
      false,
      [1, 1, 4, 1, 1, 1],
      4,
      'local',
    );
    const explicitLocalPoints = sampleBSplinePoints(
      extendedPoints,
      false,
      [1, 1, 4, 1, 1, 1],
      4,
      'global',
      undefined,
      [null, null, 'local', null, null, null] as Array<RotoPointWeightMode | null>,
    );

    expect(explicitLocalPoints).toEqual(defaultLocalPoints);
  });

  it('lets per-point full pull override a local-pull default', () => {
    const extendedPoints = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 20, y: 14 },
      { x: 30, y: 4 },
      { x: 40, y: 2 },
      { x: 50, y: 0 },
    ];
    const defaultFullPoints = sampleBSplinePoints(
      extendedPoints,
      false,
      [1, 1, 4, 1, 1, 1],
      4,
      'global',
    );
    const explicitFullPoints = sampleBSplinePoints(
      extendedPoints,
      false,
      [1, 1, 4, 1, 1, 1],
      4,
      'local',
      undefined,
      [null, null, 'global', null, null, null] as Array<RotoPointWeightMode | null>,
    );

    expect(explicitFullPoints).toEqual(defaultFullPoints);
  });

  it('lets cardinal point types interpolate a point without affecting distant spans', () => {
    const extendedPoints = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 20, y: 14 },
      { x: 30, y: 4 },
      { x: 40, y: 2 },
      { x: 50, y: 0 },
    ];
    const defaultPoints = sampleBSplinePoints(extendedPoints, false, undefined, 4);
    const cardinalPoints = sampleBSplinePoints(extendedPoints, false, undefined, 4, 'global', [
      'bspline',
      'bspline',
      'cardinal',
      'bspline',
      'bspline',
      'bspline',
    ]);

    expect(includesPoint(defaultPoints, extendedPoints[2])).toBe(false);
    expect(includesPoint(cardinalPoints, extendedPoints[2])).toBe(true);
    expect(cardinalPoints[8]).toEqual(defaultPoints[8]);
    expect(cardinalPoints[11]).not.toEqual(defaultPoints[11]);
    expect(cardinalPoints[20]).toEqual(defaultPoints[20]);
  });

  it('lets corner point types hit the exact control point', () => {
    const cornerPoints = [
      { x: 0, y: 0 },
      { x: 12, y: 16 },
      { x: 24, y: 0 },
      { x: 36, y: 10 },
    ];
    const sampledCornerPoints = sampleBSplinePoints(cornerPoints, false, undefined, 6, 'global', [
      'bspline',
      'corner',
      'bspline',
      'bspline',
    ]);

    expect(includesPoint(sampledCornerPoints, cornerPoints[1])).toBe(true);
  });
});
