import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeKind,
  NodeType,
  type AnyNode,
  type Flow,
} from '@blackboard/types';

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

vi.mock('@/effects/effectHelpers', () => ({
  getNodeAssetIds: (node: { src?: string; frames?: string[] }) => {
    if (typeof node.src === 'string') {
      return [node.src];
    }
    if (Array.isArray(node.frames)) {
      return node.frames;
    }
    return [];
  },
}));

import { exportProjectBundle, importProjectBundle, inspectProjectBundle } from './projectTransfer';

const createProjectState = (assetId: string) => {
  const nodes: AnyNode[] = [
    {
      id: 'scene_1',
      kind: NodeKind.SCENE,
      type: NodeType.SCENE,
      name: 'Scene',
      visible: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 0,
      fps: 30,
    },
    {
      id: 'img_1',
      kind: NodeKind.EFFECT,
      type: NodeType.IMAGE,
      name: 'Plate',
      visible: true,
      src: assetId,
      width: 1920,
      height: 1080,
      opacity: 100,
      operator: BlendMode.OVER,
      colorSpace: 'sRGB',
      transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.NONE },
    },
    {
      id: 'out_1',
      kind: NodeKind.OUTPUT,
      type: NodeType.OUTPUT,
      name: 'Output',
      visible: true,
    },
  ];

  const flow: Flow = {
    id: 'root',
    name: 'Root Flow',
    nodes,
    nodeOrder: ['scene_1', 'img_1', 'out_1'],
    relationships: [],
  };

  return {
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

  it('still imports legacy embedded bundles', async () => {
    saveAssetMock.mockResolvedValue('asset_new');

    const file = new File(
      [
        JSON.stringify({
          format: 'blackboard-studio-project',
          version: 1,
          exportedAt: '2026-04-03T00:00:00.000Z',
          project: {
            name: 'Legacy Project',
            thumbnail: null,
            state: createProjectState('asset_old'),
          },
          assets: [
            {
              id: 'asset_old',
              name: 'plate.txt',
              type: 'text/plain',
              dataUrl: 'data:text/plain;base64,SGVsbG8=',
            },
          ],
        }),
      ],
      'legacy.blackboard-project.json',
      { type: 'application/json' },
    );

    const result = await importProjectBundle(file);

    expect(saveAssetMock).toHaveBeenCalledTimes(1);
    expect(result.projectName).toBe('Legacy Project');
    expect(result.state.flows.root.nodes[1]).toMatchObject({ src: 'asset_new' });
  });
});
