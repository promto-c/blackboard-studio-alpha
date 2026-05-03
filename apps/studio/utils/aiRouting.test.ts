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

  it('resolves an openai route with provider-specific settings', () => {
    const route = resolveAiTaskRoute('assistantChat', {
      aiTaskRoutes: {
        ...DEFAULT_AI_TASK_ROUTES,
        assistantChat: {
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      },
      geminiApiKey: '',
      openAiApiKey: 'sk-test',
      openAiBaseUrl: 'https://api.openai.com/v1/',
      ollamaEndpoint: 'http://localhost:11434',
    });

    expect(route).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
      openAiApiKey: 'sk-test',
      openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
      openAiModel: 'gpt-5-mini',
    });
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
        geminiApiKey: '',
        openAiApiKey: '',
        openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
        ollamaEndpoint: '',
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
        geminiApiKey: '',
        openAiApiKey: '',
        openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
        ollamaEndpoint: 'http://localhost:11434',
      }),
    ).toBe('Set an OpenAI API key in Preferences > Integrations.');
  });

  it('normalizes openai base urls by trimming trailing slashes', () => {
    expect(normalizeOpenAiBaseUrl(' https://api.openai.com/v1/// ')).toBe(DEFAULT_OPENAI_BASE_URL);
  });
});
