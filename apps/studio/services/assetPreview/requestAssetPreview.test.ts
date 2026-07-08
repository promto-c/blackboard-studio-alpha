// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectColorManagement } from '@blackboard/types';
import { getAsset } from '@/state/assetStorage';
import { renderMediaAssetToBlob } from '@/utils/thumbnailRenderer';
import { assetPreviewCache } from './assetPreviewCache';
import { requestAssetPreview } from './requestAssetPreview';
import type { AssetPreviewRequest } from './types';

vi.mock('@/state/assetStorage', () => ({ getAsset: vi.fn() }));
vi.mock('@/utils/thumbnailRenderer', () => ({ renderMediaAssetToBlob: vi.fn() }));

const colorManagement: ProjectColorManagement = {
  schemaVersion: 1,
  config: { kind: 'builtin', id: 'aces', uri: 'ocio://aces' },
  workingSpace: { role: 'scene_linear' },
  viewer: { display: 'sRGB', view: 'ACES SDR' },
};
const request: AssetPreviewRequest = {
  source: {
    assetId: 'asset:image',
    width: 100,
    height: 100,
    mediaKind: 'image',
    mediaColorManagement: {
      sourceColorSpace: 'sRGB',
      assignmentSource: 'metadata',
      isData: false,
    },
  },
  projectColorManagement: colorManagement,
  mode: 'gallery-thumbnail',
  maxDimension: 320,
  priority: 'visible-thumbnail',
};

describe('requestAssetPreview', () => {
  beforeEach(() => {
    assetPreviewCache.clearForTests();
    vi.mocked(getAsset).mockReset();
    vi.mocked(renderMediaAssetToBlob).mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  it('deduplicates native requests and bypasses the renderer', async () => {
    vi.mocked(getAsset).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const first = requestAssetPreview(request);
    const second = requestAssetPreview({
      ...request,
      source: {
        ...request.source,
        mediaColorManagement: { ...request.source.mediaColorManagement },
      },
      projectColorManagement: {
        ...colorManagement,
        viewer: { ...colorManagement.viewer },
      },
    });

    const [left, right] = await Promise.all([first.promise, second.promise]);
    expect(left.url).toBe(right.url);
    expect(left.strategy).toBe('native-object-url');
    expect(getAsset).toHaveBeenCalledOnce();
    expect(renderMediaAssetToBlob).not.toHaveBeenCalled();
    first.release();
    second.release();
  });

  it('routes EXR through the color-managed blob renderer', async () => {
    vi.mocked(getAsset).mockResolvedValue(new Blob(['exr'], { type: 'image/x-exr' }));
    vi.mocked(renderMediaAssetToBlob).mockResolvedValue(
      new Blob(['preview'], { type: 'image/png' }),
    );
    const lease = requestAssetPreview({
      ...request,
      source: { ...request.source, fileName: 'plate.exr' },
    });
    await expect(lease.promise).resolves.toMatchObject({
      strategy: 'color-managed-render',
      url: 'blob:preview',
    });
    expect(renderMediaAssetToBlob).toHaveBeenCalledOnce();
    lease.release();
  });
});
