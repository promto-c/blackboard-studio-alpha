import type {
  DirectoryImportModePreference,
  PaintBrushSettings,
  PaintBrushChannels,
  PaintStrokeChannels,
  PaintStrokePathsMode,
  ProjectColorManagement,
  RotoMotionCueScope,
  RotoMotionCueMode,
} from '@blackboard/types';
import { clampRotoMotionBlurSamples } from '@/utils/rotoMotionBlur';
import {
  clampRotoInteractivePreviewSize,
  RotoInteractivePreviewSize,
} from '@/utils/rotoPreviewQuality';
export { RotoInteractivePreviewSize };
import {
  clampRotoPreviewRefineDelay,
  RotoPreviewRefineDelay,
  type RotoPlaybackPreviewMode,
} from '@/utils/rotoTemporalPreview';
export { RotoPreviewRefineDelay };
import {
  DEFAULT_ROTO_POINT_WEIGHT_MODE,
  isRotoPointWeightMode,
  type RotoPointWeightMode,
} from '@/utils/rotoPointWeights';
import {
  normalizeAiTaskRoutes,
  normalizeOpenAiBaseUrl,
  type AiTaskRoutes,
} from '@/utils/aiRouting';
import {
  EditorPanelWidth,
  EditorTimelineHeight,
  EditorSubPanelWidth,
  EditorSubPanelHeight,
  EditorItemsPanelPercent,
  clampEditor,
} from '@/utils/editorLayout';
import {
  colors,
  applyComponentStyle,
  applyTheme,
  applyUiStyle,
  type ComponentStyle,
} from '@/utils/colors';
import {
  assertProjectColorManagement,
  cloneProjectColorManagement,
  createDefaultProjectColorManagement,
} from '@/color-management/project';

// ─── Storage key ────────────────────────────────────────────────

const PREFERENCES_KEY = 'blackboard-studio-preferences';

// ─── Constants ──────────────────────────────────────────────────

const RotoTrailFrames = {
  MIN: 1,
  MAX: 8,
  DEFAULT: 3,
} as const;
const ROTO_MOTION_BLUR_INTERACTIVE_DEFAULT_SAMPLES = 16;
export const RotoTrackingDriftTolerance = {
  MIN: 1,
  MAX: 50,
  STEP: 0.5,
  DEFAULT: 15,
  UNLIMITED: null,
  /** Sentinel slider value that maps to `UNLIMITED` */
  OVERFLOW: 50.5,
} as const;
const PrefetchWindowFrames = {
  MIN: 1,
  MAX: 240,
  DEFAULT: 24,
} as const;
const MaxCachedFrames = {
  MIN: 1,
  MAX: 480,
  DEFAULT: 48,
} as const;
export const AgentMaxSubagentSpawns = {
  MIN: 0,
  MAX: 8,
  DEFAULT: 2,
} as const;
export type UndoHistoryLimitPreference = 50 | 100 | 200 | 500 | 'unlimited';
export type ReopenHistoryLimitPreference = 0 | 20 | 50 | 100;
export const DEFAULT_UNDO_HISTORY_LIMIT: UndoHistoryLimitPreference = 200;
export const DEFAULT_REOPEN_HISTORY_LIMIT: ReopenHistoryLimitPreference = 50;
export const DEFAULT_AUTO_CHECKPOINT_ENABLED = true;

export const DEFAULT_PAINT_BRUSH_SETTINGS: PaintBrushSettings = {
  size: 24,
  spacing: 20,
  softness: 30,
  stabilization: 30,
  opacity: 100,
  color: [1, 1, 1],
  alpha: 1,
  channels: 'view',
};

// ─── Exported types ─────────────────────────────────────────────

export type ThumbnailMode = 'live' | 'static' | 'off';
export type BackgroundPrefetchMode = 'on_demand' | 'auto' | 'forward' | 'bidirectional';
export type CacheBudgetMode = 'auto_memory' | 'manual_memory' | 'frame_count';
export type TimelineCacheMode = 'consolidated' | 'separate';
export type ViewportBackgroundMode = 'none' | 'checkerboard' | 'grid' | 'custom';
export type IntegrationConnectionProviderId = 'openai' | 'ollama' | 'comfy';

export interface IntegrationConnection {
  id: string;
  provider: IntegrationConnectionProviderId;
  name: string;
  endpoint?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  disabledModels?: string[];
}

export interface Preferences {
  primaryColor: string;
  thumbnailMode: ThumbnailMode;
  flowPanelHeight: number;
  uiStyle: 'glass' | 'solid';
  componentStyle: ComponentStyle;
  editorPanelWidth: number;
  editorTimelineHeight: number;
  editorSubPanelWidth: number;
  editorSubPanelHeight: number;
  editorItemsPanelPercent: number;
  codeEditorWordWrap: boolean;
  compareChordHoldMs: number;
  flowListDirection: 'bottom-up' | 'top-down';
  playbackMode: 'realtime' | 'every_frame';
  undoHistoryLimit: UndoHistoryLimitPreference;
  reopenHistoryLimit: ReopenHistoryLimitPreference;
  autoCheckpointEnabled: boolean;
  backgroundPrefetchMode: BackgroundPrefetchMode;
  backgroundPrefetchFrameWindow: number;
  cacheBudgetMode: CacheBudgetMode;
  maxCacheSizeMB: number;
  maxCachedFrames: number;
  aiTaskRoutes: AiTaskRoutes;
  integrationConnections: IntegrationConnection[];
  agentMaxSubagentSpawns: number;
  newProjectColorManagement: ProjectColorManagement;
  comfyMissingModelDetailsVisible: boolean;
  enableToolSorting: boolean;
  toolUsageCounts: Record<string, number>;
  rotoMotionCueEnabled: boolean;
  rotoMotionCueMode: RotoMotionCueMode;
  rotoMotionCueScope: RotoMotionCueScope;
  rotoMotionPathVisible: boolean;
  rotoMotionBlurPathVisible: boolean;
  rotoMotionTrailFrames: number;
  rotoMotionBlurInteractivePreviewEnabled: boolean;
  rotoFrameChangePreviewEnabled: boolean;
  rotoPreviewRefineDelayMs: number;
  rotoPlaybackPreviewMode: RotoPlaybackPreviewMode;
  rotoInteractivePreviewMaxDimension: number;
  rotoMotionBlurInteractivePreviewSamples: number;
  rotoPointWeightMode: RotoPointWeightMode;
  rotoTrackingBackgroundEnabled: boolean;
  rotoTrackingDriftTolerance: number | null;
  directoryImportModePreference: DirectoryImportModePreference;
  flowViewMode: 'list' | 'graph';
  nudgeRadius: number;
  pinnedNodeActions: string[];
  alphaOverlayColorSource: 'accent' | 'custom';
  alphaOverlayCustomColor: [number, number, number];
  alphaOverlayOpacity: number;
  alphaOverlayBgDarken: number;
  paintBrush: PaintBrushSettings;
  paintStrokePathsVisible: boolean;
  paintStrokePathsMode: PaintStrokePathsMode;
  viewportBackgroundMode: ViewportBackgroundMode;
  viewportBackgroundColor: [number, number, number];
  viewportInterpolation: 'nearest' | 'linear';
  timelineCacheMode: TimelineCacheMode;
  onnxRuntimeWebGpuEnabled: boolean;
  onnxRuntimeWasmEnabled: boolean;

  // Viewport view auto-detection
  autoDetectViewportView: boolean;

  // Debug
  debugMode: boolean;
}

// ─── Internal validators ────────────────────────────────────────

const isRotoMotionCueMode = (value: unknown): value is RotoMotionCueMode =>
  value === 'gradient_trail' || value === 'speed_heatline';

const isRotoMotionCueScope = (value: unknown): value is RotoMotionCueScope =>
  value === 'selected' || value === 'all';

const isDirectoryImportModePreference = (value: unknown): value is DirectoryImportModePreference =>
  value === 'ask' || value === 'reference' || value === 'copy';

const isAlphaOverlayColorSource = (value: unknown): value is 'accent' | 'custom' =>
  value === 'accent' || value === 'custom';

const isNormalizedRgbTriplet = (value: unknown): value is [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) return false;
  return value.every(
    (channel) =>
      typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1,
  );
};

const isPaintStrokeChannels = (value: unknown): value is PaintStrokeChannels =>
  value === 'rgb' || value === 'r' || value === 'g' || value === 'b' || value === 'a';

const isPaintBrushChannels = (value: unknown): value is PaintBrushChannels =>
  value === 'view' || isPaintStrokeChannels(value);

const clampPercent = (value: unknown, fallback: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(0, Math.min(100, numericValue));
};

const clampRotoTrailFrames = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return RotoTrailFrames.DEFAULT;
  return Math.max(RotoTrailFrames.MIN, Math.min(RotoTrailFrames.MAX, Math.round(numericValue)));
};

export const clampRotoTrackingDriftTolerance = (value: unknown): number | null => {
  if (value === null || value === 'unlimited') return null;
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return RotoTrackingDriftTolerance.DEFAULT;
  return Math.max(
    RotoTrackingDriftTolerance.MIN,
    Math.min(RotoTrackingDriftTolerance.MAX, numericValue),
  );
};

const isUndoHistoryLimitPreference = (value: unknown): value is UndoHistoryLimitPreference =>
  value === 50 || value === 100 || value === 200 || value === 500 || value === 'unlimited';

const isReopenHistoryLimitPreference = (value: unknown): value is ReopenHistoryLimitPreference =>
  value === 0 || value === 20 || value === 50 || value === 100;

const isBackgroundPrefetchMode = (value: unknown): value is BackgroundPrefetchMode =>
  value === 'on_demand' || value === 'auto' || value === 'forward' || value === 'bidirectional';

const isCacheBudgetMode = (value: unknown): value is CacheBudgetMode =>
  value === 'auto_memory' || value === 'manual_memory' || value === 'frame_count';

const isIntegrationConnectionProviderId = (
  value: unknown,
): value is IntegrationConnectionProviderId =>
  value === 'openai' || value === 'ollama' || value === 'comfy';

const sanitizeConnectionIdPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const normalizeConnectionModels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const model = entry.trim();
    if (model) seen.add(model);
  });
  return [...seen];
};

const normalizeIntegrationConnections = (value: unknown): IntegrationConnection[] => {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();

  return value.flatMap((entry, index): IntegrationConnection[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Partial<IntegrationConnection>;
    if (!isIntegrationConnectionProviderId(candidate.provider)) return [];

    const provider = candidate.provider;
    const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const name = rawName || `${provider[0].toUpperCase()}${provider.slice(1)} ${index + 1}`;
    const fallbackId = `${provider}-${sanitizeConnectionIdPart(name) || index + 1}`;
    let id =
      typeof candidate.id === 'string' && candidate.id.trim()
        ? sanitizeConnectionIdPart(candidate.id) || fallbackId
        : fallbackId;
    while (usedIds.has(id)) {
      id = `${fallbackId}-${usedIds.size + 1}`;
    }
    usedIds.add(id);

    const connection: IntegrationConnection = {
      id,
      provider,
      name,
      models: normalizeConnectionModels(candidate.models),
      disabledModels: normalizeConnectionModels(candidate.disabledModels),
    };

    if (typeof candidate.endpoint === 'string') {
      connection.endpoint = candidate.endpoint.trim();
    }
    if (typeof candidate.baseUrl === 'string') {
      connection.baseUrl = normalizeOpenAiBaseUrl(candidate.baseUrl);
    }
    if (typeof candidate.apiKey === 'string') {
      connection.apiKey = candidate.apiKey.trim();
    }

    return [connection];
  });
};

const clampPositiveInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numericValue)));
};

const clampPrefetchWindowFrames = (value: unknown): number =>
  clampPositiveInteger(
    value,
    PrefetchWindowFrames.DEFAULT,
    PrefetchWindowFrames.MIN,
    PrefetchWindowFrames.MAX,
  );

const clampMaxCachedFrames = (value: unknown): number =>
  clampPositiveInteger(value, MaxCachedFrames.DEFAULT, MaxCachedFrames.MIN, MaxCachedFrames.MAX);

export const CompareChordHoldMs = {
  MIN: 0,
  MAX: 500,
  DEFAULT: 100,
} as const;

const clampCompareChordHoldMs = (value: unknown): number =>
  clampPositiveInteger(
    value,
    CompareChordHoldMs.DEFAULT,
    CompareChordHoldMs.MIN,
    CompareChordHoldMs.MAX,
  );

const clampAgentMaxSubagentSpawns = (value: unknown): number =>
  clampPositiveInteger(
    value,
    AgentMaxSubagentSpawns.DEFAULT,
    AgentMaxSubagentSpawns.MIN,
    AgentMaxSubagentSpawns.MAX,
  );

const clampUnit = (value: unknown, fallback: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(0, Math.min(1, numericValue));
};

const normalizeNewProjectColorManagement = (value: unknown): ProjectColorManagement => {
  try {
    return cloneProjectColorManagement(assertProjectColorManagement(value));
  } catch {
    return createDefaultProjectColorManagement();
  }
};

const cloneRgbTriplet = (value: [number, number, number]): [number, number, number] => [
  value[0],
  value[1],
  value[2],
];

const normalizePaintBrushSettings = (value: unknown): PaintBrushSettings => {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as Partial<PaintBrushSettings>)
      : ({} as Partial<PaintBrushSettings>);

  return {
    size: clampPositiveInteger(
      value !== null && typeof value === 'object' && 'size' in value
        ? (value as Partial<PaintBrushSettings>).size
        : undefined,
      DEFAULT_PAINT_BRUSH_SETTINGS.size,
      1,
      256,
    ),
    softness: clampPercent(candidate.softness, DEFAULT_PAINT_BRUSH_SETTINGS.softness),
    stabilization: clampPercent(
      candidate.stabilization,
      DEFAULT_PAINT_BRUSH_SETTINGS.stabilization,
    ),
    spacing: clampPositiveInteger(candidate.spacing, DEFAULT_PAINT_BRUSH_SETTINGS.spacing, 1, 200),
    opacity: clampPercent(candidate.opacity, DEFAULT_PAINT_BRUSH_SETTINGS.opacity),
    color: isNormalizedRgbTriplet(candidate.color)
      ? cloneRgbTriplet(candidate.color)
      : cloneRgbTriplet(DEFAULT_PAINT_BRUSH_SETTINGS.color),
    alpha: clampUnit(candidate.alpha, DEFAULT_PAINT_BRUSH_SETTINGS.alpha),
    channels: isPaintBrushChannels(candidate.channels)
      ? candidate.channels
      : DEFAULT_PAINT_BRUSH_SETTINGS.channels,
  };
};

// ─── Schema-driven preference field definition ──────────────────

interface PreferenceField<T> {
  defaultValue: T;
  normalize: (value: unknown) => T;
}

// Helper constructors
const boolField = (defaultValue: boolean): PreferenceField<boolean> => ({
  defaultValue,
  normalize: (v) => (typeof v === 'boolean' ? v : defaultValue),
});

const numberField = (defaultValue: number): PreferenceField<number> => ({
  defaultValue,
  normalize: (v) => (typeof v === 'number' ? v : defaultValue),
});

const enumField = <T extends string>(
  defaultValue: T,
  validValues: readonly T[],
): PreferenceField<T> => ({
  defaultValue,
  normalize: (v) => (validValues.includes(v as T) ? (v as T) : defaultValue),
});

const customField = <T>(defaultValue: T, normalize: (v: unknown) => T): PreferenceField<T> => ({
  defaultValue,
  normalize,
});

// ─── schema ─────────────────────────────────────────────────────

const preferenceSchema: { [K in keyof Preferences]: PreferenceField<Preferences[K]> } = {
  primaryColor: customField('teal', (v) => (typeof v === 'string' && colors[v] ? v : 'teal')),
  thumbnailMode: enumField('live' as ThumbnailMode, ['live', 'static', 'off'] as const),
  flowPanelHeight: numberField(50),
  uiStyle: enumField('glass' as 'glass' | 'solid', ['glass', 'solid'] as const),
  componentStyle: enumField('glass' as ComponentStyle, ['glass', 'flat'] as const),
  editorPanelWidth: customField(EditorPanelWidth.DEFAULT, (v) => clampEditor(v, EditorPanelWidth)),
  editorTimelineHeight: customField(EditorTimelineHeight.DEFAULT, (v) =>
    clampEditor(v, EditorTimelineHeight),
  ),
  editorSubPanelWidth: customField(EditorSubPanelWidth.DEFAULT, (v) =>
    clampEditor(v, EditorSubPanelWidth),
  ),
  editorSubPanelHeight: customField(EditorSubPanelHeight.DEFAULT, (v) =>
    clampEditor(v, EditorSubPanelHeight),
  ),
  editorItemsPanelPercent: customField(EditorItemsPanelPercent.DEFAULT, (v) =>
    clampEditor(v, EditorItemsPanelPercent),
  ),
  codeEditorWordWrap: boolField(false),
  compareChordHoldMs: customField(CompareChordHoldMs.DEFAULT, clampCompareChordHoldMs),
  flowListDirection: enumField(
    'top-down' as 'bottom-up' | 'top-down',
    ['bottom-up', 'top-down'] as const,
  ),
  playbackMode: enumField(
    'realtime' as 'realtime' | 'every_frame',
    ['realtime', 'every_frame'] as const,
  ),
  undoHistoryLimit: customField(DEFAULT_UNDO_HISTORY_LIMIT as UndoHistoryLimitPreference, (v) =>
    isUndoHistoryLimitPreference(v) ? v : DEFAULT_UNDO_HISTORY_LIMIT,
  ),
  reopenHistoryLimit: customField(
    DEFAULT_REOPEN_HISTORY_LIMIT as ReopenHistoryLimitPreference,
    (v) => (isReopenHistoryLimitPreference(v) ? v : DEFAULT_REOPEN_HISTORY_LIMIT),
  ),
  autoCheckpointEnabled: boolField(DEFAULT_AUTO_CHECKPOINT_ENABLED),
  backgroundPrefetchMode: customField('auto' as BackgroundPrefetchMode, (v) =>
    isBackgroundPrefetchMode(v) ? v : 'auto',
  ),
  backgroundPrefetchFrameWindow: customField(PrefetchWindowFrames.DEFAULT, (v) =>
    clampPrefetchWindowFrames(v),
  ),
  cacheBudgetMode: customField('manual_memory' as CacheBudgetMode, (v) =>
    isCacheBudgetMode(v) ? v : 'manual_memory',
  ),
  maxCacheSizeMB: customField(1024, (v) => (typeof v === 'number' ? v : 1024)),
  maxCachedFrames: customField(MaxCachedFrames.DEFAULT, (v) => clampMaxCachedFrames(v)),
  aiTaskRoutes: customField(
    {
      assistantChat: { provider: 'ollama', model: '' },
      shaderGeneration: { provider: 'ollama', model: '' },
      shaderPromptTools: { provider: 'ollama', model: '' },
      imagePromptTools: { provider: 'ollama', model: '' },
    } as AiTaskRoutes,
    (v) => normalizeAiTaskRoutes(v),
  ),
  integrationConnections: customField([] as IntegrationConnection[], (v) =>
    normalizeIntegrationConnections(v),
  ),
  agentMaxSubagentSpawns: customField(AgentMaxSubagentSpawns.DEFAULT, (v) =>
    clampAgentMaxSubagentSpawns(v),
  ),
  newProjectColorManagement: customField(createDefaultProjectColorManagement(), (v) =>
    normalizeNewProjectColorManagement(v),
  ),
  comfyMissingModelDetailsVisible: boolField(true),
  enableToolSorting: boolField(true),
  toolUsageCounts: customField({} as Record<string, number>, (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, number>) : {},
  ),
  rotoMotionCueEnabled: boolField(false),
  rotoMotionCueMode: customField('gradient_trail' as RotoMotionCueMode, (v) =>
    isRotoMotionCueMode(v) ? v : 'gradient_trail',
  ),
  rotoMotionCueScope: customField('selected' as RotoMotionCueScope, (v) => {
    if (v === 'selected_path') return 'selected';
    if (isRotoMotionCueScope(v)) return v;
    return 'selected';
  }),
  rotoMotionPathVisible: boolField(true),
  rotoMotionBlurPathVisible: boolField(true),
  rotoMotionTrailFrames: customField(RotoTrailFrames.DEFAULT, (v) => clampRotoTrailFrames(v)),
  rotoMotionBlurInteractivePreviewEnabled: boolField(true),
  rotoFrameChangePreviewEnabled: boolField(true),
  rotoPreviewRefineDelayMs: customField(
    RotoPreviewRefineDelay.DEFAULT,
    clampRotoPreviewRefineDelay,
  ),
  rotoPlaybackPreviewMode: enumField(
    'auto' as RotoPlaybackPreviewMode,
    ['auto', 'optimized', 'full'] as const,
  ),
  rotoInteractivePreviewMaxDimension: customField(
    RotoInteractivePreviewSize.DEFAULT,
    clampRotoInteractivePreviewSize,
  ),
  rotoMotionBlurInteractivePreviewSamples: customField(
    ROTO_MOTION_BLUR_INTERACTIVE_DEFAULT_SAMPLES,
    (v) =>
      clampRotoMotionBlurSamples(
        typeof v === 'number' ? v : ROTO_MOTION_BLUR_INTERACTIVE_DEFAULT_SAMPLES,
      ),
  ),
  rotoPointWeightMode: customField(DEFAULT_ROTO_POINT_WEIGHT_MODE, (v) =>
    isRotoPointWeightMode(v) ? v : DEFAULT_ROTO_POINT_WEIGHT_MODE,
  ),
  rotoTrackingBackgroundEnabled: boolField(false),
  rotoTrackingDriftTolerance: customField(
    RotoTrackingDriftTolerance.DEFAULT as number | null,
    (v) => clampRotoTrackingDriftTolerance(v),
  ),
  directoryImportModePreference: customField('ask' as DirectoryImportModePreference, (v) =>
    isDirectoryImportModePreference(v) ? v : 'ask',
  ),
  flowViewMode: enumField('list' as 'list' | 'graph', ['list', 'graph'] as const),
  nudgeRadius: customField(50, (v) => (typeof v === 'number' && v > 0 ? v : 50)),
  pinnedNodeActions: customField(['execute'] as string[], (v) =>
    Array.isArray(v) ? v.filter((item: unknown) => typeof item === 'string') : ['execute'],
  ),
  alphaOverlayColorSource: customField('accent' as 'accent' | 'custom', (v) =>
    isAlphaOverlayColorSource(v) ? v : 'accent',
  ),
  alphaOverlayCustomColor: customField([1, 0, 0] as [number, number, number], (v) =>
    isNormalizedRgbTriplet(v) ? v : [1, 0, 0],
  ),
  alphaOverlayOpacity: customField(35, (v) => clampPercent(v, 35)),
  alphaOverlayBgDarken: customField(0, (v) => clampPercent(v, 0)),
  paintBrush: customField(DEFAULT_PAINT_BRUSH_SETTINGS, (v) => normalizePaintBrushSettings(v)),
  paintStrokePathsVisible: boolField(false),
  paintStrokePathsMode: enumField(
    'all' as PaintStrokePathsMode,
    ['all', 'selected_layer'] as const,
  ),
  viewportBackgroundMode: enumField(
    'none' as ViewportBackgroundMode,
    ['none', 'checkerboard', 'grid', 'custom'] as const,
  ),
  viewportBackgroundColor: customField([0.08, 0.08, 0.09] as [number, number, number], (v) =>
    isNormalizedRgbTriplet(v) ? v : [0.08, 0.08, 0.09],
  ),
  viewportInterpolation: enumField(
    'nearest' as 'nearest' | 'linear',
    ['nearest', 'linear'] as const,
  ),
  autoDetectViewportView: boolField(true),
  timelineCacheMode: enumField(
    'consolidated' as TimelineCacheMode,
    ['consolidated', 'separate'] as const,
  ),
  onnxRuntimeWebGpuEnabled: boolField(true),
  onnxRuntimeWasmEnabled: boolField(true),

  // Debug
  debugMode: boolField(false),
};

// ─── Load / Save ────────────────────────────────────────────────

export const getRecommendedCacheSizeMB = () => {
  const nav =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  if (nav && nav.deviceMemory) {
    return Math.floor(nav.deviceMemory * 1024 * 0.5);
  }
  return 1024;
};

export const createDefaultPreferences = (): Preferences => {
  const defaults = {} as Preferences;
  for (const key in preferenceSchema) {
    defaults[key] = preferenceSchema[key].defaultValue;
  }
  // Override dynamic default
  defaults.maxCacheSizeMB = getRecommendedCacheSizeMB();
  return defaults;
};

export const loadPreferences = (): Preferences => {
  const prefs: Preferences = createDefaultPreferences();

  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (!stored) return prefs;

    const loaded = JSON.parse(stored) as Partial<Record<keyof Preferences, unknown>>;
    for (const key in preferenceSchema) {
      const field = preferenceSchema[key as keyof Preferences];
      const storedValue = loaded[key as keyof Preferences];
      if (storedValue !== undefined) {
        (prefs as unknown as Record<string, unknown>)[key] = field.normalize(storedValue);
      }
    }
  } catch (error) {
    console.error('Failed to load preferences:', error);
  }

  return prefs;
};

export const savePreferencesToStorage = (prefs: Preferences) => {
  try {
    const toStore: Record<string, unknown> = {};
    for (const key in preferenceSchema) {
      toStore[key] = prefs[key as keyof Preferences];
    }
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(toStore));
  } catch (error) {
    console.error('Failed to save preferences:', error);
  }
};

export const initTheme = () => {
  const prefs = loadPreferences();
  applyTheme(prefs.primaryColor);
  applyUiStyle(prefs.uiStyle);
  applyComponentStyle(prefs.componentStyle);
};
