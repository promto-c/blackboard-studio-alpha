import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyComfyWorkflowInputImages,
  buildComfyWebSocketUrl,
  extractComfyImageWorkflowMetadata,
  extractComfyPrompt,
  extractComfyPromptWithOutputs,
  extractComfyWorkflowFromImage,
  parseComfyProgressMessage,
  selectComfyPromptOutputs,
  testComfyConnection,
} from './client';

afterEach(() => {
  vi.restoreAllMocks();
});

const makePngTextChunk = (keyword: string, text: string): Uint8Array => {
  const encoder = new TextEncoder();
  const type = encoder.encode('tEXt');
  const data = encoder.encode(`${keyword}\0${text}`);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  return chunk;
};

const makePngWithTextChunks = (chunks: Array<[string, string]>): Blob => {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const iend = new Uint8Array(12);
  iend.set(new TextEncoder().encode('IEND'), 4);
  return new Blob(
    [signature, ...chunks.map(([key, value]) => makePngTextChunk(key, value)), iend],
    {
      type: 'image/png',
    },
  );
};

describe('Comfy workflow conversion', () => {
  it('extracts ComfyUI prompt and workflow metadata from PNG text chunks', async () => {
    const prompt = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 123,
        },
      },
    };
    const workflow = {
      nodes: [{ id: 3, type: 'KSampler' }],
      links: [],
    };
    const image = makePngWithTextChunks([
      ['prompt', JSON.stringify(prompt)],
      ['workflow', JSON.stringify(workflow)],
    ]);

    await expect(extractComfyWorkflowFromImage(image)).resolves.toEqual(workflow);
    await expect(extractComfyWorkflowFromImage(image, { preferPrompt: true })).resolves.toEqual(
      prompt,
    );
    await expect(extractComfyImageWorkflowMetadata(image)).resolves.toMatchObject({
      source: 'png',
      prompt,
      workflow,
    });
  });

  it('appends a PreviewImage output when a graph workflow exposes only an image output port', () => {
    const workflow = {
      nodes: [
        {
          id: 7,
          type: 'VAEDecode',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
      ],
      links: [],
    };
    const objectInfo = {
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    expect(extractComfyPrompt(workflow, objectInfo)).toEqual({
      '7': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      blackboard_preview_7_0: {
        class_type: 'PreviewImage',
        inputs: {
          images: ['7', 0],
        },
      },
    });
  });

  it('does not append a PreviewImage output from graph LoadImage output ports', () => {
    const workflow = {
      nodes: [
        {
          id: 4,
          type: 'LoadImage',
          inputs: [{ name: 'image', widget: { name: 'image' } }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
          widgets_values: ['reference.png'],
        },
        {
          id: 7,
          type: 'VAEDecode',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
      ],
      links: [],
    };
    const objectInfo = {
      LoadImage: {
        input: {
          required: {
            image: ['IMAGEUPLOAD'],
          },
        },
        output: ['IMAGE', 'MASK'],
      },
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPromptWithOutputs(workflow, objectInfo);

    expect(extracted.inputCandidates).toEqual([
      {
        id: '4:image',
        nodeId: '4',
        nodeType: 'LoadImage',
        inputName: 'image',
        label: 'LoadImage #4',
      },
    ]);
    expect(extracted.outputCandidates.map((candidate) => candidate.nodeId)).toEqual(['7']);
    expect(extracted.prompt).toEqual({
      '4': {
        class_type: 'LoadImage',
        inputs: {
          image: 'reference.png',
        },
      },
      '7': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      blackboard_preview_7_0: {
        class_type: 'PreviewImage',
        inputs: {
          images: ['7', 0],
        },
      },
    });
  });

  it('resolves subgraph image outputs when appending a PreviewImage output', () => {
    const workflow = {
      nodes: [
        {
          id: 57,
          type: 'custom-image-subgraph',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
      ],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: 'custom-image-subgraph',
            nodes: [
              {
                id: 1,
                type: 'VAEDecode',
                inputs: [],
                outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10] }],
              },
            ],
            links: [[10, 1, 0, -20, 0, 'IMAGE']],
            outputs: [{ linkIds: [10] }],
          },
        ],
      },
    };
    const objectInfo = {
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    expect(extractComfyPrompt(workflow, objectInfo)).toEqual({
      '57_1': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      blackboard_preview_57_0: {
        class_type: 'PreviewImage',
        inputs: {
          images: ['57_1', 0],
        },
      },
    });
  });

  it('exposes multiple detected image output ports and can select more than one', () => {
    const workflow = {
      nodes: [
        {
          id: 10,
          type: 'VAEDecode',
          order: 1,
          inputs: [],
          outputs: [{ name: 'first', type: 'IMAGE', links: [] }],
        },
        {
          id: 20,
          type: 'ImageBlend',
          order: 2,
          inputs: [],
          outputs: [{ name: 'second', type: 'IMAGE', links: [] }],
        },
      ],
      links: [],
    };
    const objectInfo = {
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      ImageBlend: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPromptWithOutputs(workflow, objectInfo);

    expect(extracted.outputCandidates.map((candidate) => candidate.id)).toEqual(['20:0', '10:0']);
    expect(extracted.outputCandidates.map((candidate) => candidate.kind)).toEqual([
      'synthetic',
      'synthetic',
    ]);
    expect(extracted.selectedOutputIds).toEqual(['20:0']);
    expect(extracted.prompt).toEqual({
      '10': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      '20': {
        class_type: 'ImageBlend',
        inputs: {},
      },
      blackboard_preview_20_0: {
        class_type: 'PreviewImage',
        inputs: {
          images: ['20', 0],
        },
      },
    });

    expect(
      selectComfyPromptOutputs({
        prompt: extracted.prompt,
        outputCandidates: extracted.outputCandidates,
        selectedOutputIds: ['20:0', '10:0'],
      }),
    ).toEqual({
      '10': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      '20': {
        class_type: 'ImageBlend',
        inputs: {},
      },
      blackboard_preview_20_0: {
        class_type: 'PreviewImage',
        inputs: {
          images: ['20', 0],
        },
      },
      blackboard_preview_10_0: {
        class_type: 'PreviewImage',
        inputs: {
          images: ['10', 0],
        },
      },
    });
  });

  it('extracts Comfy combo input options for workflow controls', () => {
    const workflow = {
      '3': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'z_image_turbo_bf16.safetensors',
          weight_dtype: 'default',
        },
      },
    };
    const objectInfo = {
      UNETLoader: {
        input: {
          required: {
            unet_name: [['a.safetensors', 'z_image_turbo_bf16.safetensors']],
            weight_dtype: [['default', 'fp8_e4m3fn']],
          },
        },
      },
    };

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).controlOptions).toEqual([
      {
        nodeId: '3',
        inputName: 'unet_name',
        options: ['a.safetensors', 'z_image_turbo_bf16.safetensors'],
      },
      {
        nodeId: '3',
        inputName: 'weight_dtype',
        options: ['default', 'fp8_e4m3fn'],
      },
    ]);
  });

  it('exposes LoadImage nodes as workflow image input candidates', () => {
    const workflow = {
      '4': {
        class_type: 'LoadImage',
        inputs: {
          image: 'reference.png',
        },
      },
      '8': {
        class_type: 'PreviewImage',
        inputs: {
          images: ['4', 0],
        },
      },
    };
    const objectInfo = {
      LoadImage: {
        input: {
          required: {
            image: ['IMAGEUPLOAD'],
          },
        },
        output: ['IMAGE', 'MASK'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).inputCandidates).toEqual([
      {
        id: '4:image',
        nodeId: '4',
        nodeType: 'LoadImage',
        inputName: 'image',
        label: 'LoadImage #4',
      },
    ]);
  });

  it('patches connected workflow image inputs without mutating the stored prompt', () => {
    const prompt = {
      '4': {
        class_type: 'LoadImage',
        inputs: {
          image: 'reference.png',
        },
      },
      '8': {
        class_type: 'PreviewImage',
        inputs: {
          images: ['4', 0],
        },
      },
    };

    const patched = applyComfyWorkflowInputImages(prompt, [
      {
        candidate: {
          nodeId: '4',
          inputName: 'image',
        },
        imageName: 'blackboard/input_a.png',
      },
    ]);

    expect(patched['4']).toMatchObject({
      inputs: {
        image: 'blackboard/input_a.png',
      },
    });
    expect(prompt['4']).toMatchObject({
      inputs: {
        image: 'reference.png',
      },
    });
  });

  it('exposes existing PreviewImage and SaveImage output nodes for selection', () => {
    const workflow = {
      nodes: [
        {
          id: 7,
          type: 'VAEDecode',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9, 10] }],
        },
        {
          id: 8,
          type: 'PreviewImage',
          inputs: [{ name: 'images', link: 9 }],
          outputs: [],
        },
        {
          id: 12,
          type: 'SaveImage',
          inputs: [{ name: 'images', link: 10 }],
          outputs: [],
          widgets_values: ['ComfyUI'],
        },
      ],
      links: [
        [9, 7, 0, 8, 0, 'IMAGE'],
        [10, 7, 0, 12, 0, 'IMAGE'],
      ],
    };
    const objectInfo = {
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
      SaveImage: {
        input: {
          required: {
            images: ['IMAGE'],
            filename_prefix: ['STRING'],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPromptWithOutputs(workflow, objectInfo);

    expect(extracted.outputCandidates.map((candidate) => candidate.id)).toEqual(['8', '12']);
    expect(extracted.outputCandidates.map((candidate) => candidate.kind)).toEqual([
      'existing',
      'existing',
    ]);
    expect(extracted.selectedOutputIds).toEqual(['8', '12']);

    expect(
      selectComfyPromptOutputs({
        prompt: extracted.prompt,
        outputCandidates: extracted.outputCandidates,
        selectedOutputIds: ['12'],
      }),
    ).toEqual({
      '7': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      '12': {
        class_type: 'SaveImage',
        inputs: {
          images: ['7', 0],
          filename_prefix: 'ComfyUI',
        },
      },
    });
  });

  it('does not append a PreviewImage output when the workflow already has an output node', () => {
    const workflow = {
      nodes: [
        {
          id: 7,
          type: 'VAEDecode',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9] }],
        },
        {
          id: 8,
          type: 'PreviewImage',
          inputs: [{ name: 'images', link: 9 }],
          outputs: [],
        },
      ],
      links: [[9, 7, 0, 8, 0, 'IMAGE']],
    };
    const objectInfo = {
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPromptWithOutputs(workflow, objectInfo);
    expect(extracted.outputCandidates).toEqual([
      {
        id: '8',
        nodeId: '8',
        nodeType: 'PreviewImage',
        kind: 'existing',
        outputIndex: 0,
        outputName: 'images',
        label: 'PreviewImage #8',
        promptLink: ['7', 0],
        previewNodeId: '8',
      },
    ]);
    expect(extracted.selectedOutputIds).toEqual(['8']);
    expect(extractComfyPrompt(workflow, objectInfo)).toEqual({
      '7': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      '8': {
        class_type: 'PreviewImage',
        inputs: {
          images: ['7', 0],
        },
      },
    });
  });

  it('maps linked BasicScheduler steps without shifting scheduler and denoise widget values', () => {
    const workflow = {
      nodes: [
        {
          id: 1,
          type: 'UNETLoader',
          inputs: [],
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [190] }],
        },
        {
          id: 17,
          type: 'BasicScheduler',
          inputs: [
            { name: 'model', link: 190 },
            {
              name: 'steps',
              type: 'INT',
              widget: { name: 'steps' },
              link: 276,
            },
          ],
          outputs: [{ name: 'SIGMAS', type: 'SIGMAS', links: [200] }],
          widgets_values: ['simple', 20, 1],
        },
        {
          id: 99,
          type: 'IntOutputNode',
          inputs: [],
          outputs: [{ name: 'INT', type: 'INT', links: [276] }],
          widgets_values: [50],
        },
        {
          id: 20,
          type: 'KSamplerAdvanced',
          inputs: [
            { name: 'model', link: 190 },
            { name: 'sigmas', link: 200 },
            { name: 'start_at_step', link: 276 },
          ],
          outputs: [{ name: 'OUTPUT', type: 'LATENT', links: [210] }],
        },
        {
          id: 21,
          type: 'VAEDecode',
          inputs: [{ name: 'samples', link: 210 }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [220] }],
        },
        {
          id: 22,
          type: 'PreviewImage',
          inputs: [{ name: 'images', link: 220 }],
          outputs: [],
        },
      ],
      links: [
        [190, 1, 0, 17, 0, 'MODEL'],
        [276, 99, 0, 17, 1, 'INT'],
        [200, 17, 0, 20, 1, 'SIGMAS'],
        [210, 20, 0, 21, 0, 'LATENT'],
        [220, 21, 0, 22, 0, 'IMAGE'],
      ],
    };

    const objectInfo = {
      UNETLoader: {
        input: {
          required: {},
        },
        output: ['MODEL'],
      },
      IntOutputNode: {
        input: {
          required: {
            value: ['INT'],
          },
        },
        output: ['INT'],
      },
      BasicScheduler: {
        input_order: {
          required: ['model', 'scheduler', 'steps', 'denoise'],
        },
        input: {
          required: {
            model: ['MODEL'],
            scheduler: [['simple', 'normal']],
            steps: ['INT'],
            denoise: ['FLOAT'],
          },
        },
        output: ['SIGMAS'],
      },
      KSamplerAdvanced: {
        input: {
          required: {
            model: ['MODEL'],
            sigmas: ['SIGMAS'],
            start_at_step: ['INT'],
          },
        },
        output: ['LATENT'],
      },
      VAEDecode: {
        input: {
          required: {
            samples: ['LATENT'],
          },
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    expect(extractComfyPrompt(workflow, objectInfo)).toMatchObject({
      '17': {
        class_type: 'BasicScheduler',
        inputs: {
          model: ['1', 0],
          scheduler: 'simple',
          steps: ['99', 0],
          denoise: 1,
        },
      },
    });
  });

  it('skips seed control widgets when mapping normal workflow widgets to API inputs', () => {
    const workflow = {
      nodes: [
        {
          id: 3,
          type: 'KSampler',
          inputs: [],
          outputs: [{ name: 'LATENT', type: 'LATENT', links: [8] }],
          widgets_values: [844219637214913, 'randomize', 8, 1, 'res_multistep', 'simple', 1],
        },
        {
          id: 4,
          type: 'VAEDecode',
          inputs: [{ name: 'samples', link: 8 }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9] }],
        },
        {
          id: 5,
          type: 'PreviewImage',
          inputs: [{ name: 'images', link: 9 }],
          outputs: [],
        },
      ],
      links: [
        [8, 3, 0, 4, 0, 'LATENT'],
        [9, 4, 0, 5, 0, 'IMAGE'],
      ],
    };
    const objectInfo = {
      KSampler: {
        input_order: {
          required: [
            'model',
            'seed',
            'steps',
            'cfg',
            'sampler_name',
            'scheduler',
            'positive',
            'negative',
            'latent_image',
            'denoise',
          ],
        },
        input: {
          required: {
            model: ['MODEL'],
            seed: ['INT'],
            steps: ['INT'],
            cfg: ['FLOAT'],
            sampler_name: [['res_multistep']],
            scheduler: [['simple']],
            positive: ['CONDITIONING'],
            negative: ['CONDITIONING'],
            latent_image: ['LATENT'],
            denoise: ['FLOAT'],
          },
        },
        output: ['LATENT'],
      },
      VAEDecode: {
        input: {
          required: {
            samples: ['LATENT'],
          },
        },
        output: ['IMAGE'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    expect(extractComfyPrompt(workflow, objectInfo)).toEqual({
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 844219637214913,
          steps: 8,
          cfg: 1,
          sampler_name: 'res_multistep',
          scheduler: 'simple',
          denoise: 1,
        },
      },
      '4': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['3', 0],
        },
      },
      '5': {
        class_type: 'PreviewImage',
        inputs: {
          images: ['4', 0],
        },
      },
    });
  });

  it('maps widget values correctly for BasicScheduler using input_order', () => {
    const workflow = {
      nodes: [
        {
          id: 1,
          type: 'UNETLoader',
          inputs: [],
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
          widgets_values: ['model.safetensors'],
        },
        {
          id: 17,
          type: 'BasicScheduler',
          inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
          outputs: [{ name: 'SIGMAS', type: 'SIGMAS', links: [2] }],
          widgets_values: ['simple', 20, 1], // scheduler, steps, start_at_step
        },
        {
          id: 8,
          type: 'PreviewImage',
          inputs: [{ name: 'images', link: 3 }],
          outputs: [],
        },
      ],
      links: [[1, 1, 0, 17, 0, 'MODEL']],
    };
    const objectInfo = {
      UNETLoader: {
        input: {
          required: {
            ckpt_name: [['model.safetensors']],
          },
        },
        output: ['MODEL'],
      },
      BasicScheduler: {
        input: {
          required: {
            model: ['MODEL'],
            steps: ['INT'],
            start_at_step: ['INT'],
          },
        },
        input_order: {
          required: ['model', 'steps', 'start_at_step'],
        },
        output: ['SIGMAS'],
      },
      PreviewImage: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPrompt(workflow, objectInfo);
    const schedulerNode = extracted['17'] as { inputs: Record<string, unknown> };
    // Verify that widget values are mapped correctly for BasicScheduler
    // Index 1 should be steps (value 20), not scheduler (value 'simple')
    expect(schedulerNode.inputs).toMatchObject({
      model: ['1', 0],
      steps: 20,
      start_at_step: 1,
    });
  });
});

describe('Comfy connection test', () => {
  it('rejects endpoints that are not full http or https URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(testComfyConnection('127.0.0.1:8188')).rejects.toThrow(
      'must be a full http:// or https:// URL',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects same-origin HTML fallback responses instead of treating any 200 as connected', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>Studio</html>', { status: 200 }))
      .mockResolvedValueOnce(new Response('<html>Studio</html>', { status: 200 }));

    await expect(testComfyConnection('http://127.0.0.1:8188/wrong')).rejects.toThrow(
      'did not look like ComfyUI',
    );
  });
});

describe('Comfy progress stream', () => {
  it('builds a websocket URL from the configured Comfy endpoint', () => {
    expect(buildComfyWebSocketUrl('http://127.0.0.1:8188/', 'client_a')).toBe(
      'ws://127.0.0.1:8188/ws?clientId=client_a',
    );
    expect(buildComfyWebSocketUrl('https://comfy.example.com/base', 'client a')).toBe(
      'wss://comfy.example.com/base/ws?clientId=client+a',
    );
  });

  it('parses ComfyUI step progress messages', () => {
    expect(
      parseComfyProgressMessage({
        type: 'progress',
        data: {
          prompt_id: 'prompt_a',
          node: '3',
          value: 7,
          max: 20,
        },
      }),
    ).toEqual({
      type: 'progress',
      promptId: 'prompt_a',
      nodeId: '3',
      value: 7,
      max: 20,
    });
  });

  it('parses final executing messages as complete', () => {
    expect(
      parseComfyProgressMessage({
        type: 'executing',
        data: {
          prompt_id: 'prompt_a',
          node: null,
        },
      }),
    ).toEqual({
      type: 'complete',
      promptId: 'prompt_a',
      nodeId: null,
    });
  });
});
