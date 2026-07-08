import { ImageFitMode, type ComfyNode, type GeneratedOutput } from '@blackboard/types';
import { getAsset } from '@/state/assetStorage';
import {
  buildOpticalFlowPyramid,
  calculateHybridOpticalFlowFromPyramids,
  fitTrackedTransform,
  refineNccSubPixel,
} from '@/utils/opticalFlow';
import { isAutoImageFitMode } from '@/nodes/imageFitMode';
import { getComfyOutputRegionOffset, getComfyOutputTransform } from './comfyOutputTransform';

const ANALYSIS_MAX_SIZE = 640;
const HIGH_RES_SCALE = 3;
const MIN_MATCH_COUNT = 6;
const MAX_FLOW_ERROR = 12;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.25;

/**
 * Per-improvement toggles for the alignment pipeline.
 * All default to true (enabled). Pass options to explicitly disable a feature. */
export interface ComfyAlignmentOptions {
  /**
   * Skip tracking points in regions where the source and output differ significantly.
   * Helps prevent edited areas (img2img) from contaminating the alignment solve.
   * Computes a coarse block-based difference map and filters out points in high-diff blocks.
   */
  skipEditedRegions?: boolean;

  /**
   * Iterative refinement: runs up to 2 additional passes with progressively
   * smaller search radii. Each pass uses the previous estimate to warp the source
   * toward the output, enabling sub-pixel corrections.
   */
  iterativeRefinement?: boolean;

  /**
   * Two-pass coarse-to-fine refinement. The first pass runs at standard resolution
   * (max 480px). If successful, a second pass runs at 2× resolution using the
   * coarse transform to pre-warp the source, yielding higher precision.
   */
  highResRefinement?: boolean;

  /**
   * Edge-aware sampling: after selecting tracking points, rank them by local
   * gradient magnitude and keep only the top fraction. This gives more weight
   * to strong edges and corners, which produce more reliable optical flow,
   * and discards points in uniform/flat areas where tracking is noisy.
   */
  edgeAwareSampling?: boolean;

  /**
   * Sub-pixel NCC refinement: after RANSAC fitting, refine the inlier tracked
   * positions to sub-pixel accuracy using parabolic interpolation of NCC
   * scores around the integer match. This corrects residual integer-rounding
   * bias from the optical flow tracker and produces more precise transforms.
   */
  subPixelRefinement?: boolean;
}

const DEFAULT_ALIGNMENT_OPTIONS: Required<ComfyAlignmentOptions> = {
  skipEditedRegions: true,
  iterativeRefinement: true,
  highResRefinement: true,
  edgeAwareSampling: true,
  subPixelRefinement: true,
};

export interface ComfyImageAlignmentEstimate {
  /** Scale and offset mapping input-image coordinates to generated-output coordinates. */
  sourceToOutputScaleX: number;
  sourceToOutputScaleY: number;
  sourceToOutputOffsetX: number;
  sourceToOutputOffsetY: number;
  confidence: number;
  matchedPointCount: number;
}

type PixelImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * Compute a coarse grid-based difference map between source and output.
 * Returns a flat Uint8Array where higher values = more difference.
 * Grid resolution is roughly image.width/16 × image.height/16 blocks.
 */
const computeCoarseDifferenceMask = (
  source: PixelImage,
  output: PixelImage,
): { mask: Uint8Array; blockWidth: number; blockHeight: number } => {
  const blockSize = Math.max(8, Math.round(Math.min(source.width, source.height) / 16));
  const cols = Math.ceil(source.width / blockSize);
  const rows = Math.ceil(source.height / blockSize);
  const mask = new Uint8Array(cols * rows);
  const blockMeans: number[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const startX = col * blockSize;
      const startY = row * blockSize;
      const endX = Math.min(startX + blockSize, source.width);
      const endY = Math.min(startY + blockSize, source.height);
      let sumDiff = 0;
      let pixelCount = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const index = (y * source.width + x) * 4;
          const sr = source.data[index];
          const sg = source.data[index + 1];
          const sb = source.data[index + 2];
          const dr = output.data[index];
          const dg = output.data[index + 1];
          const db = output.data[index + 2];
          sumDiff += Math.abs(sr - dr) + Math.abs(sg - dg) + Math.abs(sb - db);
          pixelCount++;
        }
      }

      const meanDiff = pixelCount > 0 ? sumDiff / pixelCount : 0;
      blockMeans.push(meanDiff);
    }
  }

  // Threshold: blocks in the top 25% of difference are considered "edited"
  const sorted = [...blockMeans].sort((a, b) => a - b);
  const thresholdIndex = Math.floor(sorted.length * 0.75);
  const threshold = sorted[thresholdIndex] ?? 0;

  for (let index = 0; index < blockMeans.length; index++) {
    mask[index] = blockMeans[index] >= threshold ? 1 : 0;
  }

  return { mask, blockWidth: blockSize, blockHeight: blockSize };
};

/*/**
 * Filter tracking points to keep only those with the strongest local edges.
 * Ranks each point by its gradient magnitude (Sobel-like) on the source image
 * and keeps the top 75% of points. This discards uniform/flat areas where
 * optical flow tracking is noisy and unreliable.
 */
const filterPointsByEdgeScore = (
  points: Array<{ x: number; y: number }>,
  source: PixelImage,
): Array<{ x: number; y: number }> => {
  const scored = points.map((point) => {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    const clampedX = Math.max(2, Math.min(source.width - 3, x));
    const clampedY = Math.max(2, Math.min(source.height - 3, y));
    const index = (clampedY * source.width + clampedX) * 4;

    // Simple 3×3 Sobel-like gradient magnitude on luminance
    const tl =
      source.data[index - source.width * 4 - 4] +
      source.data[index - source.width * 4 - 3] +
      source.data[index - source.width * 4 - 2];
    const tc =
      source.data[index - source.width * 4] +
      source.data[index - source.width * 4 + 1] +
      source.data[index - source.width * 4 + 2];
    const tr =
      source.data[index - source.width * 4 + 4] +
      source.data[index - source.width * 4 + 5] +
      source.data[index - source.width * 4 + 6];
    const ml = source.data[index - 4] + source.data[index - 3] + source.data[index - 2];
    // const mc = source.data[index] + source.data[index + 1] + source.data[index + 2];
    const mr = source.data[index + 4] + source.data[index + 5] + source.data[index + 6];
    const bl =
      source.data[index + source.width * 4 - 4] +
      source.data[index + source.width * 4 - 3] +
      source.data[index + source.width * 4 - 2];
    const bc =
      source.data[index + source.width * 4] +
      source.data[index + source.width * 4 + 1] +
      source.data[index + source.width * 4 + 2];
    const br =
      source.data[index + source.width * 4 + 4] +
      source.data[index + source.width * 4 + 5] +
      source.data[index + source.width * 4 + 6];

    // Sobel X: (tr + 2*mr + br) - (tl + 2*ml + bl)
    const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
    // Sobel Y: (bl + 2*bc + br) - (tl + 2*tc + tr)
    const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);

    return { point, score: Math.sqrt(gx * gx + gy * gy) };
  });

  // Sort descending by score, keep top 75%
  scored.sort((a, b) => b.score - a.score);
  const keepCount = Math.max(MIN_MATCH_COUNT, Math.ceil(scored.length * 0.75));
  return scored.slice(0, keepCount).map((s) => s.point);
};

/**
 * Filter tracking points to avoid heavily edited regions (img2img areas). */
const filterPointsByDifferenceMask = (
  points: Array<{ x: number; y: number }>,
  source: PixelImage,
  output: PixelImage,
): Array<{ x: number; y: number }> => {
  const { mask, blockWidth, blockHeight } = computeCoarseDifferenceMask(source, output);
  const cols = Math.ceil(source.width / blockWidth);

  return points.filter((point) => {
    const col = Math.floor(point.x / blockWidth);
    const row = Math.floor(point.y / blockHeight);
    const maskIndex = row * cols + col;
    return maskIndex < mask.length ? mask[maskIndex] === 0 : true;
  });
};

/**
 * Apply the alignment transform to a single point.
 * Returns the transformed coordinates (source → output).
 */
const applyAlignmentToPoint = (
  point: { x: number; y: number },
  estimate: ComfyImageAlignmentEstimate,
): { x: number; y: number } => ({
  x: estimate.sourceToOutputScaleX * point.x + estimate.sourceToOutputOffsetX,
  y: estimate.sourceToOutputScaleY * point.y + estimate.sourceToOutputOffsetY,
});

/**
 * Core single-pass alignment: run optical flow from source→output on the given
 * tracking points, filter reliable pairs, fit an independent-scale transform,
 * optionally refine inliers to sub-pixel via NCC parabolic interpolation,
 * and return an estimate with confidence score.
 */
export const estimateAlignmentSinglePass = (
  source: PixelImage,
  output: PixelImage,
  points: Array<{ x: number; y: number }>,
  options: {
    searchRadius: number;
    maxError: number;
    outlierDistance: number;
    ransacThreshold?: number;
    enableSubPixelRefinement?: boolean;
  },
): ComfyImageAlignmentEstimate | null => {
  if (points.length < MIN_MATCH_COUNT) return null;

  const pyrSrc = buildOpticalFlowPyramid(source.data, source.width, source.height);
  const pyrOut = buildOpticalFlowPyramid(output.data, output.width, output.height);

  const tracked = calculateHybridOpticalFlowFromPyramids(pyrSrc, pyrOut, points, {
    maxError: options.maxError,
    outlierDistance: options.outlierDistance,
    searchRadius: options.searchRadius,
    patchRadius: 5,
    minimumNccScore: 0.5,
    coherentFallback: false,
  });

  const reliablePairs = points
    .map((sourcePoint, index) => ({
      source: sourcePoint,
      output: tracked[index],
      error: tracked[index].error,
    }))
    .filter(
      (pair) =>
        Number.isFinite(pair.output.x) &&
        Number.isFinite(pair.output.y) &&
        Number.isFinite(pair.error) &&
        pair.error <= options.maxError,
    );

  if (reliablePairs.length < MIN_MATCH_COUNT) return null;

  let src = reliablePairs.map((p) => ({ x: p.source.x, y: p.source.y }));
  let dst = reliablePairs.map((p) => ({ x: p.output.x, y: p.output.y }));

  // --- RANSAC transform fitting ---
  const solved = fitTrackedTransform(src, dst, {
    translation: true,
    rotation: false,
    scale: false,
    affine: false,
    perspective: false,
    independentScale: true,
    deform: false,
    ransacThreshold: options.ransacThreshold ?? 1.5,
  });

  if (!solved || solved.type !== 'independent_scale') return null;

  let [sx, tx, sy, ty] = solved.model;
  if (
    !Number.isFinite(sx) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(sy) ||
    !Number.isFinite(ty) ||
    sx < MIN_SCALE ||
    sx > MAX_SCALE ||
    sy < MIN_SCALE ||
    sy > MAX_SCALE
  ) {
    return null;
  }

  // --- Optional: sub-pixel NCC refinement on inlier pairs ---
  if (options.enableSubPixelRefinement) {
    // Identify inliers according to the fitted model
    const residuals = dst.map((d, i) =>
      Math.hypot(sx * src[i].x + tx - d.x, sy * src[i].y + ty - d.y),
    );
    const sortedRes = [...residuals].filter(Number.isFinite).sort((a, b) => a - b);
    const medianRes = sortedRes.length > 0 ? sortedRes[Math.floor(sortedRes.length / 2)] : 0;
    const inlierThreshold = Math.max(3, medianRes * 2);
    const inlierIndices = residuals
      .map((r, i) => (r <= inlierThreshold ? i : -1))
      .filter((i) => i >= 0);

    if (inlierIndices.length >= MIN_MATCH_COUNT) {
      // Sub-pixel refine only the inlier tracked positions
      const inlierSrc = inlierIndices.map((i) => src[i]);
      const inlierDst = inlierIndices.map((i) => ({
        x: dst[i].x,
        y: dst[i].y,
        error: residuals[i],
      }));

      const refined = refineNccSubPixel(pyrSrc, pyrOut, inlierSrc, inlierDst, 3);

      // Use refined positions where they improved (error is reasonable)
      const refitSrc: Array<{ x: number; y: number }> = [];
      const refitDst: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < inlierIndices.length; i++) {
        const r = refined[i];
        if (Number.isFinite(r.x) && Number.isFinite(r.y)) {
          refitSrc.push(inlierSrc[i]);
          refitDst.push({ x: r.x, y: r.y });
        }
      }

      if (refitSrc.length >= MIN_MATCH_COUNT) {
        // Refit the transform using the sub-pixel refined positions
        const refitSolved = fitTrackedTransform(refitSrc, refitDst, {
          translation: true,
          rotation: false,
          scale: false,
          affine: false,
          perspective: false,
          independentScale: true,
          deform: false,
          ransacThreshold: options.ransacThreshold ?? 1.5,
        });

        if (refitSolved && refitSolved.type === 'independent_scale') {
          const [rfSx, rfTx, rfSy, rfTy] = refitSolved.model;
          if (
            Number.isFinite(rfSx) &&
            Number.isFinite(rfTx) &&
            Number.isFinite(rfSy) &&
            Number.isFinite(rfTy) &&
            rfSx >= MIN_SCALE &&
            rfSx <= MAX_SCALE &&
            rfSy >= MIN_SCALE &&
            rfSy <= MAX_SCALE
          ) {
            sx = rfSx;
            tx = rfTx;
            sy = rfSy;
            ty = rfTy;
            // Update dst for confidence calculation below
            dst = refitDst;
            src = refitSrc;
          }
        }
      }
    }
  }

  // Compute confidence from residuals
  const residuals = dst.map((d, i) =>
    Math.hypot(sx * src[i].x + tx - d.x, sy * src[i].y + ty - d.y),
  );
  const sortedResiduals = residuals.filter(Number.isFinite).sort((a, b) => a - b);
  const medianResidual =
    sortedResiduals.length > 0 ? sortedResiduals[Math.floor(sortedResiduals.length / 2)] : 0;
  const inlierCount = residuals.filter(
    (residual) => residual <= Math.max(3, medianResidual * 2),
  ).length;
  const coverage = inlierCount / residuals.length;
  const confidence = Math.max(0, Math.min(1, coverage * (1 - medianResidual / 18)));
  if (confidence < 0.35) return null;

  return {
    sourceToOutputScaleX: sx,
    sourceToOutputScaleY: sy,
    sourceToOutputOffsetX: tx,
    sourceToOutputOffsetY: ty,
    confidence,
    matchedPointCount: residuals.length,
  };
};

/**
 * Iterative refinement: re-track the original source points with progressively
 * smaller search radii, using the current estimate only to constrain the
 * outlier-distance check. Each pass produces an independent transform estimate
 * from the original tracking data; only the best (highest-confidence) pass is
 * kept, avoiding error accumulation from transform composition.
 */
const estimateWithIterativeRefinement = (
  source: PixelImage,
  output: PixelImage,
  points: Array<{ x: number; y: number }>,
  initialEstimate: ComfyImageAlignmentEstimate,
): ComfyImageAlignmentEstimate | null => {
  let best = initialEstimate;
  const radii = [6, 3]; // progressively smaller search radii

  for (const searchRadius of radii) {
    const refined = estimateAlignmentSinglePass(source, output, points, {
      searchRadius,
      maxError: MAX_FLOW_ERROR,
      outlierDistance: Math.max(6, searchRadius * 2),
      enableSubPixelRefinement: false,
    });

    if (!refined) break;

    // Keep the pass with the highest confidence
    if (refined.confidence > best.confidence) {
      best = refined;
    }
  }

  return best;
};

export const selectTrackingPoints = (image: PixelImage): Array<{ x: number; y: number }> => {
  const spacing = Math.max(24, Math.round(Math.min(image.width, image.height) / 10));
  const margin = Math.max(14, Math.round(spacing * 0.7));
  const points: Array<{ x: number; y: number }> = [];

  for (let cellY = margin; cellY < image.height - margin; cellY += spacing) {
    for (let cellX = margin; cellX < image.width - margin; cellX += spacing) {
      let bestPoint: { x: number; y: number; score: number } | null = null;
      const radius = Math.max(4, Math.floor(spacing / 3));
      for (let y = cellY - radius; y <= cellY + radius; y += 3) {
        for (let x = cellX - radius; x <= cellX + radius; x += 3) {
          if (x < 2 || y < 2 || x >= image.width - 2 || y >= image.height - 2) continue;
          const index = (y * image.width + x) * 4;
          const left = image.data[index - 4] + image.data[index - 3] + image.data[index - 2];
          const right = image.data[index + 4] + image.data[index + 5] + image.data[index + 6];
          const upIndex = index - image.width * 4;
          const downIndex = index + image.width * 4;
          const up = image.data[upIndex] + image.data[upIndex + 1] + image.data[upIndex + 2];
          const down =
            image.data[downIndex] + image.data[downIndex + 1] + image.data[downIndex + 2];
          const score = Math.abs(right - left) + Math.abs(down - up);
          if (!bestPoint || score > bestPoint.score) bestPoint = { x, y, score };
        }
      }
      if (bestPoint && bestPoint.score > 24) points.push(bestPoint);
    }
  }

  return points;
};

/**
 * Get analysis dimensions for a second high-resolution pass.
 * Returns null if the source is already at or below the low-res threshold. */
const getHighResAnalysisSize = async (
  blob: Blob,
): Promise<{ width: number; height: number } | null> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const lowScale = Math.min(1, ANALYSIS_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
    // Only run high-res if the low-res scale was < 0.9 (meaning we downscaled)
    if (lowScale >= 0.9) return null;
    const highScale = Math.min(
      1,
      (ANALYSIS_MAX_SIZE * HIGH_RES_SCALE) / Math.max(bitmap.width, bitmap.height),
    );
    return {
      width: Math.max(32, Math.round(bitmap.width * highScale)),
      height: Math.max(32, Math.round(bitmap.height * highScale)),
    };
  } finally {
    bitmap.close();
  }
};

/**
 * High-res refinement pass: after coarse alignment, re-sample at 2× resolution
 * and run a second independent alignment. Coarse and HR images are re-sampled
 * from the same originals at the same relative resolution for source and output,
 * so the transform is directly comparable. Returns the more precise HR estimate.
 */
const estimateWithHighResRefinement = async (
  inputBlob: Blob,
  outputBlob: Blob,
  coarseEstimate: ComfyImageAlignmentEstimate,
): Promise<ComfyImageAlignmentEstimate | null> => {
  const hrSize = await getHighResAnalysisSize(inputBlob);
  if (!hrSize) return coarseEstimate;

  const [hrSource, hrOutput] = await Promise.all([
    readNormalizedPixels(inputBlob, hrSize.width, hrSize.height),
    readNormalizedPixels(outputBlob, hrSize.width, hrSize.height),
  ]);

  // Select tracking points on the high-res source
  let points = selectTrackingPoints(hrSource);
  if (points.length < MIN_MATCH_COUNT) return coarseEstimate;

  // Filter out points predicted to be outside the output bounds
  points = points.filter((p) => {
    const predicted = applyAlignmentToPoint(p, coarseEstimate);
    const margin = 4;
    return (
      predicted.x >= margin &&
      predicted.x < hrOutput.width - margin &&
      predicted.y >= margin &&
      predicted.y < hrOutput.height - margin
    );
  });

  if (points.length < MIN_MATCH_COUNT) return coarseEstimate;

  const hrEstimate = estimateAlignmentSinglePass(hrSource, hrOutput, points, {
    searchRadius: Math.max(4, Math.round(Math.min(hrSource.width, hrSource.height) * 0.03)),
    maxError: 6,
    outlierDistance: Math.max(8, Math.min(hrSource.width, hrSource.height) * 0.04),
    ransacThreshold: 1.0,
  });

  return hrEstimate ?? coarseEstimate;
};

export const estimateComfyImageAlignment = (
  source: PixelImage,
  output: PixelImage,
  options?: ComfyAlignmentOptions,
): ComfyImageAlignmentEstimate | null => {
  if (
    source.width !== output.width ||
    source.height !== output.height ||
    source.width < 32 ||
    source.height < 32
  ) {
    return null;
  }

  const opts: Required<ComfyAlignmentOptions> = {
    ...DEFAULT_ALIGNMENT_OPTIONS,
    ...options,
  };

  // --- Select tracking points ---
  let points = selectTrackingPoints(source);
  if (points.length < MIN_MATCH_COUNT) return null;

  // Optionally filter out points in edited regions (before edge scoring,
  // so we don't waste computation on points that will be removed anyway)
  if (opts.skipEditedRegions) {
    points = filterPointsByDifferenceMask(points, source, output);
    if (points.length < MIN_MATCH_COUNT) return null;
  }

  // Optionally keep only the strongest edge points
  if (opts.edgeAwareSampling) {
    points = filterPointsByEdgeScore(points, source);
    if (points.length < MIN_MATCH_COUNT) return null;
  }

  // --- First pass at standard resolution ---
  const searchRadius = Math.max(12, Math.round(Math.min(source.width, source.height) * 0.06));
  const outlierDistance = Math.max(14, Math.min(source.width, source.height) * 0.06);

  const estimate = estimateAlignmentSinglePass(source, output, points, {
    searchRadius,
    maxError: MAX_FLOW_ERROR,
    outlierDistance,
    enableSubPixelRefinement: opts.subPixelRefinement,
  });

  if (!estimate) return null;

  // --- Optional: iterative refinement ---
  const refinedEstimate = opts.iterativeRefinement
    ? estimateWithIterativeRefinement(source, output, points, estimate)
    : estimate;

  if (!refinedEstimate) return null;

  return refinedEstimate;
};

const readNormalizedPixels = async (
  blob: Blob,
  width: number,
  height: number,
): Promise<PixelImage> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create an image alignment canvas.');
    context.drawImage(bitmap, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap.close();
  }
};

const getAnalysisSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, ANALYSIS_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
    return {
      width: Math.max(32, Math.round(bitmap.width * scale)),
      height: Math.max(32, Math.round(bitmap.height * scale)),
    };
  } finally {
    bitmap.close();
  }
};

export const alignComfyOutputToInput = async ({
  node,
  output,
  sceneNode,
  inputBlob,
  options,
}: {
  node: ComfyNode;
  output: GeneratedOutput;
  sceneNode: { width: number; height: number } | null | undefined;
  inputBlob: Blob;
  options?: ComfyAlignmentOptions;
}): Promise<GeneratedOutput | null> => {
  if (output.mediaKind && output.mediaKind !== 'image') return null;
  const outputBlob = await getAsset(output.src);
  if (!outputBlob) return null;

  const opts: Required<ComfyAlignmentOptions> = {
    ...DEFAULT_ALIGNMENT_OPTIONS,
    ...options,
  };

  const analysisSize = await getAnalysisSize(inputBlob);
  const [sourcePixels, outputPixels] = await Promise.all([
    readNormalizedPixels(inputBlob, analysisSize.width, analysisSize.height),
    readNormalizedPixels(outputBlob, analysisSize.width, analysisSize.height),
  ]);
  const estimate = estimateComfyImageAlignment(sourcePixels, outputPixels, opts);
  if (!estimate) return null;

  // --- Optional: high-resolution refinement pass ---
  const finalEstimate = opts.highResRefinement
    ? await estimateWithHighResRefinement(inputBlob, outputBlob, estimate)
    : estimate;

  if (!finalEstimate) return null;

  const baseFitMode = isAutoImageFitMode(output.transform?.fitMode ?? ImageFitMode.FIT)
    ? (output.transform?.fitMode ?? ImageFitMode.FIT)
    : ImageFitMode.FIT;
  const baseOutput = {
    ...output,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: baseFitMode },
  };
  const baseTransform = getComfyOutputTransform({ node, output: baseOutput, sceneNode });
  const baseScaleX = Number(baseTransform.scaleX);
  const baseScaleY = Number(baseTransform.scaleY);
  const baseX = Number(baseTransform.x);
  const baseY = Number(baseTransform.y);
  if (![baseScaleX, baseScaleY, baseX, baseY].every(Number.isFinite)) return null;

  // Correction = INVERSE of the estimate: source = correctionScale * output + correctionOffset
  //   correctionScale = 1/estimateScale
  //   correctionOffset = -estimateOffset / estimateScale
  const correctionScaleX = 1 / finalEstimate.sourceToOutputScaleX;
  const correctionScaleY = 1 / finalEstimate.sourceToOutputScaleY;
  const correctionOffsetX = -finalEstimate.sourceToOutputOffsetX * correctionScaleX;
  const correctionOffsetY = -finalEstimate.sourceToOutputOffsetY * correctionScaleY;

  // Centering: when scaling around the top-left corner, the content center shifts from
  // center to correctionScale * center. To keep the content center in place, we add an
  // offset of (1 - correctionScale) * center in the canvas coordinate system.
  // (Y is flipped in screen coords via the subtraction below.)
  const centeredOffsetX = correctionOffsetX + ((correctionScaleX - 1) * analysisSize.width) / 2;
  const centeredOffsetY = correctionOffsetY + ((correctionScaleY - 1) * analysisSize.height) / 2;

  const regionOffset = getComfyOutputRegionOffset({ node, output, sceneNode });

  // Coordinate mapping from analysis-coords to screen-coords.
  // Pixel (px, py) at analysis resolution maps to pixel (px, py) at output resolution
  // via: screen_x = px * (baseScaleX * output.width) / analysisWidth.
  // Screen Y is flipped relative to canvas Y (renderer Y-up vs canvas Y-down), hence `-` on y.
  return {
    ...output,
    transform: {
      x:
        baseX -
        regionOffset.x +
        centeredOffsetX * ((baseScaleX * output.width) / analysisSize.width),
      y:
        baseY -
        regionOffset.y -
        centeredOffsetY * ((baseScaleY * output.height) / analysisSize.height),
      scaleX: baseScaleX * correctionScaleX,
      scaleY: baseScaleY * correctionScaleY,
      fitMode: ImageFitMode.CUSTOM,
    },
  };
};
