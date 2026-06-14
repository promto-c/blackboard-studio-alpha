import type { AiProvider } from '@blackboard/types';
import { hasGeminiApiKey, hasOpenAiApiKey } from '@/utils/ai';

export type AiRouteTask =
  | 'assistantChat'
  | 'shaderGeneration'
  | 'shaderPromptTools'
  | 'imagePromptTools';

interface AiTaskRoute {
  provider: AiProvider;
  model: string;
  connectionId?: string;
}

export type AiTaskRoutes = Record<AiRouteTask, AiTaskRoute>;

interface AiRoutingPreferencesLike {
  aiTaskRoutes: AiTaskRoutes;
  integrationConnections?: AiRoutingConnection[];
  geminiApiKey: string;
  openAiApiKey: string;
  openAiBaseUrl: string;
  ollamaEndpoint: string;
}

interface AiRoutingConnection {
  id: string;
  provider: AiProvider | 'comfy';
  apiKey?: string;
  endpoint?: string;
  baseUrl?: string;
  models?: string[];
  disabledModels?: string[];
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const normalizeOpenAiBaseUrl = (value: string): string => {
  const trimmed = value.trim() || DEFAULT_OPENAI_BASE_URL;
  return trimmed.replace(/\/+$/, '');
};

const isAiProvider = (value: unknown): value is AiProvider =>
  value === 'gemini' || value === 'ollama' || value === 'openai';

const isSameModel = (first: string, second: string): boolean =>
  first.trim().toLowerCase() === second.trim().toLowerCase();

const isModelInList = (models: string[] | undefined, model: string): boolean =>
  Boolean(model.trim()) && (models ?? []).some((entry) => isSameModel(entry, model));

const normalizeAiTaskRoute = (value: unknown, fallback: AiTaskRoute): AiTaskRoute => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const candidate = value as Partial<AiTaskRoute>;
  return {
    provider: isAiProvider(candidate.provider) ? candidate.provider : fallback.provider,
    model: typeof candidate.model === 'string' ? candidate.model.trim() : fallback.model,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() : undefined,
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
  connectionId?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

const getRouteConnection = (
  route: AiTaskRoute,
  preferences: AiRoutingPreferencesLike,
): AiRoutingConnection | undefined =>
  route.connectionId
    ? preferences.integrationConnections?.find(
        (connection) =>
          connection.id === route.connectionId && connection.provider === route.provider,
      )
    : undefined;

const getOpenAiRouteBaseUrl = (route: AiTaskRoute, preferences: AiRoutingPreferencesLike): string =>
  normalizeOpenAiBaseUrl(
    getRouteConnection(route, preferences)?.baseUrl ?? preferences.openAiBaseUrl,
  );

const hasOpenAiRouteAuth = (route: AiTaskRoute, preferences: AiRoutingPreferencesLike): boolean => {
  const connection = getRouteConnection(route, preferences);
  const apiKey = connection?.apiKey ?? preferences.openAiApiKey;
  const baseUrl = normalizeOpenAiBaseUrl(connection?.baseUrl ?? preferences.openAiBaseUrl);
  return hasOpenAiApiKey(apiKey) || baseUrl !== DEFAULT_OPENAI_BASE_URL;
};

export const getAiTaskRouteError = (
  task: AiRouteTask,
  preferences: AiRoutingPreferencesLike,
): string | null => {
  const route = preferences.aiTaskRoutes[task];
  const trimmedModel = route.model.trim();

  if (!trimmedModel) {
    return 'Choose a model in Preferences > Integrations.';
  }

  if (isModelInList(getRouteConnection(route, preferences)?.disabledModels, trimmedModel)) {
    return 'Enable this model in Preferences > Integrations or choose another model.';
  }

  if (route.provider === 'gemini') {
    const connection = getRouteConnection(route, preferences);
    return hasGeminiApiKey(connection?.apiKey ?? preferences.geminiApiKey)
      ? null
      : 'Set a Gemini API key in Preferences > Integrations.';
  }

  if (route.provider === 'openai') {
    return hasOpenAiRouteAuth(route, preferences)
      ? null
      : 'Set an OpenAI API key in Preferences > Integrations.';
  }

  const connection = getRouteConnection(route, preferences);
  return (connection?.endpoint ?? preferences.ollamaEndpoint).trim()
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
    const connection = getRouteConnection(route, preferences);
    return {
      provider: 'gemini',
      model: route.model.trim(),
      ...(route.connectionId ? { connectionId: route.connectionId } : {}),
      geminiApiKey: connection?.apiKey ?? preferences.geminiApiKey,
      geminiModel: route.model.trim(),
    };
  }

  if (route.provider === 'openai') {
    const connection = getRouteConnection(route, preferences);
    return {
      provider: 'openai',
      model: route.model.trim(),
      ...(route.connectionId ? { connectionId: route.connectionId } : {}),
      openAiApiKey: (connection?.apiKey ?? preferences.openAiApiKey).trim(),
      openAiBaseUrl: getOpenAiRouteBaseUrl(route, preferences),
      openAiModel: route.model.trim(),
    };
  }

  const connection = getRouteConnection(route, preferences);
  return {
    provider: 'ollama',
    model: route.model.trim(),
    ...(route.connectionId ? { connectionId: route.connectionId } : {}),
    ollamaEndpoint: (connection?.endpoint ?? preferences.ollamaEndpoint).trim(),
    ollamaModel: route.model.trim(),
  };
};
