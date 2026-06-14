import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyComfyWorkflowInputImages,
  buildComfyWebSocketUrl,
  collectComfyHistoryOutputFiles,
  extractComfyImageWorkflowMetadata,
  extractComfyPrompt,
  extractComfyPromptWithOutputs,
  extractComfyWorkflowFromImage,
  parseComfyProgressMessage,
  queueComfyPrompt,
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

  it('prefers an EXR output node when ComfyUI exposes one for synthetic image outputs', () => {
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
                        input_color_space: [['sRGB'], { default: 'sRGB' }],
                      },
                    },
                  },
                  {
                    key: 'exr',
                    inputs: {
                      required: {
                        bit_depth: [['32-bit float'], { default: '32-bit float' }],
                        input_color_space: [['sRGB', 'HDR', 'linear'], { default: 'sRGB' }],
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

    expect(extracted.outputCandidates[0]).toMatchObject({
      syntheticOutputNodeType: 'SaveImageAdvanced',
      syntheticOutputFormat: 'exr_float',
      previewNodeId: 'blackboard_exr_7_0',
      outputNodeDynamicInputs: [
        {
          parentInputName: 'format',
          optionKey: 'png',
          fields: [
            {
              inputName: 'bit_depth',
              dottedInputName: 'format.bit_depth',
              defaultValue: '8-bit',
              options: ['8-bit', '16-bit'],
            },
            {
              inputName: 'input_color_space',
              dottedInputName: 'format.input_color_space',
              defaultValue: 'sRGB',
              options: ['sRGB'],
            },
          ],
        },
        {
          parentInputName: 'format',
          optionKey: 'exr',
          fields: [
            {
              inputName: 'bit_depth',
              dottedInputName: 'format.bit_depth',
              defaultValue: '32-bit float',
              options: ['32-bit float'],
            },
            {
              inputName: 'input_color_space',
              dottedInputName: 'format.input_color_space',
              defaultValue: 'sRGB',
              options: ['sRGB', 'HDR', 'linear'],
            },
          ],
        },
      ],
    });
    expect(extracted.prompt).toEqual({
      '7': {
        class_type: 'VAEDecode',
        inputs: {},
      },
      blackboard_exr_7_0: {
        class_type: 'SaveImageAdvanced',
        inputs: {
          images: ['7', 0],
          filename_prefix: 'blackboard/7_0_exr',
          format: 'exr',
          'format.bit_depth': '32-bit float',
          'format.input_color_space': 'sRGB',
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

  it('extracts selected dynamic combo nested options for workflow controls', () => {
    const workflow = {
      '15': {
        class_type: 'VHS_VideoCombine',
        inputs: {
          filename_prefix: 'AnimateDiff',
          format: 'video/h264-mp4',
          codec: 'h264',
          pix_fmt: 'yuv420p',
        },
      },
    };
    const objectInfo = {
      VHS_VideoCombine: {
        input: {
          required: {
            filename_prefix: ['STRING'],
            format: [
              'COMFY_DYNAMICCOMBO_V3',
              {
                options: [
                  {
                    key: 'video/h264-mp4',
                    inputs: {
                      required: {
                        codec: [['h264', 'hevc']],
                        pix_fmt: [['yuv420p', 'yuv444p']],
                      },
                    },
                  },
                  {
                    key: 'image/gif',
                    inputs: {
                      required: {
                        dither: [['none', 'floyd-steinberg']],
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    };

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).controlOptions).toEqual([
      {
        nodeId: '15',
        inputName: 'format',
        options: ['video/h264-mp4', 'image/gif'],
      },
      {
        nodeId: '15',
        inputName: 'codec',
        options: ['h264', 'hevc'],
      },
      {
        nodeId: '15',
        inputName: 'pix_fmt',
        options: ['yuv420p', 'yuv444p'],
      },
    ]);
  });

  it('extracts dynamic combo nested options for the selected output format', () => {
    const workflow = {
      '15': {
        class_type: 'SaveImageAdvanced',
        inputs: {
          images: ['7', 0],
          filename_prefix: 'ComfyUI',
          format: 'png',
          'format.bit_depth': '8-bit',
          'format.input_color_space': 'sRGB',
        },
      },
    };
    const objectInfo = {
      SaveImageAdvanced: {
        input: {
          required: {
            images: ['IMAGE'],
            filename_prefix: ['STRING'],
            format: [
              'COMFY_DYNAMICCOMBO_V3',
              {
                options: [
                  {
                    key: 'png',
                    inputs: {
                      required: {
                        bit_depth: [['8-bit', '16-bit'], { default: '8-bit' }],
                        input_color_space: [['sRGB'], { default: 'sRGB' }],
                      },
                    },
                  },
                  {
                    key: 'exr',
                    inputs: {
                      required: {
                        bit_depth: [['32-bit float'], { default: '32-bit float' }],
                        input_color_space: [['sRGB', 'HDR', 'linear'], { default: 'sRGB' }],
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
        output_node: true,
      },
    };

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).controlOptions).toEqual([
      {
        nodeId: '15',
        inputName: 'format',
        options: ['png', 'exr'],
      },
      {
        nodeId: '15',
        inputName: 'format.bit_depth',
        options: ['8-bit', '16-bit'],
      },
      {
        nodeId: '15',
        inputName: 'format.input_color_space',
        options: ['sRGB'],
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

  it('does not expose linked internal media inputs from API-format prompts', () => {
    const prompt = {
      '75': {
        class_type: 'SaveVideo',
        inputs: {
          video: ['267:242', 0],
        },
      },
      '269': {
        class_type: 'LoadImage',
        inputs: {
          image: 'z-image_00169_.png',
        },
      },
      '267:235': {
        class_type: 'ResizeImagesByLongerEdge',
        inputs: {
          images: ['267:238', 0],
        },
      },
      '267:230': {
        class_type: 'LTXVImgToVideoInplace',
        inputs: {
          image: ['267:248', 0],
        },
      },
      '267:242': {
        class_type: 'CreateVideo',
        inputs: {
          images: ['267:12', 0],
        },
      },
    };
    const objectInfo = {
      SaveVideo: {
        input: {
          required: {
            video: ['VIDEO'],
          },
        },
        output_node: true,
      },
      LoadImage: {
        input: {
          required: {
            image: ['IMAGEUPLOAD'],
          },
        },
        output: ['IMAGE', 'MASK'],
      },
      ResizeImagesByLongerEdge: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output: ['IMAGE'],
      },
      LTXVImgToVideoInplace: {
        input: {
          required: {
            image: ['IMAGE'],
          },
        },
        output: ['LATENT'],
      },
      CreateVideo: {
        input: {
          required: {
            images: ['IMAGE'],
          },
        },
        output: ['VIDEO'],
      },
    };

    expect(extractComfyPromptWithOutputs(prompt, objectInfo).inputCandidates).toEqual([
      {
        id: '269:image',
        nodeId: '269',
        nodeType: 'LoadImage',
        inputName: 'image',
        label: 'LoadImage #269',
      },
    ]);
  });

  it('exposes IMAGE-type inputs on non-LoadImage nodes as input candidates', () => {
    const workflow = {
      nodes: [
        {
          id: 5,
          type: 'IPAdapter',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
        {
          id: 7,
          type: 'ImageScale',
          inputs: [{ name: 'image', link: null }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
      ],
      links: [],
    };
    const objectInfo = {
      IPAdapter: {
        input: {
          required: {
            image: ['IMAGE'],
            model: ['MODEL'],
          },
        },
        output: ['IMAGE'],
      },
      ImageScale: {
        input: {
          required: {
            image: ['IMAGE'],
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

    const candidates = extractComfyPromptWithOutputs(workflow, objectInfo).inputCandidates;
    const nonLoadImageCandidates = candidates.filter((c) => c.nodeType !== 'LoadImage');
    expect(nonLoadImageCandidates).toEqual([
      {
        id: '5:image',
        nodeId: '5',
        nodeType: 'IPAdapter',
        inputName: 'image',
        label: 'IPAdapter #5',
      },
      {
        id: '7:image',
        nodeId: '7',
        nodeType: 'ImageScale',
        inputName: 'image',
        label: 'ImageScale #7',
      },
    ]);
  });

  it('does not expose connected top-level media inputs as input candidates', () => {
    const workflow = {
      nodes: [
        {
          id: 4,
          type: 'LoadImage',
          inputs: [{ name: 'image', widget: { name: 'image' } }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9] }],
          widgets_values: ['reference.png'],
        },
        {
          id: 7,
          type: 'ImageScale',
          inputs: [{ name: 'image', link: 9 }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
      ],
      links: [[9, 4, 0, 7, 0, 'IMAGE']],
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
      ImageScale: {
        input: {
          required: {
            image: ['IMAGE'],
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

  it('does not expose media inputs from inside subgraphs as workflow input candidates', () => {
    const workflow = {
      nodes: [
        {
          id: 10,
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
                id: 4,
                type: 'ImageScale',
                inputs: [{ name: 'image', type: 'IMAGE', link: 20 }],
                outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10] }],
              },
            ],
            links: [
              [10, 4, 0, -20, 0, 'IMAGE'],
              [20, -10, 0, 4, 0, 'IMAGE'],
            ],
            inputs: [{ name: 'start_image', type: 'IMAGE', linkIds: [20] }],
            outputs: [{ linkIds: [10] }],
          },
        ],
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
      ImageScale: {
        input: {
          required: {
            image: ['IMAGE'],
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

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).inputCandidates).toEqual([]);
  });

  it('falls back to an embedded API prompt when graph conversion needs unavailable node types', () => {
    const workflow = {
      nodes: [
        {
          id: 269,
          type: 'LoadImage',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [609] }],
          widgets_values: ['z-image_00169_.png'],
        },
        {
          id: 267,
          type: 'custom-video-subgraph',
          inputs: [{ name: 'input', type: 'IMAGE,MASK', link: 609 }],
          outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [594] }],
        },
        {
          id: 75,
          type: 'SaveVideo',
          inputs: [{ name: 'video', type: 'VIDEO', link: 594 }],
          outputs: [],
        },
      ],
      links: [
        [609, 269, 0, 267, 0, 'IMAGE'],
        [594, 267, 0, 75, 0, 'VIDEO'],
      ],
      definitions: {
        subgraphs: [
          {
            id: 'custom-video-subgraph',
            nodes: [
              {
                id: 1,
                type: 'UnavailableVideoNode',
                inputs: [{ name: 'image', type: 'IMAGE', link: 2 }],
                outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [3] }],
              },
            ],
            links: [
              [2, -10, 0, 1, 0, 'IMAGE'],
              [3, 1, 0, -20, 0, 'VIDEO'],
            ],
            inputs: [{ name: 'input', type: 'IMAGE', linkIds: [2] }],
            outputs: [{ linkIds: [3] }],
          },
        ],
      },
      extra: {
        prompt: {
          '75': {
            class_type: 'SaveVideo',
            inputs: {
              video: ['267:1', 0],
            },
          },
          '269': {
            class_type: 'LoadImage',
            inputs: {
              image: 'z-image_00169_.png',
            },
          },
          '267:1': {
            class_type: 'UnavailableVideoNode',
            inputs: {
              image: ['269', 0],
            },
          },
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
      SaveVideo: {
        input: {
          required: {
            video: ['VIDEO'],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPromptWithOutputs(workflow, objectInfo);

    expect(extracted.prompt).toEqual(workflow.extra.prompt);
    expect(extracted.inputCandidates).toEqual([
      {
        id: '269:image',
        nodeId: '269',
        nodeType: 'LoadImage',
        inputName: 'image',
        label: 'LoadImage #269',
      },
    ]);
  });

  it('prefers converted full graph values over stale embedded prompt when UI-only nodes are unavailable', () => {
    const workflow = {
      nodes: [
        {
          id: 269,
          type: 'LoadImage',
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [609] }],
          widgets_values: ['z-image_00169_.png'],
        },
        {
          id: 267,
          type: 'custom-video-subgraph',
          inputs: [{ name: 'input', type: 'IMAGE', link: 609 }],
          outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [594] }],
        },
        {
          id: 75,
          type: 'SaveVideo',
          inputs: [{ name: 'video', type: 'VIDEO', link: 594 }],
          outputs: [],
          widgets_values: ['video/LTX_2.3_i2v', 'auto'],
        },
      ],
      links: [
        [609, 269, 0, 267, 0, 'IMAGE'],
        [594, 267, 0, 75, 0, 'VIDEO'],
      ],
      definitions: {
        subgraphs: [
          {
            id: 'custom-video-subgraph',
            nodes: [
              {
                id: 236,
                type: 'CheckpointLoaderSimple',
                inputs: [{ name: 'ckpt_name', type: 'COMBO', widget: { name: 'ckpt_name' } }],
                outputs: [{ name: 'MODEL', type: 'MODEL', links: [557] }],
                widgets_values: ['sulphur_dev_fp8mixed.safetensors'],
              },
              {
                id: 255,
                type: 'Reroute',
                inputs: [{ name: '', type: '*', link: 557 }],
                outputs: [{ name: '', type: '*', links: [558] }],
              },
              {
                id: 242,
                type: 'CreateVideo',
                inputs: [{ name: 'model', type: 'MODEL', link: 558 }],
                outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [560, 561] }],
              },
              {
                id: 275,
                type: 'PreviewAny',
                inputs: [{ name: 'source', type: '*', link: 561 }],
                outputs: [],
              },
            ],
            links: [
              [557, 236, 0, 255, 0, 'MODEL'],
              [558, 255, 0, 242, 0, 'MODEL'],
              [560, 242, 0, -20, 0, 'VIDEO'],
              [561, 242, 0, 275, 0, 'VIDEO'],
            ],
            inputs: [{ name: 'input', type: 'IMAGE', linkIds: [] }],
            outputs: [{ linkIds: [560] }],
          },
        ],
      },
      extra: {
        prompt: {
          '1': {
            class_type: 'CheckpointLoaderSimple',
            inputs: {
              ckpt_name: 'ltx-av-step-1751000_vocoder_24K.safetensors',
            },
          },
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
      CheckpointLoaderSimple: {
        input: {
          required: {
            ckpt_name: [
              ['sulphur_dev_fp8mixed.safetensors', 'ltx-av-step-1751000_vocoder_24K.safetensors'],
            ],
          },
        },
        output: ['MODEL'],
      },
      CreateVideo: {
        input: {
          required: {
            model: ['MODEL'],
          },
        },
        output: ['VIDEO'],
      },
      SaveVideo: {
        input: {
          required: {
            video: ['VIDEO'],
            filename_prefix: ['STRING'],
            format: [['auto', 'mp4']],
          },
        },
        output_node: true,
      },
    };

    const extracted = extractComfyPromptWithOutputs(workflow, objectInfo);

    expect(extracted.prompt).toMatchObject({
      '267_236': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'sulphur_dev_fp8mixed.safetensors',
        },
      },
      '267_242': {
        class_type: 'CreateVideo',
        inputs: {
          model: ['267_236', 0],
        },
      },
      '75': {
        class_type: 'SaveVideo',
        inputs: {
          video: ['267_242', 0],
        },
      },
    });
    expect(extracted.prompt).not.toHaveProperty('1');
  });

  it('exposes unconnected media inputs on top-level subgraph wrapper nodes', () => {
    const workflow = {
      nodes: [
        {
          id: 133,
          type: 'custom-image-edit-subgraph',
          inputs: [{ name: 'start_image', type: 'IMAGE', link: null }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
          title: 'Image Edit (Capybara v0.1)',
        },
      ],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: 'custom-image-edit-subgraph',
            nodes: [
              {
                id: 4,
                type: 'ImageScale',
                inputs: [{ name: 'image', type: 'IMAGE', link: 20 }],
                outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10] }],
              },
            ],
            links: [
              [10, 4, 0, -20, 0, 'IMAGE'],
              [20, -10, 0, 4, 0, 'IMAGE'],
            ],
            inputs: [{ name: 'start_image', type: 'IMAGE', linkIds: [20] }],
            outputs: [{ linkIds: [10] }],
          },
        ],
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
      ImageScale: {
        input: {
          required: {
            image: ['IMAGE'],
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

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).inputCandidates).toEqual([
      {
        id: '133:start_image',
        nodeId: '133',
        nodeType: 'custom-image-edit-subgraph',
        inputName: 'start_image',
        label: 'custom-image-edit-subgraph #133',
        promptTargets: [{ nodeId: '133_4', inputName: 'image' }],
      },
    ]);
  });

  it('exposes top-level image list and video media inputs as input candidates', () => {
    const workflow = {
      nodes: [
        {
          id: 12,
          type: 'LoadVideo',
          inputs: [{ name: 'video', widget: { name: 'video' } }],
          outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [] }],
          widgets_values: ['clip.mp4'],
        },
        {
          id: 20,
          type: 'ImageListConsumer',
          inputs: [{ name: 'images', link: null }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
        },
      ],
      links: [],
    };
    const objectInfo = {
      LoadVideo: {
        input: {
          required: {
            video: ['VIDEOUPLOAD'],
          },
        },
        output: ['VIDEO'],
      },
      ImageListConsumer: {
        input: {
          required: {
            images: ['IMAGES'],
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

    expect(extractComfyPromptWithOutputs(workflow, objectInfo).inputCandidates).toEqual([
      {
        id: '12:video',
        nodeId: '12',
        nodeType: 'LoadVideo',
        inputName: 'video',
        label: 'LoadVideo #12',
      },
      {
        id: '20:images',
        nodeId: '20',
        nodeType: 'ImageListConsumer',
        inputName: 'images',
        label: 'ImageListConsumer #20',
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
          nodeType: 'LoadImage',
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

  it('injects a LoadImage node for non-LoadImage input candidates', () => {
    const prompt = {
      '5': {
        class_type: 'IPAdapter',
        inputs: {
          image: ['3', 0],
          model: ['2', 0],
        },
      },
    };

    const patched = applyComfyWorkflowInputImages(prompt, [
      {
        candidate: {
          nodeId: '5',
          inputName: 'image',
          nodeType: 'IPAdapter',
        },
        imageName: 'blackboard/input_a.png',
      },
    ]);

    const loadNodeId = Object.keys(patched).find((key) => key !== '5');

    expect(loadNodeId).toBeDefined();
    expect(loadNodeId).toMatch(/^blackboard_input_load_5_image/);
    expect(patched[loadNodeId!]).toMatchObject({
      class_type: 'LoadImage',
      inputs: { image: 'blackboard/input_a.png' },
    });
    expect(patched['5']).toMatchObject({
      inputs: {
        image: [loadNodeId!, 0],
        model: ['2', 0],
      },
    });
  });

  it('injects a LoadImage node into expanded subgraph input targets', () => {
    const prompt = {
      '133_4': {
        class_type: 'ImageScale',
        inputs: {},
      },
      '133_8': {
        class_type: 'PreviewImage',
        inputs: {
          images: ['133_4', 0],
        },
      },
    };

    const patched = applyComfyWorkflowInputImages(prompt, [
      {
        candidate: {
          nodeId: '133',
          inputName: 'start_image',
          nodeType: 'custom-image-edit-subgraph',
          promptTargets: [{ nodeId: '133_4', inputName: 'image' }],
        },
        imageName: 'blackboard/input_a.png',
      },
    ]);

    const loadNodeId = Object.keys(patched).find((key) => key.startsWith('blackboard_input_load_'));

    expect(loadNodeId).toBeDefined();
    expect(patched[loadNodeId!]).toMatchObject({
      class_type: 'LoadImage',
      inputs: { image: 'blackboard/input_a.png' },
    });
    expect(patched['133_4']).toMatchObject({
      inputs: {
        image: [loadNodeId!, 0],
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
    expect(extracted.outputCandidates[1]?.outputNodeInputs).toEqual({
      images: ['7', 0],
      filename_prefix: 'ComfyUI',
    });
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

  it('exposes existing API prompt output nodes for selection details', () => {
    const prompt = {
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
    };
    const objectInfo = {
      VAEDecode: {
        input: {
          required: {},
        },
        output: ['IMAGE'],
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

    const extracted = extractComfyPromptWithOutputs(prompt, objectInfo);

    expect(extracted.outputCandidates).toEqual([
      {
        id: '12',
        nodeId: '12',
        nodeType: 'SaveImage',
        kind: 'existing',
        outputIndex: 0,
        outputName: 'images',
        outputType: 'IMAGE',
        label: 'SaveImage #12',
        promptLink: ['7', 0],
        previewNodeId: '12',
        outputNodeInputs: {
          images: ['7', 0],
          filename_prefix: 'ComfyUI',
        },
      },
    ]);
    expect(extracted.selectedOutputIds).toEqual(['12']);
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
        outputType: 'IMAGE',
        label: 'PreviewImage #8',
        promptLink: ['7', 0],
        previewNodeId: '8',
        outputNodeInputs: {
          images: ['7', 0],
        },
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

  it('preserves dotted dynamic combo input names when converting full graph widgets', () => {
    const workflow = {
      nodes: [
        {
          id: 257,
          type: 'PrimitiveInt',
          inputs: [],
          outputs: [{ name: 'INT', type: 'INT', links: [558] }],
          widgets_values: [2096, 'fixed'],
        },
        {
          id: 258,
          type: 'PrimitiveInt',
          inputs: [],
          outputs: [{ name: 'INT', type: 'INT', links: [559] }],
          widgets_values: [880, 'fixed'],
        },
        {
          id: 238,
          type: 'ResizeImageMaskNode',
          inputs: [
            {
              name: 'resize_type.width',
              type: 'INT',
              widget: { name: 'resize_type.width' },
              link: 558,
            },
            {
              name: 'resize_type.height',
              type: 'INT',
              widget: { name: 'resize_type.height' },
              link: 559,
            },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [560] }],
          widgets_values: ['scale dimensions', 1920, 1088, 'center', 'lanczos'],
        },
        {
          id: 274,
          type: 'TextGenerateLTX2Prompt',
          inputs: [],
          outputs: [],
          widgets_values: ['', 256, 'on', 0.7, 64, 0.95, 0.05, 1.05, 0, 0, false, true],
        },
        {
          id: 8,
          type: 'PreviewImage',
          inputs: [{ name: 'images', type: 'IMAGE', link: 560 }],
          outputs: [],
        },
      ],
      links: [
        [558, 257, 0, 238, 0, 'INT'],
        [559, 258, 0, 238, 1, 'INT'],
        [560, 238, 0, 8, 0, 'IMAGE'],
      ],
    };
    const objectInfo = {
      PrimitiveInt: {
        input: {
          required: {
            value: ['INT'],
          },
        },
        output: ['INT'],
      },
      ResizeImageMaskNode: {
        input_order: {
          required: ['input', 'resize_type', 'scale_method'],
        },
        input: {
          required: {
            input: ['IMAGE'],
            resize_type: [
              'COMFY_DYNAMICCOMBO_V3',
              {
                options: [
                  {
                    key: 'scale dimensions',
                    inputs: {
                      required: {
                        width: ['INT'],
                        height: ['INT'],
                        crop: [['center', 'disabled']],
                      },
                    },
                  },
                ],
              },
            ],
            scale_method: [['lanczos', 'nearest']],
          },
        },
        output: ['IMAGE'],
      },
      TextGenerateLTX2Prompt: {
        input_order: {
          required: ['prompt', 'max_length', 'sampling_mode', 'thinking', 'use_default_template'],
        },
        input: {
          required: {
            prompt: ['STRING'],
            max_length: ['INT'],
            sampling_mode: [
              'COMFY_DYNAMICCOMBO_V3',
              {
                options: [
                  {
                    key: 'on',
                    inputs: {
                      required: {
                        temperature: ['FLOAT'],
                        top_k: ['INT'],
                        top_p: ['FLOAT'],
                        min_p: ['FLOAT'],
                        repetition_penalty: ['FLOAT'],
                        seed: ['INT'],
                        presence_penalty: ['FLOAT'],
                      },
                    },
                  },
                ],
              },
            ],
            thinking: ['BOOLEAN'],
            use_default_template: ['BOOLEAN'],
          },
        },
        output: ['STRING'],
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

    const prompt = extractComfyPrompt(workflow, objectInfo);

    expect(prompt['238']).toMatchObject({
      class_type: 'ResizeImageMaskNode',
      inputs: {
        resize_type: 'scale dimensions',
        'resize_type.width': ['257', 0],
        'resize_type.height': ['258', 0],
        'resize_type.crop': 'center',
        scale_method: 'lanczos',
      },
    });
    expect(prompt['274']).toMatchObject({
      class_type: 'TextGenerateLTX2Prompt',
      inputs: {
        prompt: '',
        max_length: 256,
        sampling_mode: 'on',
        'sampling_mode.temperature': 0.7,
        'sampling_mode.top_k': 64,
        'sampling_mode.top_p': 0.95,
        'sampling_mode.min_p': 0.05,
        'sampling_mode.repetition_penalty': 1.05,
        'sampling_mode.seed': 0,
        'sampling_mode.presence_penalty': 0,
        thinking: false,
        use_default_template: true,
      },
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

describe('Comfy prompt queue', () => {
  it('sends extra png metadata when provided', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ prompt_id: 'prompt-1', number: 2 }), { status: 200 }),
      );
    const prompt = {
      '1': {
        class_type: 'PreviewImage',
        inputs: {
          images: ['2', 0],
        },
      },
    };
    const extraData = {
      extra_pnginfo: {
        prompt,
        workflow: { nodes: [], links: [] },
      },
    };

    await expect(
      queueComfyPrompt({
        endpoint: 'http://127.0.0.1:8188',
        prompt,
        clientId: 'client-1',
        extraData,
      }),
    ).resolves.toEqual({ promptId: 'prompt-1', number: 2 });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt,
      client_id: 'client-1',
      extra_data: extraData,
    });
  });
});

describe('Comfy output history', () => {
  it('returns video outputs from ComfyUI history', () => {
    expect(
      collectComfyHistoryOutputFiles({
        outputs: {
          '75': {
            videos: [
              {
                filename: 'LTX_2.3_i2v_00041_.mp4',
                subfolder: '',
                type: 'output',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        nodeId: '75',
        kind: 'video',
        filename: 'LTX_2.3_i2v_00041_.mp4',
        subfolder: '',
        type: 'output',
      },
    ]);
  });

  it('keeps mp4 files returned through image slots for media detection', () => {
    expect(
      collectComfyHistoryOutputFiles({
        outputs: {
          '75': {
            images: [
              {
                filename: 'LTX_2.3_i2v_00041_.mp4',
                type: 'output',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        nodeId: '75',
        kind: 'image',
        filename: 'LTX_2.3_i2v_00041_.mp4',
        type: 'output',
      },
    ]);
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
