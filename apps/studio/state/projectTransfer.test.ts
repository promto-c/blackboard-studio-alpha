import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeKind,
  NodeType,
  type AnyNode,
  type Flow,
} from '@blackboard/types';
import { ColorManagementDefaults, createDefaultProjectColorManagement } from '@/color-management';

const {
  getAssetMock,
  getAssetReferenceExportRecordMock,
  saveAssetMock,
  saveDirectoryAssetReferencesMock,
  deleteAssetsMock,
} = vi.hoisted(() => ({
  getAssetMock: vi.fn(),
  getAssetReferenceExportRecordMock: vi.fn(),
  saveAssetMock: vi.fn(),
  saveDirectoryAssetReferencesMock: vi.fn(),
  deleteAssetsMock: vi.fn(),
}));

vi.mock('@/state/assetStorage', () => ({
  getAsset: getAssetMock,
  getAssetReferenceExportRecord: getAssetReferenceExportRecordMock,
  saveAsset: saveAssetMock,
  saveDirectoryAssetReferences: saveDirectoryAssetReferencesMock,
  deleteAssets: deleteAssetsMock,
}));

import { exportProjectBundle, importProjectBundle, inspectProjectBundle } from './projectTransfer';

const createProjectState = (assetId: string) => {
  const nodes: AnyNode[] = [
    {
      id: 'scene_1',
      kind: NodeKind.SCENE,
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: ColorManagementDefaults.WORKING_SPACE,
      maxFrames: 0,
      fps: 30,
    },
    {
      id: 'img_1',
      kind: NodeKind.EFFECT,
      type: NodeType.MEDIA_SOURCE,
      name: 'Plate',
      enabled: true,
      mediaKind: 'image',
      src: assetId,
      width: 1920,
      height: 1080,
      opacity: 100,
      operator: BlendMode.OVER,
      colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
    },
    {
      id: 'out_1',
      kind: NodeKind.OUTPUT,
      type: NodeType.OUTPUT,
      name: 'Output',
      enabled: true,
    },
  ];

  const flow: Flow = {
    id: 'root',
    name: 'Root Flow',
    nodes,
    edges: [],
    stacks: [],
    outputNodeId: 'out_1',
  };

  return {
    colorManagement: createDefaultProjectColorManagement(),
    flows: {
      root: flow,
    },
    rootFlowId: 'root',
    activeFlowId: 'root',
    history: [],
  };
};

afterEach(() => {
  getAssetMock.mockReset();
  getAssetReferenceExportRecordMock.mockReset();
  saveAssetMock.mockReset();
  saveDirectoryAssetReferencesMock.mockReset();
  deleteAssetsMock.mockReset();
});

describe('projectTransfer', () => {
  it('exports referenced assets as relinkable folder metadata instead of embedding blobs', async () => {
    getAssetReferenceExportRecordMock.mockResolvedValue({
      handleId: 'dir_1',
      directoryName: 'plates',
      relativePath: 'shot/frame_0001.png',
    });

    const { blob } = await exportProjectBundle({
      projectName: 'Reference Project',
      state: createProjectState('ref_1'),
    });

    const bundle = JSON.parse(await blob.text());
    expect(bundle.version).toBe(2);
    expect(bundle.referenceGroups).toEqual([{ id: 'dir_1', directoryName: 'plates' }]);
    expect(bundle.assets).toEqual([
      {
        id: 'ref_1',
        kind: 'directory-file',
        referenceGroupId: 'dir_1',
        relativePath: 'shot/frame_0001.png',
        name: 'frame_0001.png',
        type: '',
      },
    ]);
    expect(getAssetMock).not.toHaveBeenCalled();
  });

  it('inspects bundle reference groups before import', async () => {
    const file = new File(
      [
        JSON.stringify({
          format: 'blackboard-studio-project',
          version: 2,
          exportedAt: '2026-04-03T00:00:00.000Z',
          project: {
            name: 'Referenced Project',
            thumbnail: null,
            state: createProjectState('ref_old'),
          },
          referenceGroups: [{ id: 'dir_1', directoryName: 'plates' }],
          assets: [
            {
              id: 'ref_old',
              kind: 'directory-file',
              referenceGroupId: 'dir_1',
              relativePath: 'shot/frame_0001.png',
              name: 'frame_0001.png',
              type: '',
            },
          ],
        }),
      ],
      'referenced.blackboard-project.json',
      { type: 'application/json' },
    );

    await expect(inspectProjectBundle(file)).resolves.toEqual({
      projectName: 'Referenced Project',
      referenceGroups: [
        {
          id: 'dir_1',
          directoryName: 'plates',
          fileCount: 1,
          sampleRelativePath: 'shot/frame_0001.png',
        },
      ],
    });
  });

  it('imports referenced bundles by recreating directory-backed asset ids', async () => {
    saveDirectoryAssetReferencesMock.mockResolvedValue(['ref_new']);

    const file = new File(
      [
        JSON.stringify({
          format: 'blackboard-studio-project',
          version: 2,
          exportedAt: '2026-04-03T00:00:00.000Z',
          project: {
            name: 'Referenced Project',
            thumbnail: null,
            state: createProjectState('ref_old'),
          },
          referenceGroups: [{ id: 'dir_1', directoryName: 'plates' }],
          assets: [
            {
              id: 'ref_old',
              kind: 'directory-file',
              referenceGroupId: 'dir_1',
              relativePath: 'shot/frame_0001.png',
              name: 'frame_0001.png',
              type: '',
            },
          ],
        }),
      ],
      'referenced.blackboard-project.json',
      { type: 'application/json' },
    );

    const directoryHandle = { name: 'plates' } as FileSystemDirectoryHandle;
    const result = await importProjectBundle(file, {
      referenceDirectoriesByGroupId: new Map([['dir_1', directoryHandle]]),
    });

    expect(saveDirectoryAssetReferencesMock).toHaveBeenCalledWith(directoryHandle, [
      'shot/frame_0001.png',
    ]);
    expect(result.state.flows.root.nodes[1]).toMatchObject({ src: 'ref_new' });
    expect(deleteAssetsMock).not.toHaveBeenCalled();
  });

  it('rejects project bundles without the current color-management schema', async () => {
    const state = createProjectState('ref_old');
    const { colorManagement: _colorManagement, ...oldState } = state;
    const file = new File(
      [
        JSON.stringify({
          format: 'blackboard-studio-project',
          version: 2,
          exportedAt: '2026-04-03T00:00:00.000Z',
          project: {
            name: 'Old Project',
            thumbnail: null,
            state: oldState,
          },
          referenceGroups: [],
          assets: [],
        }),
      ],
      'old.blackboard-project.json',
      { type: 'application/json' },
    );

    await expect(importProjectBundle(file)).rejects.toThrow('Project color management is missing');
  });

  it('rejects legacy color-space aliases in persisted project nodes', async () => {
    const state = createProjectState('ref_old');
    const mediaNode = state.flows.root.nodes.find((node) => node.id === 'img_1') as
      | { colorSpace?: string }
      | undefined;
    if (mediaNode) {
      mediaNode.colorSpace = 'sRGB';
    }

    await expect(
      exportProjectBundle({
        projectName: 'Legacy Alias Project',
        state,
      }),
    ).rejects.toThrow('legacy source color space alias "sRGB"');
  });
});
