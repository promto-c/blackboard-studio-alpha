import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeneratedOutputsFromComfyFiles } from './comfyGeneratedOutputs';

vi.mock('@/services/comfy/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/comfy/client')>();
  return {
    ...actual,
    fetchComfyOutputFile: vi.fn(),
  };
});

vi.mock('@/state/assetStorage', () => ({
  saveAsset: vi.fn().mockResolvedValue('asset:model'),
}));

import { fetchComfyOutputFile } from '@/services/comfy/client';

describe('Comfy generated 3D outputs', () => {
  beforeEach(() => {
    vi.mocked(fetchComfyOutputFile).mockReset();
  });

  it('persists a Comfy 3D file as a typed splat artifact', async () => {
    vi.mocked(fetchComfyOutputFile).mockResolvedValue(
      new Blob([new Uint8Array([0x50, 0x5a])], { type: 'application/octet-stream' }),
    );

    const outputs = await createGeneratedOutputsFromComfyFiles({
      endpoint: 'http://127.0.0.1:8188',
      files: [
        {
          nodeId: '51',
          kind: '3d',
          filename: 'ComfyUI_TripoSplat_00060_.spz',
          type: 'output',
        },
      ],
      workflow: null,
      promptId: 'prompt-3d',
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      src: 'asset:model',
      mediaKind: 'model_3d',
      width: 0,
      height: 0,
      scene3dAsset: {
        assetId: 'asset:model',
        fileName: 'ComfyUI_TripoSplat_00060_.spz',
        kind: 'splat',
        format: 'spz',
      },
    });
  });
});
