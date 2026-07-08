import { describe, expect, it } from 'vitest';
import type { GeneratedOutput } from '@blackboard/types';
import type { GalleryEntry } from '@blackboard/project-store';
import { getComfyGalleryEntriesForOutputDelete } from './comfyGalleryDeletion';

const makeOutput = (updates: Partial<GeneratedOutput> = {}): GeneratedOutput => ({
  id: 'output-a',
  src: 'asset-a',
  width: 128,
  height: 128,
  createdAt: 100,
  ...updates,
});

const makeEntry = (updates: Partial<GalleryEntry> = {}): GalleryEntry => ({
  id: 'entry-a',
  source: 'Comfy',
  assetId: 'asset-a',
  width: 128,
  height: 128,
  createdAt: 100,
  tags: ['project:project-a', 'branch:main', 'node:node-a', 'source:comfy'],
  outputId: 'output-a',
  ...updates,
});

describe('getComfyGalleryEntriesForOutputDelete', () => {
  it('matches current node gallery entries by output id', () => {
    const entries = [
      makeEntry({ id: 'matching-entry' }),
      makeEntry({
        id: 'other-node-entry',
        tags: ['project:project-a', 'branch:main', 'node:node-b'],
      }),
    ];

    expect(
      getComfyGalleryEntriesForOutputDelete({
        entries,
        outputs: [makeOutput()],
        scope: { projectId: 'project-a', branchId: 'main', nodeId: 'node-a' },
      }).map((entry) => entry.id),
    ).toEqual(['matching-entry']);
  });

  it('falls back to output asset ids for older entries without output ids', () => {
    const entries = [
      makeEntry({ id: 'frame-entry', assetId: 'frame-b', outputId: undefined }),
      makeEntry({ id: 'unrelated-entry', assetId: 'asset-z', outputId: undefined }),
    ];

    expect(
      getComfyGalleryEntriesForOutputDelete({
        entries,
        outputs: [makeOutput({ src: 'asset-a', frames: ['frame-a', 'frame-b'] })],
        scope: { projectId: 'project-a', branchId: 'main', nodeId: 'node-a' },
      }).map((entry) => entry.id),
    ).toEqual(['frame-entry']);
  });

  it('ignores entries already in the bin', () => {
    expect(
      getComfyGalleryEntriesForOutputDelete({
        entries: [makeEntry({ deletedAt: 200 })],
        outputs: [makeOutput()],
        scope: { projectId: 'project-a', branchId: 'main', nodeId: 'node-a' },
      }),
    ).toEqual([]);
  });
});
