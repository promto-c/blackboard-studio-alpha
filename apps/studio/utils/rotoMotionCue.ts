import type { RotoMotionCueScope, RotoPointType } from '@blackboard/types';
import {
  generateBSplineSegments,
  sampleBSplinePoints,
  sampleBSplineScalars,
} from '@/utils/bspline';
import { hasCustomRotoPointTypes } from '@/utils/rotoPointTypes';
import type { RotoPointWeightMode } from '@/utils/rotoPointWeights';

export type ResolvedPoint = { x: number; y: number };

export interface HeatlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface GradientTrailStyle {
  stroke: string;
  opacity: number;
}

export const MIN_ROTO_MOTION_TRAIL_FRAMES = 1;
export const MAX_ROTO_MOTION_TRAIL_FRAMES = 8;

const PAST_TRAIL_COLOR: [number, number, number] = [59, 130, 246];
const CURRENT_TRAIL_COLOR: [number, number, number] = [250, 204, 21];
const FUTURE_TRAIL_COLOR: [number, number, number] = [217, 70, 239];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpRgb = (
  start: [number, number, number],
  end: [number, number, number],
  t: number,
): [number, number, number] => [
  Math.round(lerp(start[0], end[0], t)),
  Math.round(lerp(start[1], end[1], t)),
  Math.round(lerp(start[2], end[2], t)),
];

const rgbToCss = ([r, g, b]: [number, number, number]): string => `rgb(${r}, ${g}, ${b})`;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
};

const evaluateBezierPoint = (
  start: ResolvedPoint,
  c1: ResolvedPoint,
  c2: ResolvedPoint,
  end: ResolvedPoint,
  t: number,
): ResolvedPoint => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x: mt2 * mt * start.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t2 * t * end.x,
    y: mt2 * mt * start.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t2 * t * end.y,
  };
};

const estimateBezierLength = (
  start: ResolvedPoint,
  c1: ResolvedPoint,
  c2: ResolvedPoint,
  end: ResolvedPoint,
): number =>
  Math.hypot(c1.x - start.x, c1.y - start.y) +
  Math.hypot(c2.x - c1.x, c2.y - c1.y) +
  Math.hypot(end.x - c2.x, end.y - c2.y);

export const clampRotoMotionTrailFrames = (value: number): number =>
  Math.max(MIN_ROTO_MOTION_TRAIL_FRAMES, Math.min(MAX_ROTO_MOTION_TRAIL_FRAMES, Math.round(value)));

export const getMotionCueTargetPathIds = (
  pathIds: string[],
  selectedPathIds: string[],
  scope: RotoMotionCueScope,
): string[] => {
  if (scope === 'all') {
    return [...pathIds];
  }

  const available = new Set(pathIds);
  return selectedPathIds.filter(
    (id, index) => available.has(id) && selectedPathIds.indexOf(id) === index,
  );
};

export const getGradientTrailStyle = (offset: number, windowSize: number): GradientTrailStyle => {
  const safeWindow = Math.max(MIN_ROTO_MOTION_TRAIL_FRAMES, windowSize);
  const normalized = clamp01((offset + safeWindow) / (safeWindow * 2));

  const color =
    normalized <= 0.5
      ? lerpRgb(PAST_TRAIL_COLOR, CURRENT_TRAIL_COLOR, normalized * 2)
      : lerpRgb(CURRENT_TRAIL_COLOR, FUTURE_TRAIL_COLOR, (normalized - 0.5) * 2);

  const distance = Math.abs(offset) / safeWindow;
  const opacity = offset === 0 ? 0.95 : Math.max(0.12, 0.18 + (1 - distance) * 0.65);

  return {
    stroke: rgbToCss(color),
    opacity,
  };
};

export const computeCentralDifferenceSpeeds = (
  previousPoints: ResolvedPoint[],
  nextPoints: ResolvedPoint[],
): number[] => {
  const pointCount = Math.min(previousPoints.length, nextPoints.length);
  const speeds: number[] = [];

  for (let i = 0; i < pointCount; i++) {
    const dx = (nextPoints[i].x - previousPoints[i].x) * 0.5;
    const dy = (nextPoints[i].y - previousPoints[i].y) * 0.5;
    speeds.push(Math.hypot(dx, dy));
  }

  return speeds;
};

export const normalizeSpeeds = (speeds: number[], floor = 0.35): number[] => {
  const finiteSpeeds = speeds.filter((value) => Number.isFinite(value) && value >= 0);
  if (finiteSpeeds.length === 0) {
    return speeds.map(() => 0);
  }

  const p90 = percentile(finiteSpeeds, 0.9);
  const scale = Math.max(floor, p90);

  return speeds.map((speed) => {
    if (!Number.isFinite(speed) || speed <= 0) return 0;
    return clamp01(speed / scale);
  });
};

export const getSpeedHeatColor = (normalizedSpeed: number, alpha = 0.92): string => {
  const t = clamp01(normalizedSpeed);
  const hue = lerp(215, 0, t);
  const lightness = lerp(58, 50, t);
  return `hsla(${hue.toFixed(1)}, 92%, ${lightness.toFixed(1)}%, ${alpha})`;
};

export const buildPolygonHeatlineSegments = (
  points: ResolvedPoint[],
  normalizedSpeeds: number[],
  closed: boolean,
  alpha = 0.92,
): HeatlineSegment[] => {
  if (points.length < 2) return [];

  const segmentCount = closed ? points.length : points.length - 1;
  const segments: HeatlineSegment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const nextIndex = (i + 1) % points.length;
    const speedA = normalizedSpeeds[i] ?? 0;
    const speedB = normalizedSpeeds[nextIndex] ?? speedA;
    const color = getSpeedHeatColor((speedA + speedB) * 0.5, alpha);

    segments.push({
      x1: points[i].x,
      y1: points[i].y,
      x2: points[nextIndex].x,
      y2: points[nextIndex].y,
      color,
    });
  }

  return segments;
};

export const buildBSplineHeatlineSegments = (
  points: ResolvedPoint[],
  normalizedSpeeds: number[],
  closed: boolean,
  maxSegments = 96,
  alpha = 0.92,
  pointWeights?: readonly number[],
  pointWeightMode?: RotoPointWeightMode,
  pointTypes?: readonly RotoPointType[],
  pointWeightModes?: readonly (RotoPointWeightMode | null)[],
): HeatlineSegment[] => {
  if (points.length < 3) {
    return buildPolygonHeatlineSegments(points, normalizedSpeeds, closed, alpha);
  }

  if (
    pointWeights?.some((weight) => Math.abs((weight ?? 1) - 1) > 1e-4) ||
    hasCustomRotoPointTypes(pointTypes, points.length)
  ) {
    const samplesPerSegment = Math.max(
      2,
      Math.round(
        Math.max(16, Math.min(maxSegments, points.length * 16)) / Math.max(1, points.length),
      ),
    );
    const sampledPoints = sampleBSplinePoints(
      points,
      closed,
      pointWeights,
      samplesPerSegment,
      pointWeightMode,
      pointTypes,
      pointWeightModes,
    );
    const sampledSpeeds = sampleBSplineScalars(
      normalizedSpeeds,
      closed,
      pointWeights,
      samplesPerSegment,
      pointWeightMode,
      pointTypes,
      pointWeightModes,
    );

    const segmentCount = Math.min(sampledPoints.length, sampledSpeeds.length);
    const segments: HeatlineSegment[] = [];

    for (let index = 1; index < segmentCount; index += 1) {
      const speedA = sampledSpeeds[index - 1] ?? 0;
      const speedB = sampledSpeeds[index] ?? speedA;
      segments.push({
        x1: sampledPoints[index - 1].x,
        y1: sampledPoints[index - 1].y,
        x2: sampledPoints[index].x,
        y2: sampledPoints[index].y,
        color: getSpeedHeatColor((speedA + speedB) * 0.5, alpha),
      });
    }

    return segments;
  }

  const bezierSegments = generateBSplineSegments(points, closed);
  if (bezierSegments.length === 0) return [];

  const pointCount = points.length;
  const segmentBudget = Math.max(16, Math.min(maxSegments, pointCount * 16));
  const estimatedLengths = bezierSegments.map((segment) =>
    estimateBezierLength(segment.start, segment.c1, segment.c2, segment.end),
  );
  const totalEstimatedLength = estimatedLengths.reduce((sum, length) => sum + length, 0);

  const segments: HeatlineSegment[] = [];

  bezierSegments.forEach((segment, segmentIndex) => {
    const lengthWeight =
      totalEstimatedLength > 0
        ? estimatedLengths[segmentIndex] / totalEstimatedLength
        : 1 / bezierSegments.length;
    const samples = Math.max(2, Math.round(lengthWeight * segmentBudget));

    const speedStart = normalizedSpeeds[segmentIndex] ?? 0;
    const speedEndIndex = closed
      ? (segmentIndex + 1) % pointCount
      : Math.min(segmentIndex + 1, pointCount - 1);
    const speedEnd = normalizedSpeeds[speedEndIndex] ?? speedStart;

    let previousPoint = evaluateBezierPoint(segment.start, segment.c1, segment.c2, segment.end, 0);

    for (let sample = 1; sample <= samples; sample++) {
      const t = sample / samples;
      const currentPoint = evaluateBezierPoint(
        segment.start,
        segment.c1,
        segment.c2,
        segment.end,
        t,
      );

      const speedT = (sample - 0.5) / samples;
      const normalizedSpeed = lerp(speedStart, speedEnd, speedT);
      const color = getSpeedHeatColor(normalizedSpeed, alpha);

      segments.push({
        x1: previousPoint.x,
        y1: previousPoint.y,
        x2: currentPoint.x,
        y2: currentPoint.y,
        color,
      });

      previousPoint = currentPoint;
    }
  });

  return segments;
};
