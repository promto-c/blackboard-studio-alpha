import {
  RotoDrawMode,
  RotoShapeType,
  type RotoNode,
  type RotoPath,
  type SceneNode,
} from '@blackboard/types';
import type { ContourPoint } from '@/utils/contour';
import { sampleBSplinePoints } from '@/utils/bspline';
import { drawRotoPathGeometry } from '@/utils/rotoMaskRaster';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import { DEFAULT_ROTO_POINT_WEIGHT_MODE } from '@/utils/rotoPointWeights';

const DEFAULT_MAX_ANALYSIS_DIMENSION = 1_536;
const ANALYSIS_PADDING = 2;
const OWNERSHIP_SAMPLES_PER_SPLINE_SEGMENT = 4;

export interface RotoShapeRasterBounds {
  /** Left edge in scene-centered coordinates. */
  x: number;
  /** Top edge in scene-centered coordinates. */
  y: number;
  width: number;
  height: number;
}

/**
 * A temporary, shape-local binary raster used by geometry analysis tools.
 * It is deliberately not project data and must never be persisted as an asset.
 */
export interface RotoShapeAnalysisRaster {
  mask: Uint8Array;
  width: number;
  height: number;
  sceneBounds: RotoShapeRasterBounds;
}

const getShapeBounds = (
  node: RotoNode,
  path: RotoPath,
  frame: number,
): RotoShapeRasterBounds | null => {
  const points = resolveRotoPathPointsAtFrame(node, path, frame);
  if (points.length < 3) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    x: minX - ANALYSIS_PADDING,
    y: minY - ANALYSIS_PADDING,
    width: Math.max(1, maxX - minX + ANALYSIS_PADDING * 2),
    height: Math.max(1, maxY - minY + ANALYSIS_PADDING * 2),
  };
};

export const rasterPointToScenePoint = (
  raster: Pick<RotoShapeAnalysisRaster, 'width' | 'height' | 'sceneBounds'>,
  point: ContourPoint,
): ContourPoint => ({
  x: raster.sceneBounds.x + (point.x / Math.max(1, raster.width)) * raster.sceneBounds.width,
  y: raster.sceneBounds.y + (point.y / Math.max(1, raster.height)) * raster.sceneBounds.height,
});

export const scenePointToRasterPoint = (
  raster: Pick<RotoShapeAnalysisRaster, 'width' | 'height' | 'sceneBounds'>,
  point: ContourPoint,
): ContourPoint => ({
  x: ((point.x - raster.sceneBounds.x) / Math.max(1, raster.sceneBounds.width)) * raster.width,
  y: ((point.y - raster.sceneBounds.y) / Math.max(1, raster.sceneBounds.height)) * raster.height,
});

/**
 * Return the rendered boundary neighborhood governed by each source control.
 * B-spline controls do not generally sit on their curve, so separation must
 * classify them from spline parameter space rather than Euclidean proximity.
 */
export const getRotoControlOwnershipSamples = (
  path: Pick<RotoPath, 'shapeType' | 'pointWeights' | 'pointWeightModes' | 'pointTypes' | 'closed'>,
  resolvedPoints: readonly ContourPoint[],
): ContourPoint[][] => {
  if (resolvedPoints.length === 0) return [];
  if (path.shapeType !== RotoShapeType.BSPLINE || resolvedPoints.length < 3 || !path.closed) {
    return resolvedPoints.map((point, index) => {
      if (resolvedPoints.length < 2) return [{ ...point }];
      const previous = resolvedPoints[(index - 1 + resolvedPoints.length) % resolvedPoints.length];
      const next = resolvedPoints[(index + 1) % resolvedPoints.length];
      return [
        { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 },
        { ...point },
        { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
      ];
    });
  }

  const sampled = sampleBSplinePoints(
    [...resolvedPoints],
    true,
    path.pointWeights,
    OWNERSHIP_SAMPLES_PER_SPLINE_SEGMENT,
    DEFAULT_ROTO_POINT_WEIGHT_MODE,
    path.pointTypes,
    path.pointWeightModes,
  );
  const uniqueSampleCount = resolvedPoints.length * OWNERSHIP_SAMPLES_PER_SPLINE_SEGMENT;
  if (sampled.length < uniqueSampleCount) return resolvedPoints.map((point) => [{ ...point }]);
  const halfSegment = Math.floor(OWNERSHIP_SAMPLES_PER_SPLINE_SEGMENT / 2);

  return resolvedPoints.map((_, index) => {
    const anchorIndex = index * OWNERSHIP_SAMPLES_PER_SPLINE_SEGMENT;
    return [
      sampled[(anchorIndex - halfSegment + uniqueSampleCount) % uniqueSampleCount],
      sampled[anchorIndex],
      sampled[(anchorIndex + halfSegment) % uniqueSampleCount],
    ].map((point) => ({ ...point }));
  });
};

export const sceneDistanceToRasterDistance = (
  raster: Pick<RotoShapeAnalysisRaster, 'width' | 'height' | 'sceneBounds'>,
  distance: number,
): number =>
  distance *
  ((raster.width / Math.max(1, raster.sceneBounds.width) +
    raster.height / Math.max(1, raster.sceneBounds.height)) /
    2);

/**
 * Rasterize any closed polygon or B-spline at its resolved frame transform.
 * Styling, opacity, and Smart Mask provenance are intentionally ignored: only
 * the vector silhouette participates in the analysis.
 */
export const rasterizeRotoShapeForAnalysis = (
  node: RotoNode,
  path: RotoPath,
  frame: number,
  scene: Pick<SceneNode, 'width' | 'height'>,
  maxDimension = DEFAULT_MAX_ANALYSIS_DIMENSION,
): RotoShapeAnalysisRaster | null => {
  if (!path.closed) return null;
  const sceneBounds = getShapeBounds(node, path, frame);
  if (!sceneBounds) return null;

  const safeMaxDimension = Math.max(64, Math.round(maxDimension));
  const scale = Math.min(1, safeMaxDimension / Math.max(sceneBounds.width, sceneBounds.height));
  const width = Math.max(1, Math.ceil(sceneBounds.width * scale));
  const height = Math.max(1, Math.ceil(sceneBounds.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create the temporary shape analysis raster.');

  const scaleX = width / sceneBounds.width;
  const scaleY = height / sceneBounds.height;
  const sceneCanvasLeft = sceneBounds.x + scene.width / 2;
  const sceneCanvasTop = sceneBounds.y + scene.height / 2;
  context.setTransform(scaleX, 0, 0, scaleY, -sceneCanvasLeft * scaleX, -sceneCanvasTop * scaleY);
  context.fillStyle = '#fff';
  drawRotoPathGeometry(
    context,
    node,
    {
      ...path,
      closed: true,
      style: { ...path.style, mode: RotoDrawMode.FILL },
    },
    frame,
    scene.width,
    scene.height,
  );
  context.resetTransform();

  const alpha = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = alpha[index * 4 + 3] >= 128 ? 255 : 0;
  }

  return { mask, width, height, sceneBounds };
};
