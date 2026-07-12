import type { GalleryEntry } from '@blackboard/project-store';

export type GallerySelection = Map<string, GalleryEntry>;

interface GallerySelectionClickOptions {
  entry: GalleryEntry;
  visibleEntries: readonly GalleryEntry[];
  currentSelection: GallerySelection;
  anchorId: string | null;
  shiftKey: boolean;
  additive: boolean;
}

export interface GallerySelectionClickResult {
  selection: GallerySelection;
  anchorId: string | null;
}

export const getGallerySelectionAfterClick = ({
  entry,
  visibleEntries,
  currentSelection,
  anchorId,
  shiftKey,
  additive,
}: GallerySelectionClickOptions): GallerySelectionClickResult => {
  if (!entry.assetId) return { selection: currentSelection, anchorId };

  if (shiftKey && anchorId) {
    const anchorIndex = visibleEntries.findIndex((candidate) => candidate.id === anchorId);
    const targetIndex = visibleEntries.findIndex((candidate) => candidate.id === entry.id);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const [startIndex, endIndex] =
        anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const selection = additive ? new Map(currentSelection) : new Map<string, GalleryEntry>();
      visibleEntries
        .slice(startIndex, endIndex + 1)
        .filter((candidate) => !!candidate.assetId)
        .forEach((candidate) => selection.set(candidate.id, candidate));
      return { selection, anchorId };
    }
  }

  if (additive) {
    const selection = new Map(currentSelection);
    if (selection.has(entry.id)) selection.delete(entry.id);
    else selection.set(entry.id, entry);
    return { selection, anchorId: entry.id };
  }

  return {
    selection: new Map([[entry.id, entry]]),
    anchorId: entry.id,
  };
};
