import type { ImageSequenceNode, ImageSequencePlate } from '@blackboard/types';
import { parseSequenceFrameName } from './sequenceFrameRange';
import { normalizeTimelineFrameRange, type TimelineFrameRange } from './timelineRange';

export interface PlateImageEntry {
  file: File;
  relativePath: string;
}

export interface ImageSequencePlateGroup<TEntry extends PlateImageEntry = PlateImageEntry> {
  name: string;
  entries: TEntry[];
  frameRange: TimelineFrameRange;
}

const compareNatural = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const getPathParts = (relativePath: string): { directory: string; baseName: string } => {
  const normalized = relativePath.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  return separator < 0
    ? { directory: '', baseName: normalized }
    : { directory: normalized.slice(0, separator), baseName: normalized.slice(separator + 1) };
};

const getPlateLabel = (directory: string, stem: string): string => {
  const cleanStem = stem.replace(/[._\-\s]+$/, '').trim() || 'Plate';
  return directory ? `${directory.replace(/\//g, ' / ')} / ${cleanStem}` : cleanStem;
};

/** Groups a folder's images into contiguous numbered filename series. */
export const groupImageEntriesIntoPlates = <TEntry extends PlateImageEntry>(
  entries: readonly TEntry[],
): ImageSequencePlateGroup<TEntry>[] => {
  const numberedGroups = new Map<
    string,
    { directory: string; prefix: string; entries: Array<{ entry: TEntry; frame: number }> }
  >();
  const singleFrameGroups: ImageSequencePlateGroup<TEntry>[] = [];

  for (const entry of entries) {
    const { directory, baseName } = getPathParts(entry.relativePath);
    const parsed = parseSequenceFrameName(baseName);
    if (!parsed) {
      const stem = baseName.replace(/\.[^.]+$/, '');
      singleFrameGroups.push({
        name: getPlateLabel(directory, stem),
        entries: [entry],
        frameRange: normalizeTimelineFrameRange(0, 0),
      });
      continue;
    }

    const key = [directory, parsed.prefix.toLowerCase(), parsed.extension, parsed.padding].join(
      '\0',
    );
    const group = numberedGroups.get(key) ?? {
      directory,
      prefix: parsed.prefix,
      entries: [],
    };
    group.entries.push({ entry, frame: parsed.frame });
    numberedGroups.set(key, group);
  }

  const numberedPlateGroups = Array.from(numberedGroups.values()).flatMap((group) => {
    const ordered = [...group.entries].sort(
      (left, right) =>
        left.frame - right.frame ||
        compareNatural(left.entry.relativePath, right.entry.relativePath),
    );
    const runs: (typeof ordered)[] = [];

    for (const item of ordered) {
      const currentRun = runs[runs.length - 1];
      const previous = currentRun?.[currentRun.length - 1];
      if (!currentRun || !previous || item.frame !== previous.frame + 1) {
        runs.push([item]);
      } else {
        currentRun.push(item);
      }
    }

    const baseLabel = getPlateLabel(group.directory, group.prefix);
    return runs.map((run) => {
      const startFrame = run[0].frame;
      const endFrame = run[run.length - 1].frame;
      return {
        name: runs.length > 1 ? `${baseLabel} (${startFrame}–${endFrame})` : baseLabel,
        entries: run.map((item) => item.entry),
        frameRange: normalizeTimelineFrameRange(startFrame, endFrame),
      };
    });
  });

  return [...numberedPlateGroups, ...singleFrameGroups].sort((left, right) =>
    compareNatural(left.name, right.name),
  );
};

export const getImageSequencePlateTimelineRange = (
  plates: readonly Pick<ImageSequencePlate, 'startFrame' | 'frames'>[],
): TimelineFrameRange => {
  if (plates.length === 0) return normalizeTimelineFrameRange(0, 0);
  return normalizeTimelineFrameRange(
    Math.min(...plates.map((plate) => plate.startFrame)),
    Math.max(...plates.map((plate) => plate.startFrame + Math.max(0, plate.frames.length - 1))),
  );
};

export const getImageSequenceAssetIds = (node: ImageSequenceNode): string[] =>
  Array.from(
    new Set([...(node.frames ?? []), ...(node.plates?.flatMap((plate) => plate.frames) ?? [])]),
  ).filter(Boolean);

const snapshotActivePlate = (
  node: ImageSequenceNode,
  plate: ImageSequencePlate,
): ImageSequencePlate => ({
  ...plate,
  frames: node.frames,
  sourceFileName: node.sourceFileName,
  width: node.width,
  height: node.height,
  colorSpace: node.colorSpace,
  mediaColorManagement: node.mediaColorManagement,
  startFrame: node.startFrame,
});

export const selectImageSequencePlate = (
  node: ImageSequenceNode,
  plateId: string,
): Partial<ImageSequenceNode> | null => {
  if (!node.plates || node.plates.length === 0 || node.activePlateId === plateId) return null;

  const synchronizedPlates = node.plates.map((plate) =>
    plate.id === node.activePlateId ? snapshotActivePlate(node, plate) : plate,
  );
  const nextPlate = synchronizedPlates.find((plate) => plate.id === plateId);
  if (!nextPlate) return null;

  return {
    plates: synchronizedPlates,
    activePlateId: nextPlate.id,
    frames: nextPlate.frames,
    sourceFileName: nextPlate.sourceFileName,
    width: nextPlate.width,
    height: nextPlate.height,
    colorSpace: nextPlate.colorSpace,
    mediaColorManagement: nextPlate.mediaColorManagement,
    startFrame: nextPlate.startFrame,
  };
};
