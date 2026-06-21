import type { ComfyWorkflow } from '@blackboard/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileComfyWorkflowInputSelection,
  reconcileComfyWorkflowOutputSelection,
  refreshComfyWorkflowFromSource,
} from './comfyWorkflowImport';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshComfyWorkflowFromSource', () => {
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
});
