import { describe, expect, it } from 'vitest';
import { ImageFitMode, NodeType } from '@blackboard/types';
import { getInAppMediaNodeSpec } from './inAppMediaSource';

describe('in-app media source nodes', () => {
  it('creates a fitted media source that references the existing asset', () => {
    const spec = getInAppMediaNodeSpec(
      {
        version: 1,
        assetId: 'asset:image-1',
        mediaKind: 'image',
        label: 'Generated plate',
        width: 1920,
        height: 1080,
        colorSpace: 'ACEScg',
      },
      { width: 1280, height: 720 },
    );

    expect(spec).toMatchObject({
      nodeType: NodeType.MEDIA_SOURCE,
      name: 'Generated plate',
      props: {
        src: 'asset:image-1',
        mediaKind: 'image',
        width: 1920,
        height: 1080,
        colorSpace: 'ACEScg',
        transform: { fitMode: ImageFitMode.FIT },
      },
    });
  });

  it('creates an image-sequence source from the existing frame assets', () => {
    const spec = getInAppMediaNodeSpec({
      version: 1,
      assetId: 'asset:frame-1',
      mediaKind: 'image_sequence',
      label: 'Generated sequence',
      width: 1024,
      height: 1024,
      fps: 24,
      frames: ['asset:frame-1', 'asset:frame-2'],
    });

    expect(spec).toMatchObject({
      nodeType: NodeType.IMAGE_SEQUENCE,
      props: {
        frames: ['asset:frame-1', 'asset:frame-2'],
        fps: 24,
      },
    });
  });
});
