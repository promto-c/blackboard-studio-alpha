import type { FlowEdge } from '@blackboard/types';
import { getInputPortKey, getOutputPortKey } from './nodePortKeys';

export interface GraphPoint {
  x: number;
  y: number;
}

interface CubicBezier {
  start: GraphPoint;
  control1: GraphPoint;
  control2: GraphPoint;
  end: GraphPoint;
}

const getWireBezier = (source: GraphPoint, target: GraphPoint): CubicBezier => {
  const verticalDistance = Math.abs(target.y - source.y);
  const controlOffset = Math.max(40, verticalDistance * 0.4);
  return {
    start: source,
    control1: { x: source.x, y: source.y + controlOffset },
    control2: { x: target.x, y: target.y - controlOffset },
    end: target,
  };
};

export const makeWireBezierPath = (source: GraphPoint, target: GraphPoint): string => {
  const bezier = getWireBezier(source, target);
  return `M ${bezier.start.x} ${bezier.start.y} C ${bezier.control1.x} ${bezier.control1.y}, ${bezier.control2.x} ${bezier.control2.y}, ${bezier.end.x} ${bezier.end.y}`;
};

export const makePolylinePath = (points: readonly GraphPoint[]): string =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

const distance = (a: GraphPoint, b: GraphPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

const getCubicBezierPoint = (bezier: CubicBezier, t: number): GraphPoint => {
  const inverse = 1 - t;
  const inverseSquared = inverse * inverse;
  const tSquared = t * t;
  return {
    x:
      inverseSquared * inverse * bezier.start.x +
      3 * inverseSquared * t * bezier.control1.x +
      3 * inverse * tSquared * bezier.control2.x +
      tSquared * t * bezier.end.x,
    y:
      inverseSquared * inverse * bezier.start.y +
      3 * inverseSquared * t * bezier.control1.y +
      3 * inverse * tSquared * bezier.control2.y +
      tSquared * t * bezier.end.y,
  };
};

const sampleWireBezier = (source: GraphPoint, target: GraphPoint): GraphPoint[] => {
  const bezier = getWireBezier(source, target);
  const controlLength =
    distance(bezier.start, bezier.control1) +
    distance(bezier.control1, bezier.control2) +
    distance(bezier.control2, bezier.end);
  const segmentCount = Math.max(20, Math.min(96, Math.ceil(controlLength / 24)));
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    getCubicBezierPoint(bezier, index / segmentCount),
  );
};

const crossProduct = (a: GraphPoint, b: GraphPoint, c: GraphPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const isPointOnSegment = (point: GraphPoint, start: GraphPoint, end: GraphPoint): boolean =>
  point.x >= Math.min(start.x, end.x) &&
  point.x <= Math.max(start.x, end.x) &&
  point.y >= Math.min(start.y, end.y) &&
  point.y <= Math.max(start.y, end.y);

const segmentsIntersect = (
  aStart: GraphPoint,
  aEnd: GraphPoint,
  bStart: GraphPoint,
  bEnd: GraphPoint,
): boolean => {
  const abStart = crossProduct(aStart, aEnd, bStart);
  const abEnd = crossProduct(aStart, aEnd, bEnd);
  const baStart = crossProduct(bStart, bEnd, aStart);
  const baEnd = crossProduct(bStart, bEnd, aEnd);
  const epsilon = 1e-6;

  if (
    ((abStart > epsilon && abEnd < -epsilon) || (abStart < -epsilon && abEnd > epsilon)) &&
    ((baStart > epsilon && baEnd < -epsilon) || (baStart < -epsilon && baEnd > epsilon))
  ) {
    return true;
  }

  return (
    (Math.abs(abStart) <= epsilon && isPointOnSegment(bStart, aStart, aEnd)) ||
    (Math.abs(abEnd) <= epsilon && isPointOnSegment(bEnd, aStart, aEnd)) ||
    (Math.abs(baStart) <= epsilon && isPointOnSegment(aStart, bStart, bEnd)) ||
    (Math.abs(baEnd) <= epsilon && isPointOnSegment(aEnd, bStart, bEnd))
  );
};

const squaredDistanceToSegment = (
  point: GraphPoint,
  segmentStart: GraphPoint,
  segmentEnd: GraphPoint,
): number => {
  const deltaX = segmentEnd.x - segmentStart.x;
  const deltaY = segmentEnd.y - segmentStart.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    const pointDeltaX = point.x - segmentStart.x;
    const pointDeltaY = point.y - segmentStart.y;
    return pointDeltaX * pointDeltaX + pointDeltaY * pointDeltaY;
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * deltaX + (point.y - segmentStart.y) * deltaY) / lengthSquared,
    ),
  );
  const nearestX = segmentStart.x + projection * deltaX;
  const nearestY = segmentStart.y + projection * deltaY;
  const nearestDeltaX = point.x - nearestX;
  const nearestDeltaY = point.y - nearestY;
  return nearestDeltaX * nearestDeltaX + nearestDeltaY * nearestDeltaY;
};

const segmentsAreWithinRadius = (
  aStart: GraphPoint,
  aEnd: GraphPoint,
  bStart: GraphPoint,
  bEnd: GraphPoint,
  radius: number,
): boolean => {
  if (segmentsIntersect(aStart, aEnd, bStart, bEnd)) return true;
  const radiusSquared = radius * radius;
  return (
    squaredDistanceToSegment(aStart, bStart, bEnd) <= radiusSquared ||
    squaredDistanceToSegment(aEnd, bStart, bEnd) <= radiusSquared ||
    squaredDistanceToSegment(bStart, aStart, aEnd) <= radiusSquared ||
    squaredDistanceToSegment(bEnd, aStart, aEnd) <= radiusSquared
  );
};

const polylineIntersectsWire = (
  cutPath: readonly GraphPoint[],
  wirePoints: readonly GraphPoint[],
  hitRadius: number,
): boolean => {
  for (let cutIndex = 1; cutIndex < cutPath.length; cutIndex += 1) {
    for (let wireIndex = 1; wireIndex < wirePoints.length; wireIndex += 1) {
      if (
        segmentsAreWithinRadius(
          cutPath[cutIndex - 1],
          cutPath[cutIndex],
          wirePoints[wireIndex - 1],
          wirePoints[wireIndex],
          hitRadius,
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

/** Return the canonical edge IDs crossed by a freehand knife path. */
export const getWireCutConnectionIds = (
  connections: readonly FlowEdge[],
  portPositions: ReadonlyMap<string, GraphPoint>,
  cutPath: readonly GraphPoint[],
  hitRadius = 0,
): Set<string> => {
  const intersectedIds = new Set<string>();
  if (cutPath.length < 2) return intersectedIds;

  for (const connection of connections) {
    const source = portPositions.get(
      getOutputPortKey(connection.sourceNodeId, connection.sourcePort),
    );
    const target = portPositions.get(
      getInputPortKey(connection.targetNodeId, connection.targetPort),
    );
    if (!source || !target) continue;

    if (polylineIntersectsWire(cutPath, sampleWireBezier(source, target), hitRadius)) {
      intersectedIds.add(connection.id);
    }
  }

  return intersectedIds;
};
