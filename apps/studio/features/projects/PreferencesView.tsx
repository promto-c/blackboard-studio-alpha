import React from 'react';
import {
  RotoTrackingDriftTolerance,
  getRecommendedCacheSizeMB,
  type BackgroundPrefetchMode,
  type CacheBudgetMode,
  type ReopenHistoryLimitPreference,
  type RotoMotionBlurPreviewBackend,
  type UndoHistoryLimitPreference,
} from '@/state/preferences';
import { usePreferences } from '@/state/preferencesContext';
import { useOcio } from '@/state/ocioContext';
import { colors } from '@/utils/colors';
import { useDebugLog } from '@/utils/debugLogContext';
import { ColorPicker, StyledDropdown, ToggleSwitch } from '@blackboard/ui';
import { SegmentedControl, SettingsPanelFrame, Slider } from '@/components';
import { normalizeComfyEndpoint } from '@/services/comfy/client';
import OnnxModelsPreferences from './OnnxModelsPreferences';
import IntegrationsPreferences from './IntegrationsPreferences';
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
  | 'colorManagement'
  | 'editing'
  | 'recovery'
  | 'integrations'
  | 'models'
  | 'rotoMotion'
  | 'performance'
  | 'debug';
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
    description: 'Theme, panel finish, and preview styling',
    icon: Icons.Sun,
    group: 'app',
  },
  {
    id: 'colorManagement',
    label: 'Color',
    description: 'OpenColorIO config, displays, and working spaces',
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
    id: 'integrations',
    label: 'Integrations',
    description: 'External services and local backends',
    icon: Icons.Link,
    group: 'app',
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Browser ONNX inference and model cache',
    icon: Icons.CubeTransparent,
    group: 'app',
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Prefetching, memory, and cache budgets',
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
      className={`inline-flex min-w-0 max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${toneClassName} ${className ?? ''}`}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function OcioStatusBadges({
  isInitialized,
  isLoading,
  error,
  version,
  workingColorSpace,
  textureColorSpace,
  dataColorSpace,
}: {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  version: string;
  workingColorSpace: string;
  textureColorSpace: string;
  dataColorSpace: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <StatusBadge tone={isInitialized ? 'success' : error ? 'danger' : 'neutral'}>
        {isInitialized ? `OCIO ${version}` : isLoading ? 'Loading' : 'Unavailable'}
      </StatusBadge>
      <StatusBadge tone="accent">{workingColorSpace}</StatusBadge>
      <StatusBadge tone="neutral" className="max-w-[min(100%,16rem)]">
        {textureColorSpace}
      </StatusBadge>
      <StatusBadge tone="neutral">{dataColorSpace}</StatusBadge>
    </div>
  );
}

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
      <StatusBadge tone={checked ? 'accent' : 'neutral'}>
        {checked ? activeLabel : inactiveLabel}
      </StatusBadge>
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

function PreferencesView({ onBack }: PreferencesViewProps) {
  const ocio = useOcio();
  const {
    primaryColor,
    thumbnailMode,
    uiStyle,
    codeEditorWordWrap,
    playbackMode,
    undoHistoryLimit,
    reopenHistoryLimit,
    autoCheckpointEnabled,
    backgroundPrefetchMode,
    backgroundPrefetchFrameWindow,
    cacheBudgetMode,
    maxCacheSizeMB,
    maxCachedFrames,
    ollamaEndpoint,
    aiTaskRoutes,
    integrationConnections,
    comfyEndpoint,
    ocioConfigName,
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
    debugMode,
    setPreferences,
  } = usePreferences();
  const { entries: debugLogEntries, clearLog: clearDebugLog } = useDebugLog();
  const [activeSection, setActiveSection] = React.useState<PreferencesSectionId>('appearance');
  const recommendedCacheSizeMB = getRecommendedCacheSizeMB();

  const uiStyleOptions = [
    { value: 'glass', label: 'Glass' },
    { value: 'solid', label: 'Solid' },
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

  const ocioConfigOptions = React.useMemo(
    () =>
      ocio.builtinConfigs.map((config) => ({
        value: `ocio://${config.name}`,
        label: config.name,
        secondaryLabel: config.uiName,
        badges: config.recommended ? ['Recommended'] : [],
        searchText: `${config.name} ${config.uiName}`,
      })),
    [ocio.builtinConfigs],
  );

  const trimmedComfyEndpoint = normalizeComfyEndpoint(comfyEndpoint);
  const aiRouteCountsByProvider = React.useMemo(() => {
    const counts: Record<AiProvider, number> = { gemini: 0, openai: 0, ollama: 0 };
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
      uiStyle === 'glass' ? 'Glass panels' : 'Solid panels',
      viewportInterpolation === 'nearest' ? 'Nearest sampling' : 'Linear sampling',
    ],
    colorManagement: [
      ocio.isInitialized
        ? `OCIO ${ocio.version}`
        : ocio.isLoading
          ? 'Loading OCIO'
          : 'OCIO offline',
      ocio.workingColorSpace,
      `${ocio.displays.length} displays`,
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
    integrations: [
      `${integrationConnections.length} connection${integrationConnections.length === 1 ? '' : 's'}`,
      `${Object.keys(aiTaskRoutes).length} task routes`,
      `Gemini ${aiRouteCountsByProvider.gemini} · OpenAI ${aiRouteCountsByProvider.openai} · Ollama ${aiRouteCountsByProvider.ollama}`,
      `Comfy ${trimmedComfyEndpoint}`,
    ],
    models: ['ONNX Runtime Web', 'Hugging Face import', 'WebGPU with WASM fallback'],
    rotoMotion: [
      rotoMotionBlurPreviewBackend === 'gpu_float' ? 'GPU quality blur' : 'Realtime canvas blur',
      rotoPointWeightMode === 'local' ? 'Default local pull' : 'Default full pull',
      rotoMotionCueEnabled ? 'Cue overlay on' : 'Cue overlay off',
      rotoTrackingBackgroundEnabled ? 'Background tracking' : 'Inline tracking',
      `Drift stop ${rotoTrackingDriftTolerance !== null ? rotoTrackingDriftTolerance.toFixed(1) : '∞'}`,
      rotoMotionBlurInteractivePreviewEnabled
        ? `Interactive cap ${rotoMotionBlurInteractivePreviewSamples}`
        : 'Full samples while editing',
    ],
    performance: [
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
      case 'colorManagement':
        return (
          <SettingsGroup
            title="Color Management"
            description="OpenColorIO runtime and default project color pipeline."
            icon={Icons.Eye}
            highlights={activeSectionHighlights.colorManagement}
          >
            <SettingsRow
              title="OCIO Config"
              description="Built-in configs are loaded by the OpenColorIO 2.5 wasm runtime."
              controlClassName="lg:max-w-[34rem]"
            >
              <div className="min-w-0 space-y-2">
                <StyledDropdown
                  value={ocioConfigName}
                  options={
                    ocioConfigOptions.length > 0
                      ? ocioConfigOptions
                      : [{ value: ocioConfigName, label: ocioConfigName }]
                  }
                  onChange={(value) => setPreferences({ ocioConfigName: String(value) })}
                  popoverWidthClass="w-[34rem]"
                  searchable
                  showSelectedBadges={false}
                />
                <OcioStatusBadges
                  isInitialized={ocio.isInitialized}
                  isLoading={ocio.isLoading}
                  error={ocio.error}
                  version={ocio.version}
                  workingColorSpace={ocio.workingColorSpace}
                  textureColorSpace={ocio.textureColorSpace}
                  dataColorSpace={ocio.dataColorSpace}
                />
                {ocio.error ? (
                  <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
                    {ocio.error}
                  </div>
                ) : null}
              </div>
            </SettingsRow>

            <SettingsRow
              title="Displays"
              description="Available display devices and view transforms from the active config."
              stacked
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {ocio.displays.map((display) => (
                  <div key={display} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="truncate text-sm font-medium text-gray-100">{display}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {ocio.getViews(display).length} views
                    </div>
                  </div>
                ))}
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
      case 'models':
        return <OnnxModelsPreferences />;
      case 'rotoMotion':
        return (
          <SettingsGroup
            title="Roto"
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
              description="Stop roto tracking when the average optical-flow error for a frame rises above this value. Drag to the far end for unlimited tolerance."
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
            description="Balance scrubbing responsiveness and memory usage with clearer cache and prefetch limits."
            icon={Icons.ComputerDesktop}
            highlights={activeSectionHighlights.performance}
          >
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
