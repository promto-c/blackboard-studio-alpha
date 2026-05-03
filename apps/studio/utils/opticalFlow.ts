import { Point } from '@blackboard/types';

// Configuration for the tracker
const WIN_SIZE = 21; // Window size (must be odd)
const MAX_ITERATIONS = 30;
const EPSILON = 0.01;
const PYRAMID_LEVELS = 3; // Number of pyramid levels (0 = original only)

interface ImageBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

interface TrackResult {
  x: number;
  y: number;
  error: number; // Forward-Backward consistency error in pixels
}

export type OpticalFlowPyramid = ImageBuffer[];

/**
 * Converts RGBA pixel data to Grayscale (Float32)
 */
function grayscale(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // Rec. 601 luma coefficients
    gray[i] = r * 0.299 + g * 0.587 + b * 0.114;
  }
  return gray;
}

/**
 * Downsamples an image by factor of 2 using a simple box filter approximation
 */
function downsample(src: ImageBuffer): ImageBuffer {
  const w = src.width;
  const h = src.height;
  const newW = Math.floor(w / 2);
  const newH = Math.floor(h / 2);
  const newData = new Float32Array(newW * newH);

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const idx = y * newW + x;

      // Simple 2x2 box average
      let sum = 0;
      let count = 0;

      // We need to be careful with boundaries if width/height are odd
      const x0 = x * 2;
      const y0 = y * 2;
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      // Pixel 0,0
      sum += src.data[y0 * w + x0];
      count++;
      // Pixel 1,0
      if (x1 < w) {
        sum += src.data[y0 * w + x1];
        count++;
      }
      // Pixel 0,1
      if (y1 < h) {
        sum += src.data[y1 * w + x0];
        count++;
      }
      // Pixel 1,1
      if (x1 < w && y1 < h) {
        sum += src.data[y1 * w + x1];
        count++;
      }

      newData[idx] = sum / count;
    }
  }
  return { data: newData, width: newW, height: newH };
}

/**
 * Builds an image pyramid from Level 0 (original) up to PYRAMID_LEVELS - 1
 */
function buildPyramid(pixels: Uint8ClampedArray, width: number, height: number): ImageBuffer[] {
  const pyramid: ImageBuffer[] = [];
  const gray = grayscale(pixels, width, height);

  // Level 0
  pyramid.push({ data: gray, width, height });

  // Levels 1 to N
  for (let i = 1; i < PYRAMID_LEVELS; i++) {
    const prev = pyramid[i - 1];
    // Stop if image gets too small for the window
    if (prev.width < WIN_SIZE || prev.height < WIN_SIZE) break;

    pyramid.push(downsample(prev));
  }
  return pyramid;
}

export function buildOpticalFlowPyramid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): OpticalFlowPyramid {
  return buildPyramid(pixels, width, height);
}

/**
 * Bilinear interpolation to sample image at non-integer coordinates
 */
function sample(img: Float32Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  if (x0 < 0 || x1 >= width || y0 < 0 || y1 >= height) return 0;

  const fx = x - x0;
  const fy = y - y0;

  const idx00 = y0 * width + x0;
  const idx10 = y0 * width + x1;
  const idx01 = y1 * width + x0;
  const idx11 = y1 * width + x1;

  const v00 = img[idx00];
  const v10 = img[idx10];
  const v01 = img[idx01];
  const v11 = img[idx11];

  return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
}

/**
 * Compute spatial derivatives (Scharr filter approximation)
 */
function computeGradients(
  img: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): { ix: number; iy: number } {
  // Central difference
  const valXPrev = sample(img, width, height, x - 1, y);
  const valXNext = sample(img, width, height, x + 1, y);
  const valYPrev = sample(img, width, height, x, y - 1);
  const valYNext = sample(img, width, height, x, y + 1);

  return {
    ix: (valXNext - valXPrev) * 0.5,
    iy: (valYNext - valYPrev) * 0.5,
  };
}

/**
 * Tracks a single point using iterative Lucas-Kanade for a specific image level
 */
function trackPointAtLevel(
  prevImg: Float32Array,
  currImg: Float32Array,
  width: number,
  height: number,
  px: number,
  py: number,
  guessDx: number,
  guessDy: number,
): { dx: number; dy: number; status: boolean } {
  let curX = px + guessDx;
  let curY = py + guessDy;

  const halfWin = Math.floor(WIN_SIZE / 2);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let G_xx = 0,
      G_xy = 0,
      G_yy = 0;
    let b_x = 0,
      b_y = 0;

    for (let wy = -halfWin; wy <= halfWin; wy++) {
      for (let wx = -halfWin; wx <= halfWin; wx++) {
        const prevX = px + wx;
        const prevY = py + wy;

        // Current point in J matches the template point I(x) displaced by current tracking estimate
        const currX = curX + wx;
        const currY = curY + wy;

        if (
          prevX < 0 ||
          prevX >= width ||
          prevY < 0 ||
          prevY >= height ||
          currX < 0 ||
          currX >= width ||
          currY < 0 ||
          currY >= height
        ) {
          continue;
        }

        // Compute gradient on the Previous image (Template)
        const grad = computeGradients(prevImg, width, height, prevX, prevY);

        // Temporal difference
        const I_val = sample(prevImg, width, height, prevX, prevY);
        const J_val = sample(currImg, width, height, currX, currY);
        const diff = I_val - J_val;

        G_xx += grad.ix * grad.ix;
        G_xy += grad.ix * grad.iy;
        G_yy += grad.iy * grad.iy;

        b_x += grad.ix * diff;
        b_y += grad.iy * diff;
      }
    }

    const det = G_xx * G_yy - G_xy * G_xy;

    if (Math.abs(det) < 0.001) {
      return { dx: curX - px, dy: curY - py, status: false };
    }

    // Solve G * v = b
    const invDet = 1.0 / det;
    const vx = (G_yy * b_x - G_xy * b_y) * invDet;
    const vy = (G_xx * b_y - G_xy * b_x) * invDet;

    curX += vx;
    curY += vy;

    if (vx * vx + vy * vy < EPSILON) {
      break;
    }
  }

  return { dx: curX - px, dy: curY - py, status: true };
}

/**
 * Runs the pyramidal tracking from Pyramid A to Pyramid B for a single point
 */
function runPyramidalTracking(
  pyrA: ImageBuffer[],
  pyrB: ImageBuffer[],
  startX: number,
  startY: number,
): { x: number; y: number; status: boolean } {
  const levels = Math.min(pyrA.length, pyrB.length);
  let flowX = 0;
  let flowY = 0;
  let status = true;

  // Iterate from coarsest level (top of pyramid) down to level 0 (original resolution)
  for (let level = levels - 1; level >= 0; level--) {
    if (!status) break;

    const imgA = pyrA[level];
    const imgB = pyrB[level];

    // Scale coordinates to current level
    const scale = 1.0 / Math.pow(2, level);
    const px = startX * scale;
    const py = startY * scale;

    // If we are coming from a coarser level, the flow estimate needs to be scaled up by 2
    if (level < levels - 1) {
      flowX *= 2;
      flowY *= 2;
    }

    // Track at this level using the upscaled flow as the initial guess
    const result = trackPointAtLevel(
      imgA.data,
      imgB.data,
      imgA.width,
      imgA.height,
      px,
      py,
      flowX,
      flowY,
    );

    if (result.status) {
      flowX = result.dx;
      flowY = result.dy;
    } else {
      status = false;
    }
  }

  return { x: startX + flowX, y: startY + flowY, status };
}

/**
 * Main function to track multiple points from imgA to imgB using Pyramidal LK
 * with Forward-Backward Consistency Check for scoring.
 */
export function calculateOpticalFlowFromPyramids(
  pyrA: OpticalFlowPyramid,
  pyrB: OpticalFlowPyramid,
  points: Point[],
): TrackResult[] {
  return points.map((p) => {
    // 2. Forward Track: A -> B
    const forward = runPyramidalTracking(pyrA, pyrB, p.x, p.y);

    if (!forward.status) {
      return { x: p.x, y: p.y, error: 100.0 }; // Tracking failed
    }

    // 3. Backward Track: B -> A (Consistency Check)
    // We start from the result of the forward track and try to find the original point in image A
    const backward = runPyramidalTracking(pyrB, pyrA, forward.x, forward.y);

    if (!backward.status) {
      return { x: forward.x, y: forward.y, error: 100.0 }; // Backward check failed
    }

    // 4. Calculate Forward-Backward Error (Euclidean distance between original and back-tracked)
    const diffX = p.x - backward.x;
    const diffY = p.y - backward.y;
    const fbError = Math.sqrt(diffX * diffX + diffY * diffY);

    return { x: forward.x, y: forward.y, error: fbError };
  });
}

export function calculateOpticalFlow(
  pixelsA: Uint8ClampedArray,
  pixelsB: Uint8ClampedArray,
  width: number,
  height: number,
  points: Point[],
): TrackResult[] {
  return calculateOpticalFlowFromPyramids(
    buildOpticalFlowPyramid(pixelsA, width, height),
    buildOpticalFlowPyramid(pixelsB, width, height),
    points,
  );
}

// --- Robust Solvers (RANSAC) ---

/**
 * Inverts a 3x3 matrix.
 * Returns null if singular.
 */
function invert3x3(m: number[]): number[] | null {
  const n11 = m[0],
    n12 = m[1],
    n13 = m[2];
  const n21 = m[3],
    n22 = m[4],
    n23 = m[5];
  const n31 = m[6],
    n32 = m[7],
    n33 = m[8];

  const t11 = n33 * n22 - n32 * n23;
  const t12 = n32 * n13 - n33 * n12;
  const t13 = n23 * n12 - n22 * n13;

  const det = n11 * t11 + n21 * t12 + n31 * t13;

  if (det === 0) return null;

  const invDet = 1 / det;

  return [
    t11 * invDet,
    (n31 * n23 - n33 * n21) * invDet,
    (n32 * n21 - n31 * n22) * invDet,
    t12 * invDet,
    (n33 * n11 - n31 * n13) * invDet,
    (n31 * n12 - n32 * n11) * invDet,
    t13 * invDet,
    (n21 * n13 - n23 * n11) * invDet,
    (n22 * n11 - n21 * n12) * invDet,
  ];
}

/**
 * Least Squares Affine Fit.
 * x' = ax + by + tx
 * y' = cx + dy + ty
 * Returns [a, b, tx, c, d, ty]
 */
function solveAffineLSQ(src: Point[], dst: Point[]): number[] | null {
  const n = src.length;
  if (n < 3) return null;

  let sx = 0,
    sy = 0,
    sx2 = 0,
    sy2 = 0,
    sxy = 0;
  let su = 0,
    sv = 0,
    sux = 0,
    suy = 0,
    svx = 0,
    svy = 0;

  for (let i = 0; i < n; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;

    sx += x;
    sy += y;
    sx2 += x * x;
    sy2 += y * y;
    sxy += x * y;
    su += u;
    sv += v;
    sux += u * x;
    suy += u * y;
    svx += v * x;
    svy += v * y;
  }

  const A = [sx2, sxy, sx, sxy, sy2, sy, sx, sy, n];

  const invA = invert3x3(A);
  if (!invA) return null;

  // Solve for row 1 (a, b, tx)
  const b1 = [sux, suy, su];
  const a = invA[0] * b1[0] + invA[1] * b1[1] + invA[2] * b1[2];
  const b = invA[3] * b1[0] + invA[4] * b1[1] + invA[5] * b1[2];
  const tx = invA[6] * b1[0] + invA[7] * b1[1] + invA[8] * b1[2];

  // Solve for row 2 (c, d, ty)
  const b2 = [svx, svy, sv];
  const c = invA[0] * b2[0] + invA[1] * b2[1] + invA[2] * b2[2];
  const d = invA[3] * b2[0] + invA[4] * b2[1] + invA[5] * b2[2];
  const ty = invA[6] * b2[0] + invA[7] * b2[1] + invA[8] * b2[2];

  return [a, b, tx, c, d, ty];
}

/**
 * Least Squares Similarity Fit (Translate + Rotate + Scale).
 * x' = a*x - b*y + tx
 * y' = b*x + a*y + ty
 * Returns [a, b, tx, ty]
 */
function solveSimilarityLSQ(src: Point[], dst: Point[]): number[] | null {
  const n = src.length;
  if (n < 2) return null;

  let sx = 0,
    sy = 0,
    su = 0,
    sv = 0;
  let sxx_yy = 0; // sum(x^2 + y^2)
  let sux_vy = 0; // sum(ux + vy)
  let svx_uy = 0; // sum(vx - uy)

  for (let i = 0; i < n; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;

    sx += x;
    sy += y;
    su += u;
    sv += v;
    sxx_yy += x * x + y * y;
    sux_vy += u * x + v * y;
    svx_uy += v * x - u * y;
  }

  // Solve linear system for 4 vars: a, b, tx, ty
  // Derived from minimizing sum squared error
  // Determinant of the 2x2 block for a,b relative to center
  const den = n * sxx_yy - sx * sx - sy * sy;

  if (Math.abs(den) < 1e-9) return null;

  const a = (n * sux_vy - sx * su - sy * sv) / den;
  const b = (n * svx_uy + sy * su - sx * sv) / den;
  const tx = (su - a * sx + b * sy) / n;
  const ty = (sv - b * sx - a * sy) / n;

  return [a, b, tx, ty];
}

function solveTranslation(src: Point[], dst: Point[]): number[] {
  let dx = 0,
    dy = 0;
  for (let i = 0; i < src.length; i++) {
    dx += dst[i].x - src[i].x;
    dy += dst[i].y - src[i].y;
  }
  return [dx / src.length, dy / src.length];
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const aug: number[][] = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let pivotRow = col;
    let pivotAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const candidate = Math.abs(aug[r][col]);
      if (candidate > pivotAbs) {
        pivotAbs = candidate;
        pivotRow = r;
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

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        aug[r][c] -= factor * aug[col][c];
      }
    }
  }

  return aug.map((row) => row[n]);
}

/**
 * Least Squares Homography Fit (Planar / Perspective).
 * Solves:
 * u = (h0*x + h1*y + h2) / (h6*x + h7*y + 1)
 * v = (h3*x + h4*y + h5) / (h6*x + h7*y + 1)
 * Returns 3x3 model flattened row-major with h8 = 1.
 */
function solveHomographyLSQ(src: Point[], dst: Point[]): number[] | null {
  const n = src.length;
  if (n < 4) return null;

  const ata: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  const atb: number[] = Array(8).fill(0);

  const accumulate = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) {
        ata[i][j] += row[i] * row[j];
      }
    }
  };

  for (let i = 0; i < n; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;

    // x*h0 + y*h1 + h2 - u*x*h6 - u*y*h7 = u
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    // x*h3 + y*h4 + h5 - v*x*h6 - v*y*h7 = v
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }

  const params = solveLinearSystem(ata, atb);
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
}

function applyTransform(
  p: Point,
  model: number[],
  type: 'homography' | 'affine' | 'similarity' | 'translation',
): Point {
  if (type === 'homography') {
    // [h00, h01, h02, h10, h11, h12, h20, h21, h22]
    const den = model[6] * p.x + model[7] * p.y + model[8];
    if (Math.abs(den) < 1e-9) {
      return { x: p.x, y: p.y };
    }
    return {
      x: (model[0] * p.x + model[1] * p.y + model[2]) / den,
      y: (model[3] * p.x + model[4] * p.y + model[5]) / den,
    };
  }

  if (type === 'affine') {
    // [a, b, tx, c, d, ty]
    return {
      x: model[0] * p.x + model[1] * p.y + model[2],
      y: model[3] * p.x + model[4] * p.y + model[5],
    };
  }

  if (type === 'similarity') {
    // [a, b, tx, ty]
    return {
      x: model[0] * p.x - model[1] * p.y + model[2],
      y: model[1] * p.x + model[0] * p.y + model[3],
    };
  }

  // [tx, ty]
  return {
    x: p.x + model[0],
    y: p.y + model[1],
  };
}

/**
 * Generic RANSAC Implementation
 */
function ransac(
  src: Point[],
  dst: Point[],
  type: 'homography' | 'affine' | 'similarity' | 'translation',
  minPoints: number,
  threshold: number = 2.0,
  iterations: number = 50,
): number[] | null {
  const n = src.length;
  if (n < minPoints) return null;

  let bestModel: number[] | null = null;
  let bestInliers: number[] = [];

  // RANSAC Loop
  for (let k = 0; k < iterations; k++) {
    // Random subset
    const indices: number[] = [];
    while (indices.length < minPoints) {
      const idx = Math.floor(Math.random() * n);
      if (!indices.includes(idx)) indices.push(idx);
    }

    const subsetSrc = indices.map((i) => src[i]);
    const subsetDst = indices.map((i) => dst[i]);

    let model: number[] | null = null;
    if (type === 'homography') model = solveHomographyLSQ(subsetSrc, subsetDst);
    else if (type === 'affine') model = solveAffineLSQ(subsetSrc, subsetDst);
    else if (type === 'similarity') model = solveSimilarityLSQ(subsetSrc, subsetDst);
    else model = solveTranslation(subsetSrc, subsetDst);

    if (!model) continue;

    // Count Inliers
    const inliers: number[] = [];
    for (let i = 0; i < n; i++) {
      const transformed = applyTransform(src[i], model, type);
      const dx = transformed.x - dst[i].x;
      const dy = transformed.y - dst[i].y;
      if (dx * dx + dy * dy < threshold * threshold) {
        inliers.push(i);
      }
    }

    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestModel = model;
    }
  }

  // Refine with all inliers
  if (bestInliers.length >= minPoints) {
    const finalSrc = bestInliers.map((i) => src[i]);
    const finalDst = bestInliers.map((i) => dst[i]);
    if (type === 'homography') return solveHomographyLSQ(finalSrc, finalDst);
    if (type === 'affine') return solveAffineLSQ(finalSrc, finalDst);
    if (type === 'similarity') return solveSimilarityLSQ(finalSrc, finalDst);
    return solveTranslation(finalSrc, finalDst);
  }

  return bestModel;
}

export type SolvedTransformType = 'homography' | 'affine' | 'similarity' | 'translation';

export interface SolvedTransformModel {
  type: SolvedTransformType;
  model: number[];
}

type TransformSolveConfig = {
  translation: boolean;
  rotation: boolean;
  scale: boolean;
  affine: boolean;
  perspective: boolean;
  deform: boolean;
};

const getRequestedTransformType = (
  config: TransformSolveConfig,
): { type: SolvedTransformType; minPoints: number } => {
  if (config.perspective) {
    return { type: 'homography', minPoints: 4 };
  }
  if (config.affine) {
    return { type: 'affine', minPoints: 3 };
  }
  if (config.rotation || config.scale) {
    return { type: 'similarity', minPoints: 2 };
  }
  return { type: 'translation', minPoints: 1 };
};

export const applySolvedTransform = (
  points: Point[],
  solvedTransform: SolvedTransformModel,
): Point[] =>
  points.map((point) => applyTransform(point, solvedTransform.model, solvedTransform.type));

export const fitTrackedTransform = (
  referencePoints: Point[],
  trackedPoints: Point[],
  config: TransformSolveConfig,
): SolvedTransformModel | null => {
  if (referencePoints.length < 1 || trackedPoints.length < 1 || config.deform) {
    return null;
  }

  let { type, minPoints } = getRequestedTransformType(config);

  if (referencePoints.length < minPoints) {
    if (referencePoints.length >= 3 && (config.perspective || config.affine)) {
      type = 'affine';
      minPoints = 3;
    } else if (referencePoints.length >= 2) {
      type = 'similarity';
      minPoints = 2;
    } else {
      type = 'translation';
      minPoints = 1;
    }
  }

  let model = ransac(referencePoints, trackedPoints, type, minPoints);

  if (!model && type === 'homography' && referencePoints.length >= 3) {
    type = 'affine';
    minPoints = 3;
    model = ransac(referencePoints, trackedPoints, type, minPoints);
  }
  if (!model && type === 'affine' && referencePoints.length >= 2) {
    type = 'similarity';
    minPoints = 2;
    model = ransac(referencePoints, trackedPoints, type, minPoints);
  }
  if (!model && type !== 'translation') {
    type = 'translation';
    minPoints = 1;
    model = ransac(referencePoints, trackedPoints, type, minPoints);
  }

  return {
    type,
    model: model ?? solveTranslation(referencePoints, trackedPoints),
  };
};

/**
 * Solves for the best transform and applies it to the target points.
 * Uses RANSAC for robustness against outliers (like occlusions or bad flow).
 */
export function solveTransform(
  referencePoints: Point[], // All available tracked points (Source)
  trackedPoints: Point[], // All available tracked points (Destination)
  pointsToTransform: Point[], // The boundary points we want to output transformed
  config: TransformSolveConfig,
): Point[] {
  if (referencePoints.length < 1 || trackedPoints.length < 1) return pointsToTransform;

  // If "deform" is on, we don't fit a global rigid model.
  // However, solveTransform's job IS to return transformed boundary points based on a model.
  // If Deform mode is active in Optical Flow, we usually bypass solveTransform or assume
  // pointsToTransform ARE the tracked points.
  // But since the caller structure separates "Tracking" from "Solving",
  // if deform is true, we should conceptually map 1:1 if possible, but usually deform implies
  // we take the raw flow result.
  // For this specific function, we assume if we are called, we want a rigid/affine solve.
  // If config.deform is true, caller handles it or we return raw.
  if (config.deform) return trackedPoints;

  const solvedTransform = fitTrackedTransform(referencePoints, trackedPoints, config);
  return solvedTransform
    ? applySolvedTransform(pointsToTransform, solvedTransform)
    : pointsToTransform;
}
