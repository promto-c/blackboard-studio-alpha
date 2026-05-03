import type { AiProvider } from '@blackboard/types';
import { hasGeminiApiKey } from '@/utils/ai';

export type AiRouteTask =
  | 'assistantChat'
  | 'shaderGeneration'
  | 'shaderPromptTools'
  | 'imagePromptTools';

export interface AiTaskRoute {
  provider: AiProvider;
  model: string;
}

export type AiTaskRoutes = Record<AiRouteTask, AiTaskRoute>;

export interface AiRoutingPreferencesLike {
  aiTaskRoutes: AiTaskRoutes;
  geminiApiKey: string;
  openAiApiKey: string;
  openAiBaseUrl: string;
  ollamaEndpoint: string;
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const hasOpenAiApiKey = (apiKey?: string): boolean => Boolean(apiKey?.trim());

export const normalizeOpenAiBaseUrl = (value: string): string => {
  const trimmed = value.trim() || DEFAULT_OPENAI_BASE_URL;
  return trimmed.replace(/\/+$/, '');
};

export const isAiProvider = (value: unknown): value is AiProvider =>
  value === 'gemini' || value === 'ollama' || value === 'openai';

const normalizeAiTaskRoute = (value: unknown, fallback: AiTaskRoute): AiTaskRoute => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const candidate = value as Partial<AiTaskRoute>;
  return {
    provider: isAiProvider(candidate.provider) ? candidate.provider : fallback.provider,
    model: typeof candidate.model === 'string' ? candidate.model.trim() : fallback.model,
  };
};

export const DEFAULT_AI_TASK_ROUTES: AiTaskRoutes = {
  assistantChat: { provider: 'gemini', model: 'gemini-2.5-flash' },
  shaderGeneration: { provider: 'gemini', model: 'gemini-2.5-flash' },
  shaderPromptTools: { provider: 'gemini', model: 'gemini-2.5-flash' },
  imagePromptTools: { provider: 'gemini', model: 'gemini-2.5-flash' },
};

export const normalizeAiTaskRoutes = (
  value: unknown,
  fallback: AiTaskRoutes = DEFAULT_AI_TASK_ROUTES,
): AiTaskRoutes => {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<Record<AiRouteTask, unknown>>)
      : {};

  return {
    assistantChat: normalizeAiTaskRoute(candidate.assistantChat, fallback.assistantChat),
    shaderGeneration: normalizeAiTaskRoute(candidate.shaderGeneration, fallback.shaderGeneration),
    shaderPromptTools: normalizeAiTaskRoute(
      candidate.shaderPromptTools,
      fallback.shaderPromptTools,
    ),
    imagePromptTools: normalizeAiTaskRoute(candidate.imagePromptTools, fallback.imagePromptTools),
  };
};

export interface ResolvedAiTextRoute {
  provider: AiProvider;
  model: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

export const getAiTaskRouteError = (
  task: AiRouteTask,
  preferences: AiRoutingPreferencesLike,
): string | null => {
  const route = preferences.aiTaskRoutes[task];
  const trimmedModel = route.model.trim();

  if (!trimmedModel) {
    return 'Choose a model in Preferences > Integrations.';
  }

  if (route.provider === 'gemini') {
    return hasGeminiApiKey(preferences.geminiApiKey)
      ? null
      : 'Set a Gemini API key in Preferences > Integrations.';
  }

  if (route.provider === 'openai') {
    return hasOpenAiApiKey(preferences.openAiApiKey)
      ? null
      : 'Set an OpenAI API key in Preferences > Integrations.';
  }

  return preferences.ollamaEndpoint.trim()
    ? null
    : 'Set an Ollama endpoint in Preferences > Integrations.';
};

export const resolveAiTaskRoute = (
  task: AiRouteTask,
  preferences: AiRoutingPreferencesLike,
): ResolvedAiTextRoute => {
  const route = preferences.aiTaskRoutes[task];
  const error = getAiTaskRouteError(task, preferences);
  if (error) {
    throw new Error(error);
  }

  if (route.provider === 'gemini') {
    return {
      provider: 'gemini',
      model: route.model.trim(),
      geminiApiKey: preferences.geminiApiKey,
      geminiModel: route.model.trim(),
    };
  }

  if (route.provider === 'openai') {
    return {
      provider: 'openai',
      model: route.model.trim(),
      openAiApiKey: preferences.openAiApiKey.trim(),
      openAiBaseUrl: normalizeOpenAiBaseUrl(preferences.openAiBaseUrl),
      openAiModel: route.model.trim(),
    };
  }

  return {
    provider: 'ollama',
    model: route.model.trim(),
    ollamaEndpoint: preferences.ollamaEndpoint.trim(),
    ollamaModel: route.model.trim(),
  };
};
