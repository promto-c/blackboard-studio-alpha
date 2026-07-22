import type { RotoPointType } from '@blackboard/types';
import { findMaskContours, getLargestContour, type ContourPoint } from '@/utils/contour';
import { simplifyPath } from '@/utils/bspline';

export interface RotoPartSeparationOptions {
  /** Auto infers the count; both modes use the same canonical seeds for that count. */
  partCount: number | 'auto';
  /** Underlap shared by adjacent parts, in source-mask pixels. */
  overlap: number;
  /** Values above one let distal branches claim more area from the core. */
  branchReach: number;
}

export interface RotoPartSourceGeometry {
  /** Original Roto controls expressed in the temporary analysis raster. */
  points: readonly ContourPoint[];
  pointTypes?: readonly RotoPointType[];
  /** Rendered curve neighborhoods aligned one-to-one with source controls. */
  ownershipSamples?: readonly (readonly ContourPoint[])[];
}

export type RotoPartPointOrigin = 'source' | 'silhouette' | 'tangent' | 'overlap';

export interface RotoMaskPart {
  index: number;
  seed: ContourPoint;
  mask: Uint8Array;
  /** Exact raster contour retained for provenance and future retracing. */
  contour: ContourPoint[];
  /** Roto-ready contour with artificial overlap seams reduced independently. */
  editableContour: ContourPoint[];
  /** Feature-aware spline behavior aligned with editableContour. */
  editablePointTypes?: RotoPointType[];
  /** Determines which controls may be simplified and which must remain exact. */
  editablePointOrigins?: RotoPartPointOrigin[];
  /** Adaptive control-point counts for artificial seams, including their endpoints. */
  seamPointCounts: number[];
  corePixelCount: number;
  pixelCount: number;
}

export interface RotoPartSeparationResult {
  width: number;
  height: number;
  sourceMask: Uint8Array;
  parts: RotoMaskPart[];
}

interface GeodesicPartition {
  distances: Int32Array;
  labels: Int16Array;
}

interface BranchSeedSelection {
  seeds: number[];
  /** Distance to the existing seed set when each seed was introduced. */
  gains: number[];
}

interface BranchCut {
  seed: number;
  cutPoint: number;
  distalPath: number[];
  cutIndex: number;
  cutCoreDistance: number;
  cutRadius: number;
  bias: number;
  salient: boolean;
}

const FOUR_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

const EIGHT_NEIGHBORS = [...FOUR_NEIGHBORS, [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

const clampInteger = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, Math.round(Number.isFinite(value) ? value : minimum)));

/**
 * Smart Mask can retain tiny disconnected islands even when its editable path
 * represents the main subject. Part separation deliberately works on only the
 * largest connected foreground component so those islands cannot become parts.
 */
const retainLargestComponent = (input: Uint8Array, width: number, height: number): Uint8Array => {
  const size = width * height;
  const componentIds = new Int32Array(size);
  const queue = new Int32Array(size);
  const areas: number[] = [0];
  let componentId = 0;

  for (let seed = 0; seed < size; seed += 1) {
    if (input[seed] === 0 || componentIds[seed] !== 0) continue;
    componentId += 1;
    let read = 0;
    let write = 0;
    queue[write++] = seed;
    componentIds[seed] = componentId;

    while (read < write) {
      const index = queue[read++];
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of EIGHT_NEIGHBORS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (input[next] === 0 || componentIds[next] !== 0) continue;
        componentIds[next] = componentId;
        queue[write++] = next;
      }
    }
    areas[componentId] = write;
  }

  let largestId = 0;
  for (let id = 1; id < areas.length; id += 1) {
    if ((areas[id] ?? 0) > (areas[largestId] ?? 0)) largestId = id;
  }

  const result = new Uint8Array(size);
  if (largestId === 0) return result;
  for (let index = 0; index < size; index += 1) {
    if (componentIds[index] === largestId) result[index] = 255;
  }
  return result;
};

/** Approximate distance to the matte boundary, used to place the stable core seed. */
const getBoundaryDistances = (mask: Uint8Array, width: number, height: number): Int32Array => {
  const infinity = width + height + 1;
  const distances = new Int32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    distances[index] = mask[index] > 0 ? infinity : 0;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let distance = distances[index];
      if (x === 0 || y === 0) distance = 1;
      if (x > 0) distance = Math.min(distance, distances[index - 1] + 1);
      if (y > 0) distance = Math.min(distance, distances[index - width] + 1);
      distances[index] = distance;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let distance = distances[index];
      if (x === width - 1 || y === height - 1) distance = 1;
      if (x + 1 < width) distance = Math.min(distance, distances[index + 1] + 1);
      if (y + 1 < height) distance = Math.min(distance, distances[index + width] + 1);
      distances[index] = distance;
    }
  }
  return distances;
};

const findCoreSeed = (mask: Uint8Array, boundaryDistances: Int32Array, width: number): number => {
  let foregroundCount = 0;
  let centroidX = 0;
  let centroidY = 0;
  let maximumDistance = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    foregroundCount += 1;
    centroidX += index % width;
    centroidY += Math.floor(index / width);
    maximumDistance = Math.max(maximumDistance, boundaryDistances[index]);
  }
  if (foregroundCount === 0) return -1;
  centroidX /= foregroundCount;
  centroidY /= foregroundCount;

  // Broad plateaus are common in palms and torsos. Choosing the candidate
  // nearest the silhouette centroid avoids an arbitrary top-left core.
  const plateauThreshold = Math.max(1, Math.floor(maximumDistance * 0.9));
  let bestIndex = -1;
  let bestCentroidDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0 || boundaryDistances[index] < plateauThreshold) continue;
    const dx = (index % width) - centroidX;
    const dy = Math.floor(index / width) - centroidY;
    const centroidDistance = dx * dx + dy * dy;
    if (centroidDistance < bestCentroidDistance) {
      bestCentroidDistance = centroidDistance;
      bestIndex = index;
    }
  }
  return bestIndex;
};

const partitionByGeodesicDistance = (
  mask: Uint8Array,
  width: number,
  height: number,
  seeds: readonly number[],
): GeodesicPartition => {
  const distances = new Int32Array(mask.length);
  distances.fill(-1);
  const labels = new Int16Array(mask.length);
  labels.fill(-1);
  const queue = new Int32Array(mask.length);
  let read = 0;
  let write = 0;

  seeds.forEach((seed, label) => {
    if (seed < 0 || seed >= mask.length || mask[seed] === 0 || distances[seed] === 0) return;
    distances[seed] = 0;
    labels[seed] = label;
    queue[write++] = seed;
  });

  while (read < write) {
    const index = queue[read++];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (mask[next] === 0 || distances[next] !== -1) continue;
      distances[next] = distances[index] + 1;
      labels[next] = labels[index];
      queue[write++] = next;
    }
  }

  return { distances, labels };
};

const chooseBranchSeeds = (
  mask: Uint8Array,
  width: number,
  height: number,
  requestedCount: number,
  boundaryDistances: Int32Array,
): BranchSeedSelection => {
  const coreSeed = findCoreSeed(mask, boundaryDistances, width);
  if (coreSeed < 0) {
    return {
      seeds: [],
      gains: [],
    };
  }

  const seeds = [coreSeed];
  const gains = [0];
  let partition = partitionByGeodesicDistance(mask, width, height, seeds);
  while (seeds.length < requestedCount) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] === 0 || partition.distances[index] <= 0) continue;
      // Farthest-point sampling follows the interior geodesic, so distal
      // branches win before arbitrary Euclidean slices through a wide core.
      // A small boundary-distance term keeps the seed on the branch centerline.
      const score = partition.distances[index] * 8 + boundaryDistances[index];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    gains.push(partition.distances[bestIndex]);
    seeds.push(bestIndex);
    partition = partitionByGeodesicDistance(mask, width, height, seeds);
  }
  return { seeds, gains };
};

const getAveragePathRadius = (
  path: readonly number[],
  boundaryDistances: Int32Array,
  start: number,
  end: number,
): number => {
  let sum = 0;
  let count = 0;
  for (let index = Math.max(0, start); index < Math.min(path.length, end); index += 1) {
    sum += boundaryDistances[path[index]];
    count += 1;
  }
  return count > 0 ? sum / count : 0;
};

/** Follow the core distance gradient while preferring the center of equal-cost routes. */
const traceBranchToCore = (
  seed: number,
  coreDistances: Int32Array,
  boundaryDistances: Int32Array,
  width: number,
  height: number,
): number[] => {
  const path = [seed];
  let current = seed;
  while (coreDistances[current] > 0 && path.length <= coreDistances.length) {
    const x = current % width;
    const y = Math.floor(current / width);
    let next = -1;
    let nextRadius = -1;
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const candidate = nextY * width + nextX;
      if (coreDistances[candidate] !== coreDistances[current] - 1) continue;
      if (boundaryDistances[candidate] > nextRadius) {
        next = candidate;
        nextRadius = boundaryDistances[candidate];
      }
    }
    if (next < 0) break;
    current = next;
    path.push(current);
  }
  return path;
};

/**
 * Locate the narrow-to-wide transition between a distal limb and the core.
 * The resulting additive geodesic bias makes the watershed cross this neck,
 * instead of allowing a branch cell to form a long wedge through the core.
 */
const analyzeBranchCut = (
  seed: number,
  coreDistances: Int32Array,
  boundaryDistances: Int32Array,
  width: number,
  height: number,
  branchReach: number,
): BranchCut => {
  const path = traceBranchToCore(seed, coreDistances, boundaryDistances, width, height);
  const pathLength = Math.max(1, path.length - 1);
  const window = Math.max(2, Math.min(12, Math.round(pathLength * 0.06)));
  const minimumIndex = Math.min(pathLength - 1, Math.max(window, Math.round(pathLength * 0.18)));
  const maximumIndex = Math.max(
    minimumIndex,
    Math.min(pathLength - window, Math.round(pathLength * 0.88)),
  );

  let cutIndex = Math.max(1, Math.round(pathLength * 0.62));
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestGrowthRatio = 0;
  let bestApproachGrowthRatio = 0;
  let bestProximalRadius = 1;
  for (let index = minimumIndex; index <= maximumIndex; index += 1) {
    const distalRadius = getAveragePathRadius(path, boundaryDistances, index - window, index);
    const proximalRadius = getAveragePathRadius(
      path,
      boundaryDistances,
      index + 1,
      index + window + 1,
    );
    const earlierDistalRadius = getAveragePathRadius(
      path,
      boundaryDistances,
      index - window * 2,
      index - window,
    );
    const growthRatio = (proximalRadius - distalRadius) / Math.max(1, distalRadius);
    const approachGrowthRatio =
      (distalRadius - earlierDistalRadius) / Math.max(1, earlierDistalRadius);
    const elongation = index / Math.max(1, proximalRadius);
    const score =
      growthRatio - Math.max(0, approachGrowthRatio) * 0.8 + Math.min(2, elongation) * 0.12;
    if (score > bestScore) {
      bestScore = score;
      bestGrowthRatio = growthRatio;
      bestApproachGrowthRatio = approachGrowthRatio;
      bestProximalRadius = proximalRadius;
      cutIndex = index;
    }
  }

  const baseCutRadius = boundaryDistances[path[Math.min(path.length - 1, cutIndex)]];
  const reachOffset = Math.round((branchReach - 2.5) * Math.max(1, baseCutRadius) * 0.6);
  cutIndex = Math.max(1, Math.min(pathLength - 1, cutIndex + reachOffset));
  const cutPoint = path[cutIndex];
  const cutCoreDistance = Math.max(0, coreDistances[cutPoint]);
  const seedCoreDistance = Math.max(1, coreDistances[seed]);
  const cutRadius = Math.max(1, boundaryDistances[cutPoint]);
  const distalAspect = cutIndex / Math.max(1, bestProximalRadius);

  return {
    seed,
    cutPoint,
    distalPath: path.slice(0, cutIndex + 1),
    cutIndex,
    cutCoreDistance,
    cutRadius,
    bias: seedCoreDistance - cutCoreDistance * 2,
    salient:
      bestGrowthRatio >= 0.18 &&
      bestGrowthRatio >= Math.max(0, bestApproachGrowthRatio) * 1.35 + 0.05 &&
      distalAspect >= 1.35,
  };
};

const inferAutomaticPartCount = (
  selection: BranchSeedSelection,
  coreDistances: Int32Array,
  boundaryDistances: Int32Array,
  width: number,
  height: number,
  branchReach: number,
): number => {
  if (selection.seeds.length === 0) return 0;
  const candidates = selection.seeds
    .slice(1)
    .map((seed) =>
      analyzeBranchCut(seed, coreDistances, boundaryDistances, width, height, branchReach),
    );
  const accepted: BranchCut[] = [];
  let maximumShapeRadius = 0;
  boundaryDistances.forEach((radius) => {
    maximumShapeRadius = Math.max(maximumShapeRadius, radius);
  });

  candidates.forEach((candidate, candidateIndex) => {
    const gain = selection.gains[candidateIndex + 1] ?? 0;
    if (
      !candidate.salient ||
      candidate.cutRadius < maximumShapeRadius * 0.18 ||
      gain < Math.max(4, candidate.cutRadius * 1.5)
    ) {
      return;
    }
    const cutX = candidate.cutPoint % width;
    const cutY = Math.floor(candidate.cutPoint / width);
    const duplicatesExistingBranch = accepted.some((existing) => {
      const existingX = existing.cutPoint % width;
      const existingY = Math.floor(existing.cutPoint / width);
      const existingDistalPixels = new Set(existing.distalPath);
      return (
        candidate.distalPath.some((point) => existingDistalPixels.has(point)) ||
        Math.hypot(cutX - existingX, cutY - existingY) < 3
      );
    });
    if (!duplicatesExistingBranch) accepted.push(candidate);
  });

  // A separator should still produce a useful two-part proposal for a smooth,
  // elongated shape that has no pronounced radius transition.
  if (accepted.length === 0 && candidates[0]) accepted.push(candidates[0]);
  return Math.min(selection.seeds.length, accepted.length + 1);
};

const partitionWithBranchCuts = (
  mask: Uint8Array,
  width: number,
  height: number,
  seeds: readonly number[],
  cuts: readonly BranchCut[],
): GeodesicPartition => {
  const labels = new Int16Array(mask.length);
  labels.fill(-1);
  const bestScores = new Float32Array(mask.length);
  bestScores.fill(Number.POSITIVE_INFINITY);
  const nearestDistances = new Int32Array(mask.length);
  nearestDistances.fill(-1);

  seeds.forEach((seed, label) => {
    const distances = partitionByGeodesicDistance(mask, width, height, [seed]).distances;
    const branchBias = label === 0 ? 0 : (cuts[label - 1]?.bias ?? 0);
    for (let index = 0; index < mask.length; index += 1) {
      const distance = distances[index];
      if (distance < 0) continue;
      const score = distance - branchBias;
      // On an exact seam, favor a distal branch. This avoids leaving a thin
      // finger root attached to the core when the geodesic costs are equal.
      if (score > bestScores[index] || (score === bestScores[index] && label === 0)) continue;
      bestScores[index] = score;
      nearestDistances[index] = distance;
      labels[index] = label;
    }
  });

  return { distances: nearestDistances, labels };
};

const createOverlappingPartMask = (
  sourceMask: Uint8Array,
  labels: Int16Array,
  label: number,
  width: number,
  height: number,
  overlap: number,
): { mask: Uint8Array; corePixelCount: number; pixelCount: number } => {
  const distances = new Int16Array(sourceMask.length);
  distances.fill(-1);
  const queue = new Int32Array(sourceMask.length);
  let read = 0;
  let write = 0;

  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] !== label) continue;
    distances[index] = 0;
    queue[write++] = index;
  }
  const corePixelCount = write;

  while (read < write) {
    const index = queue[read++];
    if (distances[index] >= overlap) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of EIGHT_NEIGHBORS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (sourceMask[next] === 0 || distances[next] !== -1) continue;
      distances[next] = distances[index] + 1;
      queue[write++] = next;
    }
  }

  const mask = new Uint8Array(sourceMask.length);
  for (let index = 0; index < write; index += 1) mask[queue[index]] = 255;
  return { mask, corePixelCount, pixelCount: write };
};

const pointsEqual = (a: ContourPoint, b: ContourPoint): boolean =>
  Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001;

const getPolylineLength = (points: readonly ContourPoint[]): number => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return length;
};

const getSquaredSegmentDistance = (
  point: ContourPoint,
  start: ContourPoint,
  end: ContourPoint,
): number => {
  return getSegmentProjection(point, start, end).distanceSquared;
};

const getSegmentProjection = (
  point: ContourPoint,
  start: ContourPoint,
  end: ContourPoint,
): { distanceSquared: number; t: number } => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return {
      distanceSquared: (point.x - start.x) ** 2 + (point.y - start.y) ** 2,
      t: 0,
    };
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const projectedX = start.x + dx * t;
  const projectedY = start.y + dy * t;
  return {
    distanceSquared: (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2,
    t,
  };
};

/** Retain the most structurally important bends while enforcing a hard point budget. */
const capOpenPolylinePoints = (
  points: readonly ContourPoint[],
  maximumPoints: number,
): ContourPoint[] => {
  if (points.length <= maximumPoints) return [...points];
  const selectedIndices = [0, points.length - 1];

  while (selectedIndices.length < maximumPoints) {
    selectedIndices.sort((a, b) => a - b);
    let bestIndex = -1;
    let bestDistance = -1;
    for (let segmentIndex = 0; segmentIndex < selectedIndices.length - 1; segmentIndex += 1) {
      const startIndex = selectedIndices[segmentIndex];
      const endIndex = selectedIndices[segmentIndex + 1];
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const distance = getSquaredSegmentDistance(
          points[index],
          points[startIndex],
          points[endIndex],
        );
        if (distance > bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    }
    if (bestIndex < 0) break;
    selectedIndices.push(bestIndex);
  }

  return selectedIndices.sort((a, b) => a - b).map((index) => points[index]);
};

const getGuideSeamPointBudget = (points: readonly ContourPoint[]): number => {
  if (points.length <= 2) return points.length;
  const start = points[0];
  const end = points[points.length - 1];
  const directLength = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  const pathLength = getPolylineLength(points);
  let maximumDeviation = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    maximumDeviation = Math.max(
      maximumDeviation,
      Math.sqrt(getSquaredSegmentDistance(points[index], start, end)),
    );
  }

  const deviationRatio = maximumDeviation / directLength;
  const detourRatio = pathLength / directLength;
  if (deviationRatio < 0.08 && detourRatio < 1.08) return 2;
  if (deviationRatio < 0.24 && detourRatio < 1.3) return 3;
  return 4;
};

/**
 * Use the raster partition only as a coarse guide for an editable underlap.
 * The watershed can contain long straight runs, pixel steps, and ownership
 * detours that are useful for analysis but make poor artist-facing controls.
 * A high simplification tolerance plus a four-point ceiling preserves the
 * joint and broad bend without retracing that temporary boundary.
 */
const createGuidedOverlapSeam = (
  points: readonly ContourPoint[],
  fixedMaximumPoints?: number,
): ContourPoint[] => {
  const uniquePoints = points.filter(
    (point, index) => index === 0 || !pointsEqual(point, points[index - 1]),
  );
  if (uniquePoints.length <= 2) return uniquePoints;
  const maximumPoints = fixedMaximumPoints ?? getGuideSeamPointBudget(uniquePoints);
  const tolerance = Math.max(2, getPolylineLength(uniquePoints) * 0.045);
  const simplified = simplifyPath(uniquePoints, tolerance);
  return capOpenPolylinePoints(simplified, maximumPoints);
};

const isInternalContourPoint = (
  point: ContourPoint,
  sourceMask: Uint8Array,
  width: number,
  height: number,
): boolean => {
  // An artificial seam is surrounded by accepted source pixels. A true
  // silhouette edge sees source background in at least one immediate direction.
  const sampleRadius = 1;
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;
  for (const [dx, dy] of directions) {
    const x = Math.round(point.x + dx * sampleRadius);
    const y = Math.round(point.y + dy * sampleRadius);
    if (x < 0 || x >= width || y < 0 || y >= height || sourceMask[y * width + x] === 0) {
      return false;
    }
  }
  return true;
};

const TANGENT_ESTIMATE_ARC_LENGTH = 8;
const TANGENT_ESTIMATE_MAXIMUM_SAMPLES = 16;

/** Estimate a stable one-sided boundary tangent with a local PCA line fit. */
const estimateOuterContourTangent = (
  points: readonly ContourPoint[],
  internal: readonly boolean[],
  joinIndex: number,
  direction: -1 | 1,
): ContourPoint | null => {
  const join = points[joinIndex];
  const samples = [join];
  let arcLength = 0;
  let previous = join;

  for (let offset = 1; offset <= TANGENT_ESTIMATE_MAXIMUM_SAMPLES; offset += 1) {
    const index =
      (joinIndex + direction * offset + points.length * TANGENT_ESTIMATE_MAXIMUM_SAMPLES) %
      points.length;
    if (internal[index]) break;
    const point = points[index];
    arcLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    samples.push(point);
    previous = point;
    if (arcLength >= TANGENT_ESTIMATE_ARC_LENGTH) break;
  }
  if (samples.length < 2) return null;

  const centroid = samples.reduce(
    (sum, point) => ({ x: sum.x + point.x / samples.length, y: sum.y + point.y / samples.length }),
    { x: 0, y: 0 },
  );
  let xx = 0;
  let xy = 0;
  let yy = 0;
  samples.forEach((point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  });
  if (xx + yy < 1e-6) return null;

  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  let tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  const outerSample = samples[samples.length - 1];
  const expected =
    direction < 0
      ? { x: join.x - outerSample.x, y: join.y - outerSample.y }
      : { x: outerSample.x - join.x, y: outerSample.y - join.y };
  if (tangent.x * expected.x + tangent.y * expected.y < 0) {
    tangent = { x: -tangent.x, y: -tangent.y };
  }
  return tangent;
};

const offsetPoint = (
  point: ContourPoint,
  direction: ContourPoint,
  distance: number,
): ContourPoint => ({
  x: point.x + direction.x * distance,
  y: point.y + direction.y * distance,
});

const getCutJoinControlDistances = (
  seam: readonly ContourPoint[],
): { support: number; guard: number } => {
  const chord = Math.hypot(
    seam[seam.length - 1].x - seam[0].x,
    seam[seam.length - 1].y - seam[0].y,
  );
  const guard = Math.max(1.5, Math.min(8, chord * 0.12));
  return { support: Math.min(3, guard), guard };
};

export interface SeamAwareContourResult {
  points: ContourPoint[];
  pointTypes?: RotoPointType[];
  pointOrigins?: RotoPartPointOrigin[];
  seamPointCounts: number[];
}

/**
 * Preserve the photographed outer silhouette while turning each generated
 * mask boundary into a compact, independently editable underlap curve.
 */
export const createSeamAwareRotoContour = (
  contour: readonly ContourPoint[],
  sourceMask: Uint8Array,
  width: number,
  height: number,
): SeamAwareContourResult => {
  const points = [...contour];
  if (points.length > 1 && pointsEqual(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) {
    return {
      points,
      pointTypes: undefined,
      pointOrigins: points.map(() => 'silhouette'),
      seamPointCounts: [],
    };
  }

  const internal = points.map((point) => isInternalContourPoint(point, sourceMask, width, height));
  const firstExteriorIndex = internal.findIndex((value) => !value);
  if (firstExteriorIndex === -1) {
    const closed = [...points, points[0]];
    const reduced = createGuidedOverlapSeam(closed, 5);
    const withoutDuplicate = pointsEqual(reduced[0], reduced[reduced.length - 1])
      ? reduced.slice(0, -1)
      : reduced;
    return {
      points: withoutDuplicate.length >= 3 ? withoutDuplicate : points.slice(0, 3),
      pointTypes: Array.from(
        { length: Math.max(3, withoutDuplicate.length) },
        () => 'cardinal' as const,
      ),
      pointOrigins: Array.from(
        { length: Math.max(3, withoutDuplicate.length) },
        () => 'overlap' as const,
      ),
      seamPointCounts: [withoutDuplicate.length],
    };
  }

  const result: ContourPoint[] = [points[firstExteriorIndex]];
  const pointTypes: RotoPointType[] = ['bspline'];
  const pointOrigins: RotoPartPointOrigin[] = ['silhouette'];
  const seamPointCounts: number[] = [];
  let internalRun: ContourPoint[] = [];

  for (let offset = 1; offset <= points.length; offset += 1) {
    const pointIndex = (firstExteriorIndex + offset) % points.length;
    const point = points[pointIndex];
    if (offset < points.length && internal[pointIndex]) {
      internalRun.push(point);
      continue;
    }

    if (internalRun.length > 0) {
      const startJoinIndex =
        (pointIndex - internalRun.length - 1 + points.length * 2) % points.length;
      const reducedSeam = createGuidedOverlapSeam([
        result[result.length - 1],
        ...internalRun,
        point,
      ]);
      const startJoin = reducedSeam[0];
      const endJoin = reducedSeam[reducedSeam.length - 1];
      const startTangent = estimateOuterContourTangent(points, internal, startJoinIndex, -1);
      const endTangent = estimateOuterContourTangent(points, internal, pointIndex, 1);
      const controlDistances = getCutJoinControlDistances(reducedSeam);

      // Keep a short support on the visible side of each join. Together with
      // the mirrored seam guard it makes the cardinal tangent follow the
      // locally fitted source tangent, even after the outer contour is reduced.
      if (startTangent) {
        const support = offsetPoint(startJoin, startTangent, -controlDistances.support);
        const insertIndex = result.length - 1;
        if (insertIndex === 0 || !pointsEqual(result[insertIndex - 1], support)) {
          result.splice(insertIndex, 0, support);
          pointTypes.splice(insertIndex, 0, 'bspline');
          pointOrigins.splice(insertIndex, 0, 'tangent');
        }
      }
      pointTypes[pointTypes.length - 1] = 'cardinal';
      pointOrigins[pointOrigins.length - 1] = 'overlap';

      let seamPointCount = 1;
      const startGuard = startTangent
        ? offsetPoint(startJoin, startTangent, controlDistances.guard)
        : null;
      const endGuard = endTangent
        ? offsetPoint(endJoin, endTangent, -controlDistances.guard)
        : null;
      if (startGuard) {
        result.push(startGuard);
        pointTypes.push('bspline');
        pointOrigins.push('overlap');
        seamPointCount += 1;
      }
      reducedSeam.slice(1, -1).forEach((seamPoint) => {
        if (
          (startGuard &&
            Math.hypot(seamPoint.x - startGuard.x, seamPoint.y - startGuard.y) < 0.75) ||
          (endGuard && Math.hypot(seamPoint.x - endGuard.x, seamPoint.y - endGuard.y) < 0.75)
        ) {
          return;
        }
        result.push(seamPoint);
        pointTypes.push('bspline');
        pointOrigins.push('overlap');
        seamPointCount += 1;
      });
      if (endGuard) {
        result.push(endGuard);
        pointTypes.push('bspline');
        pointOrigins.push('overlap');
        seamPointCount += 1;
      }

      if (offset < points.length && !pointsEqual(result[result.length - 1], point)) {
        result.push(point);
        pointTypes.push('cardinal');
        pointOrigins.push('overlap');
        if (endTangent) {
          result.push(offsetPoint(endJoin, endTangent, controlDistances.support));
          pointTypes.push('bspline');
          pointOrigins.push('tangent');
        }
      } else if (offset === points.length) {
        pointTypes[0] = 'cardinal';
        pointOrigins[0] = 'overlap';
        if (endTangent) {
          result.splice(1, 0, offsetPoint(endJoin, endTangent, controlDistances.support));
          pointTypes.splice(1, 0, 'bspline');
          pointOrigins.splice(1, 0, 'tangent');
        }
      }
      seamPointCounts.push(seamPointCount + 1);
      internalRun = [];
      continue;
    } else if (offset < points.length && !pointsEqual(result[result.length - 1], point)) {
      result.push(point);
      pointTypes.push('bspline');
      pointOrigins.push('silhouette');
    }
  }

  return { points: result, pointTypes, pointOrigins, seamPointCounts };
};

interface SourceControlAssignment {
  sourceIndex: number;
  edgeIndex: number;
  t: number;
  ownershipScore: number;
}

const findClosestPartContourEdge = (
  part: RotoMaskPart,
  point: ContourPoint,
  exteriorOnly: boolean,
): { edgeIndex: number; t: number; distanceSquared: number } | null => {
  let best: { edgeIndex: number; t: number; distanceSquared: number } | null = null;
  const points = part.editableContour;
  const origins = part.editablePointOrigins;
  for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
    const nextIndex = (edgeIndex + 1) % points.length;
    const isOverlapEdge = origins?.[edgeIndex] === 'overlap' || origins?.[nextIndex] === 'overlap';
    if (exteriorOnly && isOverlapEdge) continue;
    const projection = getSegmentProjection(point, points[edgeIndex], points[nextIndex]);
    if (best && projection.distanceSquared >= best.distanceSquared) continue;
    best = { edgeIndex, ...projection };
  }
  return best;
};

/**
 * Put every artist-authored control back onto the closest visible silhouette
 * run. Raster contour samples may be simplified later; source controls,
 * tangent supports, and generated overlap controls remain immutable anchors.
 */
const attachSourceControlsToParts = (
  parts: readonly RotoMaskPart[],
  sourceGeometry: RotoPartSourceGeometry | undefined,
): RotoMaskPart[] => {
  if (!sourceGeometry || sourceGeometry.points.length === 0 || parts.length === 0) {
    return [...parts];
  }

  const assignmentsByPart = parts.map(() => [] as SourceControlAssignment[]);

  sourceGeometry.points.forEach((sourcePoint, sourceIndex) => {
    let bestPartIndex = -1;
    let best: SourceControlAssignment | null = null;
    const ownershipSamples = sourceGeometry.ownershipSamples?.[sourceIndex]?.length
      ? sourceGeometry.ownershipSamples[sourceIndex]
      : [sourcePoint];
    const curveAnchor = ownershipSamples[Math.floor(ownershipSamples.length / 2)] ?? sourcePoint;

    parts.forEach((part, partIndex) => {
      const sampleProjections = ownershipSamples.map(
        (sample) =>
          findClosestPartContourEdge(part, sample, true) ??
          findClosestPartContourEdge(part, sample, false),
      );
      if (sampleProjections.some((projection) => !projection)) return;
      // A short neighborhood on both sides of the knot prevents a control
      // from jumping to a nearby finger merely because its off-curve control
      // position happens to be closer there.
      const ownershipScore = sampleProjections.reduce(
        (score, projection) => score + Math.sqrt(projection?.distanceSquared ?? 0),
        0,
      );
      if (best && ownershipScore >= best.ownershipScore) return;
      const anchorProjection =
        findClosestPartContourEdge(part, curveAnchor, true) ??
        findClosestPartContourEdge(part, curveAnchor, false);
      if (!anchorProjection) return;
      bestPartIndex = partIndex;
      best = {
        sourceIndex,
        edgeIndex: anchorProjection.edgeIndex,
        t: anchorProjection.t,
        ownershipScore,
      };
    });

    if (best && bestPartIndex >= 0) assignmentsByPart[bestPartIndex].push(best);
  });

  return parts.map((part, partIndex) => {
    const assignments = assignmentsByPart[partIndex];
    if (assignments.length === 0) return part;

    const byEdge = new Map<number, SourceControlAssignment[]>();
    const replacementByPoint = new Map<number, SourceControlAssignment>();
    assignments.forEach((assignment) => {
      const sourcePoint = sourceGeometry.points[assignment.sourceIndex];
      const exactPointIndex = part.editableContour.findIndex((point) =>
        pointsEqual(point, sourcePoint),
      );
      if (exactPointIndex >= 0 && !replacementByPoint.has(exactPointIndex)) {
        replacementByPoint.set(exactPointIndex, assignment);
        return;
      }
      const edgeAssignments = byEdge.get(assignment.edgeIndex) ?? [];
      edgeAssignments.push(assignment);
      byEdge.set(assignment.edgeIndex, edgeAssignments);
    });
    byEdge.forEach((edgeAssignments) =>
      edgeAssignments.sort((a, b) => a.t - b.t || a.sourceIndex - b.sourceIndex),
    );

    const points: ContourPoint[] = [];
    const pointTypes: RotoPointType[] = [];
    const pointOrigins: RotoPartPointOrigin[] = [];
    const originalOrigins = part.editablePointOrigins;

    part.editableContour.forEach((point, pointIndex) => {
      const replacement = replacementByPoint.get(pointIndex);
      const originalOrigin = originalOrigins?.[pointIndex] ?? 'silhouette';
      if (replacement) {
        points.push({ ...sourceGeometry.points[replacement.sourceIndex] });
        pointTypes.push(
          originalOrigin === 'overlap'
            ? 'cardinal'
            : (sourceGeometry.pointTypes?.[replacement.sourceIndex] ?? 'bspline'),
        );
        pointOrigins.push('source');
      } else {
        points.push(point);
        pointTypes.push(part.editablePointTypes?.[pointIndex] ?? 'bspline');
        pointOrigins.push(originalOrigin);
      }

      for (const assignment of byEdge.get(pointIndex) ?? []) {
        const sourcePoint = sourceGeometry.points[assignment.sourceIndex];
        points.push({ ...sourcePoint });
        pointTypes.push(sourceGeometry.pointTypes?.[assignment.sourceIndex] ?? 'bspline');
        pointOrigins.push('source');
      }
    });

    return {
      ...part,
      editableContour: points,
      editablePointTypes: pointTypes,
      editablePointOrigins: pointOrigins,
    };
  });
};

export interface SimplifiedRotoPartContour {
  points: ContourPoint[];
  pointTypes?: RotoPointType[];
  pointOrigins?: RotoPartPointOrigin[];
}

/** Simplify raster samples without moving source, tangent, or overlap anchors. */
export const simplifyRotoPartContour = (
  points: readonly ContourPoint[],
  pointTypes: readonly RotoPointType[] | undefined,
  tolerance: number,
  pointOrigins?: readonly RotoPartPointOrigin[],
): SimplifiedRotoPartContour => {
  if (points.length < 3) {
    return {
      points: [...points],
      pointTypes: pointTypes ? [...pointTypes] : undefined,
      pointOrigins: pointOrigins ? [...pointOrigins] : undefined,
    };
  }
  const anchors = points.flatMap((_, index) =>
    pointOrigins?.[index] === 'source' ||
    pointOrigins?.[index] === 'tangent' ||
    pointOrigins?.[index] === 'overlap' ||
    (pointTypes?.[index] && pointTypes[index] !== 'bspline')
      ? [index]
      : [],
  );
  if (anchors.length === 0) {
    const simplified = simplifyPath([...points], tolerance);
    return {
      points: simplified,
      pointOrigins: pointOrigins ? simplified.map(() => 'silhouette') : undefined,
    };
  }

  const typeByPoint = new Map<ContourPoint, RotoPointType>();
  const originByPoint = new Map<ContourPoint, RotoPartPointOrigin>();
  points.forEach((point, index) => typeByPoint.set(point, pointTypes?.[index] ?? 'bspline'));
  points.forEach((point, index) => originByPoint.set(point, pointOrigins?.[index] ?? 'silhouette'));
  const simplifiedPoints: ContourPoint[] = [points[anchors[0]]];
  const simplifiedTypes: RotoPointType[] = [pointTypes?.[anchors[0]] ?? 'cardinal'];
  const simplifiedOrigins: RotoPartPointOrigin[] = [pointOrigins?.[anchors[0]] ?? 'silhouette'];

  for (let anchorOffset = 0; anchorOffset < anchors.length; anchorOffset += 1) {
    const startIndex = anchors[anchorOffset];
    const endIndex = anchors[(anchorOffset + 1) % anchors.length];
    const segment: ContourPoint[] = [points[startIndex]];
    let index = (startIndex + 1) % points.length;
    while (index !== endIndex) {
      segment.push(points[index]);
      index = (index + 1) % points.length;
    }
    segment.push(points[endIndex]);
    const hasSourceEndpoint =
      pointOrigins?.[startIndex] === 'source' || pointOrigins?.[endIndex] === 'source';
    // The source controls already describe the artist's outer spline. Do not
    // add retraced raster controls between them or between a source control and
    // its overlap join. Only source-free runs need a simplified raster guide.
    const reduced = hasSourceEndpoint
      ? [segment[0], segment[segment.length - 1]]
      : simplifyPath(segment, tolerance);
    const append = anchorOffset === anchors.length - 1 ? reduced.slice(1, -1) : reduced.slice(1);
    append.forEach((point) => {
      simplifiedPoints.push(point);
      simplifiedTypes.push(typeByPoint.get(point) ?? 'bspline');
      simplifiedOrigins.push(originByPoint.get(point) ?? 'silhouette');
    });
  }

  return {
    points: simplifiedPoints,
    pointTypes: simplifiedTypes,
    pointOrigins: simplifiedOrigins,
  };
};

/**
 * Decompose a connected silhouette into a core plus geodesically distant
 * branches. Adjacent output masks dilate only inside the accepted source mask,
 * producing editable underlap while preserving the exact outer silhouette.
 */
export const separateRotoMaskIntoParts = (
  input: Uint8Array,
  width: number,
  height: number,
  options: RotoPartSeparationOptions,
  sourceGeometry?: RotoPartSourceGeometry,
): RotoPartSeparationResult => {
  const safeWidth = clampInteger(width, 1, 16_384);
  const safeHeight = clampInteger(height, 1, 16_384);
  if (input.length < safeWidth * safeHeight) {
    return { width: safeWidth, height: safeHeight, sourceMask: new Uint8Array(), parts: [] };
  }

  const sourceMask = retainLargestComponent(input, safeWidth, safeHeight);
  const automatic = options.partCount === 'auto';
  const partCount = options.partCount === 'auto' ? 13 : clampInteger(options.partCount, 2, 16);
  const overlap = clampInteger(options.overlap, 0, 128);
  const branchReach = Math.max(
    1,
    Math.min(5, Number.isFinite(options.branchReach) ? options.branchReach : 2.5),
  );
  const boundaryDistances = getBoundaryDistances(sourceMask, safeWidth, safeHeight);
  const selection = chooseBranchSeeds(
    sourceMask,
    safeWidth,
    safeHeight,
    partCount,
    boundaryDistances,
  );
  const coreDistances =
    selection.seeds.length > 0
      ? partitionByGeodesicDistance(sourceMask, safeWidth, safeHeight, [selection.seeds[0]])
          .distances
      : new Int32Array(sourceMask.length);
  // Automatic analysis determines only how many parts are useful. Rendering
  // always takes the canonical farthest-point prefix, so an inferred count and
  // the same explicit count cannot silently select different branches.
  const resolvedPartCount = automatic
    ? inferAutomaticPartCount(
        selection,
        coreDistances,
        boundaryDistances,
        safeWidth,
        safeHeight,
        branchReach,
      )
    : selection.seeds.length;
  const seeds = selection.seeds.slice(0, resolvedPartCount);
  const cuts = seeds
    .slice(1)
    .map((seed) =>
      analyzeBranchCut(seed, coreDistances, boundaryDistances, safeWidth, safeHeight, branchReach),
    );
  const partition = partitionWithBranchCuts(sourceMask, safeWidth, safeHeight, seeds, cuts);

  const parts = seeds.flatMap((seed, index): RotoMaskPart[] => {
    const part = createOverlappingPartMask(
      sourceMask,
      partition.labels,
      index,
      safeWidth,
      safeHeight,
      overlap,
    );
    const contour = getLargestContour(findMaskContours(part.mask, safeWidth, safeHeight));
    if (!contour || contour.length < 3) return [];
    const editable = createSeamAwareRotoContour(contour, sourceMask, safeWidth, safeHeight);
    return [
      {
        index,
        seed: { x: seed % safeWidth, y: Math.floor(seed / safeWidth) },
        contour,
        editableContour: editable.points,
        editablePointTypes: editable.pointTypes,
        editablePointOrigins: editable.pointOrigins,
        seamPointCounts: editable.seamPointCounts,
        ...part,
      },
    ];
  });

  const sourceAwareParts = attachSourceControlsToParts(parts, sourceGeometry);
  return {
    width: safeWidth,
    height: safeHeight,
    sourceMask,
    parts: sourceAwareParts,
  };
};
