import { AnimatableNumber, AnyNode, Keyframe, type ImageSequencePlate } from '@blackboard/types';
import { getLinearValueAtFrame } from '@blackboard/renderer';
import { readExrDimensions } from '@/utils/exr';
import {
  getImportedImageColorManagement,
  isExrFileLike,
  isImageFileLike,
} from '@/utils/mediaFiles';
import { saveAsset, saveDirectoryAssetReferences } from '@/state/assetStorage';
import { getNodeAssetIds } from '@/nodes/helpers';
import { ColorManagementDefaults, getMediaSourceColorSpace } from '@/color-management';
import {
  getImageSequencePlateTimelineRange,
  groupImageEntriesIntoPlates,
} from '@/utils/imageSequencePlates';
import type { TimelineFrameRange } from '@/utils/timelineRange';

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

export type AnimatablePoint = { x: AnimatableNumber; y: AnimatableNumber };
export type ResolvedPoint = { x: number; y: number };
export type SequenceImportMode = 'copy' | 'reference';
export type DirectoryImageEntry = { file: File; relativePath: string };

// ---------------------------------------------------------------------------
// Point resolution helpers
// ---------------------------------------------------------------------------

export const resolveAnimatablePoint = (point: AnimatablePoint, frame: number): ResolvedPoint => ({
  x: getLinearValueAtFrame(point.x, frame),
  y: getLinearValueAtFrame(point.y, frame),
});

export const resolveAnimatablePoints = (
  points: AnimatablePoint[],
  frame: number,
): ResolvedPoint[] => points.map((point) => resolveAnimatablePoint(point, frame));

export const toFrameAnchoredPoint = (point: ResolvedPoint, frame: number): AnimatablePoint => ({
  // Keep frame-0 values keyed so newly created roto shapes show a keyframe at start.
  x: [{ frame, value: point.x }],
  y: [{ frame, value: point.y }],
});

export const toFrameAnchoredPoints = (points: ResolvedPoint[], frame: number): AnimatablePoint[] =>
  points.map((point) => toFrameAnchoredPoint(point, frame));

export const toAnimatableValue = (keyframes: Keyframe[]): AnimatableNumber => {
  // Preserve a single frame-0 keyframe as keyed data to avoid dropping timeline diamonds.
  return keyframes.length === 0 ? 0 : keyframes;
};

export const toAnimatablePointFromKeyframes = (x: Keyframe[], y: Keyframe[]): AnimatablePoint => ({
  x: toAnimatableValue(x),
  y: toAnimatableValue(y),
});

export const normalizeRelativePath = (path: string): string =>
  path
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');

export const toSortedImageEntries = (entries: DirectoryImageEntry[]): DirectoryImageEntry[] => {
  return [...entries].sort((a, b) =>
    a.file.name.localeCompare(b.file.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
};

export const readImageDimensions = async (
  file: File,
): Promise<{ width: number; height: number }> => {
  if (isExrFileLike(file)) {
    return readExrDimensions(file);
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Could not decode image "${file.name}"`));
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const getSequenceProjectName = (firstRelativePath: string): string => {
  const normalized = normalizeRelativePath(firstRelativePath);
  if (!normalized.includes('/')) return 'Image Sequence';
  return normalized.split('/')[0] || 'Image Sequence';
};

// ---------------------------------------------------------------------------
// Directory / sequence helpers
// ---------------------------------------------------------------------------

type DirectoryHandleEntry = [string, FileSystemDirectoryHandle | FileSystemFileHandle];
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterable<DirectoryHandleEntry>;
};

export const collectImageEntriesFromDirectoryHandle = async (
  directoryHandle: FileSystemDirectoryHandle,
): Promise<DirectoryImageEntry[]> => {
  const entries: DirectoryImageEntry[] = [];

  const walkDirectory = async (
    handle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> => {
    for await (const [name, childHandle] of (handle as IterableDirectoryHandle).entries()) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (childHandle.kind === 'directory') {
        await walkDirectory(childHandle, relativePath);
      } else {
        const file = await childHandle.getFile();
        if (isImageFileLike(file, name)) {
          entries.push({ file, relativePath: normalizeRelativePath(relativePath) });
        }
      }
    }
  };

  await walkDirectory(directoryHandle, '');
  return toSortedImageEntries(entries);
};

export const buildImageEntriesFromFiles = (files: File[]): DirectoryImageEntry[] => {
  const entries = files
    .filter((file) => isImageFileLike(file))
    .map((file) => ({
      file,
      relativePath: normalizeRelativePath(file.webkitRelativePath || file.name),
    }));
  return toSortedImageEntries(entries);
};

export const persistSequenceAssets = async (
  entries: DirectoryImageEntry[],
  importMode: SequenceImportMode,
  directoryHandle?: FileSystemDirectoryHandle,
): Promise<string[]> => {
  if (importMode === 'reference' && directoryHandle) {
    try {
      return await saveDirectoryAssetReferences(
        directoryHandle,
        entries.map((entry) => entry.relativePath),
      );
    } catch (error) {
      console.warn('Reference import failed, falling back to copy import.', error);
    }
  }
  return Promise.all(entries.map((entry) => saveAsset(entry.file)));
};

export interface PreparedImageSequenceImport {
  plates: ImageSequencePlate[];
  timelineRange: TimelineFrameRange;
}

export const prepareImageSequenceImport = async (
  entries: DirectoryImageEntry[],
  importMode: SequenceImportMode,
  directoryHandle?: FileSystemDirectoryHandle,
): Promise<PreparedImageSequenceImport> => {
  const groups = groupImageEntriesIntoPlates(entries);
  const groupMetadata = await Promise.all(
    groups.map(async (group) => {
      const firstEntry = group.entries[0];
      return {
        firstEntry,
        dimensions: await readImageDimensions(firstEntry.file),
        mediaColorManagement: await getImportedImageColorManagement(firstEntry.file),
      };
    }),
  );
  const assetIds = await persistSequenceAssets(entries, importMode, directoryHandle);
  const assetIdByEntry = new Map(entries.map((entry, index) => [entry, assetIds[index]] as const));

  const plates = groups.map((group, index): ImageSequencePlate => {
    const { firstEntry, dimensions, mediaColorManagement } = groupMetadata[index];
    return {
      id: `plate_${index + 1}`,
      name: group.name,
      frames: group.entries.map((entry) => assetIdByEntry.get(entry) ?? '').filter(Boolean),
      sourceFileName: firstEntry.file.name,
      width: dimensions.width,
      height: dimensions.height,
      colorSpace:
        getMediaSourceColorSpace(mediaColorManagement) ?? ColorManagementDefaults.TEXTURE_SPACE,
      mediaColorManagement,
      startFrame: group.frameRange.startFrame,
    };
  });

  return {
    plates,
    timelineRange: getImageSequencePlateTimelineRange(plates),
  };
};

export const collectNodeAssetIds = (nodes: AnyNode[]): string[] => {
  const ids: string[] = [];
  nodes.forEach((node) => {
    ids.push(...getNodeAssetIds(node));
  });
  return ids.filter(Boolean);
};
