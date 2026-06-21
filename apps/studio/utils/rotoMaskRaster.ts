import { getValueAtFrame } from '@blackboard/renderer';
import { RotoDrawMode, RotoShapeType, type RotoNode } from '@blackboard/types';
import { drawBSplineOnCanvas } from '@/utils/bspline';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import { DEFAULT_ROTO_POINT_WEIGHT_MODE, type RotoPointWeightMode } from '@/utils/rotoPointWeights';

export const drawRotoPathGeometry = (
  context: CanvasRenderingContext2D,
  node: RotoNode,
  path: RotoNode['paths'][number],
  frame: number,
  width: number,
  height: number,
  pointWeightMode: RotoPointWeightMode = DEFAULT_ROTO_POINT_WEIGHT_MODE,
): void => {
  const points = resolveRotoPathPointsAtFrame(node, path, frame).map((point) => ({
    x: point.x + width / 2,
    y: point.y + height / 2,
  }));

  context.beginPath();
  if (points.length > 0) {
    if (path.shapeType === RotoShapeType.BSPLINE) {
      drawBSplineOnCanvas(
        context,
        points,
        path.closed,
        path.pointWeights,
        pointWeightMode,
        path.pointTypes,
        path.pointWeightModes,
      );
    } else {
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    }
  }

  if (path.closed) context.closePath();
  context.lineWidth = getValueAtFrame(path.style.strokeWidth, frame);
  if (path.style.mode === RotoDrawMode.FILL && path.closed) context.fill();
  if (path.style.mode === RotoDrawMode.STROKE) context.stroke();
  if (path.style.mode === RotoDrawMode.FILL_AND_STROKE) {
    if (path.closed) context.fill();
    context.stroke();
  }
};
