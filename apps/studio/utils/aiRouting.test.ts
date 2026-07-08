import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_TASK_ROUTES,
  DEFAULT_OPENAI_BASE_URL,
  getAiTaskRouteError,
  normalizeAiTaskRoutes,
  normalizeOpenAiBaseUrl,
  resolveAiTaskRoute,
} from './aiRouting';

describe('ai routing', () => {
  it('normalizes missing routes back to defaults', () => {
    expect(normalizeAiTaskRoutes(undefined)).toEqual(DEFAULT_AI_TASK_ROUTES);
  });

  it('resolves an openai route with provider-specific settings from a connection', () => {
    const route = resolveAiTaskRoute('assistantChat', {
      aiTaskRoutes: {
        ...DEFAULT_AI_TASK_ROUTES,
        assistantChat: {
          provider: 'openai',
          connectionId: 'openai-default',
          model: 'gpt-5-mini',
        },
      },
      integrationConnections: [
        {
          id: 'openai-default',
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: DEFAULT_OPENAI_BASE_URL,
        },
      ],
    });

    expect(route).toEqual({
      provider: 'openai',
      connectionId: 'openai-default',
      model: 'gpt-5-mini',
      openAiApiKey: 'sk-test',
      openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
      openAiModel: 'gpt-5-mini',
    });
  });

  it('resolves a route through its selected connection', () => {
    const route = resolveAiTaskRoute('assistantChat', {
      aiTaskRoutes: {
        ...DEFAULT_AI_TASK_ROUTES,
        assistantChat: {
          provider: 'ollama',
          connectionId: 'ollama-remote',
          model: 'qwen2.5-coder:14b',
        },
      },
      integrationConnections: [
        {
          id: 'ollama-local',
          provider: 'ollama',
          endpoint: 'http://localhost:11434',
        },
        {
          id: 'ollama-remote',
          provider: 'ollama',
          endpoint: 'http://studio-box.local:11434',
        },
      ],
    });

    expect(route).toEqual({
      provider: 'ollama',
      connectionId: 'ollama-remote',
      model: 'qwen2.5-coder:14b',
      ollamaEndpoint: 'http://studio-box.local:11434',
      ollamaModel: 'qwen2.5-coder:14b',
    });
  });

  it('allows compatible OpenAI endpoints without an API key', () => {
    expect(
      getAiTaskRouteError('assistantChat', {
        aiTaskRoutes: {
          ...DEFAULT_AI_TASK_ROUTES,
          assistantChat: {
            provider: 'openai',
            connectionId: 'local-openai',
            model: 'local-coder',
          },
        },
        integrationConnections: [
          {
            id: 'local-openai',
            provider: 'openai',
            baseUrl: 'http://localhost:8000/v1',
          },
        ],
      }),
    ).toBeNull();
  });

  it('blocks disabled connection models', () => {
    const preferences = {
      aiTaskRoutes: {
        ...DEFAULT_AI_TASK_ROUTES,
        assistantChat: {
          provider: 'ollama' as const,
          connectionId: 'ollama-local',
          model: 'qwen2.5-coder:14b',
        },
      },
      integrationConnections: [
        {
          id: 'ollama-local',
          provider: 'ollama' as const,
          endpoint: 'http://localhost:11434',
          disabledModels: ['qwen2.5-coder:14b'],
        },
      ],
    };

    expect(getAiTaskRouteError('assistantChat', preferences)).toBe(
      'Enable this model in Preferences > Integrations or choose another model.',
    );
    expect(() => resolveAiTaskRoute('assistantChat', preferences)).toThrow(
      'Enable this model in Preferences > Integrations or choose another model.',
    );
  });

  it('reports missing model and provider credentials clearly', () => {
    expect(
      getAiTaskRouteError('shaderGeneration', {
        aiTaskRoutes: {
          ...DEFAULT_AI_TASK_ROUTES,
          shaderGeneration: {
            provider: 'ollama',
            model: '',
          },
        },
      }),
    ).toBe('Choose a model in Preferences > Integrations.');

    expect(
      getAiTaskRouteError('assistantChat', {
        aiTaskRoutes: {
          ...DEFAULT_AI_TASK_ROUTES,
          assistantChat: {
            provider: 'openai',
            model: 'gpt-5-mini',
          },
        },
      }),
    ).toBe('Set an OpenAI API key in Preferences > Integrations.');
  });

  it('normalizes openai base urls by trimming trailing slashes', () => {
    expect(normalizeOpenAiBaseUrl(' https://api.openai.com/v1/// ')).toBe(DEFAULT_OPENAI_BASE_URL);
  });
});
