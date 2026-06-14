import React from 'react';
import * as Icons from '@blackboard/icons';
import { Slider } from '@/components';
import { StyledDropdown, ToggleSwitch } from '@blackboard/ui';
import {
  AgentMaxSubagentSpawns,
  type IntegrationConnection,
  type IntegrationConnectionProviderId,
} from '@/state/preferences';
import { usePreferences } from '@/state/preferencesContext';
import {
  DEFAULT_COMFY_ENDPOINT,
  normalizeComfyEndpoint,
  testComfyConnection,
} from '@/services/comfy/client';
import {
  DEFAULT_AI_TASK_ROUTES,
  DEFAULT_OPENAI_BASE_URL,
  normalizeOpenAiBaseUrl,
  type AiRouteTask,
  type AiTaskRoutes,
} from '@/utils/aiRouting';
import {
  hasGeminiApiKey,
  hasOpenAiApiKey,
  isOllamaAuthenticationRequiredError,
  listOllamaModels,
  testOpenAiConnection,
  type OllamaModelSummary,
} from '@/utils/ai';
import { isNonEmptyString } from '@/utils/guards';
import type { AiProvider } from '@blackboard/types';

type ConnectionState = 'idle' | 'checking' | 'connected' | 'error';
type AiConnection = IntegrationConnection & { provider: AiProvider };
type ConnectionPatch = Partial<Omit<IntegrationConnection, 'id' | 'provider'>>;

interface ProviderMeta {
  id: IntegrationConnectionProviderId;
  title: string;
  shortTitle: string;
  description: string;
  category: 'ai' | 'render';
  icon: React.ComponentType<{ className?: string }>;
  accentClassName: string;
}

interface OllamaConnectionStatus {
  models: OllamaModelSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  authUrl: string | null;
}

interface ModelCatalogItem {
  connectionId: string;
  provider: AiProvider;
  connectionName: string;
  model: string;
  source: 'discovered' | 'configured' | 'current';
  detail?: string;
}

interface ConnectionModelRow {
  model: string;
  source: 'discovered' | 'configured';
  detail?: string;
  tags?: string[];
}

const baseFieldClassName =
  'block w-full min-w-0 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition placeholder:text-gray-500 focus:border-primary-400/40 focus:ring-2 focus:ring-primary-500/20';

const PROVIDER_ORDER: IntegrationConnectionProviderId[] = ['ollama', 'openai', 'gemini', 'comfy'];
const AI_PROVIDERS: AiProvider[] = ['ollama', 'openai', 'gemini'];
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

const providerMeta: Record<IntegrationConnectionProviderId, ProviderMeta> = {
  ollama: {
    id: 'ollama',
    title: 'Ollama',
    shortTitle: 'Ollama',
    description: 'Local models from a desktop or workstation endpoint.',
    category: 'ai',
    icon: Icons.ComputerDesktop,
    accentClassName: 'bg-emerald-400/10 text-emerald-100 ring-emerald-300/15',
  },
  openai: {
    id: 'openai',
    title: 'OpenAI API',
    shortTitle: 'OpenAI',
    description: 'OpenAI Responses API or a compatible /v1 server.',
    category: 'ai',
    icon: Icons.Sparkles,
    accentClassName: 'bg-sky-400/10 text-sky-100 ring-sky-300/15',
  },
  gemini: {
    id: 'gemini',
    title: 'Gemini',
    shortTitle: 'Gemini',
    description: 'Google Gemini text and prompt tooling.',
    category: 'ai',
    icon: Icons.LightBulb,
    accentClassName: 'bg-amber-400/10 text-amber-100 ring-amber-300/15',
  },
  comfy: {
    id: 'comfy',
    title: 'ComfyUI',
    shortTitle: 'Comfy',
    description: 'Workflow execution backend for Comfy nodes.',
    category: 'render',
    icon: Icons.CubeTransparent,
    accentClassName: 'bg-fuchsia-400/10 text-fuchsia-100 ring-fuchsia-300/15',
  },
};

const aiRouteMeta: {
  id: AiRouteTask;
  title: string;
  description: string;
}[] = [
  {
    id: 'assistantChat',
    title: 'Assistant Chat',
    description: 'General assistant conversations and node-aware help.',
  },
  {
    id: 'shaderGeneration',
    title: 'Shader Generation',
    description: 'Shader chat and Generate Shader requests.',
  },
  {
    id: 'shaderPromptTools',
    title: 'Shader Prompt Tools',
    description: 'Suggest and enhance shader prompt drafts.',
  },
  {
    id: 'imagePromptTools',
    title: 'Image Prompt Tools',
    description: 'Suggest and enhance image and Comfy prompt text.',
  },
];

const defaultModelsByProvider: Record<AiProvider, string[]> = {
  ollama: [],
  openai: ['gpt-5-mini', 'gpt-5'],
  gemini: [DEFAULT_AI_TASK_ROUTES.assistantChat.model, 'gemini-2.5-pro'],
};

const agentDelegationTickLabels = [
  { value: AgentMaxSubagentSpawns.MIN, label: 'Off' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 6, label: '6' },
  { value: AgentMaxSubagentSpawns.MAX, label: String(AgentMaxSubagentSpawns.MAX) },
];

function StatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  className?: string;
}) {
  const toneClassName =
    tone === 'success'
      ? 'border-green-400/20 bg-green-500/10 text-green-100'
      : tone === 'warning'
        ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
        : tone === 'danger'
          ? 'border-red-400/20 bg-red-500/10 text-red-100'
          : tone === 'accent'
            ? 'border-primary-400/20 bg-primary-500/10 text-primary-100'
            : 'border-white/10 bg-white/[0.05] text-gray-300';

  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClassName} ${className ?? ''}`}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
  tone = 'neutral',
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
}) {
  const toneClassName =
    tone === 'primary'
      ? 'border-primary-300/25 bg-primary-500/15 text-primary-100 hover:border-primary-200/35 hover:bg-primary-500/20'
      : tone === 'danger'
        ? 'border-red-300/20 bg-red-500/10 text-red-100 hover:border-red-300/35 hover:bg-red-500/15'
        : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30 disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName}`}
    >
      {icon}
    </button>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-gray-400">
      {children}
    </label>
  );
}

function IntegrationTroubleshooting({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-xs text-amber-50">
      <div className="flex items-center gap-2 font-medium">
        <Icons.ExclamationCircle className="h-4 w-4 shrink-0" />
        <span>{title}</span>
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-4 leading-5 text-amber-100/90">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

const isAiProvider = (provider: IntegrationConnectionProviderId): provider is AiProvider =>
  provider === 'ollama' || provider === 'openai' || provider === 'gemini';

const isAiConnection = (connection: IntegrationConnection): connection is AiConnection =>
  isAiProvider(connection.provider);

const getProviderLabel = (provider: IntegrationConnectionProviderId): string =>
  providerMeta[provider].shortTitle;

const getOllamaModelCapabilityTags = (model: OllamaModelSummary) =>
  (model.capabilities ?? []).filter((capability) => capability !== 'completion');

const getOllamaModelDetailLabel = (model: OllamaModelSummary) =>
  [model.details?.parameter_size, model.details?.quantization_level]
    .filter(isNonEmptyString)
    .join(' · ');

const normalizeModelName = (value: string): string => value.trim();

const getModelIdentity = (model: string): string => normalizeModelName(model).toLowerCase();

const isSameModel = (first: string, second: string): boolean =>
  getModelIdentity(first) === getModelIdentity(second);

const isModelInList = (models: string[] | undefined, model: string): boolean => {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) return false;
  return (models ?? []).some((entry) => isSameModel(entry, normalizedModel));
};

const addModelToList = (models: string[] | undefined, model: string): string[] => {
  const normalizedModel = normalizeModelName(model);
  const currentModels = models ?? [];
  if (!normalizedModel || isModelInList(currentModels, normalizedModel)) return currentModels;
  return [...currentModels, normalizedModel];
};

const removeModelFromList = (models: string[] | undefined, model: string): string[] =>
  (models ?? []).filter((entry) => !isSameModel(entry, model));

const isConnectionModelEnabled = (connection: IntegrationConnection, model: string): boolean => {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel || isModelInList(connection.disabledModels, normalizedModel)) return false;
  if (connection.provider === 'ollama') return true;
  return isModelInList(connection.models, normalizedModel);
};

const getConnectionModelRows = (
  connection: IntegrationConnection,
  ollamaState: OllamaConnectionStatus | undefined,
): ConnectionModelRow[] => {
  if (!isAiProvider(connection.provider)) return [];

  const rows = new Map<string, ConnectionModelRow>();
  const addRow = (row: ConnectionModelRow) => {
    const model = normalizeModelName(row.model);
    if (!model) return;
    const key = getModelIdentity(model);
    const existingRow = rows.get(key);
    if (existingRow && existingRow.source === 'discovered') return;
    rows.set(key, { ...row, model });
  };

  if (connection.provider === 'ollama') {
    (ollamaState?.models ?? []).forEach((model) => {
      addRow({
        model: model.model,
        source: 'discovered',
        detail: getOllamaModelDetailLabel(model),
        tags: getOllamaModelCapabilityTags(model).slice(0, 3),
      });
    });
  }

  (connection.models ?? []).forEach((model) => {
    addRow({ model, source: 'configured' });
  });

  (connection.disabledModels ?? []).forEach((model) => {
    addRow({ model, source: 'configured', detail: 'Disabled' });
  });

  return [...rows.values()];
};

const getEnabledConnectionModels = (
  connection: IntegrationConnection,
  ollamaState: OllamaConnectionStatus | undefined,
): string[] =>
  getConnectionModelRows(connection, ollamaState)
    .filter((row) => isConnectionModelEnabled(connection, row.model))
    .map((row) => row.model);

function ModelToggleRow({
  row,
  provider,
  enabled,
  onToggle,
  onRemove,
}: {
  row: ConnectionModelRow;
  provider: AiProvider;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  onRemove?: () => void;
}) {
  const sourceLabel =
    row.source === 'discovered' ? 'Discovered' : provider === 'ollama' ? 'Pinned' : 'Configured';
  const detailItems = [row.detail, ...(row.tags ?? [])].filter(isNonEmptyString);

  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-2.5 py-2 transition ${
        enabled
          ? 'border-white/10 bg-white/[0.035]'
          : 'border-white/[0.07] bg-black/20 text-gray-500'
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={`min-w-0 truncate font-mono text-xs ${
              enabled ? 'text-gray-100' : 'text-gray-500'
            }`}
            title={row.model}
          >
            {row.model}
          </span>
          <StatusBadge tone={row.source === 'discovered' ? 'success' : 'neutral'}>
            {sourceLabel}
          </StatusBadge>
        </div>
        {detailItems.length > 0 ? (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-4 text-gray-500">
            {detailItems.map((detail) => (
              <span key={detail} className="min-w-0 truncate">
                {detail}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${row.model}`}
            title="Remove model"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-gray-400 transition hover:border-red-300/25 hover:bg-red-500/10 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
          >
            <Icons.XMark className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ToggleSwitch
          checked={enabled}
          onCheckedChange={onToggle}
          size="sm"
          ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${row.model}`}
          title={enabled ? 'Disable model' : 'Enable model'}
          trackClassName={
            enabled
              ? 'border border-primary-300/30 bg-primary-500/50'
              : 'border border-white/10 bg-white/10'
          }
          thumbClassName="shadow-sm"
        />
      </div>
    </div>
  );
}

function ConnectionModelsEditor({
  connection,
  ollamaState,
  modelDraft,
  onModelDraftChange,
  onAddModel,
  onToggleModel,
  onRemoveModel,
}: {
  connection: AiConnection;
  ollamaState: OllamaConnectionStatus | undefined;
  modelDraft: string;
  onModelDraftChange: (connectionId: string, value: string) => void;
  onAddModel: (connectionId: string) => void;
  onToggleModel: (
    connectionId: string,
    model: string,
    checked: boolean,
    persistModel: boolean,
  ) => void;
  onRemoveModel: (connectionId: string, model: string) => void;
}) {
  const modelRows = getConnectionModelRows(connection, ollamaState);
  const enabledCount = modelRows.filter((row) =>
    isConnectionModelEnabled(connection, row.model),
  ).length;
  const draft = modelDraft ?? '';
  const canAddModel = Boolean(normalizeModelName(draft));
  const draftInputId = `${connection.id}-model-draft`;

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-gray-400">Models</span>
          <StatusBadge tone={enabledCount > 0 ? 'accent' : 'neutral'}>
            {enabledCount} on
          </StatusBadge>
          {connection.provider === 'ollama' && ollamaState?.loading ? (
            <StatusBadge tone="warning">Syncing</StatusBadge>
          ) : null}
          {connection.provider === 'ollama' && ollamaState?.loaded && !ollamaState.error ? (
            <StatusBadge tone="neutral">{ollamaState.models.length} discovered</StatusBadge>
          ) : null}
        </div>
      </div>

      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {modelRows.length > 0 ? (
          modelRows.map((row) => {
            const enabled = isConnectionModelEnabled(connection, row.model);
            return (
              <ModelToggleRow
                key={getModelIdentity(row.model)}
                row={row}
                provider={connection.provider}
                enabled={enabled}
                onToggle={(checked) =>
                  onToggleModel(connection.id, row.model, checked, row.source !== 'discovered')
                }
                onRemove={
                  row.source === 'configured'
                    ? () => onRemoveModel(connection.id, row.model)
                    : undefined
                }
              />
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-gray-500">
            No models discovered or pinned yet.
          </div>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          id={draftInputId}
          value={draft}
          onChange={(event) => onModelDraftChange(connection.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (canAddModel) onAddModel(connection.id);
          }}
          className={`${baseFieldClassName} font-mono`}
          placeholder={connection.provider === 'ollama' ? 'Pin model name' : 'Add model name'}
          aria-label="Add model name"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => onAddModel(connection.id)}
          disabled={!canAddModel}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icons.Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}

const createConnectionId = (
  provider: IntegrationConnectionProviderId,
  existingConnections: IntegrationConnection[],
): string => {
  const prefix = `${provider}-${Date.now().toString(36)}`;
  let index = 1;
  let id = `${prefix}-${index}`;
  while (existingConnections.some((connection) => connection.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
};

const getConnectionNumber = (
  provider: IntegrationConnectionProviderId,
  existingConnections: IntegrationConnection[],
): number =>
  existingConnections.filter((connection) => connection.provider === provider).length + 1;

const getDefaultConnectionName = (
  provider: IntegrationConnectionProviderId,
  existingConnections: IntegrationConnection[],
): string => {
  const count = getConnectionNumber(provider, existingConnections);
  const baseName =
    provider === 'openai'
      ? 'OpenAI API'
      : provider === 'comfy'
        ? 'ComfyUI'
        : providerMeta[provider].title;
  return count === 1 ? baseName : `${baseName} ${count}`;
};

const createConnection = ({
  provider,
  existingConnections,
  legacy,
}: {
  provider: IntegrationConnectionProviderId;
  existingConnections: IntegrationConnection[];
  legacy: {
    geminiApiKey: string;
    openAiApiKey: string;
    openAiBaseUrl: string;
    ollamaEndpoint: string;
    comfyEndpoint: string;
  };
}): IntegrationConnection => ({
  id: createConnectionId(provider, existingConnections),
  provider,
  name: getDefaultConnectionName(provider, existingConnections),
  apiKey:
    provider === 'gemini'
      ? legacy.geminiApiKey
      : provider === 'openai'
        ? legacy.openAiApiKey
        : undefined,
  baseUrl: provider === 'openai' ? normalizeOpenAiBaseUrl(legacy.openAiBaseUrl) : undefined,
  endpoint:
    provider === 'ollama'
      ? legacy.ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT
      : provider === 'comfy'
        ? normalizeComfyEndpoint(legacy.comfyEndpoint)
        : undefined,
  models: isAiProvider(provider) ? defaultModelsByProvider[provider] : [],
});

const inferLegacyConnections = ({
  geminiApiKey,
  openAiApiKey,
  openAiBaseUrl,
  ollamaEndpoint,
  comfyEndpoint,
}: {
  geminiApiKey: string;
  openAiApiKey: string;
  openAiBaseUrl: string;
  ollamaEndpoint: string;
  comfyEndpoint: string;
}): IntegrationConnection[] => {
  const inferred: IntegrationConnection[] = [];
  const addInferred = (connection: IntegrationConnection) => {
    inferred.push({ ...connection, id: `legacy-${connection.provider}` });
  };

  if (geminiApiKey.trim()) {
    addInferred({
      id: '',
      provider: 'gemini',
      name: 'Gemini',
      apiKey: geminiApiKey.trim(),
      models: defaultModelsByProvider.gemini,
    });
  }

  if (openAiApiKey.trim() || normalizeOpenAiBaseUrl(openAiBaseUrl) !== DEFAULT_OPENAI_BASE_URL) {
    addInferred({
      id: '',
      provider: 'openai',
      name: 'OpenAI API',
      apiKey: openAiApiKey.trim(),
      baseUrl: normalizeOpenAiBaseUrl(openAiBaseUrl),
      models: defaultModelsByProvider.openai,
    });
  }

  if (ollamaEndpoint.trim() && ollamaEndpoint.trim() !== DEFAULT_OLLAMA_ENDPOINT) {
    addInferred({
      id: '',
      provider: 'ollama',
      name: 'Ollama',
      endpoint: ollamaEndpoint.trim(),
      models: [],
    });
  }

  if (normalizeComfyEndpoint(comfyEndpoint) !== DEFAULT_COMFY_ENDPOINT) {
    addInferred({
      id: '',
      provider: 'comfy',
      name: 'ComfyUI',
      endpoint: normalizeComfyEndpoint(comfyEndpoint),
      models: [],
    });
  }

  return inferred;
};

const getConnectionEndpoint = (connection: IntegrationConnection): string =>
  connection.provider === 'openai'
    ? normalizeOpenAiBaseUrl(connection.baseUrl || DEFAULT_OPENAI_BASE_URL)
    : connection.provider === 'ollama'
      ? connection.endpoint?.trim() || DEFAULT_OLLAMA_ENDPOINT
      : connection.provider === 'comfy'
        ? normalizeComfyEndpoint(connection.endpoint || DEFAULT_COMFY_ENDPOINT)
        : '';

const isOpenAiConnectionConfigured = (connection: IntegrationConnection): boolean =>
  hasOpenAiApiKey(connection.apiKey) ||
  normalizeOpenAiBaseUrl(connection.baseUrl || DEFAULT_OPENAI_BASE_URL) !== DEFAULT_OPENAI_BASE_URL;

const getConnectionModelCount = (
  connection: IntegrationConnection,
  ollamaState: OllamaConnectionStatus | undefined,
): number => {
  if (!isAiProvider(connection.provider)) return 0;
  return getEnabledConnectionModels(connection, ollamaState).length;
};

const encodeModelValue = (connectionId: string, model: string): string =>
  `${connectionId}|${model}`;

const decodeModelValue = (value: string): { connectionId: string; model: string } | null => {
  const separatorIndex = value.indexOf('|');
  if (separatorIndex === -1) return null;
  return {
    connectionId: value.slice(0, separatorIndex),
    model: value.slice(separatorIndex + 1),
  };
};

const getModelKey = (connectionId: string, model: string): string =>
  `${connectionId}:${model.trim().toLowerCase()}`;

const buildModelCatalog = ({
  connections,
  aiTaskRoutes,
  ollamaStates,
}: {
  connections: IntegrationConnection[];
  aiTaskRoutes: AiTaskRoutes;
  ollamaStates: Record<string, OllamaConnectionStatus>;
}): ModelCatalogItem[] => {
  const items = new Map<string, ModelCatalogItem>();

  const addItem = (item: ModelCatalogItem) => {
    const model = item.model.trim();
    if (!model) return;
    const key = getModelKey(item.connectionId, model);
    if (items.has(key)) return;
    items.set(key, { ...item, model });
  };

  connections.forEach((connection) => {
    if (!isAiProvider(connection.provider)) return;
    const aiConnection = connection as AiConnection;
    const configuredModels = connection.models ?? [];
    configuredModels.forEach((model) => {
      if (isModelInList(connection.disabledModels, model)) return;
      addItem({
        connectionId: connection.id,
        provider: aiConnection.provider,
        connectionName: connection.name,
        model,
        source: 'configured',
      });
    });

    if (connection.provider === 'ollama') {
      (ollamaStates[connection.id]?.models ?? []).forEach((model) => {
        if (isModelInList(connection.disabledModels, model.model)) return;
        addItem({
          connectionId: connection.id,
          provider: 'ollama',
          connectionName: connection.name,
          model: model.model,
          source: 'discovered',
          detail: getOllamaModelDetailLabel(model),
        });
      });
    }
  });

  Object.values(aiTaskRoutes).forEach((route) => {
    if (!route.connectionId || !route.model.trim()) return;
    const connection = connections.find((candidate) => candidate.id === route.connectionId);
    if (!connection || !isAiProvider(connection.provider)) return;
    if (!isConnectionModelEnabled(connection, route.model)) return;
    addItem({
      connectionId: connection.id,
      provider: connection.provider,
      connectionName: connection.name,
      model: route.model,
      source: 'current',
    });
  });

  return [...items.values()].sort((first, second) => {
    const providerDelta =
      AI_PROVIDERS.indexOf(first.provider) - AI_PROVIDERS.indexOf(second.provider);
    if (providerDelta !== 0) return providerDelta;
    const connectionDelta = first.connectionName.localeCompare(second.connectionName);
    return connectionDelta === 0 ? first.model.localeCompare(second.model) : connectionDelta;
  });
};

function IntegrationsPreferences() {
  const {
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
    aiTaskRoutes,
    integrationConnections,
    agentMaxSubagentSpawns,
    comfyEndpoint,
    setPreferences,
  } = usePreferences();
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [expandedConnectionId, setExpandedConnectionId] = React.useState<string | null>(null);
  const [ollamaStates, setOllamaStates] = React.useState<Record<string, OllamaConnectionStatus>>(
    {},
  );
  const [ollamaRefreshToken, setOllamaRefreshToken] = React.useState(0);
  const [openAiConnectionStates, setOpenAiConnectionStates] = React.useState<
    Record<string, { state: ConnectionState; error: string | null }>
  >({});
  const [comfyConnectionStates, setComfyConnectionStates] = React.useState<
    Record<string, { state: ConnectionState; error: string | null }>
  >({});
  const [modelDrafts, setModelDrafts] = React.useState<Record<string, string>>({});

  const legacyConnections = React.useMemo(
    () =>
      inferLegacyConnections({
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
        comfyEndpoint,
      }),
    [comfyEndpoint, geminiApiKey, ollamaEndpoint, openAiApiKey, openAiBaseUrl],
  );
  const connections =
    integrationConnections.length > 0 ? integrationConnections : legacyConnections;
  const aiConnections = connections.filter(isAiConnection);

  const saveConnections = React.useCallback(
    (nextConnections: IntegrationConnection[]) => {
      const firstGemini = nextConnections.find((connection) => connection.provider === 'gemini');
      const firstOpenAi = nextConnections.find((connection) => connection.provider === 'openai');
      const firstOllama = nextConnections.find((connection) => connection.provider === 'ollama');
      const firstComfy = nextConnections.find((connection) => connection.provider === 'comfy');

      setPreferences({
        integrationConnections: nextConnections,
        ...(firstGemini ? { geminiApiKey: firstGemini.apiKey ?? '' } : {}),
        ...(firstOpenAi
          ? {
              openAiApiKey: firstOpenAi.apiKey ?? '',
              openAiBaseUrl: normalizeOpenAiBaseUrl(firstOpenAi.baseUrl || DEFAULT_OPENAI_BASE_URL),
            }
          : {}),
        ...(firstOllama ? { ollamaEndpoint: getConnectionEndpoint(firstOllama) } : {}),
        ...(firstComfy ? { comfyEndpoint: getConnectionEndpoint(firstComfy) } : {}),
      });
    },
    [setPreferences],
  );

  const updateConnection = React.useCallback(
    (connectionId: string, patch: ConnectionPatch) => {
      saveConnections(
        connections.map((connection) =>
          connection.id === connectionId ? { ...connection, ...patch } : connection,
        ),
      );
    },
    [connections, saveConnections],
  );

  const updateModelDraft = React.useCallback((connectionId: string, value: string) => {
    setModelDrafts((current) => ({ ...current, [connectionId]: value }));
  }, []);

  const addConnectionModel = React.useCallback(
    (connectionId: string) => {
      const connection = connections.find((candidate) => candidate.id === connectionId);
      if (!connection || !isAiProvider(connection.provider)) return;

      const model = normalizeModelName(modelDrafts[connectionId] ?? '');
      if (!model) return;

      updateConnection(connectionId, {
        models: addModelToList(connection.models, model),
        disabledModels: removeModelFromList(connection.disabledModels, model),
      });
      setModelDrafts((current) => ({ ...current, [connectionId]: '' }));
    },
    [connections, modelDrafts, updateConnection],
  );

  const toggleConnectionModel = React.useCallback(
    (connectionId: string, model: string, checked: boolean, persistModel: boolean) => {
      const connection = connections.find((candidate) => candidate.id === connectionId);
      if (!connection || !isAiProvider(connection.provider)) return;

      updateConnection(connectionId, {
        models:
          persistModel || connection.provider !== 'ollama'
            ? addModelToList(connection.models, model)
            : (connection.models ?? []),
        disabledModels: checked
          ? removeModelFromList(connection.disabledModels, model)
          : addModelToList(connection.disabledModels, model),
      });
    },
    [connections, updateConnection],
  );

  const removeConnectionModel = React.useCallback(
    (connectionId: string, model: string) => {
      const connection = connections.find((candidate) => candidate.id === connectionId);
      if (!connection || !isAiProvider(connection.provider)) return;

      updateConnection(connectionId, {
        models: removeModelFromList(connection.models, model),
        disabledModels: removeModelFromList(connection.disabledModels, model),
      });

      let routesChanged = false;
      const nextRoutes = Object.fromEntries(
        aiRouteMeta.map((routeMeta) => {
          const route = aiTaskRoutes[routeMeta.id];
          if (route.connectionId === connectionId && isSameModel(route.model, model)) {
            routesChanged = true;
            return [routeMeta.id, { ...route, connectionId: undefined, model: '' }];
          }
          return [routeMeta.id, route];
        }),
      ) as AiTaskRoutes;

      if (routesChanged) {
        setPreferences({ aiTaskRoutes: nextRoutes });
      }
    },
    [aiTaskRoutes, connections, setPreferences, updateConnection],
  );

  const removeConnection = React.useCallback(
    (connectionId: string) => {
      const nextConnections = connections.filter((connection) => connection.id !== connectionId);
      const removedConnection = connections.find((connection) => connection.id === connectionId);
      const nextRoutes = Object.fromEntries(
        aiRouteMeta.map((routeMeta) => {
          const route = aiTaskRoutes[routeMeta.id];
          return [
            routeMeta.id,
            route.connectionId === connectionId ? { ...route, connectionId: undefined } : route,
          ];
        }),
      ) as AiTaskRoutes;

      saveConnections(nextConnections);
      setPreferences({ aiTaskRoutes: nextRoutes });

      if (expandedConnectionId === connectionId) {
        setExpandedConnectionId(nextConnections[0]?.id ?? null);
      }
      if (removedConnection?.provider === 'ollama') {
        setOllamaStates((current) => {
          const next = { ...current };
          delete next[connectionId];
          return next;
        });
      }
    },
    [aiTaskRoutes, connections, expandedConnectionId, saveConnections, setPreferences],
  );

  const addConnection = React.useCallback(
    (provider: IntegrationConnectionProviderId) => {
      const nextConnection = createConnection({
        provider,
        existingConnections: connections,
        legacy: {
          geminiApiKey,
          openAiApiKey,
          openAiBaseUrl,
          ollamaEndpoint,
          comfyEndpoint,
        },
      });
      saveConnections([...connections, nextConnection]);
      setExpandedConnectionId(nextConnection.id);
      setIsAddOpen(false);
    },
    [
      comfyEndpoint,
      connections,
      geminiApiKey,
      ollamaEndpoint,
      openAiApiKey,
      openAiBaseUrl,
      saveConnections,
    ],
  );

  const updateOllamaState = React.useCallback(
    (connectionId: string, patch: Partial<OllamaConnectionStatus>) => {
      setOllamaStates((current) => ({
        ...current,
        [connectionId]: {
          models: [],
          loading: false,
          loaded: false,
          error: null,
          authUrl: null,
          ...current[connectionId],
          ...patch,
        },
      }));
    },
    [],
  );

  const ollamaConnectionSignature = React.useMemo(
    () =>
      connections
        .filter((connection) => connection.provider === 'ollama')
        .map((connection) => `${connection.id}:${getConnectionEndpoint(connection)}`)
        .join('|'),
    [connections],
  );

  React.useEffect(() => {
    const ollamaConnections = connections.filter(
      (connection) => connection.provider === 'ollama' && getConnectionEndpoint(connection),
    );
    if (ollamaConnections.length === 0) return;

    const abortControllers: AbortController[] = [];
    const timeoutId = window.setTimeout(() => {
      ollamaConnections.forEach((connection) => {
        const abortController = new AbortController();
        abortControllers.push(abortController);
        updateOllamaState(connection.id, {
          loading: true,
          loaded: false,
          error: null,
          authUrl: null,
        });

        listOllamaModels(getConnectionEndpoint(connection), {
          signal: abortController.signal,
        })
          .then((models) => {
            updateOllamaState(connection.id, {
              models,
              loading: false,
              loaded: true,
              error: null,
              authUrl: null,
            });
          })
          .catch((error) => {
            if (abortController.signal.aborted) return;
            updateOllamaState(connection.id, {
              models: [],
              loading: false,
              loaded: true,
              error: error instanceof Error ? error.message : 'Failed to reach Ollama.',
              authUrl: isOllamaAuthenticationRequiredError(error) ? error.authUrl : null,
            });
          });
      });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      abortControllers.forEach((controller) => controller.abort());
    };
  }, [connections, ollamaConnectionSignature, ollamaRefreshToken, updateOllamaState]);

  const modelCatalog = React.useMemo(
    () => buildModelCatalog({ connections, aiTaskRoutes, ollamaStates }),
    [aiTaskRoutes, connections, ollamaStates],
  );

  const modelCatalogOptions = React.useMemo(
    () =>
      modelCatalog.map((item) => ({
        value: encodeModelValue(item.connectionId, item.model),
        label: item.model,
        secondaryLabel: `${item.connectionName} · ${getProviderLabel(item.provider)}${
          item.detail ? ` · ${item.detail}` : ''
        }`,
        badges: [
          getProviderLabel(item.provider),
          item.source === 'discovered'
            ? 'Discovered'
            : item.source === 'current'
              ? 'Current'
              : 'Configured',
        ],
        searchText: `${item.model} ${item.connectionName} ${getProviderLabel(item.provider)} ${item.source} ${item.detail ?? ''}`,
      })),
    [modelCatalog],
  );

  const getRouteModelValue = React.useCallback(
    (task: AiRouteTask): string => {
      const route = aiTaskRoutes[task];
      if (route.connectionId && route.model.trim()) {
        const matchingRouteItem = modelCatalog.find(
          (item) =>
            item.connectionId === route.connectionId && isSameModel(item.model, route.model),
        );
        return matchingRouteItem
          ? encodeModelValue(matchingRouteItem.connectionId, matchingRouteItem.model)
          : '';
      }
      const matchingItem = modelCatalog.find(
        (item) => item.provider === route.provider && isSameModel(item.model, route.model),
      );
      return matchingItem ? encodeModelValue(matchingItem.connectionId, matchingItem.model) : '';
    },
    [aiTaskRoutes, modelCatalog],
  );

  const updateRouteModel = React.useCallback(
    (task: AiRouteTask, value: string) => {
      const decoded = decodeModelValue(value);
      if (!decoded) return;
      const connection = connections.find((candidate) => candidate.id === decoded.connectionId);
      if (!connection || !isAiProvider(connection.provider)) return;

      setPreferences({
        aiTaskRoutes: {
          ...aiTaskRoutes,
          [task]: {
            provider: connection.provider,
            connectionId: connection.id,
            model: decoded.model,
          },
        },
      });
    },
    [aiTaskRoutes, connections, setPreferences],
  );

  const getConnectionStatus = React.useCallback(
    (
      connection: IntegrationConnection,
    ): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' } => {
      if (connection.provider === 'gemini') {
        return hasGeminiApiKey(connection.apiKey)
          ? { label: 'Configured', tone: 'success' }
          : { label: 'Needs key', tone: 'neutral' };
      }

      if (connection.provider === 'openai') {
        const state = openAiConnectionStates[connection.id];
        if (state?.state === 'checking') return { label: 'Checking', tone: 'warning' };
        if (state?.state === 'connected') return { label: 'Connected', tone: 'success' };
        if (state?.state === 'error') return { label: 'Failed', tone: 'danger' };
        return isOpenAiConnectionConfigured(connection)
          ? { label: 'Configured', tone: 'success' }
          : { label: 'Needs key', tone: 'neutral' };
      }

      if (connection.provider === 'ollama') {
        const state = ollamaStates[connection.id];
        if (state?.loading) return { label: 'Checking', tone: 'warning' };
        if (state?.error)
          return { label: state.authUrl ? 'Auth required' : 'Failed', tone: 'danger' };
        if (state?.loaded) return { label: 'Connected', tone: 'success' };
        return getConnectionEndpoint(connection)
          ? { label: 'Ready', tone: 'neutral' }
          : { label: 'Needs endpoint', tone: 'neutral' };
      }

      const state = comfyConnectionStates[connection.id];
      if (state?.state === 'checking') return { label: 'Checking', tone: 'warning' };
      if (state?.state === 'connected') return { label: 'Connected', tone: 'success' };
      if (state?.state === 'error') return { label: 'Failed', tone: 'danger' };
      return getConnectionEndpoint(connection)
        ? { label: 'Ready', tone: 'neutral' }
        : { label: 'Needs endpoint', tone: 'neutral' };
    },
    [comfyConnectionStates, ollamaStates, openAiConnectionStates],
  );

  const testOpenAi = React.useCallback(async (connection: IntegrationConnection) => {
    setOpenAiConnectionStates((current) => ({
      ...current,
      [connection.id]: { state: 'checking', error: null },
    }));
    try {
      await testOpenAiConnection(
        connection.apiKey ?? '',
        connection.baseUrl || DEFAULT_OPENAI_BASE_URL,
        getEnabledConnectionModels(connection, undefined)[0] || defaultModelsByProvider.openai[0],
      );
      setOpenAiConnectionStates((current) => ({
        ...current,
        [connection.id]: { state: 'connected', error: null },
      }));
    } catch (error) {
      setOpenAiConnectionStates((current) => ({
        ...current,
        [connection.id]: {
          state: 'error',
          error: error instanceof Error ? error.message : 'Failed to reach OpenAI.',
        },
      }));
    }
  }, []);

  const testComfy = React.useCallback(async (connection: IntegrationConnection) => {
    setComfyConnectionStates((current) => ({
      ...current,
      [connection.id]: { state: 'checking', error: null },
    }));
    try {
      await testComfyConnection(getConnectionEndpoint(connection));
      setComfyConnectionStates((current) => ({
        ...current,
        [connection.id]: { state: 'connected', error: null },
      }));
    } catch (error) {
      setComfyConnectionStates((current) => ({
        ...current,
        [connection.id]: {
          state: 'error',
          error: error instanceof Error ? error.message : 'Failed to reach ComfyUI.',
        },
      }));
    }
  }, []);

  const refreshOllama = React.useCallback(
    (connectionId: string) => {
      updateOllamaState(connectionId, {
        loading: false,
        loaded: false,
        error: null,
        authUrl: null,
      });
      setOllamaRefreshToken((token) => token + 1);
    },
    [updateOllamaState],
  );

  const studioOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const ollamaTroubleshootingSteps = [
    'Make sure Ollama is running and the endpoint is correct.',
    'If the browser console mentions CORS, allow this Studio origin in Ollama and restart it.',
    `For a shell-launched Ollama server, use: OLLAMA_ORIGINS=${studioOrigin} ollama serve`,
  ];
  const comfyTroubleshootingSteps = [
    'Make sure ComfyUI is running and the endpoint is correct.',
    'If the browser console mentions CORS, restart ComfyUI with CORS headers enabled.',
    `Common ComfyUI launch flag: --enable-cors-header ${studioOrigin}`,
  ];

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Connections</h2>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              Provider bindings for local servers, cloud APIs, and render backends.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAddOpen((isOpen) => !isOpen)}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-primary-300/25 bg-primary-500/15 px-3 text-xs font-medium text-primary-100 transition hover:border-primary-200/35 hover:bg-primary-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
          >
            <Icons.Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {isAddOpen ? (
          <div className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-2 md:grid-cols-2">
            {PROVIDER_ORDER.map((provider) => {
              const meta = providerMeta[provider];
              const Icon = meta.icon;
              return (
                <button
                  key={provider}
                  type="button"
                  onClick={() => addConnection(provider)}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset ${meta.accentClassName}`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{meta.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-gray-400">
                      {meta.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
          {connections.length === 0 ? (
            <div className="px-4 py-7 text-center text-sm text-gray-400">
              Add a connection to populate the shared model list.
            </div>
          ) : (
            connections.map((connection, index) => {
              const meta = providerMeta[connection.provider];
              const Icon = meta.icon;
              const isExpanded = expandedConnectionId === connection.id;
              const status = getConnectionStatus(connection);
              const modelCount = getConnectionModelCount(connection, ollamaStates[connection.id]);
              const openAiError = openAiConnectionStates[connection.id]?.error ?? null;
              const comfyError = comfyConnectionStates[connection.id]?.error ?? null;
              const ollamaState = ollamaStates[connection.id];
              const ollamaAuthUrl = ollamaState?.authUrl ?? null;

              return (
                <div key={connection.id} className={index === 0 ? '' : 'border-t border-white/10'}>
                  <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpandedConnectionId(isExpanded ? null : connection.id)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ${meta.accentClassName}`}
                      title={isExpanded ? 'Collapse connection' : 'Edit connection'}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedConnectionId(isExpanded ? null : connection.id)}
                      className="min-w-0 text-left"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-white">
                          {connection.name}
                        </span>
                        <StatusBadge tone="neutral">{meta.shortTitle}</StatusBadge>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        {isAiProvider(connection.provider) ? (
                          <StatusBadge tone="accent">
                            {modelCount} model{modelCount === 1 ? '' : 's'}
                          </StatusBadge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {connection.provider === 'gemini'
                          ? connection.apiKey
                            ? 'API key saved locally'
                            : 'Uses build key when available'
                          : getConnectionEndpoint(connection)}
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      {connection.provider === 'ollama' ? (
                        <IconButton
                          label="Refresh models"
                          onClick={() => refreshOllama(connection.id)}
                          disabled={ollamaState?.loading}
                          icon={<Icons.RotateLoop className="h-3.5 w-3.5" />}
                        />
                      ) : null}
                      {connection.provider === 'openai' ? (
                        <IconButton
                          label="Test connection"
                          onClick={() => testOpenAi(connection)}
                          disabled={openAiConnectionStates[connection.id]?.state === 'checking'}
                          icon={<Icons.Link className="h-3.5 w-3.5" />}
                        />
                      ) : null}
                      {connection.provider === 'comfy' ? (
                        <IconButton
                          label="Test connection"
                          onClick={() => testComfy(connection)}
                          disabled={comfyConnectionStates[connection.id]?.state === 'checking'}
                          icon={<Icons.Link className="h-3.5 w-3.5" />}
                        />
                      ) : null}
                      <IconButton
                        label="Remove connection"
                        tone="danger"
                        onClick={() => removeConnection(connection.id)}
                        icon={<Icons.Trash className="h-3.5 w-3.5" />}
                      />
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="space-y-3 border-t border-white/10 bg-black/20 px-3 py-3">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor={`${connection.id}-name`}>Name</FieldLabel>
                          <input
                            id={`${connection.id}-name`}
                            value={connection.name}
                            onChange={(event) =>
                              updateConnection(connection.id, { name: event.target.value })
                            }
                            className={baseFieldClassName}
                            spellCheck={false}
                          />
                        </div>

                        {connection.provider === 'gemini' ? (
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor={`${connection.id}-api-key`}>API key</FieldLabel>
                            <input
                              id={`${connection.id}-api-key`}
                              type="password"
                              value={connection.apiKey ?? ''}
                              onChange={(event) =>
                                updateConnection(connection.id, { apiKey: event.target.value })
                              }
                              className={`${baseFieldClassName} font-mono`}
                              placeholder="AIza..."
                              autoComplete="off"
                              spellCheck={false}
                            />
                          </div>
                        ) : null}

                        {connection.provider === 'openai' ? (
                          <>
                            <div className="space-y-1.5">
                              <FieldLabel htmlFor={`${connection.id}-base-url`}>
                                Endpoint
                              </FieldLabel>
                              <input
                                id={`${connection.id}-base-url`}
                                value={connection.baseUrl ?? DEFAULT_OPENAI_BASE_URL}
                                onChange={(event) =>
                                  updateConnection(connection.id, {
                                    baseUrl: event.target.value,
                                  })
                                }
                                className={`${baseFieldClassName} font-mono`}
                                spellCheck={false}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <FieldLabel htmlFor={`${connection.id}-api-key`}>API key</FieldLabel>
                              <input
                                id={`${connection.id}-api-key`}
                                type="password"
                                value={connection.apiKey ?? ''}
                                onChange={(event) =>
                                  updateConnection(connection.id, { apiKey: event.target.value })
                                }
                                className={`${baseFieldClassName} font-mono`}
                                placeholder="sk-... (optional for compatible local servers)"
                                autoComplete="off"
                                spellCheck={false}
                              />
                            </div>
                          </>
                        ) : null}

                        {connection.provider === 'ollama' || connection.provider === 'comfy' ? (
                          <div className="space-y-1.5 lg:col-span-1">
                            <FieldLabel htmlFor={`${connection.id}-endpoint`}>Endpoint</FieldLabel>
                            <input
                              id={`${connection.id}-endpoint`}
                              value={getConnectionEndpoint(connection)}
                              onChange={(event) =>
                                updateConnection(connection.id, { endpoint: event.target.value })
                              }
                              className={`${baseFieldClassName} font-mono`}
                              spellCheck={false}
                            />
                          </div>
                        ) : null}
                      </div>

                      {isAiConnection(connection) ? (
                        <ConnectionModelsEditor
                          connection={connection}
                          ollamaState={ollamaState}
                          modelDraft={modelDrafts[connection.id] ?? ''}
                          onModelDraftChange={updateModelDraft}
                          onAddModel={addConnectionModel}
                          onToggleModel={toggleConnectionModel}
                          onRemoveModel={removeConnectionModel}
                        />
                      ) : null}

                      {openAiError ? <p className="text-xs text-red-300">{openAiError}</p> : null}
                      {comfyError ? <p className="text-xs text-red-300">{comfyError}</p> : null}
                      {ollamaState?.error ? (
                        <p className="text-xs text-red-300">{ollamaState.error}</p>
                      ) : null}
                      {ollamaAuthUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            window.open(ollamaAuthUrl, '_blank', 'noopener,noreferrer')
                          }
                          className="inline-flex h-8 items-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 text-xs font-medium text-amber-100 transition hover:border-amber-200/35 hover:bg-amber-400/15"
                        >
                          <Icons.ArrowLeftOnRectangle className="h-3.5 w-3.5" />
                          Open authentication
                        </button>
                      ) : null}
                      {ollamaState?.error && !ollamaAuthUrl ? (
                        <IntegrationTroubleshooting
                          title="Troubleshooting Ollama"
                          steps={ollamaTroubleshootingSteps}
                        />
                      ) : null}
                      {comfyError ? (
                        <IntegrationTroubleshooting
                          title="Troubleshooting ComfyUI"
                          steps={comfyTroubleshootingSteps}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Model Routing</h2>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            Select a model from the unified connection catalog for each text task.
          </p>
        </div>

        <div className="grid gap-2">
          {aiRouteMeta.map((routeMeta) => {
            const route = aiTaskRoutes[routeMeta.id];
            const selectedValue = getRouteModelValue(routeMeta.id);
            const routeConnection = route.connectionId
              ? aiConnections.find((connection) => connection.id === route.connectionId)
              : null;
            const routeReady = Boolean(selectedValue && routeConnection);

            return (
              <div
                key={routeMeta.id}
                className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,28rem)] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-white">{routeMeta.title}</h3>
                    <StatusBadge tone={routeReady ? 'success' : 'warning'}>
                      {routeReady ? 'Set' : 'Select model'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-400">{routeMeta.description}</p>
                </div>
                <div className="min-w-0">
                  {modelCatalogOptions.length > 0 ? (
                    <StyledDropdown
                      value={selectedValue}
                      options={modelCatalogOptions}
                      onChange={(value) => updateRouteModel(routeMeta.id, String(value))}
                      searchable
                      popoverWidthClass="w-[min(34rem,calc(100vw-2rem))]"
                      showSelectedBadges
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-gray-500">
                      Add an AI connection first.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] lg:items-center">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Agent Delegation</h2>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            Caps delegated sub-agent tasks for a single agent run.
          </p>
        </div>
        <div className="space-y-2">
          <Slider
            label="Max sub-agents"
            description={
              agentMaxSubagentSpawns > 0
                ? `${agentMaxSubagentSpawns} active max.`
                : '0 disables delegation'
            }
            value={agentMaxSubagentSpawns}
            min={AgentMaxSubagentSpawns.MIN}
            max={AgentMaxSubagentSpawns.MAX}
            step={1}
            onChange={(value) => setPreferences({ agentMaxSubagentSpawns: Math.round(value) })}
            displayFormatter={(value) => (value <= 0 ? 'Off' : String(Math.round(value)))}
            onReset={
              agentMaxSubagentSpawns !== AgentMaxSubagentSpawns.DEFAULT
                ? () =>
                    setPreferences({
                      agentMaxSubagentSpawns: AgentMaxSubagentSpawns.DEFAULT,
                    })
                : undefined
            }
            resetTooltip="Reset delegation limit"
          />
          <div className="flex items-center justify-between px-0.5 text-[10px] font-medium text-gray-500">
            {agentDelegationTickLabels.map((tick) => (
              <span key={tick.value}>{tick.label}</span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default IntegrationsPreferences;
