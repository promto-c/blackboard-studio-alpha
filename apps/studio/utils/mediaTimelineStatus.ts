import type { SourceFrameRange } from '@/nodes/sourceFrameRange';

/**
 * Projects source-frame state onto its real timeline range. Playback extension
 * modes such as hold, loop, and bounce intentionally do not extend this range:
 * they can render a frame, but the source does not own additional frame data.
 */
export const buildSourceDataTimelineStatus = (
  sourceRange: SourceFrameRange,
  timelineStartFrame: number,
  timelineEndFrame: number,
  getSourceFrameStatus: (sourceFrame: number) => boolean,
): boolean[] => {
  const timelineEnd = Math.max(0, Math.round(timelineEndFrame));
  const status = new Array(timelineEnd + 1).fill(false);
  if (sourceRange.frameCount <= 0) return status;

  const firstFrame = Math.max(0, Math.round(timelineStartFrame), sourceRange.startFrame);
  const lastFrame = Math.min(timelineEnd, sourceRange.endFrame);

  for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
    status[frame] = getSourceFrameStatus(frame - sourceRange.startFrame);
  }

  return status;
};

export const buildSourceDataAvailability = (
  sourceRange: SourceFrameRange,
  timelineStartFrame: number,
  timelineEndFrame: number,
): boolean[] =>
  buildSourceDataTimelineStatus(sourceRange, timelineStartFrame, timelineEndFrame, () => true);

export interface TimelineFrameSegment {
  start: number;
  end: number;
}

export const buildTimelineFrameSegments = (
  timelineStartFrame: number,
  timelineEndFrame: number,
  activeFrames: readonly boolean[],
): TimelineFrameSegment[] => {
  const segments: TimelineFrameSegment[] = [];
  let segmentStart: number | null = null;

  for (let frame = timelineStartFrame; frame <= timelineEndFrame; frame += 1) {
    if (activeFrames[frame]) {
      segmentStart ??= frame;
    } else if (segmentStart !== null) {
      segments.push({ start: segmentStart, end: frame - 1 });
      segmentStart = null;
    }
  }

  if (segmentStart !== null) segments.push({ start: segmentStart, end: timelineEndFrame });
  return segments;
};
