import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeType, type AiChatAttachment, type GradeNode } from '@blackboard/types';
import {
  generateAssistantChatTurn,
  generateShaderCode,
  generateShaderChatTurn,
  isOllamaAuthenticationRequiredError,
  type ShaderGenerationStreamUpdate,
  listOllamaModels,
  validateGeneratedShaderCode,
} from './ai';
import { createAiNodeToolHandlers } from './aiNodeTools';
import { runOllamaToolAgent } from './ollamaAgentRunner';

const createNdjsonStreamResponse = (lines: Array<Record<string, unknown>>) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      lines.forEach((line) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      });
      controller.close();
    },
  });
};

describe('generateShaderCode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes shader generation through Ollama structured chat output and strips markdown fences and version headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: {
          content: JSON.stringify({
            message: 'Built a monochrome bloom shader.',
            shaderCode:
              '```glsl\n#version 300 es\nprecision highp float;\nin vec2 v_uv;\nuniform sampler2D u_tDiffuse;\nout vec4 fragColor;\nvoid main() { fragColor = texture(u_tDiffuse, v_uv); }\n```',
            suggestions: ['Make it softer', 'Add glow streaks'],
          }),
        },
      }),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const code = await generateShaderCode('a vivid monochrome bloom', {
      provider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434/api',
      ollamaModel: 'shader-local',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body)) as {
      model: string;
      stream: boolean;
      format?: unknown;
      messages: Array<{ role: string; content: string }>;
    };

    expect(requestBody.model).toBe('shader-local');
    expect(requestBody.stream).toBe(false);
    expect(requestBody.format).toEqual(
      expect.objectContaining({
        type: 'object',
      }),
    );
    expect(requestBody.messages[0]?.role).toBe('system');
    expect(requestBody.messages[1]?.role).toBe('user');
    expect(requestBody.messages[1]?.content).toContain('a vivid monochrome bloom');
    expect(requestBody.messages[1]?.content).toContain('Return ONLY valid JSON');
    expect(code).toBe(
      'precision highp float;\nin vec2 v_uv;\nuniform sampler2D u_tDiffuse;\nout vec4 fragColor;\nvoid main() { fragColor = texture(u_tDiffuse, v_uv); }',
    );
  });

  it('requires an Ollama model when local shader generation is selected', async () => {
    await expect(
      generateShaderCode('a vivid monochrome bloom', {
        provider: 'ollama',
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: '',
      }),
    ).rejects.toThrow('Missing Ollama model for shader generation');
  });

  it('repairs invalid shader candidates before returning the final code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: {
            content: JSON.stringify({
              message: 'First pass.',
              shaderCode: 'precision mediump float;\nout vec4 fragColor;\nvoid main() { }',
              suggestions: [],
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: {
            content: JSON.stringify({
              message: 'Fixed the pipeline contract.',
              shaderCode:
                'precision highp float;\nin vec2 v_uv;\nuniform sampler2D u_tDiffuse;\nout vec4 fragColor;\nvoid main() { fragColor = texture(u_tDiffuse, v_uv); }',
              suggestions: ['Boost contrast'],
            }),
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await generateShaderChatTurn('repair this', {
      provider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'shader-local',
      currentShader:
        'precision highp float;\nin vec2 v_uv;\nuniform sampler2D u_tDiffuse;\nout vec4 fragColor;\nvoid main() { fragColor = texture(u_tDiffuse, v_uv); }',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondRequestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondRequestBody = JSON.parse(String(secondRequestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(secondRequestBody.messages.at(-1)?.content).toContain(
      'Validation errors that must be fixed',
    );
    expect(secondRequestBody.messages.at(-1)?.content).toContain('Include `in vec2 v_uv;`.');
    expect(result.shaderCode).toContain('uniform sampler2D u_tDiffuse;');
    expect(result.suggestions).toEqual(['Boost contrast']);
  });

  it('streams Ollama thinking and shader text updates in real time when a callback is provided', async () => {
    const updates: ShaderGenerationStreamUpdate[] = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: createNdjsonStreamResponse([
        {
          model: 'shader-local',
          message: { thinking: 'Planning the shader.\n' },
          done: false,
        },
        {
          model: 'shader-local',
          message: { content: 'MESSAGE:\nBuilding a soft bloom shader.\n\n' },
          done: false,
        },
        {
          model: 'shader-local',
          message: {
            content:
              'SHADER:\n```glsl\nprecision highp float;\nin vec2 v_uv;\nuniform sampler2D u_tDiffuse;\n',
          },
          done: false,
        },
        {
          model: 'shader-local',
          message: {
            content:
              'out vec4 fragColor;\nvoid main() { fragColor = texture(u_tDiffuse, v_uv); }\n```\n\nSUGGESTIONS:\n- Add film grain\n- Raise bloom threshold\n',
          },
          done: true,
        },
      ]),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await generateShaderChatTurn('a soft bloom shader', {
      provider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'shader-local',
      onStreamUpdate: (update) => {
        updates.push(update);
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body)) as {
      stream: boolean;
      think: boolean;
      format?: unknown;
    };

    expect(requestBody.stream).toBe(true);
    expect(requestBody.think).toBe(true);
    expect(requestBody.format).toBeUndefined();
    expect(updates.some((update) => update.thinking.includes('Planning the shader.'))).toBe(true);
    expect(
      updates.some((update) => update.shaderCode.includes('uniform sampler2D u_tDiffuse;')),
    ).toBe(true);
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({
        stage: 'complete',
        content: 'Building a soft bloom shader.',
      }),
    );
    expect(result.thinking).toContain('Planning the shader.');
    expect(result.shaderCode).toContain('out vec4 fragColor;');
    expect(result.suggestions).toEqual(['Add film grain', 'Raise bloom threshold']);
  });
});

describe('validateGeneratedShaderCode', () => {
  it('flags unsupported custom uniforms and missing metadata', () => {
    const validation = validateGeneratedShaderCode(`
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform mat3 u_transform;
uniform float u_mixAmount;
out vec4 fragColor;

void main() {
  fragColor = texture(u_tDiffuse, v_uv);
}
`);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'Unsupported uniform type `mat3` on `u_transform`. Use float, int, bool, vec2, or vec3.',
    );
    expect(validation.errors).toContain('Uniform `u_mixAmount` is missing inline JSON metadata.');
  });

  it('accepts toggle and segmented custom shader uniforms', () => {
    const validation = validateGeneratedShaderCode(`
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform bool u_enabled; // {"label": "Enabled", "value": true}
uniform int u_mode; // {"label": "Mode", "type": "segment", "value": 1, "options": ["Soft", "Hard"]}
out vec4 fragColor;

void main() {
  vec4 source = texture(u_tDiffuse, v_uv);
  fragColor = u_enabled && u_mode == 1 ? vec4(source.bgr, source.a) : source;
}
`);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('accepts built-in temporal uniforms and texture ports without metadata', () => {
    const validation = validateGeneratedShaderCode(`
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tPreviousFrame;
uniform sampler2D u_tFrameMinus2; // {"label": "Frame -2", "type": "temporal", "mode": "relative", "frame": -2}
uniform sampler2D u_tRelativeFrame; // {"label": "Relative Frame", "type": "temporal", "mode": "relative", "frameUniform": "u_relativeFrame"}
uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -1}
uniform float u_frame;
uniform float u_time;
uniform float u_fps;
out vec4 fragColor;

void main() {
  vec4 source = texture(u_tDiffuse, v_uv);
  vec4 previous = texture(u_tPreviousFrame, v_uv);
  vec4 older = texture(u_tFrameMinus2, v_uv);
  vec4 relativeFrame = texture(u_tRelativeFrame, v_uv);
  float pulse = 0.5 + 0.5 * sin(u_time * 6.2831853);
  fragColor = mix(mix(mix(older, previous, 0.5), relativeFrame, 0.5), source, pulse + (u_frame * 0.0) + (u_fps * 0.0));
}
`);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });
});

describe('listOllamaModels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads models from Ollama tags and normalizes the endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'http://localhost:11434/api/tags') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            models: [
              {
                name: 'qwen2.5-coder:7b',
                model: 'qwen2.5-coder:7b',
                modified_at: '2026-03-29T00:00:00Z',
                size: 123,
                details: {
                  parameter_size: '7B',
                  quantization_level: 'Q4_K_M',
                },
              },
            ],
          }),
        };
      }

      if (url === 'http://localhost:11434/api/show') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            capabilities: ['completion', 'tools', 'thinking'],
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const models = await listOllamaModels('http://localhost:11434');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(models).toEqual([
      expect.objectContaining({
        model: 'qwen2.5-coder:7b',
        name: 'qwen2.5-coder:7b',
        capabilities: ['completion', 'tools', 'thinking'],
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/show',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'qwen2.5-coder:7b' }),
      }),
    );
  });

  it('reports authentication-required Ollama responses with a browser URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      url: '',
    } as Response);

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      await listOllamaModels('https://ollama.example.com/api');
      throw new Error('Expected listOllamaModels to throw.');
    } catch (error) {
      expect(isOllamaAuthenticationRequiredError(error)).toBe(true);
      if (isOllamaAuthenticationRequiredError(error)) {
        expect(error.authUrl).toBe('https://ollama.example.com');
      }
    }
  });

  it('reports redirected Ollama model-list requests as authentication required', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: 'https://ollama.example.com/login?next=/api/tags',
      headers: new Headers({ 'content-type': 'text/html' }),
    } as Response);

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      await listOllamaModels('https://ollama.example.com');
      throw new Error('Expected listOllamaModels to throw.');
    } catch (error) {
      expect(isOllamaAuthenticationRequiredError(error)).toBe(true);
      if (isOllamaAuthenticationRequiredError(error)) {
        expect(error.authUrl).toBe('https://ollama.example.com/login?next=/api/tags');
      }
    }
  });
});

describe('generateAssistantChatTurn', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes assistant chat through Ollama with optional node context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        model: 'qwen2.5-coder:7b',
        message: {
          content: 'Try lowering contrast slightly before pushing saturation.',
          thinking: 'Comparing likely grading directions.',
        },
      }),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await generateAssistantChatTurn('How should I tune this grade node?', {
      provider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'qwen2.5-coder:7b',
      contextSummary:
        'Focused node: Grade.\nNode type: Grade.\nGrade controls: brightness 0, contrast 1, saturation 1.',
      mode: 'context',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(requestBody.model).toBe('qwen2.5-coder:7b');
    expect(requestBody.messages[0]?.content).toContain('Focused node: Grade.');
    expect(requestBody.messages[0]?.content).toContain('How should I tune this grade node?');
    expect(result).toEqual({
      message: 'Try lowering contrast slightly before pushing saturation.',
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      thinking: 'Comparing likely grading directions.',
    });
  });

  it('passes attached images and readable file context to Ollama assistant chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        model: 'llava:latest',
        message: {
          content: 'The image and notes are attached.',
        },
      }),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const attachments: AiChatAttachment[] = [
      {
        id: 'image-1',
        name: 'reference.png',
        mimeType: 'image/png',
        size: 12,
        kind: 'image',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      },
      {
        id: 'text-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 18,
        kind: 'text',
        text: 'Use this as the key reference.',
      },
    ];

    await generateAssistantChatTurn('What is in this?', {
      provider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llava:latest',
      attachments,
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string; images?: string[] }>;
    };

    expect(requestBody.messages[0]?.images).toEqual(['aW1hZ2U=']);
    expect(requestBody.messages[0]?.content).toContain('reference.png');
    expect(requestBody.messages[0]?.content).toContain('Use this as the key reference.');
  });

  it('streams assistant thinking and reply text in real time when a callback is provided', async () => {
    const updates: Array<{ content: string; thinking: string; stage: string }> = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: createNdjsonStreamResponse([
        {
          model: 'qwen2.5-coder:7b',
          message: { thinking: 'Inspecting the attached node.\n' },
          done: false,
        },
        {
          model: 'qwen2.5-coder:7b',
          message: { content: 'Start by nudging brightness upward' },
          done: false,
        },
        {
          model: 'qwen2.5-coder:7b',
          message: { content: ' and then trim contrast slightly.' },
          done: true,
        },
      ]),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await generateAssistantChatTurn('How should I tune this grade node?', {
      provider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'qwen2.5-coder:7b',
      contextSummary: 'Focused node: Grade.',
      mode: 'context',
      onStreamUpdate: (update) => {
        updates.push(update);
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body)) as {
      stream: boolean;
      think: boolean;
    };

    expect(requestBody.stream).toBe(true);
    expect(requestBody.think).toBe(true);
    expect(
      updates.some((update) => update.thinking.includes('Inspecting the attached node.')),
    ).toBe(true);
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({
        stage: 'complete',
        content: 'Start by nudging brightness upward and then trim contrast slightly.',
      }),
    );
    expect(result).toEqual({
      message: 'Start by nudging brightness upward and then trim contrast slightly.',
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      thinking: 'Inspecting the attached node.',
    });
  });
});

describe('runOllamaToolAgent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('executes Grade preview tools and returns the staged artifact', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: createNdjsonStreamResponse([
          {
            model: 'qwen3-tools',
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'get_grade_state',
                    arguments: {},
                  },
                },
                {
                  function: {
                    name: 'preview_grade_adjustment',
                    arguments: {
                      brightness: 0.12,
                      contrast: 1.08,
                      saturation: 0.96,
                      reason: 'Protect highlights while opening the mids a little.',
                    },
                  },
                },
              ],
            },
            done: true,
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: createNdjsonStreamResponse([
          {
            model: 'qwen3-tools',
            message: {
              content: 'I staged a slightly brighter, lower-saturation preview for review.',
            },
            done: true,
          },
        ]),
      });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const node: GradeNode = {
      id: 'grade-1',
      type: NodeType.GRADE,
      name: 'Grade',
      visible: true,
      grade: { brightness: 0, contrast: 1, saturation: 1, gain: 1, gamma: 1 },
    };
    let stagedPreview: {
      values: { brightness: number; contrast: number; saturation: number };
      summary?: string;
    } | null = null;

    const result = await runOllamaToolAgent({
      endpoint: 'http://localhost:11434',
      model: 'qwen3-tools',
      prompt: 'Make this a bit brighter but keep highlights.',
      contextSummary: 'Focused node: Grade.',
      tools: createAiNodeToolHandlers(node, {
        node,
        currentFrame: 0,
        setGradePreview: (preview) => {
          stagedPreview = preview;
        },
        getGradePreview: () => stagedPreview,
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.message).toBe(
      'I staged a slightly brighter, lower-saturation preview for review.',
    );
    expect(result.artifact).toEqual({
      type: 'grade-preview',
      values: { brightness: 0.12, contrast: 1.08, saturation: 0.96 },
      summary: expect.stringContaining('Preview staged for Grade.'),
    });
    expect(stagedPreview).toEqual({
      values: { brightness: 0.12, contrast: 1.08, saturation: 0.96 },
      summary: expect.stringContaining('Protect highlights'),
    });
  });

  it('streams tool-agent thinking and final reply text while running', async () => {
    const updates: Array<{ stage: string; content: string; thinking: string }> = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: createNdjsonStreamResponse([
          {
            model: 'qwen3-tools',
            message: { thinking: 'Checking the current grade.\n' },
            done: false,
          },
          {
            model: 'qwen3-tools',
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'get_grade_state',
                    arguments: {},
                  },
                },
              ],
            },
            done: true,
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: createNdjsonStreamResponse([
          {
            model: 'qwen3-tools',
            message: { content: 'I staged a safer preview' },
            done: false,
          },
          {
            model: 'qwen3-tools',
            message: { content: ' with preserved highlights.' },
            done: true,
          },
        ]),
      });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const node: GradeNode = {
      id: 'grade-1',
      type: NodeType.GRADE,
      name: 'Grade',
      visible: true,
      grade: { brightness: 0, contrast: 1, saturation: 1, gain: 1, gamma: 1 },
    };

    const result = await runOllamaToolAgent({
      endpoint: 'http://localhost:11434',
      model: 'qwen3-tools',
      prompt: 'Make this a bit brighter but keep highlights.',
      contextSummary: 'Focused node: Grade.',
      tools: createAiNodeToolHandlers(node, {
        node,
        currentFrame: 0,
        setGradePreview: () => {},
        getGradePreview: () => null,
      }),
      onStreamUpdate: (update) => {
        updates.push(update);
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updates.some((update) => update.thinking.includes('Checking the current grade.'))).toBe(
      true,
    );
    expect(updates.some((update) => update.stage === 'tool')).toBe(true);
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({
        stage: 'complete',
        content: 'I staged a safer preview with preserved highlights.',
      }),
    );
    expect(result.message).toBe('I staged a safer preview with preserved highlights.');
    expect(result.thinking).toBe('Checking the current grade.');
  });
});
