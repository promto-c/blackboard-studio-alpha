import type { Point, RotoPath, RotoPointWeightMode } from '@blackboard/types';

export type { RotoPointWeightMode };

export const DEFAULT_ROTO_POINT_WEIGHT_MODE: RotoPointWeightMode = 'global';
export const DEFAULT_ROTO_POINT_WEIGHT = 1;
export const MIN_ROTO_POINT_WEIGHT = 0.25;
export const MAX_ROTO_POINT_WEIGHT = 4;

export const ROTO_POINT_WEIGHT_HANDLE_BASE_DISTANCE_PX = 14;
export const ROTO_POINT_WEIGHT_HANDLE_STEP_PX = 10;
export const ROTO_POINT_WEIGHT_HANDLE_RADIUS_PX = 3.5;

const DEFAULT_NORMAL: Point = { x: 0, y: -1 };
const WEIGHT_EPSILON = 1e-4;

export const isRotoPointWeightMode = (value: unknown): value is RotoPointWeightMode =>
  value === 'global' || value === 'local';

const getNormalizedExplicitRotoPointWeightModes = (
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
): Array<RotoPointWeightMode | null> =>
  Array.from({ length: pointCount }, (_, index) =>
    isRotoPointWeightMode(pointWeightModes?.[index]) ? pointWeightModes[index] : null,
  );

const clampUnitWeight = (weight: number): number =>
  Math.min(MAX_ROTO_POINT_WEIGHT, Math.max(MIN_ROTO_POINT_WEIGHT, weight));

const normalizeVector = (dx: number, dy: number): Point => {
  const length = Math.hypot(dx, dy);
  if (length < WEIGHT_EPSILON) return DEFAULT_NORMAL;
  return { x: dx / length, y: dy / length };
};

export const clampRotoPointWeight = (weight: number): number => clampUnitWeight(weight);

export const getNormalizedRotoPointWeights = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
): number[] =>
  Array.from({ length: pointCount }, (_, index) =>
    clampUnitWeight(pointWeights?.[index] ?? DEFAULT_ROTO_POINT_WEIGHT),
  );

export const getRotoPointWeight = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
  index: number,
): number =>
  getNormalizedRotoPointWeights(pointWeights, pointCount)[index] ?? DEFAULT_ROTO_POINT_WEIGHT;

export const getNormalizedRotoPointWeightModes = (
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
  defaultMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
): RotoPointWeightMode[] =>
  Array.from({ length: pointCount }, (_, index) =>
    isRotoPointWeightMode(pointWeightModes?.[index]) ? pointWeightModes[index] : defaultMode,
  );

export const getRotoPointWeightMode = (
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
  index: number,
  defaultMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
): RotoPointWeightMode =>
  getNormalizedRotoPointWeightModes(pointWeightModes, pointCount, defaultMode)[index] ??
  defaultMode;

export const compactRotoPointWeightModes = (
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
): Array<RotoPointWeightMode | null> | undefined => {
  if (pointCount <= 0) return undefined;

  const normalized = getNormalizedExplicitRotoPointWeightModes(pointWeightModes, pointCount);
  return normalized.some((mode) => mode !== null) ? normalized : undefined;
};

export const compactRotoPointWeights = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
): number[] | undefined => {
  if (pointCount <= 0) return undefined;

  const normalized = getNormalizedRotoPointWeights(pointWeights, pointCount);
  const hasCustomWeight = normalized.some(
    (weight) => Math.abs(weight - DEFAULT_ROTO_POINT_WEIGHT) > WEIGHT_EPSILON,
  );

  return hasCustomWeight ? normalized : undefined;
};

export const removeRotoPointWeights = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
  indicesToRemove: readonly number[],
): number[] | undefined => {
  if (!pointWeights) return undefined;

  const normalized = getNormalizedRotoPointWeights(pointWeights, pointCount);
  const removeIndexSet = new Set(indicesToRemove);
  const nextWeights = normalized.filter((_, index) => !removeIndexSet.has(index));

  return compactRotoPointWeights(nextWeights, nextWeights.length);
};

export const insertRotoPointWeight = (
  pointWeights: readonly number[] | undefined,
  pointCount: number,
  insertIndex: number,
  previousIndex: number,
  nextIndex: number,
): number[] | undefined => {
  if (!pointWeights) return undefined;

  const normalized = getNormalizedRotoPointWeights(pointWeights, pointCount);
  const nextWeights = [...normalized];
  const previousWeight = normalized[previousIndex] ?? DEFAULT_ROTO_POINT_WEIGHT;
  const nextWeight = normalized[nextIndex] ?? DEFAULT_ROTO_POINT_WEIGHT;

  nextWeights.splice(insertIndex, 0, clampUnitWeight((previousWeight + nextWeight) * 0.5));

  return compactRotoPointWeights(nextWeights, nextWeights.length);
};

export const updateRotoPointWeights = (
  path: Pick<RotoPath, 'points' | 'pointWeights'>,
  pointIndices: readonly number[],
  updater: (weight: number, pointIndex: number) => number,
): number[] | undefined => {
  const normalized = getNormalizedRotoPointWeights(path.pointWeights, path.points.length);
  const nextWeights = [...normalized];

  pointIndices.forEach((pointIndex) => {
    if (pointIndex < 0 || pointIndex >= nextWeights.length) return;
    nextWeights[pointIndex] = clampUnitWeight(updater(nextWeights[pointIndex], pointIndex));
  });

  return compactRotoPointWeights(nextWeights, nextWeights.length);
};

export const removeRotoPointWeightModes = (
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
  indicesToRemove: readonly number[],
): Array<RotoPointWeightMode | null> | undefined => {
  if (!pointWeightModes) return undefined;

  const normalized = getNormalizedExplicitRotoPointWeightModes(pointWeightModes, pointCount);
  const removeIndexSet = new Set(indicesToRemove);
  const nextModes = normalized.filter((_, index) => !removeIndexSet.has(index));

  return compactRotoPointWeightModes(nextModes, nextModes.length);
};

export const insertRotoPointWeightMode = (
  pointWeightModes: readonly (RotoPointWeightMode | null)[] | undefined,
  pointCount: number,
  insertIndex: number,
  previousIndex: number,
  nextIndex: number,
): Array<RotoPointWeightMode | null> | undefined => {
  if (!pointWeightModes) return undefined;

  const normalized = getNormalizedExplicitRotoPointWeightModes(pointWeightModes, pointCount);
  const nextModes = [...normalized];
  const previousMode = normalized[previousIndex] ?? null;
  const nextMode = normalized[nextIndex] ?? null;

  nextModes.splice(
    insertIndex,
    0,
    previousMode !== null && previousMode === nextMode ? previousMode : null,
  );

  return compactRotoPointWeightModes(nextModes, nextModes.length);
};

export const setRotoPointWeightModes = (
  path: Pick<RotoPath, 'points' | 'pointWeightModes'>,
  pointIndices: readonly number[],
  pointWeightMode: RotoPointWeightMode,
): Array<RotoPointWeightMode | null> | undefined => {
  const normalized = getNormalizedExplicitRotoPointWeightModes(
    path.pointWeightModes,
    path.points.length,
  );
  const nextModes = [...normalized];

  pointIndices.forEach((pointIndex) => {
    if (pointIndex < 0 || pointIndex >= nextModes.length) return;
    nextModes[pointIndex] = pointWeightMode;
  });

  return compactRotoPointWeightModes(nextModes, nextModes.length);
};

export const materializeRotoPointWeightModes = (
  path: Pick<RotoPath, 'points' | 'pointWeightModes'>,
  pointIndices: readonly number[],
  defaultMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
): Array<RotoPointWeightMode | null> | undefined => {
  const normalized = getNormalizedExplicitRotoPointWeightModes(
    path.pointWeightModes,
    path.points.length,
  );
  const nextModes = [...normalized];

  pointIndices.forEach((pointIndex) => {
    if (pointIndex < 0 || pointIndex >= nextModes.length) return;
    nextModes[pointIndex] = getRotoPointWeightMode(
      path.pointWeightModes,
      path.points.length,
      pointIndex,
      defaultMode,
    );
  });

  return compactRotoPointWeightModes(nextModes, nextModes.length);
};

export const getRotoPointWeightModeForSelection = (
  path: Pick<RotoPath, 'points' | 'pointWeightModes'>,
  pointIndices: readonly number[],
  defaultMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
): RotoPointWeightMode | null => {
  if (pointIndices.length === 0) return null;

  const firstMode = getRotoPointWeightMode(
    path.pointWeightModes,
    path.points.length,
    pointIndices[0],
    defaultMode,
  );
  return pointIndices.every(
    (pointIndex) =>
      getRotoPointWeightMode(path.pointWeightModes, path.points.length, pointIndex, defaultMode) ===
      firstMode,
  )
    ? firstMode
    : null;
};

export const getRotoPointWeightHandleDistance = (weight: number, zoom: number): number =>
  Math.max(
    8 / zoom,
    (ROTO_POINT_WEIGHT_HANDLE_BASE_DISTANCE_PX +
      (clampUnitWeight(weight) - DEFAULT_ROTO_POINT_WEIGHT) * ROTO_POINT_WEIGHT_HANDLE_STEP_PX) /
      zoom,
  );

export const getRotoPointWeightHandleNormal = (
  points: readonly Point[],
  pointIndex: number,
  closed: boolean,
): Point => {
  const pointCount = points.length;
  if (pointCount === 0) return DEFAULT_NORMAL;

  const point = points[pointIndex];
  if (!point) return DEFAULT_NORMAL;

  const previousPoint =
    pointIndex > 0
      ? points[pointIndex - 1]
      : closed
        ? points[(pointIndex - 1 + pointCount) % pointCount]
        : (points[Math.min(pointCount - 1, pointIndex + 1)] ?? point);
  const nextPoint =
    pointIndex < pointCount - 1
      ? points[pointIndex + 1]
      : closed
        ? points[(pointIndex + 1) % pointCount]
        : (points[Math.max(0, pointIndex - 1)] ?? point);

  const tangent = normalizeVector(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y);
  const primaryNormal = { x: -tangent.y, y: tangent.x };
  const secondaryNormal = { x: tangent.y, y: -tangent.x };

  const centroid = points.reduce(
    (acc, candidate) => ({
      x: acc.x + candidate.x / pointCount,
      y: acc.y + candidate.y / pointCount,
    }),
    { x: 0, y: 0 },
  );

  const primaryDistance = Math.hypot(
    point.x + primaryNormal.x - centroid.x,
    point.y + primaryNormal.y - centroid.y,
  );
  const secondaryDistance = Math.hypot(
    point.x + secondaryNormal.x - centroid.x,
    point.y + secondaryNormal.y - centroid.y,
  );

  return primaryDistance >= secondaryDistance ? primaryNormal : secondaryNormal;
};

export const getRotoPointWeightHandlePosition = (
  point: Point,
  normal: Point,
  weight: number,
  zoom: number,
): Point => {
  const distance = getRotoPointWeightHandleDistance(weight, zoom);
  return {
    x: point.x + normal.x * distance,
    y: point.y + normal.y * distance,
  };
};
