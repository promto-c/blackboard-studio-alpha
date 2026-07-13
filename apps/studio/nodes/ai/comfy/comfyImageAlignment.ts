import { ImageFitMode, type ComfyNode, type GeneratedOutput } from '@blackboard/types';
import { getAsset } from '@/state/assetStorage';
import {
  buildOpticalFlowPyramid,
  calculateHybridOpticalFlowFromPyramids,
  fitTrackedTransform,
  invertAxisAlignedTransformAroundCenter,
  refineNccSubPixel,
} from '@/utils/opticalFlow';
import { isAutoImageFitMode } from '@/nodes/imageFitMode';
import { decodeRasterImageSource, type RasterImageSource } from '@/utils/rasterImageSource';
import { getComfyOutputRegionOffset, getComfyOutputTransform } from './comfyOutputTransform';
import { resolveComfyAlignmentOptions, type ComfyAlignmentOptions } from './comfyAlignmentOptions';

export type { ComfyAlignmentOptions } from './comfyAlignmentOptions';

const ANALYSIS_MAX_SIZE = 640;
const HIGH_RES_SCALE = 3;
const MIN_MATCH_COUNT = 6;
const MAX_FLOW_ERROR = 12;
const ALIGNMENT_RANSAC_THRESHOLD = 0.65;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.25;

export interface ComfyImageAlignmentEstimate {
  /** Scale and offset mapping input-image coordinates to generated-output coordinates. */
  sourceToOutputScaleX: number;
  sourceToOutputScaleY: number;
  sourceToOutputOffsetX: number;
  sourceToOutputOffsetY: number;
  confidence: number;
  matchedPointCount: number;
  medianResidual: number;
}

export interface ComfyAlignmentReference {
  width: number;
  height: number;
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}

export const composeComfyAlignmentWithReference = ({
  reference,
  outputSize,
  analysisSize,
  correction,
  regionOffset = { x: 0, y: 0 },
}: {
  reference: ComfyAlignmentReference;
  outputSize: { width: number; height: number };
  analysisSize: { width: number; height: number };
  correction: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
  regionOffset?: { x: number; y: number };
}): ComfyNode['transform'] => ({
  x:
    reference.transform.x -
    regionOffset.x +
    correction.offsetX * ((reference.transform.scaleX * reference.width) / analysisSize.width),
  y:
    reference.transform.y -
    regionOffset.y -
    correction.offsetY * ((reference.transform.scaleY * reference.height) / analysisSize.height),
  scaleX: reference.transform.scaleX * (reference.width / outputSize.width) * correction.scaleX,
  scaleY: reference.transform.scaleY * (reference.height / outputSize.height) * correction.scaleY,
  fitMode: ImageFitMode.CUSTOM,
});

type PixelImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
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

type TrackedPair = {
  source: { x: number; y: number };
  output: { x: number; y: number; error: number };
  error: number;
};

const getLuminance = (image: PixelImage, x: number, y: number): number => {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const index = (clampedY * image.width + clampedX) * 4;
  return (
    image.data[index] * 0.2126 + image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722
  );
};

/** Normalized patch similarity after motion tracking; robust to brightness/color changes. */
const getTrackedPatchSimilarity = (
  source: PixelImage,
  output: PixelImage,
  sourcePoint: { x: number; y: number },
  outputPoint: { x: number; y: number },
  outputScale: { x: number; y: number } = { x: 1, y: 1 },
  radius = 4,
): number => {
  const sourceValues: number[] = [];
  const outputValues: number[] = [];
  let sourceMean = 0;
  let outputMean = 0;

  for (let y = -radius; y <= radius; y += 2) {
    for (let x = -radius; x <= radius; x += 2) {
      const sourceValue = getLuminance(source, sourcePoint.x + x, sourcePoint.y + y);
      const outputValue = getLuminance(
        output,
        outputPoint.x + x * outputScale.x,
        outputPoint.y + y * outputScale.y,
      );
      sourceValues.push(sourceValue);
      outputValues.push(outputValue);
      sourceMean += sourceValue;
      outputMean += outputValue;
    }
  }

  sourceMean /= sourceValues.length;
  outputMean /= outputValues.length;
  let covariance = 0;
  let sourceVariance = 0;
  let outputVariance = 0;
  for (let index = 0; index < sourceValues.length; index++) {
    const sourceDelta = sourceValues[index] - sourceMean;
    const outputDelta = outputValues[index] - outputMean;
    covariance += sourceDelta * outputDelta;
    sourceVariance += sourceDelta * sourceDelta;
    outputVariance += outputDelta * outputDelta;
  }

  const denominator = Math.sqrt(sourceVariance * outputVariance);
  return denominator > 1e-6 ? covariance / denominator : -1;
};

/**
 * Hold out AI-edited areas after motion tracking. Comparing patches at their
 * tracked locations avoids mistaking legitimate translation/scale for edits.
 */
const holdOutChangedTrackedPairs = (
  source: PixelImage,
  output: PixelImage,
  pairs: TrackedPair[],
  estimate?: Pick<
    ComfyImageAlignmentEstimate,
    | 'sourceToOutputScaleX'
    | 'sourceToOutputScaleY'
    | 'sourceToOutputOffsetX'
    | 'sourceToOutputOffsetY'
  >,
): TrackedPair[] => {
  if (pairs.length < MIN_MATCH_COUNT * 2) return pairs;
  const scored = pairs
    .map((pair) => {
      const expectedOutput = estimate ? applyAlignmentToPoint(pair.source, estimate) : pair.output;
      return {
        pair,
        similarity: getTrackedPatchSimilarity(source, output, pair.source, expectedOutput, {
          x: estimate?.sourceToOutputScaleX ?? 1,
          y: estimate?.sourceToOutputScaleY ?? 1,
        }),
      };
    })
    .filter(({ similarity }) => Number.isFinite(similarity))
    .sort((a, b) => b.similarity - a.similarity);
  if (scored.length < MIN_MATCH_COUNT) return pairs;

  // Keep every plausible unchanged patch. Only fall back to a ranked 60% when
  // edits are so extensive that the absolute similarity gate leaves too few points.
  const targetCount = Math.max(MIN_MATCH_COUNT, Math.ceil(scored.length * 0.6));
  const retained = scored.filter(({ similarity }) => similarity >= 0.45).map(({ pair }) => pair);
  return retained.length >= targetCount
    ? retained
    : scored.slice(0, targetCount).map(({ pair }) => pair);
};

/**
 * Apply the alignment transform to a single point.
 * Returns the transformed coordinates (source → output).
 */
const applyAlignmentToPoint = (
  point: { x: number; y: number },
  estimate: Pick<
    ComfyImageAlignmentEstimate,
    | 'sourceToOutputScaleX'
    | 'sourceToOutputScaleY'
    | 'sourceToOutputOffsetX'
    | 'sourceToOutputOffsetY'
  >,
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
    holdOutChangedRegions?: boolean;
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
  let solved = fitTrackedTransform(src, dst, {
    translation: true,
    rotation: false,
    scale: false,
    affine: false,
    perspective: false,
    independentScale: true,
    deform: false,
    ransacThreshold: options.ransacThreshold ?? ALIGNMENT_RANSAC_THRESHOLD,
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

  if (options.holdOutChangedRegions) {
    const retainedPairs = holdOutChangedTrackedPairs(source, output, reliablePairs, {
      sourceToOutputScaleX: sx,
      sourceToOutputScaleY: sy,
      sourceToOutputOffsetX: tx,
      sourceToOutputOffsetY: ty,
    });
    if (retainedPairs.length < reliablePairs.length) {
      src = retainedPairs.map((pair) => pair.source);
      dst = retainedPairs.map((pair) => pair.output);
      solved = fitTrackedTransform(src, dst, {
        translation: true,
        rotation: false,
        scale: false,
        affine: false,
        perspective: false,
        independentScale: true,
        deform: false,
        ransacThreshold: options.ransacThreshold ?? ALIGNMENT_RANSAC_THRESHOLD,
      });
      if (!solved || solved.type !== 'independent_scale') return null;
      [sx, tx, sy, ty] = solved.model;
      if (
        ![sx, tx, sy, ty].every(Number.isFinite) ||
        sx < MIN_SCALE ||
        sx > MAX_SCALE ||
        sy < MIN_SCALE ||
        sy > MAX_SCALE
      ) {
        return null;
      }
    }
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
          ransacThreshold: options.ransacThreshold ?? ALIGNMENT_RANSAC_THRESHOLD,
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
    medianResidual,
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
  holdOutChangedRegions: boolean,
): ComfyImageAlignmentEstimate | null => {
  let best = initialEstimate;
  const radii = [6, 3]; // progressively smaller search radii

  for (const searchRadius of radii) {
    const refined = estimateAlignmentSinglePass(source, output, points, {
      searchRadius,
      maxError: MAX_FLOW_ERROR,
      outlierDistance: Math.max(6, searchRadius * 2),
      enableSubPixelRefinement: false,
      holdOutChangedRegions,
    });

    if (!refined) break;

    // Prefer the geometrically tightest solve; confidence breaks near-ties.
    if (
      refined.medianResidual < best.medianResidual - 1e-4 ||
      (Math.abs(refined.medianResidual - best.medianResidual) <= 1e-4 &&
        refined.confidence > best.confidence)
    ) {
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
const getHighResAnalysisSize = (
  source: RasterImageSource,
): { width: number; height: number } | null => {
  const lowScale = Math.min(1, ANALYSIS_MAX_SIZE / Math.max(source.width, source.height));
  // Only run high-res if the low-res scale was < 0.9 (meaning we downscaled)
  if (lowScale >= 0.9) return null;
  const highScale = Math.min(
    1,
    (ANALYSIS_MAX_SIZE * HIGH_RES_SCALE) / Math.max(source.width, source.height),
  );
  return {
    width: Math.max(32, Math.round(source.width * highScale)),
    height: Math.max(32, Math.round(source.height * highScale)),
  };
};

/**
 * High-res refinement pass: after coarse alignment, re-sample at 2× resolution
 * and run a second independent alignment. Coarse and HR images are re-sampled
 * from the same originals at the same relative resolution for source and output,
 * so the transform is directly comparable. Returns the more precise HR estimate.
 */
const estimateWithHighResRefinement = async (
  inputImage: RasterImageSource,
  outputImage: RasterImageSource,
  coarseEstimate: ComfyImageAlignmentEstimate,
  coarseSize: { width: number; height: number },
  holdOutChangedRegions: boolean,
): Promise<ComfyImageAlignmentEstimate | null> => {
  const hrSize = getHighResAnalysisSize(inputImage);
  if (!hrSize) return coarseEstimate;

  const [hrSource, hrOutput] = await Promise.all([
    readNormalizedPixels(inputImage, hrSize.width, hrSize.height),
    readNormalizedPixels(outputImage, hrSize.width, hrSize.height),
  ]);
  const highResCoarseEstimate: ComfyImageAlignmentEstimate = {
    ...coarseEstimate,
    sourceToOutputOffsetX:
      coarseEstimate.sourceToOutputOffsetX * (hrSource.width / coarseSize.width),
    sourceToOutputOffsetY:
      coarseEstimate.sourceToOutputOffsetY * (hrSource.height / coarseSize.height),
  };

  // Select tracking points on the high-res source
  let points = selectTrackingPoints(hrSource);
  if (points.length < MIN_MATCH_COUNT) return coarseEstimate;

  // Filter out points predicted to be outside the output bounds
  points = points.filter((p) => {
    const predicted = applyAlignmentToPoint(p, highResCoarseEstimate);
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
    ransacThreshold: 0.5,
    holdOutChangedRegions,
  });

  return hrEstimate
    ? {
        ...hrEstimate,
        sourceToOutputOffsetX:
          hrEstimate.sourceToOutputOffsetX * (coarseSize.width / hrSource.width),
        sourceToOutputOffsetY:
          hrEstimate.sourceToOutputOffsetY * (coarseSize.height / hrSource.height),
      }
    : coarseEstimate;
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

  const opts = resolveComfyAlignmentOptions(options);

  // --- Select tracking points ---
  let points = selectTrackingPoints(source);
  if (points.length < MIN_MATCH_COUNT) return null;

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
    holdOutChangedRegions: opts.skipEditedRegions,
  });

  if (!estimate) return null;

  // --- Optional: iterative refinement ---
  const refinedEstimate = opts.iterativeRefinement
    ? estimateWithIterativeRefinement(source, output, points, estimate, opts.skipEditedRegions)
    : estimate;

  if (!refinedEstimate) return null;

  return refinedEstimate;
};

const readNormalizedPixels = async (
  image: RasterImageSource,
  width: number,
  height: number,
): Promise<PixelImage> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create an image alignment canvas.');
  context.drawImage(image.source, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
};

const getAnalysisSize = (source: RasterImageSource): { width: number; height: number } => {
  const scale = Math.min(1, ANALYSIS_MAX_SIZE / Math.max(source.width, source.height));
  return {
    width: Math.max(32, Math.round(source.width * scale)),
    height: Math.max(32, Math.round(source.height * scale)),
  };
};

export const alignComfyOutputToInput = async ({
  node,
  output,
  sceneNode,
  inputBlob,
  inputNameHint,
  reference,
  options,
}: {
  node: ComfyNode;
  output: GeneratedOutput;
  sceneNode: { width: number; height: number } | null | undefined;
  inputBlob: Blob;
  inputNameHint?: string;
  reference?: ComfyAlignmentReference;
  options?: ComfyAlignmentOptions;
}): Promise<GeneratedOutput | null> => {
  if (output.mediaKind && output.mediaKind !== 'image') return null;
  const outputBlob = await getAsset(output.src);
  if (!outputBlob) return null;

  const opts = resolveComfyAlignmentOptions(options);
  const inputImage = await decodeRasterImageSource(inputBlob, {
    nameHint: inputNameHint,
    label: 'Comfy alignment input image',
  });
  let outputImage: RasterImageSource | null = null;

  try {
    outputImage = await decodeRasterImageSource(outputBlob, {
      nameHint: output.label,
      label: 'selected Comfy output image',
      cacheKey: output.src,
    });
    const analysisSize = getAnalysisSize(inputImage);
    const [sourcePixels, outputPixels] = await Promise.all([
      readNormalizedPixels(inputImage, analysisSize.width, analysisSize.height),
      readNormalizedPixels(outputImage, analysisSize.width, analysisSize.height),
    ]);
    const estimate = estimateComfyImageAlignment(sourcePixels, outputPixels, opts);
    if (!estimate) return null;

    // --- Optional: high-resolution refinement pass ---
    const finalEstimate = opts.highResRefinement
      ? await estimateWithHighResRefinement(
          inputImage,
          outputImage,
          estimate,
          analysisSize,
          opts.skipEditedRegions,
        )
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
    const correction = invertAxisAlignedTransformAroundCenter(
      {
        scaleX: finalEstimate.sourceToOutputScaleX,
        scaleY: finalEstimate.sourceToOutputScaleY,
        offsetX: finalEstimate.sourceToOutputOffsetX,
        offsetY: finalEstimate.sourceToOutputOffsetY,
      },
      analysisSize,
    );
    if (!correction) return null;

    const regionOffset = getComfyOutputRegionOffset({ node, output, sceneNode });

    if (
      reference &&
      reference.width > 0 &&
      reference.height > 0 &&
      [
        reference.transform.x,
        reference.transform.y,
        reference.transform.scaleX,
        reference.transform.scaleY,
      ].every(Number.isFinite)
    ) {
      // The tracker solved native input pixels -> native output pixels. Compose
      // its inverse with the input node's actual scene placement instead of
      // assuming both images use the Comfy node's auto-fit transform.
      return {
        ...output,
        transform: composeComfyAlignmentWithReference({
          reference,
          outputSize: output,
          analysisSize,
          correction,
          regionOffset,
        }),
      };
    }

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
          correction.offsetX * ((baseScaleX * output.width) / analysisSize.width),
        y:
          baseY -
          regionOffset.y -
          correction.offsetY * ((baseScaleY * output.height) / analysisSize.height),
        scaleX: baseScaleX * correction.scaleX,
        scaleY: baseScaleY * correction.scaleY,
        fitMode: ImageFitMode.CUSTOM,
      },
    };
  } finally {
    outputImage?.close();
    inputImage.close();
  }
};
