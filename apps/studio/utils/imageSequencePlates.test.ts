import { describe, expect, it } from 'vitest';
import type { ImageSequenceNode } from '@blackboard/types';
import {
  getImageSequenceAssetIds,
  getImageSequencePlateTimelineRange,
  groupImageEntriesIntoPlates,
  selectImageSequencePlate,
} from './imageSequencePlates';

const entry = (relativePath: string) => ({
  relativePath,
  file: new File([], relativePath.split('/').pop() ?? relativePath),
});

describe('image sequence plates', () => {
  it('groups multiple numbered plates in one folder', () => {
    const groups = groupImageEntriesIntoPlates([
      entry('plates/beauty.1002.exr'),
      entry('plates/depth.1001.exr'),
      entry('plates/beauty.1001.exr'),
      entry('plates/depth.1002.exr'),
    ]);

    expect(
      groups.map(({ name, entries, frameRange }) => ({
        name,
        files: entries.map((item) => item.file.name),
        frameRange,
      })),
    ).toEqual([
      {
        name: 'plates / beauty',
        files: ['beauty.1001.exr', 'beauty.1002.exr'],
        frameRange: { startFrame: 1001, endFrame: 1002, frameCount: 2 },
      },
      {
        name: 'plates / depth',
        files: ['depth.1001.exr', 'depth.1002.exr'],
        frameRange: { startFrame: 1001, endFrame: 1002, frameCount: 2 },
      },
    ]);
  });

  it('splits gaps so missing source frames are not silently collapsed', () => {
    const groups = groupImageEntriesIntoPlates([
      entry('beauty.1001.exr'),
      entry('beauty.1002.exr'),
      entry('beauty.1005.exr'),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['beauty (1001–1002)', 'beauty (1005–1005)']);
  });

  it('covers every imported plate in the scene range and asset set', () => {
    const plates = [
      {
        id: 'beauty',
        name: 'beauty',
        frames: ['beauty-1001', 'shared'],
        width: 1920,
        height: 1080,
        colorSpace: 'ACEScg',
        startFrame: 1001,
      },
      {
        id: 'depth',
        name: 'depth',
        frames: ['depth-1010', 'shared'],
        width: 1920,
        height: 1080,
        colorSpace: 'Utility - Raw',
        startFrame: 1010,
      },
    ];

    expect(getImageSequencePlateTimelineRange(plates)).toEqual({
      startFrame: 1001,
      endFrame: 1011,
      frameCount: 11,
    });
    expect(
      getImageSequenceAssetIds({ frames: ['beauty-1001'], plates } as ImageSequenceNode),
    ).toEqual(['beauty-1001', 'shared', 'depth-1010']);
  });

  it('switches the active plate while retaining edits to the previous plate', () => {
    const node = {
      activePlateId: 'beauty',
      frames: ['beauty-current'],
      sourceFileName: 'beauty.1001.exr',
      width: 2048,
      height: 1556,
      colorSpace: 'ACEScg',
      startFrame: 1001,
      plates: [
        {
          id: 'beauty',
          name: 'beauty',
          frames: ['beauty-original'],
          width: 1920,
          height: 1080,
          colorSpace: 'sRGB - Texture',
          startFrame: 1,
        },
        {
          id: 'depth',
          name: 'depth',
          frames: ['depth-frame'],
          width: 1280,
          height: 720,
          colorSpace: 'Utility - Raw',
          startFrame: 1010,
        },
      ],
    } as ImageSequenceNode;

    const updates = selectImageSequencePlate(node, 'depth');

    expect(updates).toMatchObject({
      activePlateId: 'depth',
      frames: ['depth-frame'],
      width: 1280,
      height: 720,
      colorSpace: 'Utility - Raw',
      startFrame: 1010,
    });
    expect(updates?.plates?.[0]).toMatchObject({
      frames: ['beauty-current'],
      width: 2048,
      height: 1556,
      colorSpace: 'ACEScg',
      startFrame: 1001,
    });
  });
});
