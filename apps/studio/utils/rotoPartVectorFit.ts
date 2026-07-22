import type { RotoPointType } from '@blackboard/types';
import { sampleBSplinePoints } from '@/utils/bspline';
import type { ContourPoint } from '@/utils/contour';
import type { RotoPartSeparationResult } from '@/utils/rotoPartSeparation';

const FIT_SAMPLES_PER_SEGMENT = 24;

export interface RotoPartVectorFitContour {
  index: number;
  points: readonly ContourPoint[];
  pointTypes?: readonly RotoPointType[];
}

export interface RotoPartVectorFitMetrics {
  /** Percentage of the source silhouette covered by the combined editable vectors. */
  sourceCoveragePercent: number;
  /** Combined fitted pixels outside the source silhouette, relative to source area. */
  outsideSourcePercent: number;
  sourcePixelCount: number;
  coveredSourcePixelCount: number;
  outsideSourcePixelCount: number;
}

const rasterizeClosedPolyline = (
  points: readonly ContourPoint[],
  width: number,
  height: number,
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  if (points.length < 3) return mask;

  for (let y = 0; y < height; y += 1) {
    const sampleY = y + 0.5;
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if (start.y <= sampleY === end.y <= sampleY) continue;
      const t = (sampleY - start.y) / (end.y - start.y);
      intersections.push(start.x + (end.x - start.x) * t);
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const startX = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const endX = Math.min(width - 1, Math.floor(intersections[index + 1] - 0.5));
      for (let x = startX; x <= endX; x += 1) mask[y * width + x] = 255;
    }
  }
  return mask;
};

/**
 * Compare the combined editable result with the source silhouette. Internal
 * part masks guide ownership and joint placement; they are intentionally not
 * treated as vector-fit targets.
 */
export const measureRotoPartVectorFit = (
  result: Pick<RotoPartSeparationResult, 'width' | 'height' | 'sourceMask' | 'parts'>,
  contours: readonly RotoPartVectorFitContour[],
): RotoPartVectorFitMetrics => {
  const contourByIndex = new Map(contours.map((contour) => [contour.index, contour]));
  const fittedUnion = new Uint8Array(result.width * result.height);

  result.parts.forEach((part) => {
    const contour = contourByIndex.get(part.index);
    if (!contour) return;
    const sampled = sampleBSplinePoints(
      [...contour.points],
      true,
      undefined,
      FIT_SAMPLES_PER_SEGMENT,
      'global',
      contour.pointTypes,
    );
    const fittedMask = rasterizeClosedPolyline(sampled, result.width, result.height);
    for (let index = 0; index < fittedMask.length; index += 1) {
      if (fittedMask[index] > 0) fittedUnion[index] = 255;
    }
  });

  let sourcePixelCount = 0;
  let coveredSourcePixelCount = 0;
  let outsideSourcePixelCount = 0;
  for (let index = 0; index < result.sourceMask.length; index += 1) {
    const isSource = result.sourceMask[index] > 0;
    const isFitted = fittedUnion[index] > 0;
    if (isSource) sourcePixelCount += 1;
    if (isSource && isFitted) coveredSourcePixelCount += 1;
    if (!isSource && isFitted) outsideSourcePixelCount += 1;
  }

  const denominator = Math.max(1, sourcePixelCount);
  return {
    sourceCoveragePercent: (coveredSourcePixelCount / denominator) * 100,
    outsideSourcePercent: (outsideSourcePixelCount / denominator) * 100,
    sourcePixelCount,
    coveredSourcePixelCount,
    outsideSourcePixelCount,
  };
};
