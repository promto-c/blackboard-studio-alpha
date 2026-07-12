import { describe, expect, it } from 'vitest';
import type { GalleryEntry } from '@blackboard/project-store';
import { getGallerySelectionAfterClick } from './gallerySelection';

const entry = (id: string): GalleryEntry => ({
  id,
  source: 'Comfy',
  assetId: `asset:${id}`,
  width: 64,
  height: 64,
  createdAt: 1,
  tags: [],
});

describe('Gallery selection', () => {
  const entries = [entry('one'), entry('two'), entry('three')];

  it('uses plain click as exclusive single selection', () => {
    const result = getGallerySelectionAfterClick({
      entry: entries[1],
      visibleEntries: entries,
      currentSelection: new Map([[entries[0].id, entries[0]]]),
      anchorId: entries[0].id,
      shiftKey: false,
      additive: false,
    });

    expect([...result.selection.keys()]).toEqual(['two']);
    expect(result.anchorId).toBe('two');
  });

  it('toggles with Ctrl/Cmd and selects ranges with Shift', () => {
    const additive = getGallerySelectionAfterClick({
      entry: entries[1],
      visibleEntries: entries,
      currentSelection: new Map([[entries[0].id, entries[0]]]),
      anchorId: entries[0].id,
      shiftKey: false,
      additive: true,
    });
    expect([...additive.selection.keys()]).toEqual(['one', 'two']);

    const range = getGallerySelectionAfterClick({
      entry: entries[2],
      visibleEntries: entries,
      currentSelection: new Map(),
      anchorId: entries[0].id,
      shiftKey: true,
      additive: false,
    });
    expect([...range.selection.keys()]).toEqual(['one', 'two', 'three']);
    expect(range.anchorId).toBe('one');
  });
});
