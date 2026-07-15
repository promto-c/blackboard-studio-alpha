import type {
  PaintNode,
  PaintStroke,
  PaintStrokeChannels,
  PaintStrokePath,
  PaintTool,
  PaintViewportTool,
  Point,
} from '@blackboard/types';
import { buildPaintHierarchy, flattenPaintHierarchyStrokeItems } from './paintLayers';

export interface PaintLivePreview {
  nodeId: string;
  sessionId: number;
  tool: PaintTool;
  path: PaintStrokePath;
  size: number;
  spacing: number;
  softness: number;
  opacity: number;
  color: [number, number, number];
  alpha: number;
  channels: PaintStrokeChannels;
  cloneOffset?: Point | null;
}

/** Paint paths follow DOM/SVG coordinates (positive Y points down). */
export const paintPointToRenderSpace = (point: Point): Point => ({
  x: point.x,
  y: -point.y,
});

/** Convert a stored DOM/SVG clone offset into the renderer's bottom-up UV space. */
export const paintCloneOffsetToUv = (
  offset: Point | null | undefined,
  width: number,
  height: number,
): Point => ({
  x: (offset?.x ?? 0) / Math.max(1, width),
  y: -(offset?.y ?? 0) / Math.max(1, height),
});

export const collectPaintStampPoints = (points: readonly Point[], spacing: number): Point[] => {
  if (points.length <= 1) return points.map((point) => ({ ...point }));

  const resolvedSpacing = Math.max(0.25, spacing);
  const stamps: Point[] = [{ ...points[0] }];
  let distanceUntilNextStamp = resolvedSpacing;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength <= Number.EPSILON) continue;

    let distanceOnSegment = 0;
    while (distanceOnSegment + distanceUntilNextStamp <= segmentLength) {
      distanceOnSegment += distanceUntilNextStamp;
      const amount = distanceOnSegment / segmentLength;
      stamps.push({ x: start.x + dx * amount, y: start.y + dy * amount });
      distanceUntilNextStamp = resolvedSpacing;
    }
    distanceUntilNextStamp -= segmentLength - distanceOnSegment;
  }

  const end = points[points.length - 1];
  const last = stamps[stamps.length - 1];
  if (!last || last.x !== end.x || last.y !== end.y) stamps.push({ ...end });
  return stamps;
};

export const getNextPaintStrokeName = (
  strokes: readonly PaintStroke[],
  tool: PaintTool,
): string => {
  const label = tool === 'brush' ? 'Brush' : tool === 'erase' ? 'Erase' : 'Clone';
  return `${label} ${strokes.filter((stroke) => stroke.tool === tool).length + 1}`;
};

export const isPaintTool = (value: string | null): value is PaintTool =>
  value === 'brush' || value === 'erase' || value === 'clone';

export const isPaintViewportTool = (value: string | null): value is PaintViewportTool =>
  value === 'select' || value === 'nudge' || isPaintTool(value);

export const getVisiblePaintStrokes = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  frame: number,
): PaintStroke[] =>
  flattenPaintHierarchyStrokeItems(buildPaintHierarchy(node, frame))
    .filter(
      ({ activeAtFrame, stroke, visible }) =>
        activeAtFrame && visible && stroke.path.points.length > 0,
    )
    // The item panel stores newest entries first. Rendering is back-to-front.
    .map(({ stroke }) => stroke)
    .reverse();
