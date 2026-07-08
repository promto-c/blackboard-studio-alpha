import { describe, expect, it } from 'vitest';
import { resolveAssetPreviewStrategy } from './assetPreviewStrategy';
import type { AssetPreviewSource } from './types';

const source: AssetPreviewSource = {
  assetId: 'asset:image',
  width: 100,
  height: 100,
  mediaKind: 'image',
  mediaColorManagement: {
    sourceColorSpace: 'sRGB',
    assignmentSource: 'metadata',
    isData: false,
  },
};

describe('resolveAssetPreviewStrategy', () => {
  it('uses native decoding for ordinary gallery images and videos', () => {
    expect(
      resolveAssetPreviewStrategy(source, 'gallery-thumbnail', new Blob([], { type: 'image/png' })),
    ).toBe('native-object-url');
    expect(
      resolveAssetPreviewStrategy(
        { ...source, mediaKind: 'video' },
        'gallery-thumbnail',
        new Blob([], { type: 'video/mp4' }),
      ),
    ).toBe('native-object-url');
  });

  it('keeps EXR and authoritative image viewers color managed', () => {
    expect(
      resolveAssetPreviewStrategy(
        { ...source, fileName: 'plate.exr' },
        'gallery-thumbnail',
        new Blob([]),
      ),
    ).toBe('color-managed-render');
    expect(
      resolveAssetPreviewStrategy(
        { ...source, fileName: 'environment.hdr' },
        'gallery-thumbnail',
        new Blob([], { type: 'image/vnd.radiance' }),
      ),
    ).toBe('color-managed-render');
    expect(
      resolveAssetPreviewStrategy(source, 'viewer-preview', new Blob([], { type: 'image/jpeg' })),
    ).toBe('color-managed-render');
  });
});
