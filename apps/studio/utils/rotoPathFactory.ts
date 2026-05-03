import { RotoDrawMode, RotoPathBlend, RotoShapeType, type RotoPath } from '@blackboard/types';

type Point = { x: number; y: number };

export const getRotoRectangleCornerPoints = (start: Point, end: Point): Point[] => {
  const x1 = Math.min(start.x, end.x);
  const y1 = Math.min(start.y, end.y);
  const x2 = Math.max(start.x, end.x);
  const y2 = Math.max(start.y, end.y);

  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
};

export const createFrameAnchoredRotoPoints = (
  points: readonly Point[],
  frame: number,
): RotoPath['points'] =>
  points.map((point) => ({
    x: [{ frame, value: point.x }],
    y: [{ frame, value: point.y }],
  }));

export const createRotoRectanglePath = ({
  id,
  name,
  parentLayerId,
  points,
  frame,
}: {
  id: string;
  name: string;
  parentLayerId: string | null;
  points: readonly Point[];
  frame: number;
}): RotoPath => ({
  id,
  name,
  parentLayerId,
  shapeType: RotoShapeType.BSPLINE,
  points: createFrameAnchoredRotoPoints(points, frame),
  pointTypes: points.map(() => 'corner'),
  closed: true,
  feather: 0,
  opacity: 100,
  blend: RotoPathBlend.ADD,
  style: { mode: RotoDrawMode.FILL, strokeWidth: 2 },
});
