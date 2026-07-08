// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import type { ProjectColorManagement } from '@blackboard/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetPreviewSource } from '@/services/assetPreview/types';

const { requestAssetPreviewMock, mockColorManagement } = vi.hoisted(() => ({
  requestAssetPreviewMock: vi.fn(),
  mockColorManagement: {
    schemaVersion: 1,
    config: { kind: 'builtin', id: 'aces', uri: 'ocio://aces' },
    workingSpace: { role: 'scene_linear' },
    viewer: { display: 'sRGB', view: 'ACES SDR' },
  },
}));
vi.mock('@/state/editorContext', () => ({
  useEditorSelector: (selector: (state: { colorManagement: ProjectColorManagement }) => unknown) =>
    selector({ colorManagement: mockColorManagement as ProjectColorManagement }),
}));

vi.mock('@/services/assetPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/assetPreview')>();
  return { ...actual, requestAssetPreview: requestAssetPreviewMock };
});

import { useAssetPreview } from './useAssetPreviewUrl';

const source: AssetPreviewSource = {
  assetId: 'asset:one',
  width: 100,
  height: 50,
  mediaKind: 'image',
  mediaColorManagement: {
    sourceColorSpace: 'sRGB',
    assignmentSource: 'metadata',
    isData: false,
  },
};

function Harness({ value, enabled = true }: { value: AssetPreviewSource; enabled?: boolean }) {
  const preview = useAssetPreview(value, {
    mode: 'gallery-thumbnail',
    maxDimension: 320,
    priority: 'visible-thumbnail',
    enabled,
  });
  return <span>{preview.status}</span>;
}

describe('useAssetPreview', () => {
  beforeEach(() => {
    requestAssetPreviewMock.mockReset();
    requestAssetPreviewMock.mockImplementation((request: { source: AssetPreviewSource }) => ({
      promise: Promise.resolve({
        url: `blob:${request.source.assetId}`,
        strategy: 'native-object-url',
        cacheKey: request.source.assetId,
      }),
      release: vi.fn(),
    }));
  });

  it('does not request while disabled and ignores equivalent object identities', async () => {
    const view = render(<Harness value={source} enabled={false} />);
    expect(requestAssetPreviewMock).not.toHaveBeenCalled();
    view.rerender(<Harness value={{ ...source }} />);
    await waitFor(() => expect(requestAssetPreviewMock).toHaveBeenCalledOnce());
    view.rerender(
      <Harness value={{ ...source, mediaColorManagement: { ...source.mediaColorManagement } }} />,
    );
    expect(requestAssetPreviewMock).toHaveBeenCalledOnce();
  });

  it('starts a new request for a new asset and cancels on unmount', async () => {
    const releases: ReturnType<typeof vi.fn>[] = [];
    requestAssetPreviewMock.mockImplementation((request: { source: AssetPreviewSource }) => {
      const release = vi.fn();
      releases.push(release);
      return {
        promise: Promise.resolve({
          url: `blob:${request.source.assetId}`,
          strategy: 'native-object-url',
          cacheKey: request.source.assetId,
        }),
        release,
      };
    });
    const view = render(<Harness value={source} />);
    await waitFor(() => expect(requestAssetPreviewMock).toHaveBeenCalledOnce());
    view.rerender(<Harness value={{ ...source, assetId: 'asset:two' }} />);
    await waitFor(() => expect(requestAssetPreviewMock).toHaveBeenCalledTimes(2));
    expect(releases[0]).toHaveBeenCalledOnce();
    const secondSignal = requestAssetPreviewMock.mock.calls[1][0].signal as AbortSignal;
    view.unmount();
    expect(secondSignal.aborted).toBe(true);
    expect(releases[1]).toHaveBeenCalledOnce();
  });
});
