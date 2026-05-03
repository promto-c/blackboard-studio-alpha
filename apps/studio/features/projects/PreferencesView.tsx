import React from 'react';
import {
  ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT,
  ROTO_TRACKING_DRIFT_TOLERANCE_MAX,
  ROTO_TRACKING_DRIFT_TOLERANCE_MIN,
  getRecommendedCacheSizeMB,
  usePreferences,
  colors,
  type BackgroundPrefetchMode,
  type CacheBudgetMode,
  type RotoMotionBlurPreviewBackend,
} from '@/state/preferencesContext';
import {
  ColorPicker,
  SegmentedControl,
  SettingsPanelFrame,
  Slider,
  StyledDropdown,
  ToggleSwitch,
} from '@/components';
import {
  hasGeminiApiKey,
  isOllamaAuthenticationRequiredError,
  listOllamaModels,
  testOpenAiConnection,
  type OllamaModelSummary,
} from '@/utils/ai';
import {
  DEFAULT_AI_TASK_ROUTES,
  hasOpenAiApiKey,
  type AiRouteTask,
  type AiTaskRoutes,
} from '@/utils/aiRouting';
import {
  DEFAULT_COMFY_ENDPOINT,
  normalizeComfyEndpoint,
  testComfyConnection,
} from '@/services/comfy/client';
import * as Icons from '@blackboard/icons';
import type {
  AiProvider,
  DirectoryImportModePreference,
  RotoMotionCueScope,
  RotoMotionCueMode,
} from '@blackboard/types';

interface PreferencesViewProps {
  onBack: () => void;
}

type PreferencesSectionId =
  | 'appearance'
  | 'editing'
  | 'integrations'
  | 'rotoMotion'
  | 'performance';
type PreferenceSectionIcon = React.ComponentType<{ className?: string }>;

const preferenceSections: {
  id: PreferencesSectionId;
  label: string;
  description: string;
  icon: PreferenceSectionIcon;
}[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, panel finish, and preview styling',
    icon: Icons.Sun,
  },
  {
    id: 'editing',
    label: 'Editing',
    description: 'Playback defaults and editor behavior',
    icon: Icons.Brush,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'External services and local backends',
    icon: Icons.Link,
  },
  {
    id: 'rotoMotion',
    label: 'Roto Motion',
    description: 'Cue overlays and interactive blur previews',
    icon: Icons.Curve,
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Prefetching, memory, and cache budgets',
    icon: Icons.ComputerDesktop,
  },
];

const colorDisplayNames: { [key: string]: string } = {
  teal: 'Teal',
  blue: 'Blue',
  rose: 'Rose',
  amber: 'Amber',
  green: 'Green',
  indigo: 'Indigo',
};

const rgbToHex = (rgbString: string) => {
  const [r, g, b] = rgbString.split(' ').map(Number);
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
};

const baseFieldClassName =
  'block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition placeholder:text-gray-500 focus:border-primary-400/40 focus:ring-2 focus:ring-primary-500/20';

const StatusBadge: React.FC<{
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}> = ({ children, tone = 'neutral' }) => {
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
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${toneClassName}`}
    >
      {children}
    </span>
  );
};

const IntegrationTroubleshooting: React.FC<{
  title: string;
  steps: string[] | Array<{ label: string; description: string }>;
}> = ({ title, steps }) => (
  <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs text-amber-50">
    <div className="flex items-center gap-2 font-medium">
      <Icons.ExclamationCircle className="h-4 w-4 shrink-0" />
      <span>{title}</span>
    </div>
    <ol className="mt-2 list-decimal space-y-1 pl-4 leading-5 text-amber-100/90">
      {Array.isArray(steps) && steps.length > 0 && typeof steps[0] === 'string'
        ? (steps as string[]).map((step) => <li key={step}>{step}</li>)
        : (steps as Array<{ label: string; description: string }>).map((step) => (
            <li key={step.label}>
              <span className="font-medium">{step.label}</span>
              {' — '}
              {step.description}
            </li>
          ))}
    </ol>
  </div>
);

const getOllamaModelCapabilityTags = (model: OllamaModelSummary) =>
  (model.capabilities ?? []).filter((capability) => capability !== 'completion');

const getOllamaModelDetailLabel = (model: OllamaModelSummary) =>
  [model.details?.parameter_size, model.details?.quantization_level]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' · ');

const aiProviderOptions = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'ollama', label: 'Ollama' },
];

const aiRouteMeta: {
  id: AiRouteTask;
  title: string;
  description: string;
  placeholder: Record<AiProvider, string>;
}[] = [
  {
    id: 'assistantChat',
    title: 'Assistant Chat',
    description: 'General assistant conversations and node-aware help in Chats.',
    placeholder: {
      gemini: DEFAULT_AI_TASK_ROUTES.assistantChat.model,
      openai: 'gpt-5-mini',
      ollama: 'qwen2.5-coder:7b',
    },
  },
  {
    id: 'shaderGeneration',
    title: 'Shader Generation',
    description: 'Shader chat and Generate Shader requests.',
    placeholder: {
      gemini: DEFAULT_AI_TASK_ROUTES.shaderGeneration.model,
      openai: 'gpt-5-mini',
      ollama: 'qwen2.5-coder:7b',
    },
  },
  {
    id: 'shaderPromptTools',
    title: 'Shader Prompt Tools',
    description: 'Suggest and enhance actions for shader prompt drafting.',
    placeholder: {
      gemini: DEFAULT_AI_TASK_ROUTES.shaderPromptTools.model,
      openai: 'gpt-5-mini',
      ollama: 'qwen2.5-coder:7b',
    },
  },
  {
    id: 'imagePromptTools',
    title: 'Image Prompt Tools',
    description: 'Suggest and enhance actions for image and Comfy prompt text.',
    placeholder: {
      gemini: DEFAULT_AI_TASK_ROUTES.imagePromptTools.model,
      openai: 'gpt-5-mini',
      ollama: 'qwen2.5-coder:7b',
    },
  },
];

const ToggleField: React.FC<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  activeLabel?: string;
  inactiveLabel?: string;
}> = ({
  checked,
  onCheckedChange,
  ariaLabel,
  activeLabel = 'Enabled',
  inactiveLabel = 'Disabled',
}) => (
  <div className="flex items-center justify-end gap-3">
    <StatusBadge tone={checked ? 'accent' : 'neutral'}>
      {checked ? activeLabel : inactiveLabel}
    </StatusBadge>
    <ToggleSwitch checked={checked} ariaLabel={ariaLabel} onCheckedChange={onCheckedChange} />
  </div>
);

const AccentSwatch: React.FC<{
  colorKey: string;
  isActive: boolean;
  onSelect: () => void;
}> = ({ colorKey, isActive, onSelect }) => {
  const colorHex = rgbToHex(colors[colorKey][500]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 ${
        isActive
          ? 'border-primary-400/35 bg-primary-500/10 shadow-[0_12px_30px_rgba(0,0,0,0.28)] ring-1 ring-inset ring-primary-300/20'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
      }`}
      aria-pressed={isActive}
      aria-label={`Set primary color to ${colorDisplayNames[colorKey]}`}
      title={colorDisplayNames[colorKey]}
    >
      <span
        className="h-10 w-10 shrink-0 rounded-2xl border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
        style={{
          background: `linear-gradient(135deg, ${rgbToHex(colors[colorKey][400])}, ${rgbToHex(colors[colorKey][700])})`,
        }}
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>
          {colorDisplayNames[colorKey]}
        </span>
        <span className="mt-0.5 block text-[11px] text-gray-500">{colorHex}</span>
      </span>
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
          isActive
            ? 'border-primary-300/30 bg-primary-500/20 text-primary-100'
            : 'border-white/10 bg-black/20 text-transparent group-hover:text-gray-400'
        }`}
      >
        <Icons.Check className="h-3.5 w-3.5" />
      </span>
    </button>
  );
};

const SettingsGroup: React.FC<{
  title?: string;
  description?: string;
  icon?: PreferenceSectionIcon;
  highlights?: string[];
  children: React.ReactNode;
}> = ({ children }) => <div className="space-y-3 bg-gray-950">{children}</div>;

const SettingsRow: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
  stacked?: boolean;
  controlClassName?: string;
}> = ({ title, description, children, stacked = false, controlClassName }) => (
  <div
    className={`rounded-xl border border-white/10 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${
      stacked
        ? 'space-y-4 p-4'
        : 'grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] lg:items-center'
    }`}
  >
    <div className="min-w-0">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs leading-6 text-gray-400">{description}</p>
    </div>
    <div
      className={
        stacked
          ? (controlClassName ?? '')
          : `w-full lg:justify-self-end ${controlClassName ?? 'lg:max-w-[24rem]'}`
      }
    >
      {children}
    </div>
  </div>
);

const PreferencesView: React.FC<PreferencesViewProps> = ({ onBack }) => {
  const {
    primaryColor,
    thumbnailMode,
    uiStyle,
    codeEditorWordWrap,
    playbackMode,
    backgroundPrefetchMode,
    backgroundPrefetchFrameWindow,
    cacheBudgetMode,
    maxCacheSizeMB,
    maxCachedFrames,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
    aiTaskRoutes,
    comfyEndpoint,
    enableToolSorting,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    rotoMotionCueScope,
    rotoMotionTrailFrames,
    rotoMotionBlurPreviewBackend,
    rotoMotionBlurInteractivePreviewEnabled,
    rotoMotionBlurInteractivePreviewSamples,
    rotoPointWeightMode,
    rotoTrackingBackgroundEnabled,
    rotoTrackingDriftTolerance,
    directoryImportModePreference,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
    viewportInterpolation,
    setPreferences,
  } = usePreferences();
  const [activeSection, setActiveSection] = React.useState<PreferencesSectionId>('appearance');
  const [ollamaModels, setOllamaModels] = React.useState<OllamaModelSummary[]>([]);
  const [isLoadingOllamaModels, setIsLoadingOllamaModels] = React.useState(false);
  const [ollamaModelsError, setOllamaModelsError] = React.useState<string | null>(null);
  const [ollamaModelsAuthUrl, setOllamaModelsAuthUrl] = React.useState<string | null>(null);
  const [hasLoadedOllamaModels, setHasLoadedOllamaModels] = React.useState(false);
  const [ollamaConnectionCheck, setOllamaConnectionCheck] = React.useState(0);
  const [comfyConnectionState, setComfyConnectionState] = React.useState<
    'idle' | 'checking' | 'connected' | 'error'
  >('idle');
  const [comfyConnectionError, setComfyConnectionError] = React.useState<string | null>(null);
  const [openAiConnectionState, setOpenAiConnectionState] = React.useState<
    'idle' | 'checking' | 'connected' | 'error'
  >('idle');
  const [openAiConnectionError, setOpenAiConnectionError] = React.useState<string | null>(null);
  const recommendedCacheSizeMB = getRecommendedCacheSizeMB();

  const uiStyleOptions = [
    { value: 'glass', label: 'Glass' },
    { value: 'solid', label: 'Solid' },
  ];

  const playbackOptions = [
    { value: 'realtime', label: 'Real-time' },
    { value: 'every_frame', label: 'Every frame' },
  ];

  const directoryImportModeOptions = [
    { value: 'ask', label: 'Ask' },
    { value: 'reference', label: 'Reference' },
    { value: 'copy', label: 'Copy' },
  ];

  const thumbnailModeOptions = [
    { value: 'live', label: 'Live' },
    { value: 'static', label: 'Static' },
    { value: 'off', label: 'Off' },
  ];

  const backgroundPrefetchOptions = [
    { value: 'on_demand', label: 'On demand' },
    { value: 'forward', label: 'Forward' },
    { value: 'bidirectional', label: 'Bidirectional' },
  ];

  const cacheBudgetOptions = [
    { value: 'auto_memory', label: 'Auto RAM' },
    { value: 'manual_memory', label: 'Manual RAM' },
    { value: 'frame_count', label: 'Frames' },
  ];

  const rotoMotionModeOptions = [
    { value: 'gradient_trail', label: 'Gradient trail' },
    { value: 'speed_heatline', label: 'Speed heatline' },
  ];

  const rotoMotionScopeOptions = [
    { value: 'selected', label: 'Selected' },
    { value: 'all', label: 'All' },
  ];

  const rotoMotionBlurBackendOptions = [
    { value: 'realtime_canvas', label: 'Canvas 2D' },
    { value: 'gpu_float', label: 'WebGL2 (Half Float)' },
  ];

  const rotoPointWeightModeOptions = [
    { value: 'global', label: 'Global Pull' },
    { value: 'local', label: 'Local Pull' },
  ];

  const alphaOverlayColorSourceOptions = [
    { value: 'accent', label: 'Accent' },
    { value: 'custom', label: 'Custom' },
  ];

  const viewportInterpolationOptions = [
    { value: 'nearest', label: 'Nearest' },
    { value: 'linear', label: 'Linear' },
  ];

  const trimmedOllamaEndpoint = ollamaEndpoint.trim();
  const trimmedComfyEndpoint = normalizeComfyEndpoint(comfyEndpoint);
  const trimmedGeminiApiKey = geminiApiKey.trim();
  const trimmedOpenAiApiKey = openAiApiKey.trim();
  const studioOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const isGeminiConfigured = hasGeminiApiKey(geminiApiKey);
  const isOpenAiConfigured = hasOpenAiApiKey(openAiApiKey);
  const isOllamaConnected =
    hasLoadedOllamaModels &&
    !isLoadingOllamaModels &&
    !ollamaModelsError &&
    !!trimmedOllamaEndpoint;
  const isOllamaAuthenticationRequired = Boolean(ollamaModelsError && ollamaModelsAuthUrl);
  const canOpenOllamaEndpoint = Boolean(
    ollamaModelsError && (ollamaModelsAuthUrl || trimmedOllamaEndpoint),
  );
  const hasSelectableOllamaModels = isOllamaConnected && ollamaModels.length > 0;
  const ollamaModelOptions = React.useMemo(
    () =>
      ollamaModels.map((model) => ({
        value: model.model,
        label: model.model,
        secondaryLabel: getOllamaModelDetailLabel(model) || undefined,
        badges: getOllamaModelCapabilityTags(model),
      })),
    [ollamaModels],
  );
  const aiRouteCountsByProvider = React.useMemo(() => {
    const counts: Record<AiProvider, number> = { gemini: 0, openai: 0, ollama: 0 };
    (Object.values(aiTaskRoutes) as Array<AiTaskRoutes[AiRouteTask]>).forEach((route) => {
      counts[route.provider] += 1;
    });
    return counts;
  }, [aiTaskRoutes]);
  const ollamaTroubleshootingSteps = [
    `Make sure Ollama is running and the endpoint is correct: ${trimmedOllamaEndpoint || 'the Ollama endpoint'}.`,
    'If the browser console mentions CORS or Access-Control-Allow-Origin, allow this Studio origin in Ollama, then restart Ollama.',
    `For a shell-launched Ollama server, use: OLLAMA_ORIGINS=${studioOrigin} ollama serve`,
    'If Ollama is managed by a desktop app or service, set OLLAMA_ORIGINS in that service environment and restart it.',
    'For quick local-only testing, OLLAMA_ORIGINS=* can help isolate CORS, but avoid that on shared or remote machines.',
  ];
  const comfyTroubleshootingSteps = [
    `Make sure ComfyUI is running and the endpoint is correct: ${trimmedComfyEndpoint}.`,
    'If the browser console mentions CORS or Access-Control-Allow-Origin, restart ComfyUI with CORS headers enabled.',
    `Common ComfyUI launch flag: --enable-cors-header. Some versions accept an explicit origin: --enable-cors-header ${studioOrigin}`,
    'If ComfyUI is remote or behind a tunnel, use a reverse proxy that adds Access-Control-Allow-Origin for the Studio origin.',
  ];
  const activeSectionMeta =
    preferenceSections.find((section) => section.id === activeSection) ?? preferenceSections[0];
  const activeSectionHighlights: Record<PreferencesSectionId, string[]> = {
    appearance: [
      `${colorDisplayNames[primaryColor] ?? primaryColor} accent`,
      uiStyle === 'glass' ? 'Glass panels' : 'Solid panels',
      viewportInterpolation === 'nearest' ? 'Nearest sampling' : 'Linear sampling',
    ],
    editing: [
      playbackMode === 'realtime' ? 'Realtime playback' : 'Every-frame playback',
      thumbnailMode === 'live'
        ? 'Live thumbnails'
        : thumbnailMode === 'static'
          ? 'Static thumbnails'
          : 'Thumbnails off',
      directoryImportModePreference === 'ask'
        ? 'Ask before folder import'
        : directoryImportModePreference === 'reference'
          ? 'Reference folders'
          : 'Copy folders',
    ],
    integrations: [
      `${Object.keys(aiTaskRoutes).length} task routes`,
      `Gemini ${aiRouteCountsByProvider.gemini} · OpenAI ${aiRouteCountsByProvider.openai} · Ollama ${aiRouteCountsByProvider.ollama}`,
      isGeminiConfigured || isOpenAiConfigured || trimmedOllamaEndpoint
        ? 'Providers configured'
        : 'Provider setup pending',
      `Comfy ${trimmedComfyEndpoint}`,
    ],
    rotoMotion: [
      rotoMotionBlurPreviewBackend === 'gpu_float' ? 'GPU quality blur' : 'Realtime canvas blur',
      rotoPointWeightMode === 'local' ? 'Default local pull' : 'Default full pull',
      rotoMotionCueEnabled ? 'Cue overlay on' : 'Cue overlay off',
      rotoTrackingBackgroundEnabled ? 'Background tracking' : 'Inline tracking',
      `Drift stop ${rotoTrackingDriftTolerance.toFixed(1)}`,
      rotoMotionBlurInteractivePreviewEnabled
        ? `Interactive cap ${rotoMotionBlurInteractivePreviewSamples}`
        : 'Full samples while editing',
    ],
    performance: [
      backgroundPrefetchMode === 'on_demand'
        ? 'On-demand prefetch'
        : backgroundPrefetchMode === 'forward'
          ? 'Forward prefetch'
          : 'Bidirectional prefetch',
      cacheBudgetMode === 'auto_memory'
        ? 'Auto RAM budget'
        : cacheBudgetMode === 'manual_memory'
          ? 'Manual RAM budget'
          : 'Frame-count budget',
      cacheBudgetMode === 'manual_memory'
        ? `${maxCacheSizeMB} MB cache`
        : cacheBudgetMode === 'frame_count'
          ? `${maxCachedFrames} cached frames`
          : `${recommendedCacheSizeMB} MB detected`,
    ],
  };

  React.useEffect(() => {
    if (activeSection !== 'integrations') {
      return;
    }
    if (!trimmedOllamaEndpoint) {
      setOllamaModels([]);
      setOllamaModelsError(null);
      setOllamaModelsAuthUrl(null);
      setIsLoadingOllamaModels(false);
      setHasLoadedOllamaModels(false);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoadingOllamaModels(true);
      setOllamaModelsError(null);
      setOllamaModelsAuthUrl(null);
      setHasLoadedOllamaModels(false);

      try {
        const models = await listOllamaModels(trimmedOllamaEndpoint, {
          signal: abortController.signal,
        });
        setOllamaModels(models);
        setOllamaModelsAuthUrl(null);
        setHasLoadedOllamaModels(true);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        setOllamaModels([]);
        if (isOllamaAuthenticationRequiredError(error)) {
          setOllamaModelsAuthUrl(error.authUrl);
          setOllamaModelsError(error.message);
        } else {
          setOllamaModelsAuthUrl(null);
          setOllamaModelsError(error instanceof Error ? error.message : 'Failed to reach Ollama.');
        }
        setHasLoadedOllamaModels(true);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingOllamaModels(false);
        }
      }
    }, 300);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeSection, ollamaConnectionCheck, trimmedOllamaEndpoint]);

  const handleOpenOllamaAuthentication = React.useCallback(() => {
    const url = ollamaModelsAuthUrl || trimmedOllamaEndpoint;
    if (!url) {
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, [ollamaModelsAuthUrl, trimmedOllamaEndpoint]);

  const handleRetryOllamaConnection = React.useCallback(() => {
    setOllamaConnectionCheck((check) => check + 1);
  }, []);

  React.useEffect(() => {
    setComfyConnectionState('idle');
    setComfyConnectionError(null);
  }, [trimmedComfyEndpoint]);

  const handleTestComfyConnection = React.useCallback(async () => {
    setComfyConnectionState('checking');
    setComfyConnectionError(null);

    try {
      await testComfyConnection(trimmedComfyEndpoint);
      setComfyConnectionState('connected');
    } catch (error) {
      setComfyConnectionState('error');
      setComfyConnectionError(error instanceof Error ? error.message : 'Failed to reach ComfyUI.');
    }
  }, [trimmedComfyEndpoint]);

  const handleTestOpenAiConnection = React.useCallback(async () => {
    setOpenAiConnectionState('checking');
    setOpenAiConnectionError(null);

    try {
      const model = aiTaskRoutes.assistantChat.model.trim();
      if (!model) {
        throw new Error('Missing OpenAI model. Set it in Preferences > Integrations.');
      }
      await testOpenAiConnection(openAiApiKey, openAiBaseUrl, model);
      setOpenAiConnectionState('connected');
    } catch (error) {
      setOpenAiConnectionState('error');
      setOpenAiConnectionError(error instanceof Error ? error.message : 'Failed to reach OpenAI.');
    }
  }, [openAiApiKey, openAiBaseUrl, aiTaskRoutes.assistantChat.model]);

  const updateAiTaskRoute = React.useCallback(
    (task: AiRouteTask, updates: Partial<AiTaskRoutes[AiRouteTask]>) => {
      setPreferences({
        aiTaskRoutes: {
          ...aiTaskRoutes,
          [task]: {
            ...aiTaskRoutes[task],
            ...updates,
          },
        },
      });
    },
    [aiTaskRoutes, setPreferences],
  );

  const getOllamaRouteOptions = React.useCallback(
    (task: AiRouteTask) => {
      const currentModel = aiTaskRoutes[task].model.trim();
      return [
        ...(currentModel && !ollamaModels.some((model) => model.model === currentModel)
          ? [{ value: currentModel, label: `${currentModel} (current)` }]
          : []),
        ...ollamaModelOptions,
      ];
    },
    [aiTaskRoutes, ollamaModelOptions, ollamaModels],
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'appearance':
        return (
          <SettingsGroup
            title="Appearance"
            description="Match the workspace look to your workflow with a cleaner theme system and more predictable preview controls."
            icon={Icons.Sun}
            highlights={activeSectionHighlights.appearance}
          >
            <SettingsRow
              title="Accent color"
              description="Used for selections, sliders, and highlighted controls."
              stacked
            >
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {Object.keys(colors).map((color) => (
                  <AccentSwatch
                    key={color}
                    colorKey={color}
                    isActive={primaryColor === color}
                    onSelect={() => setPreferences({ primaryColor: color })}
                  />
                ))}
              </div>
            </SettingsRow>

            <SettingsRow
              title="Panel style"
              description="Choose between translucent glass and dense solid panels."
            >
              <SegmentedControl
                options={uiStyleOptions}
                value={uiStyle}
                onChange={(style) => setPreferences({ uiStyle: style as 'glass' | 'solid' })}
              />
            </SettingsRow>

            <SettingsRow
              title="Viewport interpolation"
              description="Nearest preserves sharp pixels; linear smooths between them."
            >
              <SegmentedControl
                options={viewportInterpolationOptions}
                value={viewportInterpolation}
                onChange={(mode) =>
                  setPreferences({
                    viewportInterpolation: mode as 'nearest' | 'linear',
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Alpha overlay preview"
              description="Controls Shift+A overlay styling. Recommended overlay opacity is around 35%."
              stacked
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400">Overlay color source</label>
                  <SegmentedControl
                    options={alphaOverlayColorSourceOptions}
                    value={alphaOverlayColorSource}
                    onChange={(value) =>
                      setPreferences({
                        alphaOverlayColorSource: value as 'accent' | 'custom',
                      })
                    }
                  />
                </div>
                {alphaOverlayColorSource === 'custom' && (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <ColorPicker
                      label="Custom overlay color"
                      value={alphaOverlayCustomColor}
                      onChange={(value) => setPreferences({ alphaOverlayCustomColor: value })}
                    />
                  </div>
                )}
                <Slider
                  label="Overlay Opacity"
                  value={alphaOverlayOpacity}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(value) => setPreferences({ alphaOverlayOpacity: value })}
                  onReset={() => setPreferences({ alphaOverlayOpacity: 35 })}
                  displayFormatter={(value) => `${Math.round(value)}%`}
                />
                <Slider
                  label="No-Alpha Darken"
                  value={alphaOverlayBgDarken}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(value) => setPreferences({ alphaOverlayBgDarken: value })}
                  onReset={() => setPreferences({ alphaOverlayBgDarken: 0 })}
                  displayFormatter={(value) => `${Math.round(value)}%`}
                />
              </div>
            </SettingsRow>
          </SettingsGroup>
        );
      case 'editing':
        return (
          <SettingsGroup
            title="Editing"
            description="Set the default interaction behavior for playback, imports, and editor ergonomics."
            icon={Icons.Brush}
            highlights={activeSectionHighlights.editing}
          >
            <SettingsRow
              title="Playback mode"
              description="Real-time drops frames if needed; every frame prioritizes sync."
            >
              <SegmentedControl
                options={playbackOptions}
                value={playbackMode}
                onChange={(mode) =>
                  setPreferences({
                    playbackMode: mode as 'realtime' | 'every_frame',
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Folder import mode"
              description="Ask each time, default to reference import, or always copy files into projects."
            >
              <SegmentedControl
                options={directoryImportModeOptions}
                value={directoryImportModePreference}
                onChange={(mode) =>
                  setPreferences({
                    directoryImportModePreference: mode as DirectoryImportModePreference,
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Node thumbnails"
              description="Live updates thumbnails with the current frame. Static shows the first frame only. Off disables rendered previews."
            >
              <SegmentedControl
                options={thumbnailModeOptions}
                value={thumbnailMode}
                onChange={(mode) =>
                  setPreferences({
                    thumbnailMode: mode as 'live' | 'static' | 'off',
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Sort tools by frequency"
              description="Moves commonly used tools toward the top of the tools list."
            >
              <ToggleField
                checked={enableToolSorting}
                ariaLabel="Toggle tool sorting by frequency"
                activeLabel="Adaptive order"
                inactiveLabel="Manual order"
                onCheckedChange={(checked) => setPreferences({ enableToolSorting: checked })}
              />
            </SettingsRow>

            <SettingsRow
              title="Code editor word wrap"
              description="Wrap long shader lines so they stay visible without horizontal scrolling."
            >
              <ToggleField
                checked={codeEditorWordWrap}
                ariaLabel="Toggle code editor word wrap"
                activeLabel="Wrapped"
                inactiveLabel="Single line"
                onCheckedChange={(checked) => setPreferences({ codeEditorWordWrap: checked })}
              />
            </SettingsRow>
          </SettingsGroup>
        );
      case 'integrations':
        return (
          <SettingsGroup
            title="Integrations"
            description="Configure external services, local model routing, and render backends in one predictable place."
            icon={Icons.Link}
            highlights={activeSectionHighlights.integrations}
          >
            <SettingsRow
              title="AI routing"
              description="Assign a provider and model per task. Mix Gemini, OpenAI, and Ollama under one routing system."
              stacked
            >
              <div className="space-y-3">
                {aiRouteMeta.map((routeMeta) => {
                  const route = aiTaskRoutes[routeMeta.id];
                  const routeOptions = getOllamaRouteOptions(routeMeta.id);

                  return (
                    <div
                      key={routeMeta.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">{routeMeta.title}</p>
                          <p className="mt-1 text-xs leading-5 text-gray-400">
                            {routeMeta.description}
                          </p>
                        </div>
                        <StatusBadge tone="accent">{route.provider}</StatusBadge>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-400">Provider</label>
                          <SegmentedControl
                            options={aiProviderOptions}
                            value={route.provider}
                            onChange={(provider) =>
                              updateAiTaskRoute(routeMeta.id, {
                                provider: provider as AiProvider,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-400">Model</label>
                          <div className="flex min-w-0 gap-2">
                            {route.provider === 'ollama' && hasSelectableOllamaModels ? (
                              <StyledDropdown
                                value={route.model}
                                options={routeOptions}
                                onChange={(value) =>
                                  updateAiTaskRoute(routeMeta.id, { model: String(value) })
                                }
                                widthClass="min-w-0 flex-1"
                                popoverWidthClass="w-[min(28rem,calc(100vw-2rem))]"
                              />
                            ) : (
                              <input
                                type="text"
                                value={route.model}
                                onChange={(event) =>
                                  updateAiTaskRoute(routeMeta.id, { model: event.target.value })
                                }
                                className={`${baseFieldClassName} min-w-0 flex-1 truncate font-mono`}
                                placeholder={routeMeta.placeholder[route.provider]}
                                spellCheck={false}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => updateAiTaskRoute(routeMeta.id, { model: '' })}
                              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                              title="Reset model"
                            >
                              <Icons.RotateLoop className="h-3 w-3" />
                              Reset
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SettingsRow>

            <SettingsRow
              title="Gemini API key"
              description="Used by Gemini-routed tasks when this app does not have a build-time GEMINI_API_KEY."
              stacked
            >
              <div className="space-y-3">
                <label
                  htmlFor="preferences-gemini-api-key"
                  className="text-xs font-medium text-gray-400"
                >
                  API key
                </label>
                <div className="flex gap-2">
                  <input
                    id="preferences-gemini-api-key"
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setPreferences({ geminiApiKey: e.target.value })}
                    className={`${baseFieldClassName} font-mono flex-1`}
                    placeholder="AIza..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setPreferences({ geminiApiKey: '' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                    title="Reset API key"
                  >
                    <Icons.RotateLoop className="h-3 w-3" />
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge tone={isGeminiConfigured ? 'success' : 'neutral'}>
                    {trimmedGeminiApiKey
                      ? 'Saved locally'
                      : isGeminiConfigured
                        ? 'Using build key'
                        : 'Not configured'}
                  </StatusBadge>
                </div>
              </div>
            </SettingsRow>

            <SettingsRow
              title="OpenAI"
              description="Credentials and base URL used by OpenAI-routed tasks."
              stacked
            >
              <div className="space-y-3">
                <label
                  htmlFor="preferences-openai-api-key"
                  className="text-xs font-medium text-gray-400"
                >
                  API key
                </label>
                <div className="flex gap-2">
                  <input
                    id="preferences-openai-api-key"
                    type="password"
                    value={openAiApiKey}
                    onChange={(e) => setPreferences({ openAiApiKey: e.target.value })}
                    className={`${baseFieldClassName} font-mono flex-1`}
                    placeholder="sk-... (optional for local servers)"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setPreferences({ openAiApiKey: '' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                    title="Reset API key"
                  >
                    <Icons.RotateLoop className="h-3 w-3" />
                    Reset
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Required for OpenAI. Optional for local servers like Ollama, vLLM, or LM Studio.
                </p>
                <label
                  htmlFor="preferences-openai-base-url"
                  className="text-xs font-medium text-gray-400"
                >
                  Endpoint
                </label>
                <div className="flex gap-2">
                  <input
                    id="preferences-openai-base-url"
                    type="url"
                    value={openAiBaseUrl}
                    onChange={(e) => setPreferences({ openAiBaseUrl: e.target.value })}
                    className={`${baseFieldClassName} font-mono flex-1`}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setPreferences({ openAiBaseUrl: '' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                    title="Reset endpoint"
                  >
                    <Icons.RotateLoop className="h-3 w-3" />
                    Reset
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Use the default OpenAI API URL or a compatible endpoint that supports the
                  Responses API.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge
                    tone={
                      openAiConnectionState === 'checking'
                        ? 'warning'
                        : openAiConnectionState === 'connected'
                          ? 'success'
                          : openAiConnectionState === 'error'
                            ? 'danger'
                            : trimmedOpenAiApiKey || openAiBaseUrl.trim()
                              ? 'success'
                              : 'neutral'
                    }
                  >
                    {openAiConnectionState === 'checking'
                      ? 'Checking...'
                      : openAiConnectionState === 'connected'
                        ? 'Connected'
                        : openAiConnectionState === 'error'
                          ? 'Connection failed'
                          : trimmedOpenAiApiKey || openAiBaseUrl.trim()
                            ? 'Configured'
                            : 'Not configured'}
                  </StatusBadge>
                </div>
                {openAiConnectionError ? (
                  <p className="text-xs text-red-300">{openAiConnectionError}</p>
                ) : null}
                {openAiConnectionError ? (
                  <IntegrationTroubleshooting
                    title="Troubleshooting connection failures"
                    steps={[
                      {
                        label: 'Verify base URL',
                        description:
                          'Confirm the base URL points to a running server (e.g., http://localhost:8000/v1).',
                      },
                      {
                        label: 'Check API key (if required)',
                        description:
                          'Some local servers require no key; others need a bearer token. Set it above if prompted.',
                      },
                      {
                        label: 'Verify model',
                        description:
                          'Set a valid model name in the task routes below (e.g., gpt-4o-mini or llama-3).',
                      },
                      {
                        label: 'Network connectivity',
                        description:
                          'Ensure your network can reach the endpoint or custom base URL.',
                      },
                    ]}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTestOpenAiConnection}
                    disabled={openAiConnectionState === 'checking' || !openAiBaseUrl.trim()}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icons.RotateLoop className="h-3.5 w-3.5" />
                    {openAiConnectionState === 'checking' ? 'Checking...' : 'Check connection'}
                  </button>
                </div>
              </div>
            </SettingsRow>

            <SettingsRow
              title="Ollama endpoint"
              description="Base URL for your local Ollama server. Both the root URL and an /api URL are accepted."
              stacked
            >
              <div className="space-y-3">
                <label
                  htmlFor="preferences-ollama-endpoint"
                  className="text-xs font-medium text-gray-400"
                >
                  Endpoint
                </label>
                <div className="flex gap-2">
                  <input
                    id="preferences-ollama-endpoint"
                    type="url"
                    value={ollamaEndpoint}
                    onChange={(e) => setPreferences({ ollamaEndpoint: e.target.value })}
                    className={baseFieldClassName}
                    placeholder="http://localhost:11434"
                  />
                  <button
                    type="button"
                    onClick={() => setPreferences({ ollamaEndpoint: '' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                    title="Reset endpoint"
                  >
                    <Icons.RotateLoop className="h-3 w-3" />
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge
                    tone={
                      isLoadingOllamaModels
                        ? 'warning'
                        : isOllamaAuthenticationRequired
                          ? 'warning'
                          : ollamaModelsError
                            ? 'danger'
                            : isOllamaConnected
                              ? 'success'
                              : 'neutral'
                    }
                  >
                    {isLoadingOllamaModels
                      ? 'Checking...'
                      : isOllamaAuthenticationRequired
                        ? 'Authentication required'
                        : ollamaModelsError
                          ? 'Connection failed'
                          : isOllamaConnected
                            ? 'Connected'
                            : 'Idle'}
                  </StatusBadge>
                  {isOllamaConnected ? (
                    <StatusBadge tone="accent">
                      {ollamaModels.length} model{ollamaModels.length === 1 ? '' : 's'} available
                    </StatusBadge>
                  ) : null}
                </div>
                {ollamaModelsError ? (
                  <p
                    className={`text-xs ${
                      isOllamaAuthenticationRequired ? 'text-amber-200' : 'text-red-300'
                    }`}
                  >
                    {ollamaModelsError}
                  </p>
                ) : null}
                {ollamaModelsError && !isOllamaAuthenticationRequired ? (
                  <IntegrationTroubleshooting
                    title="Troubleshooting connection failures"
                    steps={ollamaTroubleshootingSteps}
                  />
                ) : null}
                {canOpenOllamaEndpoint ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenOllamaAuthentication}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:border-amber-200/35 hover:bg-amber-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/30"
                    >
                      {isOllamaAuthenticationRequired ? (
                        <Icons.ArrowLeftOnRectangle className="h-3.5 w-3.5" />
                      ) : (
                        <Icons.Link className="h-3.5 w-3.5" />
                      )}
                      {isOllamaAuthenticationRequired ? 'Open authentication' : 'Open endpoint'}
                    </button>
                    <button
                      type="button"
                      onClick={handleRetryOllamaConnection}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                    >
                      <Icons.RotateLoop className="h-3.5 w-3.5" />
                      Check again
                    </button>
                  </div>
                ) : null}
                {isOllamaConnected && ollamaModels.length === 0 ? (
                  <p className="text-xs text-amber-200">
                    Ollama responded, but no local models were listed. Pull one first, then it will
                    appear here.
                  </p>
                ) : null}
              </div>
            </SettingsRow>

            <SettingsRow
              title="ComfyUI endpoint"
              description="Base URL for the Comfy node backend. Workflows stay on each Comfy node so graph-specific choices remain close to the render action."
              stacked
            >
              <div className="space-y-3">
                <label
                  htmlFor="preferences-comfy-endpoint"
                  className="text-xs font-medium text-gray-400"
                >
                  Endpoint
                </label>
                <div className="flex gap-2">
                  <input
                    id="preferences-comfy-endpoint"
                    type="url"
                    value={comfyEndpoint}
                    onChange={(e) => setPreferences({ comfyEndpoint: e.target.value })}
                    className={baseFieldClassName}
                    placeholder={DEFAULT_COMFY_ENDPOINT}
                  />
                  <button
                    type="button"
                    onClick={() => setPreferences({ comfyEndpoint: '' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                    title="Reset endpoint"
                  >
                    <Icons.RotateLoop className="h-3 w-3" />
                    Reset
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Used by all Comfy nodes. If the endpoint fails only in the browser, check the
                  troubleshooting steps below.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge
                    tone={
                      comfyConnectionState === 'checking'
                        ? 'warning'
                        : comfyConnectionState === 'connected'
                          ? 'success'
                          : comfyConnectionState === 'error'
                            ? 'danger'
                            : 'neutral'
                    }
                  >
                    {comfyConnectionState === 'checking'
                      ? 'Checking...'
                      : comfyConnectionState === 'connected'
                        ? 'Connected'
                        : comfyConnectionState === 'error'
                          ? 'Connection failed'
                          : 'Idle'}
                  </StatusBadge>
                  <StatusBadge tone="accent">{trimmedComfyEndpoint}</StatusBadge>
                </div>
                {comfyConnectionError ? (
                  <p className="text-xs text-red-300">{comfyConnectionError}</p>
                ) : null}
                {comfyConnectionError ? (
                  <IntegrationTroubleshooting
                    title="Troubleshooting connection failures"
                    steps={comfyTroubleshootingSteps}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTestComfyConnection}
                    disabled={comfyConnectionState === 'checking'}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
                  >
                    <Icons.Link className="h-3.5 w-3.5" />
                    Test connection
                  </button>
                </div>
              </div>
            </SettingsRow>
          </SettingsGroup>
        );
      case 'rotoMotion':
        return (
          <SettingsGroup
            title="Roto Motion"
            description="Tune rotoscoping feedback so cue overlays and motion blur stay readable while editing."
            icon={Icons.Curve}
            highlights={activeSectionHighlights.rotoMotion}
          >
            <SettingsRow
              title="Default point pull mode"
              description="Used as the starting mode for point-weight drags. You can override individual pulled points inline in the viewport with Global Pull or Local Pull."
            >
              <SegmentedControl
                options={rotoPointWeightModeOptions}
                value={rotoPointWeightMode}
                onChange={(mode) =>
                  setPreferences({
                    rotoPointWeightMode: mode as 'global' | 'local',
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Tracking run mode"
              description="Run longer roto tracks through the background jobs monitor so the playhead can stay put while progress and cancel stay available."
            >
              <ToggleField
                checked={rotoTrackingBackgroundEnabled}
                ariaLabel="Toggle background roto tracking"
                activeLabel="Background"
                inactiveLabel="Inline"
                onCheckedChange={(checked) =>
                  setPreferences({ rotoTrackingBackgroundEnabled: checked })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Tracking drift tolerance"
              description="Stop roto tracking when the average optical-flow error for a frame rises above this value."
              stacked
            >
              <Slider
                label="Tracking Drift Tolerance"
                value={rotoTrackingDriftTolerance}
                min={ROTO_TRACKING_DRIFT_TOLERANCE_MIN}
                max={ROTO_TRACKING_DRIFT_TOLERANCE_MAX}
                step={0.5}
                onChange={(value) => setPreferences({ rotoTrackingDriftTolerance: value })}
                onReset={() =>
                  setPreferences({
                    rotoTrackingDriftTolerance: ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT,
                  })
                }
                displayFormatter={(value) => value.toFixed(1)}
              />
            </SettingsRow>

            <SettingsRow
              title="Motion blur feather backend"
              description="Use Canvas 2D for faster feedback. WebGL2 uses half-float accumulation for smoother feather blur."
            >
              <SegmentedControl
                options={rotoMotionBlurBackendOptions}
                value={rotoMotionBlurPreviewBackend}
                onChange={(backend) =>
                  setPreferences({
                    rotoMotionBlurPreviewBackend: backend as RotoMotionBlurPreviewBackend,
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Reduced samples while editing"
              description="Temporarily cap roto motion blur samples during viewport roto edits such as dragging shapes or points."
            >
              <ToggleField
                checked={rotoMotionBlurInteractivePreviewEnabled}
                ariaLabel="Toggle reduced roto motion blur samples while editing"
                activeLabel="Reduced while editing"
                inactiveLabel="Always full quality"
                onCheckedChange={(checked) =>
                  setPreferences({ rotoMotionBlurInteractivePreviewEnabled: checked })
                }
              />
            </SettingsRow>

            <div
              className={`space-y-2 transition-opacity ${rotoMotionBlurInteractivePreviewEnabled ? 'opacity-100' : 'opacity-60 pointer-events-none'}`}
            >
              <SettingsRow
                title="Interactive sample cap"
                description="Upper limit for motion blur samples during active roto edits. Lower values trade quality for faster feedback."
                stacked
              >
                <Slider
                  label="Interactive Sample Cap"
                  value={rotoMotionBlurInteractivePreviewSamples}
                  min={2}
                  max={64}
                  step={1}
                  onChange={(value) =>
                    setPreferences({
                      rotoMotionBlurInteractivePreviewSamples: Math.round(value),
                    })
                  }
                  onReset={() =>
                    setPreferences({
                      rotoMotionBlurInteractivePreviewSamples: 16,
                    })
                  }
                  displayFormatter={(value) => `${Math.round(value)}`}
                />
              </SettingsRow>
            </div>

            <SettingsRow
              title="Enable motion cue overlay"
              description="Show path motion directly in the viewport."
            >
              <ToggleField
                checked={rotoMotionCueEnabled}
                ariaLabel="Toggle motion cue overlay"
                activeLabel="Overlay on"
                inactiveLabel="Overlay off"
                onCheckedChange={(checked) => setPreferences({ rotoMotionCueEnabled: checked })}
              />
            </SettingsRow>

            <div
              className={`space-y-2 transition-opacity ${rotoMotionCueEnabled ? 'opacity-100' : 'opacity-60 pointer-events-none'}`}
            >
              <SettingsRow
                title="Cue mode"
                description="Choose temporal trails or speed-mapped per-segment lines."
              >
                <SegmentedControl
                  options={rotoMotionModeOptions}
                  value={rotoMotionCueMode}
                  onChange={(mode) =>
                    setPreferences({
                      rotoMotionCueMode: mode as RotoMotionCueMode,
                    })
                  }
                />
              </SettingsRow>

              <SettingsRow
                title="Scope"
                description="Control which paths receive dynamic motion visualization."
              >
                <SegmentedControl
                  options={rotoMotionScopeOptions}
                  value={rotoMotionCueScope}
                  onChange={(scope) =>
                    setPreferences({
                      rotoMotionCueScope: scope as RotoMotionCueScope,
                    })
                  }
                />
              </SettingsRow>

              <SettingsRow
                title="Trail window"
                description="Used by gradient mode. Larger windows show more context but can add clutter."
                stacked
              >
                <Slider
                  label="Trail Window"
                  value={rotoMotionTrailFrames}
                  min={1}
                  max={8}
                  step={1}
                  onChange={(value) => setPreferences({ rotoMotionTrailFrames: value })}
                  onReset={() => setPreferences({ rotoMotionTrailFrames: 3 })}
                  displayFormatter={(value) => `±${Math.round(value)}f`}
                />
              </SettingsRow>
            </div>
          </SettingsGroup>
        );
      case 'performance':
      default:
        return (
          <SettingsGroup
            title="Performance"
            description="Balance scrubbing responsiveness and memory usage with clearer cache and prefetch limits."
            icon={Icons.ComputerDesktop}
            highlights={activeSectionHighlights.performance}
          >
            <SettingsRow
              title="Background prefetch"
              description="On demand only loads the current frame. Forward fills ahead of the playhead. Bidirectional keeps context on both sides while scrubbing."
            >
              <SegmentedControl
                options={backgroundPrefetchOptions}
                value={backgroundPrefetchMode}
                onChange={(mode) =>
                  setPreferences({
                    backgroundPrefetchMode: mode as BackgroundPrefetchMode,
                  })
                }
              />
            </SettingsRow>

            <div
              className={`space-y-2 transition-opacity ${
                backgroundPrefetchMode === 'on_demand'
                  ? 'opacity-60 pointer-events-none'
                  : 'opacity-100'
              }`}
            >
              <SettingsRow
                title="Prefetch window"
                description="Maximum number of adjacent frames to queue in the background for image sequences."
                stacked
              >
                <Slider
                  label="Prefetch Window"
                  value={backgroundPrefetchFrameWindow}
                  min={1}
                  max={240}
                  step={1}
                  onChange={(value) =>
                    setPreferences({
                      backgroundPrefetchFrameWindow: Math.round(value),
                    })
                  }
                  onReset={() =>
                    setPreferences({
                      backgroundPrefetchFrameWindow: 24,
                    })
                  }
                  displayFormatter={(value) =>
                    backgroundPrefetchMode === 'bidirectional'
                      ? `±${Math.round(value)}f`
                      : `${Math.round(value)}f`
                  }
                />
              </SettingsRow>
            </div>

            <SettingsRow
              title="Cache budget"
              description="Choose whether cache eviction is driven by available RAM, a fixed RAM cap, or a fixed decoded-frame count."
            >
              <SegmentedControl
                options={cacheBudgetOptions}
                value={cacheBudgetMode}
                onChange={(mode) =>
                  setPreferences({
                    cacheBudgetMode: mode as CacheBudgetMode,
                  })
                }
              />
            </SettingsRow>

            {cacheBudgetMode === 'auto_memory' && (
              <SettingsRow
                title="Detected memory budget"
                description="Uses about half of the browser-reported device memory for the viewport cache."
              >
                <div className="rounded-md border border-gray-700/60 bg-gray-900/60 px-3 py-2 text-sm font-medium text-gray-200">
                  {recommendedCacheSizeMB} MB
                </div>
              </SettingsRow>
            )}

            {cacheBudgetMode === 'manual_memory' && (
              <SettingsRow
                title="Memory cache limit"
                description="Higher values improve playback stability, but use more system RAM."
                stacked
              >
                <Slider
                  label="Memory Cache Limit"
                  value={maxCacheSizeMB}
                  min={128}
                  max={8192}
                  step={128}
                  onChange={(val) => setPreferences({ maxCacheSizeMB: val })}
                  onReset={() => setPreferences({ maxCacheSizeMB: recommendedCacheSizeMB })}
                  displayFormatter={(val) => `${val} MB`}
                />
              </SettingsRow>
            )}

            {cacheBudgetMode === 'frame_count' && (
              <SettingsRow
                title="Max cached frames"
                description="Static source handles stay resident; decoded frame entries are evicted first."
                stacked
              >
                <Slider
                  label="Max Cached Frames"
                  value={maxCachedFrames}
                  min={1}
                  max={480}
                  step={1}
                  onChange={(value) =>
                    setPreferences({
                      maxCachedFrames: Math.round(value),
                    })
                  }
                  onReset={() =>
                    setPreferences({
                      maxCachedFrames: 48,
                    })
                  }
                  displayFormatter={(value) => `${Math.round(value)} frames`}
                />
              </SettingsRow>
            )}
          </SettingsGroup>
        );
    }
  };
  return (
    <div className="mx-auto w-full max-w-5xl animate-[fadeIn_250ms_ease-in-out]">
      <SettingsPanelFrame
        title={
          <div className="flex items-center gap-2">
            <span className="text-white">Preferences</span>
            <span className="text-gray-600">/</span>
            <span className="text-gray-400">{activeSectionMeta.label}</span>
          </div>
        }
        subtitle={activeSectionMeta.description}
        onClose={onBack}
        closeLabel="Close preferences"
        uiStyle={uiStyle}
        sidebar={
          <div>
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              Sections
            </p>
            <nav className="grid gap-1 sm:grid-cols-2 md:grid-cols-1">
              {preferenceSections.map((section) => {
                const SectionIcon = section.icon;
                const isActive = activeSection === section.id;

                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 ${
                      isActive
                        ? 'bg-white/[0.08] text-white'
                        : 'text-gray-400 hover:bg-white/[0.05] hover:text-white'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                    title={section.description}
                  >
                    <span
                      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center ${
                        isActive ? 'text-primary-200' : 'text-gray-500'
                      }`}
                    >
                      <SectionIcon className="h-4 w-4" />
                    </span>
                    <span className="truncate font-medium">{section.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        }
      >
        <div key={activeSection} className="min-w-0 animate-[fadeIn_200ms_ease-out]">
          {renderSectionContent()}
        </div>
      </SettingsPanelFrame>
    </div>
  );
};

export default PreferencesView;
