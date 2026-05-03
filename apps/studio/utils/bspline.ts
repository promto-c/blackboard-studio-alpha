import type { RotoPointType } from '@blackboard/types';
import {
  DEFAULT_ROTO_POINT_WEIGHT_MODE,
  getNormalizedRotoPointWeightModes,
  type RotoPointWeightMode,
} from './rotoPointWeights';
import { getRotoPointType, hasCustomRotoPointTypes } from './rotoPointTypes';

type Point = {
  x: number;
  y: number;
};

type BezierSegment = {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
};

const addPoints = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

const subtractPoints = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

const scalePoint = (point: Point, scale: number): Point => ({
  x: point.x * scale,
  y: point.y * scale,
});

const DEFAULT_BSPLINE_WEIGHT = 1;
const BSPLINE_SAMPLE_STEPS = 24;
const CUSTOM_POINT_DERIVATIVE_EPSILON = 1e-3;
const CARDINAL_TANGENT_SCALE = 0.5;
const CORNER_TANGENT_SCALE = 0.5;

function bsplineSegmentToBezier(p0: Point, p1: Point, p2: Point, p3: Point): BezierSegment {
  return {
    start: {
      x: (p0.x + 4 * p1.x + p2.x) / 6,
      y: (p0.y + 4 * p1.y + p2.y) / 6,
    },
    c1: {
      x: (4 * p1.x + 2 * p2.x) / 6,
      y: (4 * p1.y + 2 * p2.y) / 6,
    },
    c2: {
      x: (2 * p1.x + 4 * p2.x) / 6,
      y: (2 * p1.y + 4 * p2.y) / 6,
    },
    end: {
      x: (p1.x + 4 * p2.x + p3.x) / 6,
      y: (p1.y + 4 * p2.y + p3.y) / 6,
    },
  };
}

const getNormalizedWeights = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
): number[] =>
  Array.from({ length: pointCount }, (_, index) => Math.max(0.001, pointWeights?.[index] ?? 1));

const hasCustomWeights = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
): boolean =>
  getNormalizedWeights(pointWeights, pointCount).some(
    (weight) => Math.abs(weight - DEFAULT_BSPLINE_WEIGHT) > 1e-4,
  );

const getPaddedBSplineControls = (
  points: Point[],
  closed: boolean,
  pointWeights?: readonly number[],
): { points: Point[]; weights: number[]; segmentCount: number } => {
  const n = points.length;
  const weights = getNormalizedWeights(pointWeights, n);

  if (closed) {
    return {
      points: [points[n - 1], ...points, points[0], points[1]],
      weights: [weights[n - 1], ...weights, weights[0], weights[1]],
      segmentCount: n,
    };
  }

  const paddedPoints = [points[0], points[0], ...points, points[n - 1], points[n - 1]];
  const paddedWeights = [weights[0], weights[0], ...weights, weights[n - 1], weights[n - 1]];

  return {
    points: paddedPoints,
    weights: paddedWeights,
    segmentCount: paddedPoints.length - 3,
  };
};

const evaluateCubicBSplineBasis = (u: number): [number, number, number, number] => {
  const u2 = u * u;
  const u3 = u2 * u;

  return [
    (1 - 3 * u + 3 * u2 - u3) / 6,
    (4 - 6 * u2 + 3 * u3) / 6,
    (1 + 3 * u + 3 * u2 - 3 * u3) / 6,
    u3 / 6,
  ];
};

const evaluateWeightedPoint = (
  points: readonly Point[],
  weights: readonly number[],
  segmentIndex: number,
  u: number,
): Point => {
  const basis = evaluateCubicBSplineBasis(u);
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;

  for (let offset = 0; offset < 4; offset += 1) {
    const basisWeight = basis[offset] * weights[segmentIndex + offset];
    weightedX += points[segmentIndex + offset].x * basisWeight;
    weightedY += points[segmentIndex + offset].y * basisWeight;
    totalWeight += basisWeight;
  }

  if (totalWeight <= 1e-6) {
    const fallbackPoint = points[segmentIndex + 1] ?? points[segmentIndex] ?? { x: 0, y: 0 };
    return { x: fallbackPoint.x, y: fallbackPoint.y };
  }

  return {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight,
  };
};

const evaluateWeightedScalar = (
  values: readonly number[],
  weights: readonly number[],
  segmentIndex: number,
  u: number,
): number => {
  const basis = evaluateCubicBSplineBasis(u);
  let weightedValue = 0;
  let totalWeight = 0;

  for (let offset = 0; offset < 4; offset += 1) {
    const basisWeight = basis[offset] * weights[segmentIndex + offset];
    weightedValue += values[segmentIndex + offset] * basisWeight;
    totalWeight += basisWeight;
  }

  if (totalWeight <= 1e-6) {
    return values[segmentIndex + 1] ?? values[segmentIndex] ?? 0;
  }

  return weightedValue / totalWeight;
};

const evaluateUnweightedPoint = (
  points: readonly Point[],
  segmentIndex: number,
  u: number,
): Point => {
  const basis = evaluateCubicBSplineBasis(u);
  let x = 0;
  let y = 0;

  for (let offset = 0; offset < 4; offset += 1) {
    x += points[segmentIndex + offset].x * basis[offset];
    y += points[segmentIndex + offset].y * basis[offset];
  }

  return { x, y };
};

const smoothstep = (value: number): number => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

const getLocalWeightPull = (weight: number): number => {
  const safeWeight = Math.max(0.001, weight);
  return (safeWeight - DEFAULT_BSPLINE_WEIGHT) / (safeWeight + DEFAULT_BSPLINE_WEIGHT);
};

const evaluateLocalWeightDelta = (
  basePoint: Point,
  points: readonly Point[],
  weights: readonly number[],
  segmentIndex: number,
  u: number,
): Point => {
  const leftPoint = points[segmentIndex + 1] ?? points[segmentIndex] ?? basePoint;
  const rightPoint = points[segmentIndex + 2] ?? points[segmentIndex + 3] ?? basePoint;
  const rightMix = smoothstep(u);
  const leftMix = 1 - rightMix;
  const leftPull = getLocalWeightPull(weights[segmentIndex + 1] ?? DEFAULT_BSPLINE_WEIGHT);
  const rightPull = getLocalWeightPull(weights[segmentIndex + 2] ?? DEFAULT_BSPLINE_WEIGHT);

  return {
    x:
      (leftPoint.x - basePoint.x) * leftPull * leftMix +
      (rightPoint.x - basePoint.x) * rightPull * rightMix,
    y:
      (leftPoint.y - basePoint.y) * leftPull * leftMix +
      (rightPoint.y - basePoint.y) * rightPull * rightMix,
  };
};

const getPaddedScalarValues = (
  values: readonly number[],
  closed: boolean,
): { values: number[]; segmentCount: number } => {
  const pointCount = values.length;
  const normalizedValues = Array.from(
    { length: pointCount },
    (_, index) => values[index] ?? values[values.length - 1] ?? 0,
  );

  if (closed) {
    return {
      values: [
        normalizedValues[pointCount - 1],
        ...normalizedValues,
        normalizedValues[0],
        normalizedValues[1],
      ],
      segmentCount: pointCount,
    };
  }

  const paddedValues = [
    normalizedValues[0],
    normalizedValues[0],
    ...normalizedValues,
    normalizedValues[pointCount - 1],
    normalizedValues[pointCount - 1],
  ];

  return {
    values: paddedValues,
    segmentCount: paddedValues.length - 3,
  };
};

const evaluateLocalScalarDelta = (
  baseValue: number,
  values: readonly number[],
  weights: readonly number[],
  segmentIndex: number,
  u: number,
): number => {
  const leftValue = values[segmentIndex + 1] ?? values[segmentIndex] ?? baseValue;
  const rightValue = values[segmentIndex + 2] ?? values[segmentIndex + 3] ?? leftValue;
  const rightMix = smoothstep(u);
  const leftMix = 1 - rightMix;
  const leftPull = getLocalWeightPull(weights[segmentIndex + 1] ?? DEFAULT_BSPLINE_WEIGHT);
  const rightPull = getLocalWeightPull(weights[segmentIndex + 2] ?? DEFAULT_BSPLINE_WEIGHT);

  return (
    (leftValue - baseValue) * leftPull * leftMix + (rightValue - baseValue) * rightPull * rightMix
  );
};

const getResolvedPointWeightMode = (pointWeightMode?: RotoPointWeightMode): RotoPointWeightMode =>
  pointWeightMode ?? DEFAULT_ROTO_POINT_WEIGHT_MODE;

const getModePartitionedWeights = (
  normalizedWeights: readonly number[],
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
  defaultMode: RotoPointWeightMode,
): {
  globalWeights: number[];
  localWeights: number[];
  hasGlobalWeights: boolean;
  hasLocalWeights: boolean;
} => {
  const resolvedModes = getNormalizedRotoPointWeightModes(
    pointWeightModes,
    pointCount,
    defaultMode,
  );
  const globalWeights = normalizedWeights.map((weight, index) =>
    resolvedModes[index] === 'global' ? weight : DEFAULT_BSPLINE_WEIGHT,
  );
  const localWeights = normalizedWeights.map((weight, index) =>
    resolvedModes[index] === 'local' ? weight : DEFAULT_BSPLINE_WEIGHT,
  );

  return {
    globalWeights,
    localWeights,
    hasGlobalWeights: globalWeights.some(
      (weight) => Math.abs(weight - DEFAULT_BSPLINE_WEIGHT) > 1e-4,
    ),
    hasLocalWeights: localWeights.some(
      (weight) => Math.abs(weight - DEFAULT_BSPLINE_WEIGHT) > 1e-4,
    ),
  };
};

const getSegmentStartPointIndex = (
  segmentIndex: number,
  pointCount: number,
  closed: boolean,
): number =>
  closed
    ? ((segmentIndex % pointCount) + pointCount) % pointCount
    : Math.max(0, Math.min(pointCount - 1, segmentIndex - 1));

const getSegmentEndPointIndex = (
  segmentIndex: number,
  pointCount: number,
  closed: boolean,
): number =>
  closed
    ? (((segmentIndex + 1) % pointCount) + pointCount) % pointCount
    : Math.max(0, Math.min(pointCount - 1, segmentIndex));

const isTypedBoundaryEligible = (
  segmentIndex: number,
  pointCount: number,
  closed: boolean,
  boundary: 'start' | 'end',
): boolean => {
  if (closed) return true;

  const lastPointIndex = pointCount - 1;
  const lastSegmentIndex = pointCount;
  const pointIndex =
    boundary === 'start'
      ? getSegmentStartPointIndex(segmentIndex, pointCount, closed)
      : getSegmentEndPointIndex(segmentIndex, pointCount, closed);

  if (boundary === 'start') {
    return segmentIndex === 0 || (pointIndex > 0 && pointIndex < lastPointIndex);
  }

  return segmentIndex === lastSegmentIndex || (pointIndex > 0 && pointIndex < lastPointIndex);
};

const getPreviousPointIndex = (index: number, pointCount: number, closed: boolean): number =>
  closed ? (index - 1 + pointCount) % pointCount : Math.max(0, index - 1);

const getNextPointIndex = (index: number, pointCount: number, closed: boolean): number =>
  closed ? (index + 1) % pointCount : Math.min(pointCount - 1, index + 1);

const getCardinalPointTangent = (
  points: readonly Point[],
  pointIndex: number,
  closed: boolean,
): Point => {
  const pointCount = points.length;
  const previousPoint =
    points[getPreviousPointIndex(pointIndex, pointCount, closed)] ?? points[pointIndex];
  const nextPoint = points[getNextPointIndex(pointIndex, pointCount, closed)] ?? points[pointIndex];

  if (!closed && pointIndex === 0) {
    return scalePoint(
      subtractPoints(nextPoint, points[pointIndex] ?? nextPoint),
      CARDINAL_TANGENT_SCALE,
    );
  }
  if (!closed && pointIndex === pointCount - 1) {
    return scalePoint(
      subtractPoints(points[pointIndex] ?? previousPoint, previousPoint),
      CARDINAL_TANGENT_SCALE,
    );
  }

  return scalePoint(subtractPoints(nextPoint, previousPoint), CARDINAL_TANGENT_SCALE);
};

const getCornerPointTangent = (
  points: readonly Point[],
  pointIndex: number,
  closed: boolean,
  boundary: 'start' | 'end',
): Point => {
  const pointCount = points.length;
  const point = points[pointIndex] ?? { x: 0, y: 0 };

  if (boundary === 'start') {
    const nextPoint = points[getNextPointIndex(pointIndex, pointCount, closed)] ?? point;
    return scalePoint(subtractPoints(nextPoint, point), CORNER_TANGENT_SCALE);
  }

  const previousPoint = points[getPreviousPointIndex(pointIndex, pointCount, closed)] ?? point;
  return scalePoint(subtractPoints(point, previousPoint), CORNER_TANGENT_SCALE);
};

const getCardinalScalarTangent = (
  values: readonly number[],
  pointIndex: number,
  closed: boolean,
): number => {
  const pointCount = values.length;
  const value = values[pointIndex] ?? 0;
  const previousValue = values[getPreviousPointIndex(pointIndex, pointCount, closed)] ?? value;
  const nextValue = values[getNextPointIndex(pointIndex, pointCount, closed)] ?? value;

  if (!closed && pointIndex === 0) {
    return (nextValue - value) * CARDINAL_TANGENT_SCALE;
  }
  if (!closed && pointIndex === pointCount - 1) {
    return (value - previousValue) * CARDINAL_TANGENT_SCALE;
  }

  return (nextValue - previousValue) * CARDINAL_TANGENT_SCALE;
};

const getCornerScalarTangent = (
  values: readonly number[],
  pointIndex: number,
  closed: boolean,
  boundary: 'start' | 'end',
): number => {
  const pointCount = values.length;
  const value = values[pointIndex] ?? 0;

  if (boundary === 'start') {
    const nextValue = values[getNextPointIndex(pointIndex, pointCount, closed)] ?? value;
    return (nextValue - value) * CORNER_TANGENT_SCALE;
  }

  const previousValue = values[getPreviousPointIndex(pointIndex, pointCount, closed)] ?? value;
  return (value - previousValue) * CORNER_TANGENT_SCALE;
};

const evaluateHermiteBasis = (u: number): [number, number, number, number] => {
  const u2 = u * u;
  const u3 = u2 * u;

  return [2 * u3 - 3 * u2 + 1, u3 - 2 * u2 + u, -2 * u3 + 3 * u2, u3 - u2];
};

const evaluatePointCorrection = (
  u: number,
  startDelta: Point,
  startDerivativeDelta: Point,
  endDelta: Point,
  endDerivativeDelta: Point,
): Point => {
  const [h00, h10, h01, h11] = evaluateHermiteBasis(u);
  return addPoints(
    addPoints(scalePoint(startDelta, h00), scalePoint(startDerivativeDelta, h10)),
    addPoints(scalePoint(endDelta, h01), scalePoint(endDerivativeDelta, h11)),
  );
};

const evaluateScalarCorrection = (
  u: number,
  startDelta: number,
  startDerivativeDelta: number,
  endDelta: number,
  endDerivativeDelta: number,
): number => {
  const [h00, h10, h01, h11] = evaluateHermiteBasis(u);
  return startDelta * h00 + startDerivativeDelta * h10 + endDelta * h01 + endDerivativeDelta * h11;
};

type SegmentPointCorrection = {
  startDelta: Point;
  startDerivativeDelta: Point;
  endDelta: Point;
  endDerivativeDelta: Point;
};

type SegmentScalarCorrection = {
  startDelta: number;
  startDerivativeDelta: number;
  endDelta: number;
  endDerivativeDelta: number;
};

const createPointSegmentCorrection = (
  points: readonly Point[],
  pointTypes: readonly RotoPointType[] | undefined,
  closed: boolean,
  segmentIndex: number,
  evaluateBaseAt: (u: number) => Point,
): SegmentPointCorrection | null => {
  if (!hasCustomRotoPointTypes(pointTypes, points.length)) return null;

  const pointCount = points.length;
  const startPointIndex = getSegmentStartPointIndex(segmentIndex, pointCount, closed);
  const endPointIndex = getSegmentEndPointIndex(segmentIndex, pointCount, closed);
  const startType = isTypedBoundaryEligible(segmentIndex, pointCount, closed, 'start')
    ? getRotoPointType(pointTypes, pointCount, startPointIndex)
    : 'bspline';
  const endType = isTypedBoundaryEligible(segmentIndex, pointCount, closed, 'end')
    ? getRotoPointType(pointTypes, pointCount, endPointIndex)
    : 'bspline';

  if (startType === 'bspline' && endType === 'bspline') return null;

  const baseStart = evaluateBaseAt(0);
  const baseEnd = evaluateBaseAt(1);
  const baseStartDerivative = scalePoint(
    subtractPoints(evaluateBaseAt(CUSTOM_POINT_DERIVATIVE_EPSILON), baseStart),
    1 / CUSTOM_POINT_DERIVATIVE_EPSILON,
  );
  const baseEndDerivative = scalePoint(
    subtractPoints(baseEnd, evaluateBaseAt(1 - CUSTOM_POINT_DERIVATIVE_EPSILON)),
    1 / CUSTOM_POINT_DERIVATIVE_EPSILON,
  );

  const targetStart = startType === 'bspline' ? baseStart : (points[startPointIndex] ?? baseStart);
  const targetEnd = endType === 'bspline' ? baseEnd : (points[endPointIndex] ?? baseEnd);
  const targetStartDerivative =
    startType === 'cardinal'
      ? getCardinalPointTangent(points, startPointIndex, closed)
      : startType === 'corner'
        ? getCornerPointTangent(points, startPointIndex, closed, 'start')
        : baseStartDerivative;
  const targetEndDerivative =
    endType === 'cardinal'
      ? getCardinalPointTangent(points, endPointIndex, closed)
      : endType === 'corner'
        ? getCornerPointTangent(points, endPointIndex, closed, 'end')
        : baseEndDerivative;

  return {
    startDelta: subtractPoints(targetStart, baseStart),
    startDerivativeDelta: subtractPoints(targetStartDerivative, baseStartDerivative),
    endDelta: subtractPoints(targetEnd, baseEnd),
    endDerivativeDelta: subtractPoints(targetEndDerivative, baseEndDerivative),
  };
};

const createScalarSegmentCorrection = (
  values: readonly number[],
  pointTypes: readonly RotoPointType[] | undefined,
  closed: boolean,
  segmentIndex: number,
  evaluateBaseAt: (u: number) => number,
): SegmentScalarCorrection | null => {
  if (!hasCustomRotoPointTypes(pointTypes, values.length)) return null;

  const pointCount = values.length;
  const startPointIndex = getSegmentStartPointIndex(segmentIndex, pointCount, closed);
  const endPointIndex = getSegmentEndPointIndex(segmentIndex, pointCount, closed);
  const startType = isTypedBoundaryEligible(segmentIndex, pointCount, closed, 'start')
    ? getRotoPointType(pointTypes, pointCount, startPointIndex)
    : 'bspline';
  const endType = isTypedBoundaryEligible(segmentIndex, pointCount, closed, 'end')
    ? getRotoPointType(pointTypes, pointCount, endPointIndex)
    : 'bspline';

  if (startType === 'bspline' && endType === 'bspline') return null;

  const baseStart = evaluateBaseAt(0);
  const baseEnd = evaluateBaseAt(1);
  const baseStartDerivative =
    (evaluateBaseAt(CUSTOM_POINT_DERIVATIVE_EPSILON) - baseStart) / CUSTOM_POINT_DERIVATIVE_EPSILON;
  const baseEndDerivative =
    (baseEnd - evaluateBaseAt(1 - CUSTOM_POINT_DERIVATIVE_EPSILON)) /
    CUSTOM_POINT_DERIVATIVE_EPSILON;

  const targetStart = startType === 'bspline' ? baseStart : (values[startPointIndex] ?? baseStart);
  const targetEnd = endType === 'bspline' ? baseEnd : (values[endPointIndex] ?? baseEnd);
  const targetStartDerivative =
    startType === 'cardinal'
      ? getCardinalScalarTangent(values, startPointIndex, closed)
      : startType === 'corner'
        ? getCornerScalarTangent(values, startPointIndex, closed, 'start')
        : baseStartDerivative;
  const targetEndDerivative =
    endType === 'cardinal'
      ? getCardinalScalarTangent(values, endPointIndex, closed)
      : endType === 'corner'
        ? getCornerScalarTangent(values, endPointIndex, closed, 'end')
        : baseEndDerivative;

  return {
    startDelta: targetStart - baseStart,
    startDerivativeDelta: targetStartDerivative - baseStartDerivative,
    endDelta: targetEnd - baseEnd,
    endDerivativeDelta: targetEndDerivative - baseEndDerivative,
  };
};

export function generateBSplineSegments(points: Point[], closed: boolean): BezierSegment[] {
  const n = points.length;
  if (n < 3) {
    return [];
  }

  // Build padded control list so each segment always reads 4 consecutive points.
  let pts: Point[];

  if (closed) {
    pts = [points[n - 1], ...points, points[0], points[1]];
  } else {
    // Clamp open splines so the rendered curve interpolates the first/last points.
    pts = [points[0], points[0], ...points, points[n - 1], points[n - 1]];
  }

  const segmentCount = pts.length - 3;
  const segments: BezierSegment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    segments.push(bsplineSegmentToBezier(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
  }
  return segments;
}

export function sampleBSplinePoints(
  points: Point[],
  closed: boolean,
  pointWeights?: readonly number[],
  samplesPerSegment: number = BSPLINE_SAMPLE_STEPS,
  pointWeightMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
  pointTypes?: readonly RotoPointType[],
  pointWeightModes?: readonly (RotoPointWeightMode | null)[],
): Point[] {
  if (points.length < 2) return [];
  if (points.length < 3 && !closed) return [...points];

  const resolvedPointWeightMode = getResolvedPointWeightMode(pointWeightMode);
  const normalizedWeights = getNormalizedWeights(pointWeights, points.length);
  const { globalWeights, localWeights, hasGlobalWeights, hasLocalWeights } =
    getModePartitionedWeights(
      normalizedWeights,
      pointWeightModes,
      points.length,
      resolvedPointWeightMode,
    );
  const { points: paddedPoints, segmentCount } = getPaddedBSplineControls(points, closed);
  const { weights: paddedGlobalWeights } = getPaddedBSplineControls(points, closed, globalWeights);
  const { weights: paddedLocalWeights } = getPaddedBSplineControls(points, closed, localWeights);
  if (segmentCount <= 0) return [];

  const safeSamplesPerSegment = Math.max(2, Math.round(samplesPerSegment));
  const sampledPoints: Point[] = [];
  const segmentCorrections = hasCustomRotoPointTypes(pointTypes, points.length)
    ? Array.from({ length: segmentCount }, (_, segmentIndex) =>
        createPointSegmentCorrection(points, pointTypes, closed, segmentIndex, (u) =>
          addPoints(
            hasGlobalWeights
              ? evaluateWeightedPoint(paddedPoints, paddedGlobalWeights, segmentIndex, u)
              : evaluateUnweightedPoint(paddedPoints, segmentIndex, u),
            hasLocalWeights
              ? evaluateLocalWeightDelta(
                  hasGlobalWeights
                    ? evaluateWeightedPoint(paddedPoints, paddedGlobalWeights, segmentIndex, u)
                    : evaluateUnweightedPoint(paddedPoints, segmentIndex, u),
                  paddedPoints,
                  paddedLocalWeights,
                  segmentIndex,
                  u,
                )
              : { x: 0, y: 0 },
          ),
        ),
      )
    : null;

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    for (let sampleIndex = 0; sampleIndex <= safeSamplesPerSegment; sampleIndex += 1) {
      if (segmentIndex > 0 && sampleIndex === 0) continue;

      const u = sampleIndex / safeSamplesPerSegment;
      const globalBasePoint = hasGlobalWeights
        ? evaluateWeightedPoint(paddedPoints, paddedGlobalWeights, segmentIndex, u)
        : evaluateUnweightedPoint(paddedPoints, segmentIndex, u);
      const basePoint = hasLocalWeights
        ? addPoints(
            globalBasePoint,
            evaluateLocalWeightDelta(
              globalBasePoint,
              paddedPoints,
              paddedLocalWeights,
              segmentIndex,
              u,
            ),
          )
        : globalBasePoint;
      const segmentCorrection = segmentCorrections?.[segmentIndex];
      sampledPoints.push(
        segmentCorrection
          ? addPoints(
              basePoint,
              evaluatePointCorrection(
                u,
                segmentCorrection.startDelta,
                segmentCorrection.startDerivativeDelta,
                segmentCorrection.endDelta,
                segmentCorrection.endDerivativeDelta,
              ),
            )
          : basePoint,
      );
    }
  }

  return sampledPoints;
}

export function sampleBSplineScalars(
  values: number[],
  closed: boolean,
  pointWeights?: readonly number[],
  samplesPerSegment: number = BSPLINE_SAMPLE_STEPS,
  pointWeightMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
  pointTypes?: readonly RotoPointType[],
  pointWeightModes?: readonly (RotoPointWeightMode | null)[],
): number[] {
  if (values.length < 2) return [];
  if (values.length < 3 && !closed) return [...values];

  const pointCount = values.length;
  const resolvedPointWeightMode = getResolvedPointWeightMode(pointWeightMode);
  const normalizedWeights = getNormalizedWeights(pointWeights, pointCount);
  const { globalWeights, localWeights, hasGlobalWeights, hasLocalWeights } =
    getModePartitionedWeights(
      normalizedWeights,
      pointWeightModes,
      pointCount,
      resolvedPointWeightMode,
    );
  const { weights: paddedGlobalWeights, segmentCount } = getPaddedBSplineControls(
    values.map((value) => ({ x: value, y: 0 })),
    closed,
    globalWeights,
  );
  const { weights: paddedLocalWeights } = getPaddedBSplineControls(
    values.map((value) => ({ x: value, y: 0 })),
    closed,
    localWeights,
  );
  const { values: paddedValues } = getPaddedScalarValues(values, closed);
  const paddedUnitWeights = paddedGlobalWeights.map(() => 1);

  const safeSamplesPerSegment = Math.max(2, Math.round(samplesPerSegment));
  const sampledValues: number[] = [];
  const segmentCorrections = hasCustomRotoPointTypes(pointTypes, pointCount)
    ? Array.from({ length: segmentCount }, (_, segmentIndex) =>
        createScalarSegmentCorrection(
          values,
          pointTypes,
          closed,
          segmentIndex,
          (u) =>
            (hasGlobalWeights
              ? evaluateWeightedScalar(paddedValues, paddedGlobalWeights, segmentIndex, u)
              : evaluateWeightedScalar(paddedValues, paddedUnitWeights, segmentIndex, u)) +
            (hasLocalWeights
              ? evaluateLocalScalarDelta(
                  hasGlobalWeights
                    ? evaluateWeightedScalar(paddedValues, paddedGlobalWeights, segmentIndex, u)
                    : evaluateWeightedScalar(paddedValues, paddedUnitWeights, segmentIndex, u),
                  paddedValues,
                  paddedLocalWeights,
                  segmentIndex,
                  u,
                )
              : 0),
        ),
      )
    : null;

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    for (let sampleIndex = 0; sampleIndex <= safeSamplesPerSegment; sampleIndex += 1) {
      if (segmentIndex > 0 && sampleIndex === 0) continue;

      const u = sampleIndex / safeSamplesPerSegment;
      const globalBaseValue = hasGlobalWeights
        ? evaluateWeightedScalar(paddedValues, paddedGlobalWeights, segmentIndex, u)
        : evaluateWeightedScalar(paddedValues, paddedUnitWeights, segmentIndex, u);
      const baseValue = hasLocalWeights
        ? globalBaseValue +
          evaluateLocalScalarDelta(
            globalBaseValue,
            paddedValues,
            paddedLocalWeights,
            segmentIndex,
            u,
          )
        : globalBaseValue;
      const segmentCorrection = segmentCorrections?.[segmentIndex];
      sampledValues.push(
        segmentCorrection
          ? baseValue +
              evaluateScalarCorrection(
                u,
                segmentCorrection.startDelta,
                segmentCorrection.startDerivativeDelta,
                segmentCorrection.endDelta,
                segmentCorrection.endDerivativeDelta,
              )
          : baseValue,
      );
    }
  }

  return sampledValues;
}

export function generateBSplinePath(
  points: Point[],
  closed: boolean,
  pointWeights?: readonly number[],
  pointWeightMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
  pointTypes?: readonly RotoPointType[],
  pointWeightModes?: readonly (RotoPointWeightMode | null)[],
): string {
  if (points.length < 2) return '';
  if (points.length < 3 && !closed)
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  if (
    hasCustomWeights(pointWeights, points.length) ||
    hasCustomRotoPointTypes(pointTypes, points.length)
  ) {
    const sampledPoints = sampleBSplinePoints(
      points,
      closed,
      pointWeights,
      BSPLINE_SAMPLE_STEPS,
      pointWeightMode,
      pointTypes,
      pointWeightModes,
    );
    if (sampledPoints.length === 0) return '';
    return (
      sampledPoints
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ') + (closed ? ' Z' : '')
    );
  }

  const segments = generateBSplineSegments(points, closed);
  if (segments.length === 0) {
    if (closed && points.length > 1) {
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
    }
    return '';
  }

  let path = `M ${segments[0].start.x},${segments[0].start.y}`;
  for (const seg of segments) {
    path += ` C ${seg.c1.x},${seg.c1.y} ${seg.c2.x},${seg.c2.y} ${seg.end.x},${seg.end.y}`;
  }

  if (closed) {
    path += ' Z';
  }
  return path;
}

export function drawBSplineOnCanvas(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  pointWeights?: readonly number[],
  pointWeightMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
  pointTypes?: readonly RotoPointType[],
  pointWeightModes?: readonly (RotoPointWeightMode | null)[],
) {
  if (points.length < 2) return;
  if (points.length < 3 && !closed) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  if (
    hasCustomWeights(pointWeights, points.length) ||
    hasCustomRotoPointTypes(pointTypes, points.length)
  ) {
    const sampledPoints = sampleBSplinePoints(
      points,
      closed,
      pointWeights,
      BSPLINE_SAMPLE_STEPS,
      pointWeightMode,
      pointTypes,
      pointWeightModes,
    );
    if (sampledPoints.length === 0) return;

    ctx.moveTo(sampledPoints[0].x, sampledPoints[0].y);
    for (let index = 1; index < sampledPoints.length; index += 1) {
      ctx.lineTo(sampledPoints[index].x, sampledPoints[index].y);
    }
    return;
  }

  const segments = generateBSplineSegments(points, closed);
  if (!segments.length) return;

  ctx.moveTo(segments[0].start.x, segments[0].start.y);
  for (const seg of segments) {
    ctx.bezierCurveTo(seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.end.x, seg.end.y);
  }
}

// Ramer-Douglas-Peucker algorithm for path simplification
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const { x: x1, y: y1 } = lineStart;
  const { x: x2, y: y2 } = lineEnd;
  const { x, y } = point;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(Math.pow(x - x1, 2) + Math.pow(y - y1, 2));
  }

  const numerator = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt(dx * dx + dy * dy);
  return numerator / denominator;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) {
    return points;
  }

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = rdp(points.slice(0, index + 1), epsilon);
    const recResults2 = rdp(points.slice(index), epsilon);
    return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
  } else {
    return [points[0], points[end]];
  }
}

export function simplifyPath(points: Point[], epsilon: number): Point[] {
  return rdp(points, epsilon);
}

/**
 * Resamples a path (array of points) to have a specific number of points,
 * distributed evenly by distance along the original segments.
 */
export function resamplePath(points: Point[], targetCount: number, closed: boolean): Point[] {
  if (points.length < 2 || targetCount < 2) return points;

  // 1. Calculate distances and total length
  const workingPoints = closed ? [...points, points[0]] : [...points];
  const segmentLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < workingPoints.length - 1; i++) {
    const d = Math.hypot(
      workingPoints[i + 1].x - workingPoints[i].x,
      workingPoints[i + 1].y - workingPoints[i].y,
    );
    segmentLengths.push(d);
    totalLength += d;
  }

  if (totalLength === 0) return points;

  // 2. Sample at uniform intervals
  const result: Point[] = [];
  const stepSize = closed ? totalLength / targetCount : totalLength / (targetCount - 1);

  for (let i = 0; i < targetCount; i++) {
    const targetDist = i * stepSize;

    let accumulated = 0;
    let found = false;

    for (let j = 0; j < segmentLengths.length; j++) {
      const nextAccumulated = accumulated + segmentLengths[j];
      if (targetDist <= nextAccumulated) {
        const segmentT = (targetDist - accumulated) / segmentLengths[j];
        const p1 = workingPoints[j];
        const p2 = workingPoints[j + 1];

        result.push({
          x: p1.x + (p2.x - p1.x) * segmentT,
          y: p1.y + (p2.y - p1.y) * segmentT,
        });
        found = true;
        break;
      }
      accumulated = nextAccumulated;
    }

    if (!found) {
      result.push(workingPoints[workingPoints.length - 1]);
    }
  }

  return result;
}

/**
 * Calculates cumulative arc lengths for a sequence of points.
 */
function getArcLengths(points: Point[], closed: boolean): { lengths: number[]; total: number } {
  const lengths = [0];
  let total = 0;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    total += d;
    lengths.push(total);
  }
  return { lengths, total };
}

/**
 * Returns a point at a specific normalized distance (0..1) along a path.
 */
function getPointAtNormalizedDist(
  points: Point[],
  arcLengths: number[],
  totalLength: number,
  t: number,
  closed: boolean,
): Point {
  if (totalLength === 0) return points[0];
  const targetDist = t * totalLength;

  // Find the segment
  let i = 0;
  while (i < arcLengths.length - 1 && arcLengths[i + 1] < targetDist) {
    i++;
  }

  const p1 = points[i];
  const p2 = points[(i + 1) % points.length];
  const segStart = arcLengths[i];
  const segEnd = arcLengths[i + 1];
  const segLen = segEnd - segStart;

  if (segLen === 0) return p1;

  const segmentT = (targetDist - segStart) / segLen;
  return {
    x: p1.x + (p2.x - p1.x) * segmentT,
    y: p1.y + (p2.y - p1.y) * segmentT,
  };
}

/**
 * Maps existing vertices to a new contour by preserving relative arc length distribution.
 * This is "more reasonable" as it maintains the point density/character of the original shape.
 * It also finds the optimal global shift for closed shapes.
 */
export function mapPointsToContour(
  existingPoints: Point[],
  contour: Point[],
  closed: boolean,
): Point[] {
  if (existingPoints.length === 0 || contour.length < 2) return existingPoints;

  const existingArc = getArcLengths(existingPoints, closed);
  const contourArc = getArcLengths(contour, closed);

  if (contourArc.total === 0) return existingPoints;

  // Relative arc length positions of original points (0..1)
  const normalizedDists = existingPoints.map((_, i) => existingArc.lengths[i] / existingArc.total);

  if (!closed) {
    // Simple linear mapping for open paths
    return normalizedDists.map((t) =>
      getPointAtNormalizedDist(contour, contourArc.lengths, contourArc.total, t, false),
    );
  }

  // For closed paths, we must find the optimal "shift" (rotation of the contour's start point)
  // to align features globally. We test multiple shift candidates.
  let bestShift = 0;
  let minTotalSqDist = Infinity;

  // We sample shifts along the new contour (e.g., 32 candidates)
  const SHIFT_SAMPLES = 32;
  for (let s = 0; s < SHIFT_SAMPLES; s++) {
    const offsetT = s / SHIFT_SAMPLES;
    let totalSqDist = 0;

    for (let i = 0; i < existingPoints.length; i++) {
      // Apply shift to the normalized distance
      const t = (normalizedDists[i] + offsetT) % 1.0;
      const projected = getPointAtNormalizedDist(
        contour,
        contourArc.lengths,
        contourArc.total,
        t,
        true,
      );
      const dx = projected.x - existingPoints[i].x;
      const dy = projected.y - existingPoints[i].y;
      totalSqDist += dx * dx + dy * dy;
    }

    if (totalSqDist < minTotalSqDist) {
      minTotalSqDist = totalSqDist;
      bestShift = offsetT;
    }
  }

  // Final mapping with the best shift
  return normalizedDists.map((t) =>
    getPointAtNormalizedDist(
      contour,
      contourArc.lengths,
      contourArc.total,
      (t + bestShift) % 1.0,
      true,
    ),
  );
}

export function getBoundingBox(points: Point[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function isPointInPolygon(point: Point, vs: Point[]) {
  // ray-casting algorithm based on
  // https://github.com/substack/point-in-polygon
  const x = point.x,
    y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x,
      yi = vs[i].y;
    const xj = vs[j].x,
      yj = vs[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
