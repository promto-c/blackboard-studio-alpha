import type { Keyframe } from '@blackboard/types';
import type { AnimatablePoint } from '@/state/editor/utils';

/**
 * Collect all unique frame numbers from an array of AnimatablePoints,
 * including any additional frames.
 *
 * Each AnimatablePoint's x and y components can either be a plain number
 * (constant value) or an array of Keyframes (animated value). This function
 * extracts every keyframe frame across all points and returns them sorted
 * ascending.
 *
 * Example usage:
 *   const frames = collectAnimatablePointFrames(points, [currentFrame]);
 */
export function collectAnimatablePointFrames(
  points: readonly AnimatablePoint[],
  additionalFrames: readonly number[] = [],
): number[] {
  const frameSet = new Set(additionalFrames);

  for (const point of points) {
    collectFramesFromComponent(point.x, frameSet);
    collectFramesFromComponent(point.y, frameSet);
  }

  return [...frameSet].sort((a, b) => a - b);
}

function collectFramesFromComponent(
  value: number | readonly Keyframe[],
  frameSet: Set<number>,
): void {
  if (Array.isArray(value)) {
    for (const keyframe of value) {
      frameSet.add(keyframe.frame);
    }
  }
}
