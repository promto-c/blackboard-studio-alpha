import type { AiProvider } from '@blackboard/types';

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
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

export const normalizeOpenAiBaseUrl = (value: string): string => {
  const trimmed = value.trim() || DEFAULT_OPENAI_BASE_URL;
  return trimmed.replace(/\/+$/, '');
};

const isAiProvider = (value: unknown): value is AiProvider =>
  value === 'ollama' || value === 'openai';

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
  assistantChat: { provider: 'ollama', model: '' },
  shaderGeneration: { provider: 'ollama', model: '' },
  shaderPromptTools: { provider: 'ollama', model: '' },
  imagePromptTools: { provider: 'ollama', model: '' },
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
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

interface AiRoutingPreferencesLike {
  aiTaskRoutes: AiTaskRoutes;
  integrationConnections?: AiRoutingConnection[];
}

const getDefaultProviderConnection = (
  provider: AiProvider,
  preferences: AiRoutingPreferencesLike,
): AiRoutingConnection | undefined =>
  preferences.integrationConnections?.find((connection) => connection.provider === provider);

const getRouteConnection = (
  route: AiTaskRoute,
  preferences: AiRoutingPreferencesLike,
): AiRoutingConnection | undefined =>
  route.connectionId
    ? preferences.integrationConnections?.find(
        (connection) =>
          connection.id === route.connectionId && connection.provider === route.provider,
      )
    : getDefaultProviderConnection(route.provider, preferences);

const getOpenAiRouteBaseUrl = (
  route: AiTaskRoute,
  preferences: AiRoutingPreferencesLike,
): string => {
  const connection = getRouteConnection(route, preferences);
  const baseUrl = connection?.baseUrl || connection?.endpoint || undefined;
  return normalizeOpenAiBaseUrl(baseUrl ?? DEFAULT_OPENAI_BASE_URL);
};

const hasOpenAiRouteAuth = (route: AiTaskRoute, preferences: AiRoutingPreferencesLike): boolean => {
  const connection = getRouteConnection(route, preferences);
  // Also search for a default OpenAI connection when no specific one is linked
  const apiKey = connection?.apiKey ?? getDefaultProviderConnection('openai', preferences)?.apiKey;
  const baseUrl = getOpenAiRouteBaseUrl(route, preferences);
  return Boolean(apiKey?.trim()) || baseUrl !== DEFAULT_OPENAI_BASE_URL;
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

  if (route.provider === 'openai') {
    return hasOpenAiRouteAuth(route, preferences)
      ? null
      : 'Set an OpenAI API key in Preferences > Integrations.';
  }

  const connection = getRouteConnection(route, preferences);
  return (connection?.endpoint ?? connection?.baseUrl ?? DEFAULT_OLLAMA_ENDPOINT).trim()
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

  if (route.provider === 'openai') {
    const connection = getRouteConnection(route, preferences);
    return {
      provider: 'openai',
      model: route.model.trim(),
      ...(route.connectionId ? { connectionId: route.connectionId } : {}),
      openAiApiKey: (
        connection?.apiKey ??
        getDefaultProviderConnection('openai', preferences)?.apiKey ??
        ''
      ).trim(),
      openAiBaseUrl: getOpenAiRouteBaseUrl(route, preferences),
      openAiModel: route.model.trim(),
    };
  }

  const connection = getRouteConnection(route, preferences);
  return {
    provider: 'ollama',
    model: route.model.trim(),
    ...(route.connectionId ? { connectionId: route.connectionId } : {}),
    ollamaEndpoint: (connection?.endpoint ?? DEFAULT_OLLAMA_ENDPOINT).trim(),
    ollamaModel: route.model.trim(),
  };
};

/**
 * Get the ComfyUI endpoint from the first comfy connection in preferences.
 * Falls back to the default endpoint when no comfy connection is configured.
 */
export const getComfyEndpoint = (prefs: {
  integrationConnections?: Array<{ provider: string; endpoint?: string }>;
}): string => {
  const connection = prefs.integrationConnections?.find((c) => c.provider === 'comfy');
  return connection?.endpoint?.trim() || 'http://127.0.0.1:8188';
};
