import type { RotoPath, RotoPointType } from '@blackboard/types';

export const DEFAULT_ROTO_POINT_TYPE: RotoPointType = 'bspline';

export const isRotoPointType = (value: unknown): value is RotoPointType =>
  value === 'bspline' || value === 'cardinal' || value === 'corner';

export const getNormalizedRotoPointTypes = (
  pointTypes: readonly RotoPointType[] | undefined,
  pointCount: number,
): RotoPointType[] =>
  Array.from({ length: pointCount }, (_, index) => pointTypes?.[index] ?? DEFAULT_ROTO_POINT_TYPE);

export const getRotoPointType = (
  pointTypes: readonly RotoPointType[] | undefined,
  pointCount: number,
  index: number,
): RotoPointType =>
  getNormalizedRotoPointTypes(pointTypes, pointCount)[index] ?? DEFAULT_ROTO_POINT_TYPE;

export const compactRotoPointTypes = (
  pointTypes: readonly RotoPointType[] | undefined,
  pointCount: number,
): RotoPointType[] | undefined => {
  if (pointCount <= 0) return undefined;

  const normalized = getNormalizedRotoPointTypes(pointTypes, pointCount);
  return normalized.some((pointType) => pointType !== DEFAULT_ROTO_POINT_TYPE)
    ? normalized
    : undefined;
};

export const hasCustomRotoPointTypes = (
  pointTypes: readonly RotoPointType[] | undefined,
  pointCount: number,
): boolean => compactRotoPointTypes(pointTypes, pointCount) !== undefined;

export const removeRotoPointTypes = (
  pointTypes: readonly RotoPointType[] | undefined,
  pointCount: number,
  indicesToRemove: readonly number[],
): RotoPointType[] | undefined => {
  if (!pointTypes) return undefined;

  const normalized = getNormalizedRotoPointTypes(pointTypes, pointCount);
  const removeIndexSet = new Set(indicesToRemove);
  const nextTypes = normalized.filter((_, index) => !removeIndexSet.has(index));

  return compactRotoPointTypes(nextTypes, nextTypes.length);
};

export const insertRotoPointType = (
  pointTypes: readonly RotoPointType[] | undefined,
  pointCount: number,
  insertIndex: number,
  previousIndex: number,
  nextIndex: number,
): RotoPointType[] | undefined => {
  if (!pointTypes) return undefined;

  const normalized = getNormalizedRotoPointTypes(pointTypes, pointCount);
  const nextTypes = [...normalized];
  const previousType = normalized[previousIndex] ?? DEFAULT_ROTO_POINT_TYPE;
  const nextType = normalized[nextIndex] ?? previousType;

  nextTypes.splice(
    insertIndex,
    0,
    previousType === nextType ? previousType : DEFAULT_ROTO_POINT_TYPE,
  );

  return compactRotoPointTypes(nextTypes, nextTypes.length);
};

export const setRotoPointTypes = (
  path: Pick<RotoPath, 'points' | 'pointTypes'>,
  pointIndices: readonly number[],
  pointType: RotoPointType,
): RotoPointType[] | undefined => {
  const normalized = getNormalizedRotoPointTypes(path.pointTypes, path.points.length);
  const nextTypes = [...normalized];

  pointIndices.forEach((pointIndex) => {
    if (pointIndex < 0 || pointIndex >= nextTypes.length) return;
    nextTypes[pointIndex] = pointType;
  });

  return compactRotoPointTypes(nextTypes, nextTypes.length);
};

export const getRotoPointTypeForSelection = (
  path: Pick<RotoPath, 'points' | 'pointTypes'>,
  pointIndices: readonly number[],
): RotoPointType | null => {
  if (pointIndices.length === 0) return null;

  const firstType = getRotoPointType(path.pointTypes, path.points.length, pointIndices[0]);
  return pointIndices.every(
    (pointIndex) => getRotoPointType(path.pointTypes, path.points.length, pointIndex) === firstType,
  )
    ? firstType
    : null;
};
