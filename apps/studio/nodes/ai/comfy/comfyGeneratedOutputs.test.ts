import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { colorManagementService } from '@/color-management';
import {
  createGeneratedOutputsFromComfyFiles,
  getComfyOutputColorSpace,
} from './comfyGeneratedOutputs';

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

vi.mock('@/state/editor/utils', () => ({
  readImageDimensions: vi.fn().mockResolvedValue({ width: 64, height: 32 }),
}));

import { fetchComfyOutputFile } from '@/services/comfy/client';

describe('Comfy generated outputs', () => {
  beforeEach(() => {
    vi.mocked(fetchComfyOutputFile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the submitted Comfy output color space through the active OCIO config', () => {
    vi.spyOn(colorManagementService, 'resolveConfiguredColorSpaceName').mockImplementation(
      (value) => {
        if (value === 'sRGB') return 'sRGB Encoded Rec.709 (sRGB)';
        throw new Error(`Unknown color space: ${value}`);
      },
    );

    expect(
      getComfyOutputColorSpace({
        outputFile: {
          nodeId: 'save-1',
          kind: 'image',
          filename: 'render.exr',
        },
        workflow: {
          id: 'workflow-1',
          name: 'Render',
          prompt: {},
          createdAt: 1,
        },
        submittedPrompt: {
          'save-1': {
            class_type: 'SaveImageAdvanced',
            inputs: {
              format: 'exr',
              'format.input_color_space': 'sRGB',
            },
          },
        },
      }),
    ).toBe('sRGB Encoded Rec.709 (sRGB)');
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

  it('persists named technical outputs with the active OCIO data role', async () => {
    vi.spyOn(colorManagementService, 'getRendererColorManagement').mockReturnValue({
      dataColorSpace: 'Raw',
    } as ReturnType<typeof colorManagementService.getRendererColorManagement>);
    vi.mocked(fetchComfyOutputFile).mockResolvedValue(
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    );

    const outputs = await createGeneratedOutputsFromComfyFiles({
      endpoint: 'http://127.0.0.1:8188',
      files: [
        {
          nodeId: 'depth-node',
          kind: 'image',
          filename: 'depth.Z.png',
          type: 'output',
        },
      ],
      workflow: null,
      promptId: 'prompt-data',
    });

    expect(outputs[0]?.mediaColorManagement).toMatchObject({
      sourceColorSpace: 'Raw',
      assignmentSource: 'pipeline',
      isData: true,
    });
  });
});
