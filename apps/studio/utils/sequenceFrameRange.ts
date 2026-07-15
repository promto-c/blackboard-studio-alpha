import type { TimelineFrameRange } from './timelineRange';
import { normalizeTimelineFrameRange } from './timelineRange';

export interface ParsedSequenceFrame {
  prefix: string;
  extension: string;
  frame: number;
  padding: number;
}

export const parseSequenceFrameName = (fileName: string): ParsedSequenceFrame | null => {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const match = /^(.*?)(\d+)(\.[^.]+)$/.exec(baseName);
  if (!match) return null;

  const frame = Number(match[2]);
  if (!Number.isSafeInteger(frame)) return null;

  return {
    prefix: match[1],
    frame,
    padding: match[2].length,
    extension: match[3].toLowerCase(),
  };
};

/**
 * Detects a contiguous absolute frame range from the trailing frame token in
 * plate filenames such as `shot_comp.1001.exr`.
 */
export const detectSequenceFrameRange = (
  fileNames: readonly string[],
): TimelineFrameRange | null => {
  if (fileNames.length === 0) return null;

  const parsed = fileNames.map(parseSequenceFrameName);
  if (parsed.some((entry) => entry === null)) return null;

  const frames = parsed as ParsedSequenceFrame[];
  const first = frames[0];
  const isSingleSequence = frames.every(
    (entry) =>
      entry.prefix === first.prefix &&
      entry.extension === first.extension &&
      entry.padding === first.padding,
  );
  const isContiguous = frames.every((entry, index) => entry.frame === first.frame + index);
  if (!isSingleSequence || !isContiguous) return null;

  return normalizeTimelineFrameRange(first.frame, frames[frames.length - 1].frame);
};
