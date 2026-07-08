// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectColorManagement } from '@blackboard/types';
import { colorManagementService } from '@/color-management';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { renderMediaAssetToDataURL } from './thumbnailRenderer';

vi.mock('@blackboard/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blackboard/renderer')>();
  return {
    ...actual,
    createStudioRenderer: vi.fn(() => ({ domElement: {} })),
  };
});

vi.mock('@/renderer/pipeline', () => ({
  renderWithSharedPipeline: vi.fn(async () => ({
    canvas: {
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob(['preview'], { type: 'image/png' })),
      ),
    },
    dispose: vi.fn(),
  })),
}));

const projectColorManagement: ProjectColorManagement = {
  schemaVersion: 1,
  config: {
    kind: 'builtin',
    id: 'aces',
    uri: 'ocio://aces',
  },
  workingSpace: { role: 'scene_linear' },
  viewer: {
    display: 'sRGB - Display',
    view: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  },
};

describe('thumbnail renderer', () => {
  beforeEach(() => {
    vi.mocked(renderWithSharedPipeline).mockClear();
    vi.spyOn(colorManagementService, 'resolveProjectColorManagement').mockReturnValue({
      workingColorSpace: 'ACEScg',
    } as ReturnType<typeof colorManagementService.resolveProjectColorManagement>);
  });

  it('renders assigned media through the project display/view processor', async () => {
    const result = await renderMediaAssetToDataURL(
      {
        assetId: 'asset:plate',
        width: 2048,
        height: 1024,
        mediaColorManagement: {
          sourceColorSpace: 'ACES2065-1',
          assignmentSource: 'metadata',
          isData: false,
        },
      },
      projectColorManagement,
      512,
    );

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(renderWithSharedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        projectColorManagement,
        finalColorSpace: 'match_viewport',
        displayView: projectColorManagement.viewer,
        width: 512,
        height: 256,
        viewerSettings: expect.objectContaining({
          channels: 'RGB',
          gain: 1,
          gamma: 1,
          saturation: 1,
        }),
        nodes: [
          expect.objectContaining({
            src: 'asset:plate',
            colorSpace: 'ACES2065-1',
            mediaColorManagement: expect.objectContaining({
              sourceColorSpace: 'ACES2065-1',
            }),
          }),
        ],
      }),
    );
  });

  it('renders a decoded video frame through the same preview graph', async () => {
    await renderMediaAssetToDataURL(
      {
        assetId: 'asset:clip',
        width: 1920,
        height: 1080,
        mediaKind: 'video',
        fps: 24,
        mediaColorManagement: {
          sourceColorSpace: 'sRGB - Texture',
          assignmentSource: 'decoder',
          isData: false,
        },
      },
      projectColorManagement,
      320,
    );

    expect(renderWithSharedPipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 320,
        height: 180,
        nodes: [
          expect.objectContaining({
            src: 'asset:clip',
            mediaKind: 'video',
            width: 320,
            height: 180,
            mediaColorManagement: expect.objectContaining({
              assignmentSource: 'decoder',
            }),
          }),
        ],
        sceneNode: expect.objectContaining({
          width: 320,
          height: 180,
          fps: 24,
        }),
      }),
    );
  });
});
