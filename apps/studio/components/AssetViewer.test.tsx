// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetViewer } from './AssetViewer';

vi.mock('./Scene3DAssetPreview', () => ({
  default: ({ asset }: { asset: { fileName: string } }) => (
    <div aria-label={`Mock 3D preview of ${asset.fileName}`} />
  ),
}));

describe('AssetViewer', () => {
  it('renders its empty state without reading fields from null media', () => {
    render(<AssetViewer media={null} />);

    expect(screen.getByText('Select a gallery item')).toBeTruthy();
    expect(screen.getByText('Gallery preview')).toBeTruthy();
  });

  it('renders Gaussian splat gallery assets in the 3D preview', async () => {
    render(
      <AssetViewer
        media={{
          id: 'gallery-splat',
          assetId: 'asset-splat',
          mediaKind: 'model_3d',
          label: 'Captured room',
          source: 'Comfy',
          scene3dAsset: {
            assetId: 'asset-splat',
            fileName: 'captured-room.spz',
            kind: 'splat',
            format: 'spz',
          },
        }}
      />,
    );

    expect(await screen.findByLabelText('Mock 3D preview of captured-room.spz')).toBeTruthy();
    expect(screen.getByText('Gaussian splat')).toBeTruthy();
    expect(screen.getByText('Comfy')).toBeTruthy();
  });
});
