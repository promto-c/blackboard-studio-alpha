// @vitest-environment jsdom

import { render } from '@testing-library/react';
import type { GeneratedOutput } from '@blackboard/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfyOutputThumbnail } from './ComfyOutputThumbnail';

const mocks = vi.hoisted(() => ({
  useAssetPreview: vi.fn(),
  useViewportProximity: vi.fn(),
}));

vi.mock('@/hooks/useAssetPreviewUrl', () => ({
  GALLERY_THUMBNAIL_MAX_DIMENSION: 320,
  useAssetPreview: mocks.useAssetPreview,
}));

vi.mock('@/hooks/useNearViewport', () => ({
  useViewportProximity: mocks.useViewportProximity,
}));

const output: GeneratedOutput = {
  id: 'output-a',
  src: 'asset-a',
  width: 128,
  height: 128,
  createdAt: 1,
  mediaColorManagement: {} as NonNullable<GeneratedOutput['mediaColorManagement']>,
};

describe('ComfyOutputThumbnail', () => {
  beforeEach(() => {
    mocks.useAssetPreview.mockReset();
    mocks.useViewportProximity.mockReset();
    mocks.useAssetPreview.mockReturnValue({
      url: 'blob:thumbnail',
      status: 'ready',
      error: null,
      strategy: null,
    });
  });

  it('does not mount the asset preview loader while outside the scroll viewport', () => {
    mocks.useViewportProximity.mockReturnValue('outside');

    const view = render(<ComfyOutputThumbnail output={output} active={false} onClick={vi.fn()} />);

    expect(mocks.useAssetPreview).not.toHaveBeenCalled();
    expect(view.container.querySelector('img')).toBeNull();
  });

  it('loads near thumbnails at prefetch priority with native image deferral', () => {
    mocks.useViewportProximity.mockReturnValue('near');

    const view = render(<ComfyOutputThumbnail output={output} active={false} onClick={vi.fn()} />);

    expect(mocks.useAssetPreview).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-a' }),
      expect.objectContaining({ priority: 'prefetch-thumbnail' }),
    );
    expect(view.container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });

  it('prioritizes a thumbnail once it is visible', () => {
    mocks.useViewportProximity.mockReturnValue('visible');

    render(<ComfyOutputThumbnail output={output} active={false} onClick={vi.fn()} />);

    expect(mocks.useAssetPreview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ priority: 'visible-thumbnail' }),
    );
  });
});
