import type { ImageSequenceNode, MediaSourceNode, SourceRangeBehavior } from '@blackboard/types';

export const DEFAULT_SOURCE_RANGE_BEHAVIOR: SourceRangeBehavior = 'black';

export type TemporalMediaNode = ImageSequenceNode | MediaSourceNode;

export interface SourceFrameRange {
  startFrame: number;
  endFrame: number;
  frameCount: number;
}

const finiteInteger = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;

const positiveInteger = (value: unknown): number | null => {
  const number = finiteInteger(value, 0);
  return number > 0 ? number : null;
};

export const getTemporalSourceFrameCount = (node: TemporalMediaNode): number => {
  if (node.type === 'image_sequence') return node.frames.length;
  if (node.mediaKind !== 'video') return 1;

  return (
    positiveInteger(node.frameCount) ?? Math.max(1, Math.ceil(Math.max(0, node.duration ?? 0) * 30))
  );
};

export const getSourceFrameRange = (node: TemporalMediaNode): SourceFrameRange => {
  const frameCount = getTemporalSourceFrameCount(node);
  const startFrame = finiteInteger(node.startFrame, 0);
  return {
    startFrame,
    endFrame: startFrame + Math.max(0, frameCount - 1),
    frameCount,
  };
};

const wrapIndex = (index: number, frameCount: number): number =>
  ((index % frameCount) + frameCount) % frameCount;

const bounceIndex = (index: number, frameCount: number): number => {
  if (frameCount <= 1) return 0;
  const period = (frameCount - 1) * 2;
  const wrapped = wrapIndex(index, period);
  return wrapped < frameCount ? wrapped : period - wrapped;
};

const resolveOutsideIndex = (
  index: number,
  frameCount: number,
  behavior: SourceRangeBehavior,
): number | null => {
  switch (behavior) {
    case 'black':
      return null;
    case 'loop':
      return wrapIndex(index, frameCount);
    case 'bounce':
      return bounceIndex(index, frameCount);
    case 'hold':
    default:
      return index < 0 ? 0 : frameCount - 1;
  }
};

/**
 * Maps a timeline frame to the zero-based frame stored by a temporal source.
 * A null result represents transparent black (zero RGBA), which composes as
 * no contribution when the source is used over another input.
 */
export const resolveTemporalSourceFrame = (
  node: TemporalMediaNode,
  timelineFrame: number,
): number | null => {
  const { startFrame, frameCount } = getSourceFrameRange(node);
  if (frameCount <= 0) return null;

  const index = finiteInteger(timelineFrame, startFrame) - startFrame;
  if (index >= 0 && index < frameCount) return index;

  const behavior =
    index < 0
      ? (node.beforeRangeBehavior ?? DEFAULT_SOURCE_RANGE_BEHAVIOR)
      : (node.afterRangeBehavior ?? DEFAULT_SOURCE_RANGE_BEHAVIOR);
  return resolveOutsideIndex(index, frameCount, behavior);
};
