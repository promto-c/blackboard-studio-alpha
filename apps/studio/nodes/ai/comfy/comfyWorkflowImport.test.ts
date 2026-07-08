import type { ComfyWorkflow } from '@blackboard/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultComfyWorkflowControls,
  reconcileComfyWorkflowInputSelection,
  reconcileComfyWorkflowOutputSelection,
  refreshComfyWorkflowFromSource,
} from './comfyWorkflowImport';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshComfyWorkflowFromSource', () => {
  it('shows an internal sampler seed by default without exposing unrelated internal fields', () => {
    const workflow: ComfyWorkflow = {
      id: 'workflow-1',
      name: 'Z-Image-Turbo',
      prompt: {
        '57_3': {
          class_type: 'KSampler',
          inputs: {
            seed: 844219637214913,
            steps: 8,
            cfg: 1,
          },
        },
      },
      defaultControlKeys: [],
      createdAt: 1,
    };

    expect(createDefaultComfyWorkflowControls(workflow)).toMatchObject([
      {
        nodeId: '57_3',
        inputName: 'seed',
        value: 844219637214913,
        runMode: 'randomize',
      },
    ]);
  });

  it('keeps newly discovered internal inputs unchecked', () => {
    expect(
      reconcileComfyWorkflowInputSelection({
        previousCandidateIds: ['top-image'],
        selectedInputIds: ['top-image'],
        nextCandidateIds: ['top-image', 'internal-image'],
        nextDefaultInputIds: ['top-image'],
      }),
    ).toEqual(['top-image']);

    expect(
      reconcileComfyWorkflowInputSelection({
        previousCandidateIds: ['top-image', 'internal-image'],
        selectedInputIds: ['top-image', 'internal-image'],
        nextCandidateIds: ['top-image', 'internal-image'],
        nextDefaultInputIds: ['top-image'],
      }),
    ).toEqual(['top-image', 'internal-image']);
  });

  it('selects newly discovered defaults without restoring an intentional deselection', () => {
    expect(
      reconcileComfyWorkflowOutputSelection({
        previousCandidateIds: ['preview'],
        selectedOutputIds: ['preview'],
        nextCandidateIds: ['preview', 'splat'],
        nextDefaultOutputIds: ['preview', 'splat'],
      }),
    ).toEqual(['preview', 'splat']);

    expect(
      reconcileComfyWorkflowOutputSelection({
        previousCandidateIds: ['preview', 'splat'],
        selectedOutputIds: ['preview'],
        nextCandidateIds: ['preview', 'splat'],
        nextDefaultOutputIds: ['preview', 'splat'],
      }),
    ).toEqual(['preview']);
  });

  it('recompiles a stored graph workflow before execution', async () => {
    const objectInfo = {
      PrimitiveInt: {
        input: { required: { value: ['INT'] } },
        output: ['INT'],
      },
      PreviewAny: {
        input: { required: { source: ['*'] } },
        output: ['STRING'],
        output_node: true,
      },
      StringReplace: {
        input: { required: { replace: ['STRING'] } },
        output: ['STRING'],
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(objectInfo), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const workflow: ComfyWorkflow = {
      id: 'workflow-1',
      name: 'Nested strings',
      prompt: {
        '8': {
          class_type: 'StringReplace',
          inputs: { replace: ['1', 0] },
        },
      },
      sourceGraph: {
        nodes: [
          {
            id: 56,
            type: 'PrimitiveInt',
            inputs: [],
            outputs: [{ name: 'INT', type: 'INT', links: [1] }],
            widgets_values: [3, 'fixed'],
          },
          {
            id: 1,
            type: 'PreviewAny',
            inputs: [{ name: 'source', type: '*', link: 1 }],
            outputs: [{ name: 'STRING', type: 'STRING', links: [6] }],
          },
          {
            id: 8,
            type: 'StringReplace',
            inputs: [{ name: 'replace', type: 'STRING', link: 6 }],
            outputs: [{ name: 'STRING', type: 'STRING', links: [] }],
          },
        ],
        links: [
          [1, 56, 0, 1, 0, 'INT'],
          [6, 1, 0, 8, 0, 'STRING'],
        ],
      },
      selectedOutputIds: ['1'],
      createdAt: 1,
    };

    const refreshed = await refreshComfyWorkflowFromSource('http://127.0.0.1:8188', workflow);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8188/object_info', expect.any(Object));
    expect(refreshed.prompt['1']).toEqual({
      class_type: 'PreviewAny',
      inputs: { source: ['56', 0] },
    });
    expect(refreshed.prompt['8']).toEqual({
      class_type: 'StringReplace',
      inputs: { replace: ['1', 0] },
    });
    expect(refreshed.selectedOutputIds).toEqual([]);
  });

  it('keeps API prompts unchanged without fetching metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const workflow: ComfyWorkflow = {
      id: 'workflow-1',
      name: 'API prompt',
      prompt: { '1': { class_type: 'PreviewImage', inputs: {} } },
      createdAt: 1,
    };

    await expect(refreshComfyWorkflowFromSource('http://127.0.0.1:8188', workflow)).resolves.toBe(
      workflow,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('selects a newly discovered raw SPLAT output on stale workflow metadata', async () => {
    const objectInfo = {
      ImageToSplat: { input: { required: {} }, output: ['SPLAT'] },
      SplatToFile3D: {
        input: {
          required: {
            splat: ['SPLAT'],
            format: [['ply', 'ksplat', 'spz'], { default: 'ply' }],
          },
        },
        output: ['FILE_3D_SPLAT_ANY'],
      },
      SaveGLB: {
        input: {
          required: {
            mesh: ['MESH,FILE_3D'],
            filename_prefix: ['STRING', { default: '3d/ComfyUI' }],
          },
        },
        output_node: true,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(objectInfo), { status: 200 })),
    );
    const workflow: ComfyWorkflow = {
      id: 'workflow-splat',
      name: 'Raw splat',
      prompt: { '88': { class_type: 'ImageToSplat', inputs: {} } },
      sourceGraph: {
        nodes: [
          {
            id: 88,
            type: 'ImageToSplat',
            inputs: [],
            outputs: [{ name: 'splat', type: 'SPLAT', links: [] }],
          },
        ],
        links: [],
      },
      outputCandidates: [],
      selectedOutputIds: [],
      createdAt: 1,
    };

    const refreshed = await refreshComfyWorkflowFromSource('http://127.0.0.1:8188', workflow);

    expect(refreshed.outputCandidates?.[0]).toMatchObject({
      id: '88:0',
      outputType: 'SPLAT',
      syntheticOutputFormat: 'model_3d',
    });
    expect(refreshed.selectedOutputIds).toEqual(['88:0']);
  });

  it('preserves and normalizes synthetic output format settings during metadata refresh', async () => {
    const objectInfo = {
      VAEDecode: {
        input: { required: {} },
        output: ['IMAGE'],
      },
      SaveImageAdvanced: {
        input: {
          required: {
            images: ['IMAGE'],
            filename_prefix: ['STRING', { default: 'ComfyUI' }],
            format: [
              'COMFY_DYNAMICCOMBO_V3',
              {
                options: [
                  {
                    key: 'png',
                    inputs: {
                      required: {
                        bit_depth: [['8-bit', '16-bit'], { default: '8-bit' }],
                      },
                    },
                  },
                  {
                    key: 'exr',
                    inputs: {
                      required: {
                        bit_depth: [['32-bit float'], { default: '32-bit float' }],
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
        input_order: {
          required: ['images', 'filename_prefix', 'format'],
        },
        output_node: true,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(objectInfo), { status: 200 })),
    );

    const workflow: ComfyWorkflow = {
      id: 'workflow-image',
      name: 'Image output',
      prompt: {
        '64': { class_type: 'VAEDecode', inputs: {} },
        blackboard_exr_64_0: {
          class_type: 'SaveImageAdvanced',
          inputs: {
            images: ['64', 0],
            filename_prefix: 'blackboard/64_0_exr',
            format: 'exr',
            'format.bit_depth': '32-bit float',
          },
        },
      },
      sourceGraph: {
        nodes: [
          {
            id: 64,
            type: 'VAEDecode',
            inputs: [],
            outputs: [{ name: 'images', type: 'IMAGE', links: [] }],
          },
        ],
        links: [],
      },
      outputCandidates: [
        {
          id: '64:0',
          nodeId: '64',
          nodeType: 'VAEDecode',
          kind: 'synthetic',
          outputIndex: 0,
          outputName: 'images',
          outputType: 'IMAGE',
          label: 'VAEDecode #64 images',
          promptLink: ['64', 0],
          previewNodeId: 'blackboard_exr_64_0',
          syntheticOutputFormat: 'exr_float',
          syntheticOutputNodes: [
            {
              id: 'blackboard_exr_64_0',
              nodeType: 'SaveImageAdvanced',
              inputs: {
                images: ['64', 0],
                filename_prefix: 'blackboard/64_0_exr',
                format: 'png',
                'format.bit_depth': '32-bit float',
              },
            },
          ],
        },
      ],
      selectedOutputIds: ['64:0'],
      createdAt: 1,
    };

    const refreshed = await refreshComfyWorkflowFromSource('http://127.0.0.1:8188', workflow);

    expect(refreshed.prompt.blackboard_exr_64_0).toMatchObject({
      class_type: 'SaveImageAdvanced',
      inputs: {
        format: 'png',
        'format.bit_depth': '8-bit',
      },
    });
    expect(refreshed.outputCandidates?.[0]?.syntheticOutputNodes?.[0]?.inputs).toMatchObject({
      format: 'png',
      'format.bit_depth': '8-bit',
    });
  });
});
