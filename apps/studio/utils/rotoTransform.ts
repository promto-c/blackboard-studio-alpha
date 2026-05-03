export type ScenePoint = { x: number; y: number };

export interface RotoTransformBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export type TransformHandleKind =
  | 'move'
  | 'rotate'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';
export type TransformOperation =
  | 'move'
  | 'scale'
  | 'rotate'
  | 'shear'
  | 'scale_shear'
  | 'perspective'
  | 'bilinear';

type EdgeHandle = 'n' | 'e' | 's' | 'w';
type CornerHandle = 'nw' | 'ne' | 'se' | 'sw';

const EPSILON = 1e-6;
const SNAP_ANGLE = Math.PI / 12; // 15deg

const finiteOr = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const safeDivide = (numerator: number, denominator: number, fallback = 1): number =>
  Math.abs(denominator) <= EPSILON ? fallback : numerator / denominator;

const isCornerHandle = (handle: TransformHandleKind): handle is CornerHandle =>
  handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';

const isEdgeHandle = (handle: TransformHandleKind): handle is EdgeHandle =>
  handle === 'n' || handle === 'e' || handle === 's' || handle === 'w';

export const getRotoTransformBounds = (points: ScenePoint[]): RotoTransformBounds | null => {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
};

export const isTransformBoundsDegenerate = (
  bounds: RotoTransformBounds,
  epsilon = EPSILON,
): boolean => bounds.width <= epsilon || bounds.height <= epsilon;

export const getTransformHandlePosition = (
  bounds: RotoTransformBounds,
  handle: TransformHandleKind,
): ScenePoint => {
  switch (handle) {
    case 'move':
      return { x: bounds.centerX, y: bounds.centerY };
    case 'rotate':
      return { x: bounds.centerX, y: bounds.minY };
    case 'nw':
      return { x: bounds.minX, y: bounds.minY };
    case 'n':
      return { x: bounds.centerX, y: bounds.minY };
    case 'ne':
      return { x: bounds.maxX, y: bounds.minY };
    case 'e':
      return { x: bounds.maxX, y: bounds.centerY };
    case 'se':
      return { x: bounds.maxX, y: bounds.maxY };
    case 's':
      return { x: bounds.centerX, y: bounds.maxY };
    case 'sw':
      return { x: bounds.minX, y: bounds.maxY };
    case 'w':
      return { x: bounds.minX, y: bounds.centerY };
  }
};

const getScalePivot = (
  bounds: RotoTransformBounds,
  handle: TransformHandleKind,
  fromCenter: boolean,
): ScenePoint => {
  if (fromCenter) {
    return { x: bounds.centerX, y: bounds.centerY };
  }

  switch (handle) {
    case 'nw':
      return { x: bounds.maxX, y: bounds.maxY };
    case 'n':
      return { x: bounds.centerX, y: bounds.maxY };
    case 'ne':
      return { x: bounds.minX, y: bounds.maxY };
    case 'e':
      return { x: bounds.minX, y: bounds.centerY };
    case 'se':
      return { x: bounds.minX, y: bounds.minY };
    case 's':
      return { x: bounds.centerX, y: bounds.minY };
    case 'sw':
      return { x: bounds.maxX, y: bounds.minY };
    case 'w':
      return { x: bounds.maxX, y: bounds.centerY };
    case 'move':
    case 'rotate':
      return { x: bounds.centerX, y: bounds.centerY };
  }
};

const getShearPivot = (
  bounds: RotoTransformBounds,
  handle: EdgeHandle,
  fromCenter: boolean,
): ScenePoint => {
  if (fromCenter) {
    return { x: bounds.centerX, y: bounds.centerY };
  }

  switch (handle) {
    case 'n':
      return { x: bounds.centerX, y: bounds.maxY };
    case 's':
      return { x: bounds.centerX, y: bounds.minY };
    case 'e':
      return { x: bounds.minX, y: bounds.centerY };
    case 'w':
      return { x: bounds.maxX, y: bounds.centerY };
  }
};

const getAxisDeltaFromPivot = (point: ScenePoint, pivot: ScenePoint, axis: 'x' | 'y'): number => {
  return axis === 'x' ? point.x - pivot.x : point.y - pivot.y;
};

const rotatePointAroundPivot = (
  point: ScenePoint,
  pivot: ScenePoint,
  radians: number,
): ScenePoint => {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    x: pivot.x + (dx * cos - dy * sin),
    y: pivot.y + (dx * sin + dy * cos),
  };
};

const solveLinearSystem = (matrix: number[][], rhs: number[]): number[] | null => {
  const n = rhs.length;
  const aug = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const candidate = Math.abs(aug[row][col]);
      if (candidate > pivotAbs) {
        pivotAbs = candidate;
        pivotRow = row;
      }
    }
    if (pivotAbs < 1e-9) return null;

    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col][col];
    for (let c = col; c <= n; c++) aug[col][c] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      if (Math.abs(factor) <= EPSILON) continue;
      for (let c = col; c <= n; c++) {
        aug[row][c] -= factor * aug[col][c];
      }
    }
  }

  return aug.map((row) => row[n]);
};

const solveHomography = (src: ScenePoint[], dst: ScenePoint[]): number[] | null => {
  if (src.length !== 4 || dst.length !== 4) return null;

  const matrix: number[][] = [];
  const rhs: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }

  const params = solveLinearSystem(matrix, rhs);
  if (!params) return null;

  const model = [
    params[0],
    params[1],
    params[2],
    params[3],
    params[4],
    params[5],
    params[6],
    params[7],
    1,
  ];
  return model.every(Number.isFinite) ? model : null;
};

const applyHomography = (point: ScenePoint, model: number[]): ScenePoint => {
  const den = model[6] * point.x + model[7] * point.y + model[8];
  if (Math.abs(den) <= EPSILON) return { ...point };
  return {
    x: (model[0] * point.x + model[1] * point.y + model[2]) / den,
    y: (model[3] * point.x + model[4] * point.y + model[5]) / den,
  };
};

const getPerspectiveSourceCorners = (bounds: RotoTransformBounds): ScenePoint[] => [
  { x: bounds.minX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY },
  { x: bounds.minX, y: bounds.maxY },
];

const getPerspectiveDestinationCorners = (
  bounds: RotoTransformBounds,
  handle: CornerHandle,
  dx: number,
  dy: number,
): ScenePoint[] => {
  const corners = getPerspectiveSourceCorners(bounds);
  const cornerIndex = { nw: 0, ne: 1, se: 2, sw: 3 }[handle];
  corners[cornerIndex] = {
    x: corners[cornerIndex].x + dx,
    y: corners[cornerIndex].y + dy,
  };
  return corners;
};

const applyBilinearWarp = (
  point: ScenePoint,
  bounds: RotoTransformBounds,
  corners: [ScenePoint, ScenePoint, ScenePoint, ScenePoint],
): ScenePoint => {
  const u = bounds.width <= EPSILON ? 0.5 : (point.x - bounds.minX) / bounds.width;
  const v = bounds.height <= EPSILON ? 0.5 : (point.y - bounds.minY) / bounds.height;
  const uu = finiteOr(u, 0.5);
  const vv = finiteOr(v, 0.5);
  const w00 = (1 - uu) * (1 - vv);
  const w10 = uu * (1 - vv);
  const w11 = uu * vv;
  const w01 = (1 - uu) * vv;
  const [p00, p10, p11, p01] = corners;

  return {
    x: p00.x * w00 + p10.x * w10 + p11.x * w11 + p01.x * w01,
    y: p00.y * w00 + p10.y * w10 + p11.y * w11 + p01.y * w01,
  };
};

// --- Helper functions for transform handles (shared between overlay + interaction handlers) ---

export const isEdgeTransformHandle = (
  handle: TransformHandleKind,
): handle is 'n' | 'e' | 's' | 'w' =>
  handle === 'n' || handle === 'e' || handle === 's' || handle === 'w';

export const getTransformHandleCursor = (
  handle: TransformHandleKind,
  useAffineModifier = false,
  usePerspectiveModifier = false,
): string => {
  if (usePerspectiveModifier && isCornerHandle(handle)) return 'cursor-all-scroll';
  if (useAffineModifier && isEdgeTransformHandle(handle)) return 'cursor-all-scroll';
  switch (handle) {
    case 'move':
      return 'cursor-move';
    case 'rotate':
      return 'cursor-crosshair';
    case 'nw':
    case 'se':
      return 'cursor-nwse-resize';
    case 'ne':
    case 'sw':
      return 'cursor-nesw-resize';
    case 'n':
    case 's':
      return 'cursor-ns-resize';
    case 'e':
    case 'w':
      return 'cursor-ew-resize';
  }
};

export const getTransformOperationForHandle = (
  handle: TransformHandleKind,
  useAffineModifier: boolean,
  usePerspectiveModifier = false,
): TransformOperation => {
  if (handle === 'move') return 'move';
  if (handle === 'rotate') return 'rotate';
  if (isCornerHandle(handle) && usePerspectiveModifier) return 'perspective';
  if (isCornerHandle(handle) && useAffineModifier) return 'bilinear';
  if (isEdgeTransformHandle(handle) && useAffineModifier) return 'scale_shear';
  return 'scale';
};

export const getTransformOperationLabel = (operation: TransformOperation): string => {
  switch (operation) {
    case 'move':
      return 'Move';
    case 'rotate':
      return 'Rotate';
    case 'scale':
      return 'Stretch';
    case 'shear':
      return 'Affine Shear';
    case 'scale_shear':
      return 'Affine + Stretch';
    case 'perspective':
      return 'Perspective';
    case 'bilinear':
      return 'Bilinear Warp';
  }
};

export interface ApplyRotoTransformOptions {
  operation: TransformOperation;
  handle: TransformHandleKind;
  points: ScenePoint[];
  bounds: RotoTransformBounds;
  startMouse: ScenePoint;
  currentMouse: ScenePoint;
  shiftKey?: boolean;
  altKey?: boolean;
}

export const applyRotoTransform = ({
  operation,
  handle,
  points,
  bounds,
  startMouse,
  currentMouse,
  shiftKey = false,
  altKey = false,
}: ApplyRotoTransformOptions): ScenePoint[] => {
  if (points.length === 0) return points;

  const dx = finiteOr(currentMouse.x - startMouse.x, 0);
  const dy = finiteOr(currentMouse.y - startMouse.y, 0);

  if (operation === 'move') {
    return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }

  if (operation === 'rotate') {
    const pivot = { x: bounds.centerX, y: bounds.centerY };
    const startAngle = Math.atan2(startMouse.y - pivot.y, startMouse.x - pivot.x);
    const currentAngle = Math.atan2(currentMouse.y - pivot.y, currentMouse.x - pivot.x);
    let deltaAngle = finiteOr(currentAngle - startAngle, 0);
    if (shiftKey) {
      deltaAngle = Math.round(deltaAngle / SNAP_ANGLE) * SNAP_ANGLE;
    }
    return points.map((point) => rotatePointAroundPivot(point, pivot, deltaAngle));
  }

  if (operation === 'perspective') {
    if (!isCornerHandle(handle)) return points;
    const model = solveHomography(
      getPerspectiveSourceCorners(bounds),
      getPerspectiveDestinationCorners(bounds, handle, dx, dy),
    );
    return model ? points.map((point) => applyHomography(point, model)) : points;
  }

  if (operation === 'bilinear') {
    if (!isCornerHandle(handle)) return points;
    const corners = getPerspectiveDestinationCorners(bounds, handle, dx, dy) as [
      ScenePoint,
      ScenePoint,
      ScenePoint,
      ScenePoint,
    ];
    return points.map((point) => applyBilinearWarp(point, bounds, corners));
  }

  if (operation === 'scale' || operation === 'scale_shear') {
    const pivot = getScalePivot(bounds, handle, altKey);
    const startHandlePos = getTransformHandlePosition(bounds, handle);
    const currentHandlePos = {
      x: startHandlePos.x + dx,
      y: startHandlePos.y + dy,
    };

    const allowScaleX = handle === 'e' || handle === 'w' || isCornerHandle(handle);
    const allowScaleY = handle === 'n' || handle === 's' || isCornerHandle(handle);

    let scaleX = allowScaleX
      ? safeDivide(currentHandlePos.x - pivot.x, startHandlePos.x - pivot.x, 1)
      : 1;
    let scaleY = allowScaleY
      ? safeDivide(currentHandlePos.y - pivot.y, startHandlePos.y - pivot.y, 1)
      : 1;

    if (shiftKey && isCornerHandle(handle)) {
      const startVec = {
        x: startHandlePos.x - pivot.x,
        y: startHandlePos.y - pivot.y,
      };
      const currentVec = {
        x: currentHandlePos.x - pivot.x,
        y: currentHandlePos.y - pivot.y,
      };
      const startLen = Math.hypot(startVec.x, startVec.y);
      if (startLen > EPSILON) {
        let uniformScale = Math.hypot(currentVec.x, currentVec.y) / startLen;
        const dot = startVec.x * currentVec.x + startVec.y * currentVec.y;
        if (dot < 0) uniformScale *= -1;
        scaleX = uniformScale;
        scaleY = uniformScale;
      }
    }

    scaleX = finiteOr(scaleX, 1);
    scaleY = finiteOr(scaleY, 1);

    const scaledPoints = points.map((point) => ({
      x: pivot.x + (point.x - pivot.x) * scaleX,
      y: pivot.y + (point.y - pivot.y) * scaleY,
    }));

    if (operation === 'scale' || !isEdgeHandle(handle)) {
      return scaledPoints;
    }

    // Combined edge interaction: stretch on the edge normal + affine shear on the edge tangent.
    const shearPivot = getShearPivot(bounds, handle, altKey);
    if (handle === 'n' || handle === 's') {
      const scaledHandlePos = {
        x: startHandlePos.x,
        y: currentHandlePos.y,
      };
      const handleYOffset = getAxisDeltaFromPivot(scaledHandlePos, shearPivot, 'y');
      const shearX = finiteOr(safeDivide(dx, handleYOffset, 0), 0);
      return scaledPoints.map((point) => ({
        x: point.x + (point.y - shearPivot.y) * shearX,
        y: point.y,
      }));
    }

    const scaledHandlePos = {
      x: currentHandlePos.x,
      y: startHandlePos.y,
    };
    const handleXOffset = getAxisDeltaFromPivot(scaledHandlePos, shearPivot, 'x');
    const shearY = finiteOr(safeDivide(dy, handleXOffset, 0), 0);
    return scaledPoints.map((point) => ({
      x: point.x,
      y: point.y + (point.x - shearPivot.x) * shearY,
    }));
  }

  if (operation === 'shear') {
    if (!isEdgeHandle(handle)) return points;
    const pivot = getShearPivot(bounds, handle, altKey);

    if (handle === 'n' || handle === 's') {
      const shearSign = handle === 'n' ? -1 : 1;
      const shearX = finiteOr((dy / Math.max(bounds.height, EPSILON)) * shearSign, 0);
      return points.map((point) => ({
        x: point.x + (point.y - pivot.y) * shearX,
        y: point.y,
      }));
    }

    const shearSign = handle === 'w' ? -1 : 1;
    const shearY = finiteOr((dx / Math.max(bounds.width, EPSILON)) * shearSign, 0);
    return points.map((point) => ({
      x: point.x,
      y: point.y + (point.x - pivot.x) * shearY,
    }));
  }

  return points;
};
