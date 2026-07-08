import { describe, expect, it } from 'vitest';
import { ColorManagementDefaults, createUserMediaColorManagement } from '@/color-management';
import { createMediaSourceNode, createSequenceNode } from './graphCommands';

describe('graph command media color defaults', () => {
  it('stores structured color assignment metadata on image sources', () => {
    const node = createMediaSourceNode({
      name: 'Plate',
      src: 'asset-1',
      mediaKind: 'image',
      width: 1920,
      height: 1080,
      colorSpace: 'ACEScg',
    });

    expect(node.colorSpace).toBe('ACEScg');
    expect(node.mediaColorManagement).toEqual({
      sourceColorSpace: 'ACEScg',
      assignmentSource: 'project_default',
      isData: false,
    });
  });

  it('uses an explicit unassigned state for video sources without metadata', () => {
    const node = createMediaSourceNode({
      name: 'Clip',
      src: 'asset-2',
      mediaKind: 'video',
      width: 1920,
      height: 1080,
      duration: 120,
    });

    expect(node.colorSpace).toBeUndefined();
    expect(node.mediaColorManagement).toEqual({
      sourceColorSpace: null,
      assignmentSource: 'unassigned',
      isData: false,
    });
  });

  it('persists normalized video color metadata without assigning a source color space', () => {
    const videoColorMetadata = {
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      range: 'limited',
      source: 'container',
    } as const;
    const node = createMediaSourceNode({
      name: 'Clip',
      src: 'asset-2',
      mediaKind: 'video',
      width: 1920,
      height: 1080,
      duration: 120,
      videoColorMetadata,
    });

    expect(node.videoColorMetadata).toEqual(videoColorMetadata);
    expect(node.mediaColorManagement?.assignmentSource).toBe('unassigned');
  });

  it('stores structured color assignment metadata on image sequences', () => {
    const node = createSequenceNode({
      name: 'Sequence',
      frames: ['frame-1', 'frame-2'],
      width: 1920,
      height: 1080,
    });

    expect(node.colorSpace).toBe(ColorManagementDefaults.TEXTURE_SPACE);
    expect(node.mediaColorManagement).toEqual({
      sourceColorSpace: ColorManagementDefaults.TEXTURE_SPACE,
      assignmentSource: 'project_default',
      isData: false,
    });
  });

  it.each([
    ['ACEScg EXR', 'ACEScg', false],
    ['ACES2065-1 EXR', 'ACES2065-1', false],
    ['linear Rec.709 EXR', 'Linear Rec.709 (sRGB)', false],
    ['camera-gamut EXR', 'ARRI Wide Gamut 4 LogC4', false],
    ['log-encoded EXR', 'ACEScct', false],
    ['data EXR', 'Raw', true],
  ])(
    'stores explicit %s source assignments on media source nodes',
    (_label, sourceColorSpace, isData) => {
      const node = createMediaSourceNode({
        name: 'Plate',
        src: 'asset-1',
        sourceFileName: 'plate.exr',
        mediaKind: 'image',
        width: 1920,
        height: 1080,
        mediaColorManagement: createUserMediaColorManagement(sourceColorSpace, { isData }),
      });

      expect(node.colorSpace).toBe(sourceColorSpace);
      expect(node.mediaColorManagement).toEqual({
        sourceColorSpace,
        assignmentSource: 'user',
        isData,
      });
    },
  );
});
