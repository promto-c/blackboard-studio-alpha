import {
  type Point,
  type RotoLayer,
  type RotoNode,
  type RotoPath,
  type RotoTrackingMatrix4,
  type RotoTrackingModel,
  type RotoTrackingTransform,
} from '@blackboard/types';
import { getLinearValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';
import { fitTrackedTransform } from '@/utils/opticalFlow';
import {
  createRotoLayer,
  getCommonRotoParentLayerId,
  getNextRotoLayerName,
  getRotoLayerPathIds,
  getRotoLayers,
  getRotoPathParentLayerId,
  moveRotoPathsToLayer,
} from '@/utils/rotoHierarchy';

export type RotoTrackingShapeTarget = {
  kind: 'shape';
  pathId: string;
};

export type ResolvedRotoTrackingLayerTarget = {
  kind: 'layer';
  layerId: string;
};

export type PendingRotoTrackingLayerTarget = {
  kind: 'layer';
  createLayer: true;
  parentLayerId: string | null;
  layerName: string;
};

export type RotoTrackingLayerTarget =
  | ResolvedRotoTrackingLayerTarget
  | PendingRotoTrackingLayerTarget;

export type ResolvedRotoTrackingTarget = RotoTrackingShapeTarget | ResolvedRotoTrackingLayerTarget;

export type RotoTrackingTarget = RotoTrackingShapeTarget | RotoTrackingLayerTarget;

export interface RotoTrackingSelectionScope {
  sourcePathIds: string[];
  availableTargets: RotoTrackingTarget['kind'][];
  defaultTarget: RotoTrackingTarget | null;
  shapeTargetPath: RotoPath | null;
  layerTarget: RotoLayer | null;
  layerTargetOption: RotoTrackingLayerTarget | null;
  reason?: string;
}

type TransformComponentConfig = {
  translation: boolean;
  rotation: boolean;
  scale: boolean;
  affine: boolean;
  perspective: boolean;
};

const MATRIX_SIZE = 4;
const EPSILON = 1e-8;
const STABILIZATION_REFERENCE_POINTS: Point[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

const createIdentityRow = (rowIndex: number) =>
  Array.from({ length: MATRIX_SIZE }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0));

export const createIdentityRotoTrackingMatrix4 = (): RotoTrackingMatrix4 =>
  Array.from({ length: MATRIX_SIZE }, (_, rowIndex) => createIdentityRow(rowIndex));

const createIdentityResolvedMatrix4 = (): number[][] =>
  Array.from({ length: MATRIX_SIZE }, (_, rowIndex) => createIdentityRow(rowIndex));

const isTransformComponentEnabled = (config: TransformComponentConfig): boolean =>
  config.translation || config.rotation || config.scale || config.affine || config.perspective;

export const resolveRotoTrackingMatrix4 = (
  matrix: RotoTrackingMatrix4 | undefined,
  frame: number,
): number[][] => {
  const source = matrix ?? createIdentityRotoTrackingMatrix4();
  return source.map((row) => row.map((value) => getLinearValueAtFrame(value, frame)));
};

export const multiplyRotoTrackingMatrix4 = (
  leftMatrix: number[][],
  rightMatrix: number[][],
): number[][] =>
  Array.from({ length: MATRIX_SIZE }, (_, rowIndex) =>
    Array.from({ length: MATRIX_SIZE }, (_, columnIndex) =>
      Array.from({ length: MATRIX_SIZE }, (_, innerIndex) => innerIndex).reduce(
        (sum, innerIndex) =>
          sum +
          (leftMatrix[rowIndex]?.[innerIndex] ?? 0) * (rightMatrix[innerIndex]?.[columnIndex] ?? 0),
        0,
      ),
    ),
  );

export const applyRotoTrackingMatrix4ToPoint = (
  matrix: number[][],
  point: Pick<Point, 'x' | 'y'>,
): Point => {
  const x =
    (matrix[0]?.[0] ?? 0) * point.x +
    (matrix[0]?.[1] ?? 0) * point.y +
    (matrix[0]?.[2] ?? 0) * 0 +
    (matrix[0]?.[3] ?? 0);
  const y =
    (matrix[1]?.[0] ?? 0) * point.x +
    (matrix[1]?.[1] ?? 0) * point.y +
    (matrix[1]?.[2] ?? 0) * 0 +
    (matrix[1]?.[3] ?? 0);
  const w =
    (matrix[3]?.[0] ?? 0) * point.x +
    (matrix[3]?.[1] ?? 0) * point.y +
    (matrix[3]?.[2] ?? 0) * 0 +
    (matrix[3]?.[3] ?? 1);
  const divisor = Math.abs(w) > EPSILON ? w : 1;

  return { x: x / divisor, y: y / divisor };
};

export const stabilizePoint = (
  point: Pick<Point, 'x' | 'y'>,
  stabilizationMatrix: number[][] | null,
): Point => {
  if (!stabilizationMatrix) return { x: point.x, y: point.y };
  return applyRotoTrackingMatrix4ToPoint(stabilizationMatrix, point);
};

export const stabilizePoints = (
  points: Pick<Point, 'x' | 'y'>[],
  stabilizationMatrix: number[][] | null,
): Point[] => {
  if (!stabilizationMatrix) return points.map((p) => ({ x: p.x, y: p.y }));
  return points.map((p) => applyRotoTrackingMatrix4ToPoint(stabilizationMatrix, p));
};

export const invertRotoTrackingMatrix4 = (matrix: number[][]): number[][] | null => {
  const augmented = Array.from({ length: MATRIX_SIZE }, (_, rowIndex) => [
    ...(matrix[rowIndex] ?? createIdentityRow(rowIndex)).slice(0, MATRIX_SIZE),
    ...createIdentityRow(rowIndex),
  ]);

  for (let pivotIndex = 0; pivotIndex < MATRIX_SIZE; pivotIndex += 1) {
    let bestRowIndex = pivotIndex;
    let bestPivotValue = Math.abs(augmented[pivotIndex]?.[pivotIndex] ?? 0);

    for (
      let candidateRowIndex = pivotIndex + 1;
      candidateRowIndex < MATRIX_SIZE;
      candidateRowIndex += 1
    ) {
      const candidateValue = Math.abs(augmented[candidateRowIndex]?.[pivotIndex] ?? 0);
      if (candidateValue > bestPivotValue) {
        bestRowIndex = candidateRowIndex;
        bestPivotValue = candidateValue;
      }
    }

    if (bestPivotValue <= EPSILON) {
      return null;
    }

    if (bestRowIndex !== pivotIndex) {
      [augmented[pivotIndex], augmented[bestRowIndex]] = [
        augmented[bestRowIndex],
        augmented[pivotIndex],
      ];
    }

    const pivotValue = augmented[pivotIndex][pivotIndex];
    for (let columnIndex = 0; columnIndex < MATRIX_SIZE * 2; columnIndex += 1) {
      augmented[pivotIndex][columnIndex] /= pivotValue;
    }

    for (let rowIndex = 0; rowIndex < MATRIX_SIZE; rowIndex += 1) {
      if (rowIndex === pivotIndex) continue;
      const factor = augmented[rowIndex][pivotIndex];
      if (Math.abs(factor) <= EPSILON) continue;

      for (let columnIndex = 0; columnIndex < MATRIX_SIZE * 2; columnIndex += 1) {
        augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
      }
    }
  }

  return augmented.map((row) => row.slice(MATRIX_SIZE));
};

const getRotoLayerChain = (node: RotoNode, layerId: string): RotoLayer[] => {
  const layerMap = new Map(getRotoLayers(node).map((layer) => [layer.id, layer]));
  const chain: RotoLayer[] = [];
  const visited = new Set<string>();

  let currentLayerId: string | null = layerId;
  while (currentLayerId && !visited.has(currentLayerId)) {
    visited.add(currentLayerId);
    const layer = layerMap.get(currentLayerId);
    if (!layer) break;
    chain.unshift(layer);
    currentLayerId = layer.parentLayerId ?? null;
  }

  return chain;
};

const composeResolvedMatrices = (matrices: readonly number[][][]): number[][] =>
  matrices.reduce(
    (composedMatrix, currentMatrix) => multiplyRotoTrackingMatrix4(composedMatrix, currentMatrix),
    createIdentityResolvedMatrix4(),
  );

const getResolvedRotoLayerMatrices = (
  layer: RotoLayer,
  frame: number,
  includeUserTransform: boolean,
): number[][][] => {
  const matrices = [resolveRotoTrackingMatrix4(layer.trackingTransform?.matrix, frame)];
  if (includeUserTransform && layer.userTransform) {
    matrices.push(resolveRotoTrackingMatrix4(layer.userTransform.matrix, frame));
  }
  return matrices;
};

export const resolveRotoLayerCompositeMatrix = (
  node: RotoNode,
  layerId: string | null | undefined,
  frame: number,
  options?: {
    includeSelf?: boolean;
    includeUserTransform?: boolean;
  },
): number[][] => {
  if (!layerId) {
    return createIdentityResolvedMatrix4();
  }

  const layerChain = getRotoLayerChain(node, layerId);
  const lastIndex = options?.includeSelf === false ? layerChain.length - 1 : layerChain.length;
  const includeUserTransform = options?.includeUserTransform ?? false;

  return composeResolvedMatrices(
    layerChain
      .slice(0, Math.max(0, lastIndex))
      .flatMap((layer) => getResolvedRotoLayerMatrices(layer, frame, includeUserTransform)),
  );
};

export const resolveRotoPathTrackOffsetAtFrame = (
  path: RotoPath,
  frame: number,
  pointIndex: number,
): Point => {
  const trackPoint = path.trackPoints?.[pointIndex];
  return {
    x: trackPoint ? getLinearValueAtFrame(trackPoint.x, frame) : 0,
    y: trackPoint ? getLinearValueAtFrame(trackPoint.y, frame) : 0,
  };
};

export const resolveRotoPathLocalPointsAtFrame = (path: RotoPath, frame: number): Point[] =>
  path.points.map((point, pointIndex) => {
    const trackOffset = resolveRotoPathTrackOffsetAtFrame(path, frame, pointIndex);
    return {
      x: getLinearValueAtFrame(point.x, frame) + trackOffset.x,
      y: getLinearValueAtFrame(point.y, frame) + trackOffset.y,
    };
  });

export const deriveUserTranslationFromPoints = (
  path: RotoPath,
  referenceFrame: number,
  currentFrame: number,
): number[][] => {
  if (path.points.length === 0) {
    return createIdentityResolvedMatrix4();
  }

  let refCentroidX = 0;
  let refCentroidY = 0;
  let curCentroidX = 0;
  let curCentroidY = 0;
  const count = path.points.length;

  for (const point of path.points) {
    refCentroidX += getLinearValueAtFrame(point.x, referenceFrame);
    refCentroidY += getLinearValueAtFrame(point.y, referenceFrame);
    curCentroidX += getLinearValueAtFrame(point.x, currentFrame);
    curCentroidY += getLinearValueAtFrame(point.y, currentFrame);
  }

  const dx = (curCentroidX - refCentroidX) / count;
  const dy = (curCentroidY - refCentroidY) / count;

  return projectTrackingModelToMatrix4([dx, dy], 'translation');
};

export const resolveRotoPathCompositeMatrix = (
  node: RotoNode,
  path: RotoPath,
  frame: number,
  options?: {
    excludeUpToLayerId?: string | null;
    includePathTransform?: boolean;
    includeUserTransform?: boolean;
  },
): number[][] => {
  const parentLayerId = getRotoPathParentLayerId(node, path);
  const layerChain = parentLayerId ? getRotoLayerChain(node, parentLayerId) : [];
  const excludedLayerIndex =
    options?.excludeUpToLayerId !== undefined && options.excludeUpToLayerId !== null
      ? layerChain.findIndex((layer) => layer.id === options.excludeUpToLayerId)
      : -1;
  const remainingLayerChain =
    excludedLayerIndex >= 0 ? layerChain.slice(excludedLayerIndex + 1) : layerChain;
  const includeUserTransform = options?.includeUserTransform ?? false;
  const layerMatrix = composeResolvedMatrices(
    remainingLayerChain.flatMap((layer) =>
      getResolvedRotoLayerMatrices(layer, frame, includeUserTransform),
    ),
  );

  if (options?.includePathTransform === false) {
    return layerMatrix;
  }

  let result = multiplyRotoTrackingMatrix4(
    layerMatrix,
    resolveRotoTrackingMatrix4(path.trackingTransform?.matrix, frame),
  );

  if (includeUserTransform && path.userTransform) {
    result = multiplyRotoTrackingMatrix4(
      result,
      resolveRotoTrackingMatrix4(path.userTransform.matrix, frame),
    );
  }

  return result;
};

export const resolveRotoPathPointsAtFrame = (
  node: RotoNode,
  path: RotoPath,
  frame: number,
  options?: {
    excludeUpToLayerId?: string | null;
    includePathTransform?: boolean;
    includeUserTransform?: boolean;
  },
): Point[] => {
  const compositeMatrix = resolveRotoPathCompositeMatrix(node, path, frame, {
    ...options,
    includeUserTransform: options?.includeUserTransform ?? true,
  });
  return resolveRotoPathLocalPointsAtFrame(path, frame).map((point) =>
    applyRotoTrackingMatrix4ToPoint(compositeMatrix, point),
  );
};

export const projectScenePointToRotoLayerLocal = (
  node: RotoNode,
  layerId: string | null | undefined,
  frame: number,
  point: Pick<Point, 'x' | 'y'>,
): Point => {
  const inverseMatrix = invertRotoTrackingMatrix4(
    resolveRotoLayerCompositeMatrix(node, layerId, frame, { includeUserTransform: true }),
  );
  return inverseMatrix ? applyRotoTrackingMatrix4ToPoint(inverseMatrix, point) : { ...point };
};

export const projectScenePointToRotoPathResolvedLocal = (
  node: RotoNode,
  path: RotoPath,
  frame: number,
  point: Pick<Point, 'x' | 'y'>,
): Point => {
  const inverseMatrix = invertRotoTrackingMatrix4(
    resolveRotoPathCompositeMatrix(node, path, frame, { includeUserTransform: true }),
  );
  return inverseMatrix ? applyRotoTrackingMatrix4ToPoint(inverseMatrix, point) : { ...point };
};

export const projectScenePointToRotoPathBasePoint = (
  node: RotoNode,
  path: RotoPath,
  frame: number,
  pointIndex: number,
  point: Pick<Point, 'x' | 'y'>,
  trackOffsetOverride?: Pick<Point, 'x' | 'y'>,
): Point => {
  const resolvedLocalPoint = projectScenePointToRotoPathResolvedLocal(node, path, frame, point);
  const trackOffset =
    trackOffsetOverride ?? resolveRotoPathTrackOffsetAtFrame(path, frame, pointIndex);
  return {
    x: resolvedLocalPoint.x - trackOffset.x,
    y: resolvedLocalPoint.y - trackOffset.y,
  };
};

export const resolveRotoTrackingTransformDataFromMatrix = (
  matrix: number[][],
): { x: number; y: number; scale: number; rotation: number; matrix: number[][] } => {
  const origin = applyRotoTrackingMatrix4ToPoint(matrix, { x: 0, y: 0 });
  const xAxisPoint = applyRotoTrackingMatrix4ToPoint(matrix, { x: 1, y: 0 });
  const yAxisPoint = applyRotoTrackingMatrix4ToPoint(matrix, { x: 0, y: 1 });
  const xAxis = { x: xAxisPoint.x - origin.x, y: xAxisPoint.y - origin.y };
  const yAxis = { x: yAxisPoint.x - origin.x, y: yAxisPoint.y - origin.y };
  const xScale = Math.hypot(xAxis.x, xAxis.y);
  const yScale = Math.hypot(yAxis.x, yAxis.y);

  return {
    x: origin.x,
    y: origin.y,
    scale: xScale > EPSILON || yScale > EPSILON ? (xScale + yScale) / 2 : 1,
    rotation: Math.atan2(xAxis.y, xAxis.x),
    matrix,
  };
};

export const resolveRotoTrackingTransformData = (
  transform: RotoTrackingTransform | undefined,
  frame: number,
): { x: number; y: number; scale: number; rotation: number } | null =>
  transform
    ? resolveRotoTrackingTransformDataFromMatrix(
        resolveRotoTrackingMatrix4(transform.matrix, frame),
      )
    : null;

export const reduceRotoTrackingMatrix4ToComponents = (
  matrix: number[][],
  config: TransformComponentConfig,
): number[][] => {
  if (!isTransformComponentEnabled(config)) {
    return createIdentityResolvedMatrix4();
  }

  const transformedPoints = STABILIZATION_REFERENCE_POINTS.map((point) =>
    applyRotoTrackingMatrix4ToPoint(matrix, point),
  );
  const solvedTransform = fitTrackedTransform(STABILIZATION_REFERENCE_POINTS, transformedPoints, {
    ...config,
    deform: false,
  });

  return solvedTransform
    ? projectTrackingModelToMatrix4(solvedTransform.model, solvedTransform.type)
    : createIdentityResolvedMatrix4();
};

export const formatRotoTrackingMatrix4AsCssMatrix3d = (matrix: number[][]): string => {
  const values = [
    matrix[0]?.[0] ?? 1,
    matrix[1]?.[0] ?? 0,
    matrix[2]?.[0] ?? 0,
    matrix[3]?.[0] ?? 0,
    matrix[0]?.[1] ?? 0,
    matrix[1]?.[1] ?? 1,
    matrix[2]?.[1] ?? 0,
    matrix[3]?.[1] ?? 0,
    matrix[0]?.[2] ?? 0,
    matrix[1]?.[2] ?? 0,
    matrix[2]?.[2] ?? 1,
    matrix[3]?.[2] ?? 0,
    matrix[0]?.[3] ?? 0,
    matrix[1]?.[3] ?? 0,
    matrix[2]?.[3] ?? 0,
    matrix[3]?.[3] ?? 1,
  ];

  return `matrix3d(${values.join(', ')})`;
};

export const keyframeRotoTrackingMatrix4 = (
  currentMatrix: RotoTrackingMatrix4 | undefined,
  frame: number,
  resolvedMatrix: number[][],
): RotoTrackingMatrix4 => {
  const source = currentMatrix ?? createIdentityRotoTrackingMatrix4();
  return source.map((row, rowIndex) =>
    row.map((value, columnIndex) =>
      setKeyframeOnValue(value, frame, resolvedMatrix[rowIndex]?.[columnIndex] ?? 0),
    ),
  );
};

export const projectTrackingModelToMatrix4 = (
  model: number[],
  type: RotoTrackingModel,
): number[][] => {
  switch (type) {
    case 'translation':
      return [
        [1, 0, 0, model[0] ?? 0],
        [0, 1, 0, model[1] ?? 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ];
    case 'similarity':
      return [
        [model[0] ?? 1, -(model[1] ?? 0), 0, model[2] ?? 0],
        [model[1] ?? 0, model[0] ?? 1, 0, model[3] ?? 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ];
    case 'affine':
      return [
        [model[0] ?? 1, model[1] ?? 0, 0, model[2] ?? 0],
        [model[3] ?? 0, model[4] ?? 1, 0, model[5] ?? 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ];
    case 'homography':
      return [
        [model[0] ?? 1, model[1] ?? 0, 0, model[2] ?? 0],
        [model[3] ?? 0, model[4] ?? 1, 0, model[5] ?? 0],
        [0, 0, 1, 0],
        [model[6] ?? 0, model[7] ?? 0, 0, model[8] ?? 1],
      ];
  }
};

export const updateTrackingTransform = (
  currentTransform: RotoTrackingTransform | undefined,
  frame: number,
  resolvedMatrix: number[][],
  model: RotoTrackingModel,
  sourcePathIds: string[],
): RotoTrackingTransform => ({
  matrix: keyframeRotoTrackingMatrix4(currentTransform?.matrix, frame, resolvedMatrix),
  model,
  sourcePathIds: [...sourcePathIds],
});

const createPendingLayerTrackingTarget = (
  node: RotoNode,
  parentLayerId: string | null,
): PendingRotoTrackingLayerTarget => ({
  kind: 'layer',
  createLayer: true,
  parentLayerId,
  layerName: getNextRotoLayerName(node),
});

export const isPendingRotoTrackingLayerTarget = (
  target: RotoTrackingTarget | null | undefined,
): target is PendingRotoTrackingLayerTarget =>
  !!target && target.kind === 'layer' && 'createLayer' in target && target.createLayer === true;

export const materializeRotoTrackingTarget = (
  node: RotoNode,
  sourcePathIds: readonly string[],
  target: RotoTrackingTarget,
): { node: RotoNode; target: ResolvedRotoTrackingTarget } => {
  if (target.kind === 'shape') {
    return { node, target };
  }

  if (!isPendingRotoTrackingLayerTarget(target)) {
    return { node, target };
  }

  const nextLayer = createRotoLayer(target.layerName, target.parentLayerId);
  const nodeWithLayer = {
    ...node,
    layers: [...(node.layers ?? []), nextLayer],
  };

  return {
    node: {
      ...nodeWithLayer,
      ...moveRotoPathsToLayer(nodeWithLayer, sourcePathIds, nextLayer.id),
    },
    target: {
      kind: 'layer',
      layerId: nextLayer.id,
    },
  };
};

export const resolveRotoTrackingSelection = (
  node: RotoNode,
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): RotoTrackingSelectionScope => {
  const layerMap = new Map(getRotoLayers(node).map((layer) => [layer.id, layer]));
  const validSelectedLayerIds = [...new Set(selectedLayerIds)].filter((layerId) =>
    layerMap.has(layerId),
  );
  const selectedPaths = node.paths.filter((path) => selectedPathIds.includes(path.id));

  if (validSelectedLayerIds.length === 1 && selectedPaths.length === 0) {
    const layerId = validSelectedLayerIds[0];
    const sourcePathIds = getRotoLayerPathIds(node, layerId);
    const layerTarget = layerMap.get(layerId) ?? null;

    return {
      sourcePathIds,
      availableTargets: sourcePathIds.length > 0 ? ['layer'] : [],
      defaultTarget: sourcePathIds.length > 0 ? { kind: 'layer', layerId } : null,
      shapeTargetPath: null,
      layerTarget,
      layerTargetOption: sourcePathIds.length > 0 ? { kind: 'layer', layerId } : null,
      reason: sourcePathIds.length > 0 ? undefined : 'Selected layer has no shapes to track.',
    };
  }

  if (selectedPaths.length === 1) {
    const shapeTargetPath = selectedPaths[0];
    const parentLayerId = getRotoPathParentLayerId(node, shapeTargetPath);
    const layerTarget = parentLayerId ? (layerMap.get(parentLayerId) ?? null) : null;
    const layerTargetOption = layerTarget
      ? ({ kind: 'layer', layerId: layerTarget.id } as const)
      : createPendingLayerTrackingTarget(node, null);

    return {
      sourcePathIds: [shapeTargetPath.id],
      availableTargets: ['shape', 'layer'],
      defaultTarget: { kind: 'shape', pathId: shapeTargetPath.id },
      shapeTargetPath,
      layerTarget,
      layerTargetOption,
    };
  }

  if (selectedPaths.length > 1) {
    const sourcePathIds = selectedPaths.map((path) => path.id);
    const commonLayerId = getCommonRotoParentLayerId(node, sourcePathIds);
    const layerTarget = commonLayerId ? (layerMap.get(commonLayerId) ?? null) : null;
    const allPathsUnparented = selectedPaths.every(
      (path) => getRotoPathParentLayerId(node, path) === null,
    );
    const layerTargetOption = layerTarget
      ? ({ kind: 'layer', layerId: layerTarget.id } as const)
      : allPathsUnparented
        ? createPendingLayerTrackingTarget(node, null)
        : null;

    return {
      sourcePathIds,
      availableTargets: layerTargetOption ? ['layer'] : [],
      defaultTarget: layerTargetOption,
      shapeTargetPath: null,
      layerTarget,
      layerTargetOption,
      reason: layerTargetOption
        ? undefined
        : 'Multi-shape tracking needs the selected shapes to share a parent layer.',
    };
  }

  return {
    sourcePathIds: [],
    availableTargets: [],
    defaultTarget: null,
    shapeTargetPath: null,
    layerTarget: null,
    layerTargetOption: null,
    reason: 'Select a shape or layer to track.',
  };
};
