import { describe, expect, it } from 'vitest';
import type { ProjectColorManagement } from '@blackboard/types';
import { createAssetPreviewCacheKey } from './assetPreviewKey';
import type { AssetPreviewSource } from './types';

const source: AssetPreviewSource = {
  assetId: 'asset:plate',
  width: 1920,
  height: 1080,
  mediaKind: 'image',
  mediaColorManagement: {
    sourceColorSpace: 'ACEScg',
    assignmentSource: 'metadata',
    isData: false,
  },
};

const colorManagement: ProjectColorManagement = {
  schemaVersion: 1,
  config: { kind: 'builtin', id: 'aces', uri: 'ocio://aces' },
  workingSpace: { role: 'scene_linear' },
  viewer: { display: 'sRGB', view: 'ACES SDR' },
  context: { SHOT: '010', SEQUENCE: 'A' },
};

describe('createAssetPreviewCacheKey', () => {
  it('is stable for equivalent reconstructed values and record insertion order', () => {
    const left = createAssetPreviewCacheKey(source, colorManagement, {
      mode: 'gallery-thumbnail',
      maxDimension: 320,
    });
    const right = createAssetPreviewCacheKey(
      {
        ...source,
        mediaColorManagement: { ...source.mediaColorManagement },
      },
      {
        ...colorManagement,
        config: { ...colorManagement.config },
        viewer: { ...colorManagement.viewer },
        context: { SEQUENCE: 'A', SHOT: '010' },
      },
      { mode: 'gallery-thumbnail', maxDimension: 320 },
    );
    expect(right).toBe(left);
  });

  it('changes for output-affecting viewer settings and dimensions', () => {
    const base = createAssetPreviewCacheKey(source, colorManagement, {
      mode: 'viewer-preview',
      maxDimension: 2048,
    });
    expect(
      createAssetPreviewCacheKey(
        source,
        { ...colorManagement, viewer: { display: 'P3', view: 'Film' } },
        { mode: 'viewer-preview', maxDimension: 2048 },
      ),
    ).not.toBe(base);
    expect(
      createAssetPreviewCacheKey(source, colorManagement, {
        mode: 'viewer-preview',
        maxDimension: 1024,
      }),
    ).not.toBe(base);
  });
});
