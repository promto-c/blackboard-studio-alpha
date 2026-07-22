import React from 'react';
import {
  CompareChordHoldMs,
  PreviewMaxDimension,
  PreviewRefineDelay,
  PreviewSampleLimit,
  RotoTrackingDriftTolerance,
  ViewportPixelGridThresholdPercent,
  getRecommendedCacheSizeMB,
  type BackgroundPrefetchMode,
  type CacheBudgetMode,
  type ReopenHistoryLimitPreference,
  type TimelineCacheMode,
  type UndoHistoryLimitPreference,
  type ViewportBackgroundMode,
} from '@/state/preferences';
import type { PreviewPlaybackMode } from '@/utils/previewPerformance';
import { usePreferences } from '@/state/preferencesContext';
import { useOcio } from '@/state/ocioContext';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  cloneProjectColorManagement,
  colorManagementService,
  createProjectColorManagementFromOcioDefaults,
  stripBuiltinConfigPrefix,
} from '@/color-management';
import { useOcioConfigSnapshot } from '@/hooks/useOcioConfigSnapshot';
import { colors } from '@/utils/colors';
import { useDebugLog } from '@/utils/debugLogContext';
import { getComfyEndpoint } from '@/utils/aiRouting';
import { DEFAULT_COMFY_ENDPOINT } from '@/services/comfy/client';
import { Badge, ColorPicker, Slider, ToggleSwitch } from '@blackboard/ui';
import {
  ColorManagementSettingsEditor,
  PreferenceBentoCard,
  PreferenceBentoControl,
  PreferenceBentoEmptyState,
  PreferenceBentoResetButton,
  SegmentedControl,
  SettingsPanelFrame,
} from '@/components';
import ViewportBackground from '@/components/ViewportBackground';
import { normalizeComfyEndpoint } from '@/services/comfy/client';
import OnnxModelsPreferences from './OnnxModelsPreferences';
import IntegrationsPreferences from './IntegrationsPreferences';
import StorageMountPreferences from './StorageMountPreferences';
import {
  getDefaultPreferencesColorScope,
  type PreferencesColorScope,
  type PreferencesSectionId,
} from './preferencesNavigation';
import * as Icons from '@blackboard/icons';
import type {
  AiProvider,
  ColorConfigReference,
  DirectoryImportModePreference,
  ProjectColorManagement,
  RotoMotionCueScope,
  RotoMotionCueMode,
} from '@blackboard/types';

interface PreferencesViewProps {
  onBack: () => void;
  initialSection?: PreferencesSectionId;
  initialColorScope?: PreferencesColorScope;
}

type PreferenceSectionIcon = React.ComponentType<{ className?: string }>;
type PreferenceSectionGroup = 'app' | 'node';

const preferenceSections: {
  id: PreferencesSectionId;
  label: string;
  description: string;
  icon: PreferenceSectionIcon;
  group: PreferenceSectionGroup;
}[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, panel finish, and control styling',
    icon: Icons.Sun,
    group: 'app',
  },
  {
    id: 'viewport',
    label: 'Viewport',
    description: 'Canvas background, sampling, and alpha overlays',
    icon: Icons.Photo,
    group: 'app',
  },
  {
    id: 'colorManagement',
    label: 'Color',
    description: 'New project defaults and per-project overrides',
    icon: Icons.Eye,
    group: 'app',
  },
  {
    id: 'editing',
    label: 'Editing',
    description: 'Playback defaults and editor behavior',
    icon: Icons.Brush,
    group: 'app',
  },
  {
    id: 'recovery',
    label: 'Recovery',
    description: 'Undo depth and project reopen history',
    icon: Icons.RotateLoop,
    group: 'app',
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'Browser, folder, object, and workspace mounts',
    icon: Icons.Stack,
    group: 'app',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'External services and local backends',
    icon: Icons.Link,
    group: 'app',
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Model library, dependencies, and browser ONNX inference',
    icon: Icons.CubeTransparent,
    group: 'app',
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Realtime quality, prefetching, and cache budgets',
    icon: Icons.ComputerDesktop,
    group: 'app',
  },
  {
    id: 'rotoMotion',
    label: 'Roto',
    description: 'Motion cues, tracking, and blur for the Roto node',
    icon: Icons.Curve,
    group: 'node',
  },
  {
    id: 'debug',
    label: 'Debug',
    description: 'Developer debug tools and event log',
    icon: Icons.CodeBracket,
    group: 'app',
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

const formatColorConfigLabel = (config: ColorConfigReference): string =>
  config.kind === 'builtin' ? stripBuiltinConfigPrefix(config.uri) : config.uri;

function ToggleField({
  checked,
  onCheckedChange,
  ariaLabel,
  activeLabel = 'Enabled',
  inactiveLabel = 'Disabled',
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <Badge variant={checked ? 'accent' : 'neutral'}>
        {checked ? activeLabel : inactiveLabel}
      </Badge>
      <ToggleSwitch checked={checked} ariaLabel={ariaLabel} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function AccentSwatch({
  colorKey,
  isActive,
  onSelect,
}: {
  colorKey: string;
  isActive: boolean;
  onSelect: () => void;
}) {
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
}

function SettingsGroup({
  children,
}: {
  title?: string;
  description?: string;
  icon?: PreferenceSectionIcon;
  highlights?: string[];
  children: React.ReactNode;
}) {
  return <div className="space-y-3 bg-gray-950">{children}</div>;
}

function SettingsRow({
  title,
  description,
  children,
  stacked = false,
  controlClassName,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  stacked?: boolean;
  controlClassName?: string;
}) {
  return (
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
}

function PreferencesView({
  onBack,
  initialSection = 'appearance',
  initialColorScope,
}: PreferencesViewProps) {
  const ocio = useOcio();
  const projectId = useEditorSelector((state) => state.projectId);
  const projectColorManagement = useEditorSelector((state) => state.colorManagement);
  const { setProjectColorManagement } = useEditorActions();
  const {
    primaryColor,
    thumbnailMode,
    uiStyle,
    codeEditorWordWrap,
    compareChordHoldMs,
    playbackMode,
    undoHistoryLimit,
    reopenHistoryLimit,
    autoCheckpointEnabled,
    backgroundPrefetchMode,
    backgroundPrefetchFrameWindow,
    cacheBudgetMode,
    maxCacheSizeMB,
    maxCachedFrames,
    aiTaskRoutes,
    integrationConnections,
    newProjectColorManagement,
    enableToolSorting,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    rotoMotionCueScope,
    rotoMotionTrailFrames,
    previewOptimizeWhileEditing,
    previewOptimizeFrameChanges,
    previewRefineDelayMs,
    previewPlaybackMode,
    previewMaxDimension,
    previewSampleLimit,
    rotoPointWeightMode,
    rotoTrackingBackgroundEnabled,
    rotoTrackingDriftTolerance,
    directoryImportModePreference,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
    viewportBackgroundMode,
    viewportBackgroundColor,
    viewportInterpolation,
    viewportPixelGridEnabled,
    viewportPixelGridZoomThresholdPercent,
    autoDetectViewportView,
    timelineCacheMode,
    componentStyle,
    debugMode,
    setPreferences,
  } = usePreferences();
  const { entries: debugLogEntries, clearLog: clearDebugLog } = useDebugLog();
  const [activeSection, setActiveSection] = React.useState<PreferencesSectionId>(initialSection);
  const [colorScope, setColorScope] = React.useState<PreferencesColorScope>(
    getDefaultPreferencesColorScope(projectId, initialColorScope),
  );
  const [configSelection, setConfigSelection] = React.useState<{
    scope: 'application' | 'project';
    isLoading: boolean;
    error: string | null;
  } | null>(null);
  const configSelectionRevisionRef = React.useRef(0);
  const recommendedCacheSizeMB = getRecommendedCacheSizeMB();

  React.useEffect(() => {
    if (!projectId && colorScope === 'project') setColorScope('application');
  }, [colorScope, projectId]);

  React.useEffect(
    () => () => {
      configSelectionRevisionRef.current += 1;
    },
    [],
  );

  const uiStyleOptions = [
    { value: 'glass', label: 'Frosted' },
    { value: 'solid', label: 'Solid' },
  ];

  const componentStyleOptions = [
    { value: 'glass', label: 'Glass' },
    { value: 'flat', label: 'Flat' },
  ];

  const playbackOptions = [
    { value: 'realtime', label: 'Real-time' },
    { value: 'every_frame', label: 'Every frame' },
  ];

  const undoHistoryLimitOptions = [
    { value: 50, label: '50' },
    { value: 100, label: '100' },
    { value: 200, label: '200' },
    { value: 500, label: '500' },
    { value: 'unlimited', label: 'Unlimited' },
  ];

  const reopenHistoryLimitOptions = [
    { value: 0, label: 'Off' },
    { value: 20, label: '20' },
    { value: 50, label: '50' },
    { value: 100, label: '100' },
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
    { value: 'auto', label: 'Auto' },
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

  const previewPlaybackModeOptions = [
    { value: 'auto', label: 'Auto' },
    { value: 'optimized', label: 'Optimized' },
    { value: 'full', label: 'Full' },
  ];

  const rotoTrackingRunModeOptions = [
    { value: 'inline', label: 'Inline' },
    { value: 'background', label: 'Background' },
  ];

  const rotoPointWeightModeOptions = [
    { value: 'global', label: 'Global Pull' },
    { value: 'local', label: 'Local Pull' },
  ];

  const previewOptimizationEnabled =
    previewOptimizeWhileEditing || previewOptimizeFrameChanges || previewPlaybackMode !== 'full';

  const alphaOverlayColorSourceOptions = [
    { value: 'accent', label: 'Accent' },
    { value: 'custom', label: 'Custom' },
  ];

  const viewportInterpolationOptions = [
    { value: 'nearest', label: 'Nearest' },
    { value: 'linear', label: 'Linear' },
  ];

  const viewportBackgroundOptions = [
    {
      value: 'none',
      label: 'None',
      description: 'Workspace default',
    },
    {
      value: 'checkerboard',
      label: 'Checkerboard',
      description: 'Reveal transparency',
    },
    {
      value: 'grid',
      label: 'Grid',
      description: 'Alignment guide',
    },
    {
      value: 'custom',
      label: 'Custom color',
      description: 'Choose a solid color',
    },
  ];

  const {
    snapshot: selectedNewProjectOcio,
    isLoading: isSelectedNewProjectOcioLoading,
    error: selectedNewProjectOcioError,
  } = useOcioConfigSnapshot(newProjectColorManagement.config);
  const setNewProjectColorManagement = React.useCallback(
    (nextValue: ProjectColorManagement) => {
      setPreferences({
        newProjectColorManagement: cloneProjectColorManagement(nextValue),
      });
    },
    [setPreferences],
  );
  const setColorConfig = React.useCallback(
    async (scope: 'application' | 'project', config: ColorConfigReference) => {
      const revision = ++configSelectionRevisionRef.current;
      setConfigSelection({ scope, isLoading: true, error: null });
      const runtime = await colorManagementService.inspectConfig(config);
      if (revision !== configSelectionRevisionRef.current) return;
      if (!runtime.isInitialized || runtime.error) {
        setConfigSelection({
          scope,
          isLoading: false,
          error: runtime.error ?? `Could not load OCIO config "${config.uri}".`,
        });
        return;
      }

      const currentValue = scope === 'project' ? projectColorManagement : newProjectColorManagement;
      const nextValue = createProjectColorManagementFromOcioDefaults(config, runtime);
      if (currentValue.context) nextValue.context = { ...currentValue.context };

      if (scope === 'project') {
        setProjectColorManagement(nextValue, {
          historyLabel: 'Change Project OCIO Config',
        });
      } else {
        setNewProjectColorManagement(nextValue);
      }
      setConfigSelection(null);
    },
    [
      newProjectColorManagement,
      projectColorManagement,
      setNewProjectColorManagement,
      setProjectColorManagement,
    ],
  );
  const isProjectColorScope = colorScope === 'project' && Boolean(projectId);
  const scopedColorManagement = isProjectColorScope
    ? projectColorManagement
    : newProjectColorManagement;
  const scopedColorRuntime = isProjectColorScope ? ocio : selectedNewProjectOcio;
  const scopedConfigSelection =
    configSelection?.scope === (isProjectColorScope ? 'project' : 'application')
      ? configSelection
      : null;
  const scopedColorLoading =
    scopedConfigSelection?.isLoading || (!isProjectColorScope && isSelectedNewProjectOcioLoading);
  const scopedColorError =
    scopedConfigSelection?.error || (!isProjectColorScope ? selectedNewProjectOcioError : null);
  const trimmedComfyEndpoint = normalizeComfyEndpoint(
    getComfyEndpoint({ integrationConnections }) ?? DEFAULT_COMFY_ENDPOINT,
  );
  const aiRouteCountsByProvider = React.useMemo(() => {
    const counts: Record<AiProvider, number> = { openai: 0, ollama: 0 };
    Object.values(aiTaskRoutes).forEach((route) => {
      counts[route.provider] += 1;
    });
    return counts;
  }, [aiTaskRoutes]);
  const activeSectionMeta =
    preferenceSections.find((section) => section.id === activeSection) ?? preferenceSections[0];
  const activeSectionHighlights: Record<PreferencesSectionId, string[]> = {
    appearance: [
      `${colorDisplayNames[primaryColor] ?? primaryColor} accent`,
      uiStyle === 'glass' ? 'Frosted panels' : 'Solid panels',
      componentStyle === 'glass' ? 'Glass controls' : 'Flat controls',
    ],
    viewport: [
      viewportBackgroundMode === 'none'
        ? 'Default background'
        : (viewportBackgroundOptions.find((option) => option.value === viewportBackgroundMode)
            ?.label ?? viewportBackgroundMode),
      viewportInterpolation === 'nearest' ? 'Nearest sampling' : 'Linear sampling',
      viewportPixelGridEnabled
        ? `Pixel grid by ${viewportPixelGridZoomThresholdPercent}%`
        : 'Pixel grid off',
    ],
    colorManagement: [
      colorScope === 'project' && projectId ? 'Current project' : 'App defaults',
      `Config: ${formatColorConfigLabel(
        colorScope === 'project' && projectId
          ? projectColorManagement.config
          : newProjectColorManagement.config,
      )}`,
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
    recovery: [
      undoHistoryLimit === 'unlimited'
        ? 'Unlimited open-project undo'
        : `${undoHistoryLimit} open-project steps`,
      reopenHistoryLimit === 0 ? 'Reopen history off' : `${reopenHistoryLimit} steps after reopen`,
      autoCheckpointEnabled ? 'Auto checkpoints on' : 'Manual checkpoints only',
    ],
    storage: [
      colorScope === 'project' && projectId ? 'Current project workflow' : 'New project defaults',
      'Browser storage by default',
      'Multi-mount assets and Gallery',
    ],
    integrations: [
      `${integrationConnections.length} connection${integrationConnections.length === 1 ? '' : 's'}`,
      `${Object.keys(aiTaskRoutes).length} task routes`,
      `OpenAI ${aiRouteCountsByProvider.openai} · Ollama ${aiRouteCountsByProvider.ollama}`,
      `Comfy ${trimmedComfyEndpoint}`,
    ],
    models: [
      'Built-in and plugin model requirements',
      'ONNX Runtime Web',
      'Hugging Face import',
      'WebGPU with WASM fallback',
    ],
    rotoMotion: [
      'Float GPU feather',
      rotoPointWeightMode === 'local' ? 'Default local pull' : 'Default full pull',
      rotoMotionCueEnabled ? 'Cue overlay on' : 'Cue overlay off',
      rotoTrackingBackgroundEnabled ? 'Background tracking' : 'Inline tracking',
      `Drift stop ${rotoTrackingDriftTolerance !== null ? rotoTrackingDriftTolerance.toFixed(1) : '∞'}`,
    ],
    performance: [
      previewOptimizationEnabled
        ? `${previewMaxDimension}px · ${previewSampleLimit} samples`
        : 'Full-quality viewport',
      previewPlaybackMode === 'auto'
        ? 'Adaptive playback quality'
        : previewPlaybackMode === 'optimized'
          ? 'Optimized playback'
          : 'Full-quality playback',
      backgroundPrefetchMode === 'on_demand'
        ? 'On-demand prefetch'
        : backgroundPrefetchMode === 'auto'
          ? 'Auto prefetch'
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
      timelineCacheMode === 'consolidated' ? 'Merged cache bar' : 'Per-node cache bars',
    ],
    debug: [
      debugMode ? 'Debug mode on' : 'Debug mode off',
      `${debugLogEntries.length} log entries`,
    ],
  };

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
              description="Frosted panels are translucent with blur; Solid panels are fully opaque."
            >
              <SegmentedControl
                options={uiStyleOptions}
                value={uiStyle}
                onChange={(style) => setPreferences({ uiStyle: style as 'glass' | 'solid' })}
              />
            </SettingsRow>

            <SettingsRow
              title="Component style"
              description="Glass controls sit above the surface with depth, rim lighting, and backdrop blur; Flat keeps them minimal and clean."
            >
              <SegmentedControl
                options={componentStyleOptions}
                value={componentStyle}
                onChange={(style) => setPreferences({ componentStyle: style as 'glass' | 'flat' })}
              />
            </SettingsRow>
          </SettingsGroup>
        );
      case 'viewport':
        return (
          <SettingsGroup
            title="Viewport"
            description="Choose how transparent and empty areas read while you work. These settings only affect the editor viewport."
            icon={Icons.Photo}
            highlights={activeSectionHighlights.viewport}
          >
            <SettingsRow
              title="Background"
              description="None keeps the current workspace background. Checkerboard and grid improve transparency and alignment visibility."
              stacked
            >
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {viewportBackgroundOptions.map((option) => {
                    const mode = option.value as ViewportBackgroundMode;
                    const isActive = viewportBackgroundMode === mode;

                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPreferences({ viewportBackgroundMode: mode })}
                        aria-pressed={isActive}
                        className={`group flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 ${
                          isActive
                            ? 'border-primary-400/35 bg-primary-500/10 shadow-[0_12px_30px_rgba(0,0,0,0.28)] ring-1 ring-inset ring-primary-300/20'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                          <ViewportBackground
                            mode={mode}
                            color={viewportBackgroundColor}
                            className="absolute inset-0"
                          />
                          {mode === 'none' && (
                            <span className="absolute inset-0 grid place-items-center text-lg text-gray-600">
                              —
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm font-medium ${
                              isActive ? 'text-white' : 'text-gray-200'
                            }`}
                          >
                            {option.label}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                            {option.description}
                          </span>
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
                  })}
                </div>
                {viewportBackgroundMode === 'custom' && (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <ColorPicker
                      label="Viewport background color"
                      value={viewportBackgroundColor}
                      onChange={(value) => setPreferences({ viewportBackgroundColor: value })}
                    />
                  </div>
                )}
              </div>
            </SettingsRow>

            <SettingsRow
              title="Image interpolation"
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
              title="Pixel grid"
              description="Shows native image-pixel boundaries when the viewport reaches the chosen zoom level."
            >
              <ToggleField
                checked={viewportPixelGridEnabled}
                onCheckedChange={(checked) => setPreferences({ viewportPixelGridEnabled: checked })}
                ariaLabel="Toggle viewport pixel grid"
                activeLabel="Automatic"
                inactiveLabel="Hidden"
              />
            </SettingsRow>

            {viewportPixelGridEnabled && (
              <SettingsRow
                title="Pixel grid zoom"
                description="The grid eases in over the preceding 100% zoom and is fully visible at this level."
                stacked
              >
                <Slider
                  label="Fully visible at"
                  value={viewportPixelGridZoomThresholdPercent}
                  min={ViewportPixelGridThresholdPercent.MIN}
                  max={ViewportPixelGridThresholdPercent.MAX}
                  step={ViewportPixelGridThresholdPercent.STEP}
                  onChange={(value) =>
                    setPreferences({ viewportPixelGridZoomThresholdPercent: value })
                  }
                  onReset={() =>
                    setPreferences({
                      viewportPixelGridZoomThresholdPercent:
                        ViewportPixelGridThresholdPercent.DEFAULT,
                    })
                  }
                  displayFormatter={(value) => `${Math.round(value)}%`}
                />
              </SettingsRow>
            )}

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
      case 'colorManagement':
        return (
          <SettingsGroup
            title="Color Management"
            description={
              isProjectColorScope
                ? 'Color management stored in the current project.'
                : 'Defaults copied into each project when it is created.'
            }
            icon={Icons.Eye}
            highlights={activeSectionHighlights.colorManagement}
          >
            <nav
              aria-label="Color settings scope"
              className="mb-3 flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2"
            >
              <span className="shrink-0 px-1 text-xs font-medium text-gray-500">Color</span>
              <Icons.ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-600" />
              <div className="flex min-w-0 flex-wrap gap-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isProjectColorScope}
                  onClick={() => setColorScope('application')}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    !isProjectColorScope
                      ? 'bg-primary-500/15 text-primary-100'
                      : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
                  }`}
                >
                  App defaults
                </button>
                {projectId ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isProjectColorScope}
                    onClick={() => setColorScope('project')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      isProjectColorScope
                        ? 'bg-primary-500/15 text-primary-100'
                        : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
                    }`}
                  >
                    Current project
                  </button>
                ) : null}
              </div>
            </nav>

            <ColorManagementSettingsEditor
              scope={isProjectColorScope ? 'project' : 'application'}
              value={scopedColorManagement}
              runtime={scopedColorRuntime}
              builtinConfigs={ocio.builtinConfigs}
              isLoading={Boolean(scopedColorLoading)}
              configError={scopedColorError}
              onChange={
                isProjectColorScope ? setProjectColorManagement : setNewProjectColorManagement
              }
              onConfigChange={(config) =>
                void setColorConfig(isProjectColorScope ? 'project' : 'application', config)
              }
              autoDetectViewportView={autoDetectViewportView}
              onAutoDetectViewportViewChange={(checked) =>
                setPreferences({ autoDetectViewportView: checked })
              }
            />
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

            <SettingsRow
              title="Compare chord hold"
              description="How long two viewer slot keys must overlap before compare mode activates."
              stacked
            >
              <Slider
                label="Compare Chord Hold"
                value={compareChordHoldMs}
                min={CompareChordHoldMs.MIN}
                max={CompareChordHoldMs.MAX}
                step={10}
                onChange={(value) => setPreferences({ compareChordHoldMs: value })}
                onReset={() => setPreferences({ compareChordHoldMs: CompareChordHoldMs.DEFAULT })}
                displayFormatter={(value) => `${Math.round(value)} ms`}
              />
            </SettingsRow>
          </SettingsGroup>
        );
      case 'recovery':
        return (
          <SettingsGroup
            title="Recovery"
            description="Choose how much undo state Studio keeps in memory and how much it writes into project storage."
            icon={Icons.RotateLoop}
            highlights={activeSectionHighlights.recovery}
          >
            <SettingsRow
              title="Undo History"
              description="Keep temporary undo steps while the project is open."
            >
              <SegmentedControl
                options={undoHistoryLimitOptions}
                value={undoHistoryLimit}
                onChange={(limit) =>
                  setPreferences({
                    undoHistoryLimit: limit as UndoHistoryLimitPreference,
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Reopen History"
              description="Save recent undo steps so they are available after reopening the project."
            >
              <SegmentedControl
                options={reopenHistoryLimitOptions}
                value={reopenHistoryLimit}
                onChange={(limit) =>
                  setPreferences({
                    reopenHistoryLimit: limit as ReopenHistoryLimitPreference,
                  })
                }
              />
            </SettingsRow>

            <SettingsRow
              title="Auto Checkpoint"
              description="Automatically pin the current history event when Studio saves a project branch snapshot."
            >
              <ToggleField
                checked={autoCheckpointEnabled}
                ariaLabel="Toggle automatic history checkpoints"
                activeLabel="Automatic"
                inactiveLabel="Manual only"
                onCheckedChange={(checked) => setPreferences({ autoCheckpointEnabled: checked })}
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
            <IntegrationsPreferences />
          </SettingsGroup>
        );
      case 'storage':
        return (
          <StorageMountPreferences
            projectId={projectId}
            scope={colorScope}
            onScopeChange={setColorScope}
          />
        );
      case 'models':
        return <OnnxModelsPreferences />;
      case 'rotoMotion':
        return (
          <SettingsGroup
            title="Roto"
            description="Tune Roto point interaction, tracking, and motion feedback."
            icon={Icons.Curve}
            highlights={activeSectionHighlights.rotoMotion}
          >
            <div className="grid items-start gap-3 lg:grid-cols-12">
              <PreferenceBentoCard
                title="Interaction & tracking"
                description="Choose how point edits behave and how tracking work is scheduled and validated."
                icon={Icons.CursorArrow}
                headerAction={
                  <PreferenceBentoResetButton
                    label="Reset interaction and tracking settings"
                    onReset={() =>
                      setPreferences({
                        rotoPointWeightMode: 'global',
                        rotoTrackingBackgroundEnabled: false,
                        rotoTrackingDriftTolerance: RotoTrackingDriftTolerance.DEFAULT,
                      })
                    }
                  />
                }
                className="lg:col-span-12"
              >
                <PreferenceBentoControl
                  title="Default point pull"
                  description="Starting influence mode for point-weight drags."
                  stacked
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
                </PreferenceBentoControl>

                <PreferenceBentoControl
                  title="Tracking run mode"
                  description="Background jobs keep the playhead free during longer tracks."
                  stacked
                >
                  <SegmentedControl
                    options={rotoTrackingRunModeOptions}
                    value={rotoTrackingBackgroundEnabled ? 'background' : 'inline'}
                    onChange={(mode) =>
                      setPreferences({
                        rotoTrackingBackgroundEnabled: mode === 'background',
                      })
                    }
                  />
                </PreferenceBentoControl>

                <PreferenceBentoControl
                  title="Drift tolerance"
                  description="Stop when average optical-flow error crosses this threshold. Use ∞ to never stop automatically."
                  stacked
                >
                  <Slider
                    label="Tracking Drift Tolerance"
                    value={rotoTrackingDriftTolerance ?? RotoTrackingDriftTolerance.OVERFLOW}
                    min={RotoTrackingDriftTolerance.MIN}
                    max={RotoTrackingDriftTolerance.MAX}
                    step={RotoTrackingDriftTolerance.STEP}
                    overflowLabel="∞"
                    onChange={(value) =>
                      setPreferences({
                        rotoTrackingDriftTolerance:
                          value >= RotoTrackingDriftTolerance.OVERFLOW ? null : value,
                      })
                    }
                    onReset={() =>
                      setPreferences({
                        rotoTrackingDriftTolerance: RotoTrackingDriftTolerance.DEFAULT,
                      })
                    }
                    displayFormatter={(value) => value.toFixed(1)}
                  />
                </PreferenceBentoControl>
              </PreferenceBentoCard>

              <PreferenceBentoCard
                title="Motion cue overlay"
                description="Visualize direction and speed around the current frame without changing the rendered result."
                icon={Icons.Sparkles}
                headerAction={
                  <div className="flex items-center gap-2">
                    <ToggleSwitch
                      checked={rotoMotionCueEnabled}
                      ariaLabel="Toggle motion cue overlay"
                      onCheckedChange={(checked) =>
                        setPreferences({ rotoMotionCueEnabled: checked })
                      }
                    />
                    <PreferenceBentoResetButton
                      label="Reset motion cue overlay settings"
                      onReset={() =>
                        setPreferences({
                          rotoMotionCueEnabled: false,
                          rotoMotionCueMode: 'gradient_trail',
                          rotoMotionCueScope: 'selected',
                          rotoMotionTrailFrames: 3,
                        })
                      }
                    />
                  </div>
                }
                className="lg:col-span-12"
              >
                {rotoMotionCueEnabled ? (
                  <div className="grid md:grid-cols-3 md:divide-x md:divide-white/[0.07]">
                    <div className="md:pr-4">
                      <PreferenceBentoControl
                        title="Cue style"
                        description="Temporal trails or speed-mapped lines."
                        stacked
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
                      </PreferenceBentoControl>
                    </div>
                    <div className="md:px-4">
                      <PreferenceBentoControl
                        title="Path scope"
                        description="Show cues for selected or all paths."
                        stacked
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
                      </PreferenceBentoControl>
                    </div>
                    <div className="md:pl-4">
                      <PreferenceBentoControl
                        title="Trail window"
                        description="More frames add context and visual density."
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
                      </PreferenceBentoControl>
                    </div>
                  </div>
                ) : (
                  <PreferenceBentoEmptyState icon={Icons.EyeSlash}>
                    Turn on the overlay to configure cue style, path scope, and trail length.
                  </PreferenceBentoEmptyState>
                )}
              </PreferenceBentoCard>
            </div>
          </SettingsGroup>
        );
      case 'debug':
        return (
          <SettingsGroup
            title="Debug"
            description="Developer tools for inspecting agent behavior and application events."
            icon={Icons.CodeBracket}
            highlights={activeSectionHighlights.debug}
          >
            <SettingsRow
              title="Debug mode"
              description="Enables additional debug information in the chats view and other panels."
            >
              <ToggleField
                checked={debugMode}
                ariaLabel="Toggle debug mode"
                activeLabel="Enabled"
                inactiveLabel="Disabled"
                onCheckedChange={(checked) => setPreferences({ debugMode: checked })}
              />
            </SettingsRow>

            <SettingsRow
              title="Event log"
              description="Recent debug events captured in memory. Disabled when debug mode is off."
              stacked
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    {debugLogEntries.length} event{debugLogEntries.length === 1 ? '' : 's'} logged
                  </span>
                  <button
                    type="button"
                    onClick={clearDebugLog}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-gray-300 transition hover:bg-white/[0.08]"
                  >
                    Clear log
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2 font-mono text-[10px] leading-5">
                  {debugLogEntries.length === 0 ? (
                    <span className="text-gray-500">No events logged yet.</span>
                  ) : (
                    [...debugLogEntries].reverse().map((entry) => (
                      <div key={entry.id} className="flex min-w-0 gap-2 py-0.5">
                        <span className="shrink-0 text-gray-500">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={`shrink-0 w-14 ${
                            entry.type === 'error'
                              ? 'text-red-300'
                              : entry.type === 'tool_call'
                                ? 'text-cyan-300'
                                : entry.type === 'tool_result'
                                  ? 'text-green-300'
                                  : 'text-gray-400'
                          }`}
                        >
                          {entry.type}
                        </span>
                        <span className="shrink-0 text-gray-500">{entry.source}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-200">
                          {entry.detail}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </SettingsRow>
          </SettingsGroup>
        );
      case 'performance':
      default:
        return (
          <SettingsGroup
            title="Performance"
            description="Balance realtime preview responsiveness, reliable full-quality refinement, and memory usage."
            icon={Icons.ComputerDesktop}
            highlights={activeSectionHighlights.performance}
          >
            <div className="grid items-start gap-3 lg:grid-cols-12">
              <PreferenceBentoCard
                title="Realtime preview"
                description="Share one temporary resolution and sampling budget across adaptive nodes. Idle and export renders always return to full quality."
                icon={Icons.Play}
                headerAction={
                  <div className="flex items-center gap-2">
                    <ToggleSwitch
                      checked={previewOptimizationEnabled}
                      ariaLabel="Toggle all optimized viewport preview modes"
                      onCheckedChange={(checked) =>
                        setPreferences(
                          checked
                            ? {
                                previewOptimizeWhileEditing: true,
                                previewOptimizeFrameChanges: true,
                                previewPlaybackMode: 'auto',
                              }
                            : {
                                previewOptimizeWhileEditing: false,
                                previewOptimizeFrameChanges: false,
                                previewPlaybackMode: 'full',
                              },
                        )
                      }
                    />
                    <PreferenceBentoResetButton
                      label="Reset realtime preview settings"
                      onReset={() =>
                        setPreferences({
                          previewOptimizeWhileEditing: true,
                          previewOptimizeFrameChanges: true,
                          previewPlaybackMode: 'auto',
                          previewMaxDimension: PreviewMaxDimension.DEFAULT,
                          previewRefineDelayMs: PreviewRefineDelay.DEFAULT,
                          previewSampleLimit: PreviewSampleLimit.DEFAULT,
                        })
                      }
                    />
                  </div>
                }
                className="lg:col-span-12"
              >
                <div className="grid md:grid-cols-3 md:divide-x md:divide-white/[0.07]">
                  <div className="md:pr-4">
                    <PreferenceBentoControl
                      title="While editing"
                      description="Use the proxy budget during node and viewport interaction, then refine."
                    >
                      <ToggleField
                        checked={previewOptimizeWhileEditing}
                        ariaLabel="Toggle optimized preview while editing"
                        activeLabel="Optimized"
                        inactiveLabel="Full"
                        onCheckedChange={(checked) =>
                          setPreferences({ previewOptimizeWhileEditing: checked })
                        }
                      />
                    </PreferenceBentoControl>
                  </div>
                  <div className="md:px-4">
                    <PreferenceBentoControl
                      title="Frame changes"
                      description="Stay full while frames are fast; use coarse-to-fine only after the render misses its budget."
                    >
                      <ToggleField
                        checked={previewOptimizeFrameChanges}
                        ariaLabel="Toggle optimized preview during frame changes"
                        activeLabel="Adaptive"
                        inactiveLabel="Full"
                        onCheckedChange={(checked) =>
                          setPreferences({ previewOptimizeFrameChanges: checked })
                        }
                      />
                    </PreferenceBentoControl>
                  </div>
                  <div className="md:pl-4">
                    <PreferenceBentoControl
                      title="Playback quality"
                      description="Auto reduces quality only after the render exceeds its frame budget."
                      stacked
                    >
                      <SegmentedControl
                        options={previewPlaybackModeOptions}
                        value={previewPlaybackMode}
                        onChange={(mode) =>
                          setPreferences({ previewPlaybackMode: mode as PreviewPlaybackMode })
                        }
                      />
                    </PreferenceBentoControl>
                  </div>
                </div>

                {previewOptimizationEnabled ? (
                  <div className="grid border-t border-white/[0.07] md:grid-cols-3 md:divide-x md:divide-white/[0.07]">
                    <div className="pt-4 md:pr-4">
                      <PreferenceBentoControl
                        title="Proxy long edge"
                        description="Maximum temporary processing size, also bounded by the viewport."
                        stacked
                      >
                        <Slider
                          label="Proxy Long Edge"
                          value={previewMaxDimension}
                          min={PreviewMaxDimension.MIN}
                          max={PreviewMaxDimension.MAX}
                          step={PreviewMaxDimension.STEP}
                          onChange={(value) =>
                            setPreferences({ previewMaxDimension: Math.round(value) })
                          }
                          onReset={() =>
                            setPreferences({ previewMaxDimension: PreviewMaxDimension.DEFAULT })
                          }
                          displayFormatter={(value) => `${Math.round(value)} px`}
                        />
                      </PreferenceBentoControl>
                    </div>
                    <div className="pt-4 md:px-4">
                      <PreferenceBentoControl
                        title="Full-quality refine delay"
                        description="Quiet time before the proxy is replaced by an exact result."
                        stacked
                      >
                        <Slider
                          label="Refine Delay"
                          value={previewRefineDelayMs}
                          min={PreviewRefineDelay.MIN}
                          max={PreviewRefineDelay.MAX}
                          step={PreviewRefineDelay.STEP}
                          onChange={(value) =>
                            setPreferences({ previewRefineDelayMs: Math.round(value) })
                          }
                          onReset={() =>
                            setPreferences({ previewRefineDelayMs: PreviewRefineDelay.DEFAULT })
                          }
                          displayFormatter={(value) => `${Math.round(value)} ms`}
                        />
                      </PreferenceBentoControl>
                    </div>
                    <div className="pt-4 md:pl-4">
                      <PreferenceBentoControl
                        title="Preview sample limit"
                        description="Caps adaptive matte, blur, bokeh, and motion-blur work per pass."
                        stacked
                      >
                        <Slider
                          label="Preview Sample Limit"
                          value={previewSampleLimit}
                          min={PreviewSampleLimit.MIN}
                          max={PreviewSampleLimit.MAX}
                          step={PreviewSampleLimit.STEP}
                          onChange={(value) =>
                            setPreferences({ previewSampleLimit: Math.round(value) })
                          }
                          onReset={() =>
                            setPreferences({ previewSampleLimit: PreviewSampleLimit.DEFAULT })
                          }
                          displayFormatter={(value) => `${Math.round(value)}`}
                        />
                      </PreferenceBentoControl>
                    </div>
                  </div>
                ) : (
                  <PreferenceBentoEmptyState icon={Icons.Sparkles}>
                    Enable an optimized preview mode to configure its shared quality budget.
                  </PreferenceBentoEmptyState>
                )}
              </PreferenceBentoCard>
            </div>

            <SettingsRow
              title="Background prefetch"
              description="Auto follows the current scrub or playback direction. On demand only loads the current frame. Forward fills ahead. Bidirectional keeps context on both sides."
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
                description="Maximum number of adjacent frames to queue in the background."
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
                    backgroundPrefetchMode === 'auto'
                      ? `Auto ${Math.round(value)}f`
                      : backgroundPrefetchMode === 'bidirectional'
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

            <SettingsRow
              title="Timeline cache display"
              description="Consolidated merges all media cache into one combined bar. Separate shows each media node as a distinct colored bar."
            >
              <SegmentedControl
                options={[
                  {
                    value: 'consolidated',
                    label: 'Consolidated',
                    description: 'Single merged bar',
                  },
                  { value: 'separate', label: 'Separate', description: 'Per-node colored bars' },
                ]}
                value={timelineCacheMode}
                onChange={(mode) =>
                  setPreferences({ timelineCacheMode: mode as TimelineCacheMode })
                }
              />
            </SettingsRow>
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
            {(['app', 'node'] as PreferenceSectionGroup[]).map((group) => (
              <div key={group} className="mb-2">
                <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  {group === 'app' ? 'Application' : 'Node Specific'}
                </p>
                <nav className="grid gap-1 sm:grid-cols-2 md:grid-cols-1">
                  {preferenceSections
                    .filter((section) => section.group === group)
                    .map((section) => {
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
            ))}
          </div>
        }
      >
        <div key={activeSection} className="min-w-0 animate-[fadeIn_200ms_ease-out]">
          {renderSectionContent()}
        </div>
      </SettingsPanelFrame>
    </div>
  );
}

export default PreferencesView;
