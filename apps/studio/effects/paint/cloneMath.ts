import type { Point } from '@blackboard/types';

export const createCloneOffset = (source: Point, target: Point): Point => ({
  x: source.x - target.x,
  y: source.y - target.y,
});

export const getCloneSourceFromOffset = (
  target: Point,
  cloneOffset?: Point | null,
): Point | null => {
  if (!cloneOffset) return null;
  return {
    x: target.x + cloneOffset.x,
    y: target.y + cloneOffset.y,
  };
};
