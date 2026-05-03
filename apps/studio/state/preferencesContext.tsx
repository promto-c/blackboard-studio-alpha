import React, { createContext, useContext, useState, ReactNode } from 'react';
import type {
  DirectoryImportModePreference,
  PaintBrushSettings,
  PaintBrushChannels,
  PaintStrokeChannels,
  PaintStrokePathsMode,
  RotoMotionCueScope,
  RotoMotionCueMode,
} from '@blackboard/types';
import {
  EDITOR_ITEMS_PANEL_PERCENT_DEFAULT,
  EDITOR_PANEL_WIDTH_DEFAULT,
  EDITOR_SUB_PANEL_HEIGHT_DEFAULT,
  EDITOR_SUB_PANEL_WIDTH_DEFAULT,
  EDITOR_TIMELINE_HEIGHT_DEFAULT,
  clampEditorItemsPanelPercent,
  clampEditorPanelWidth,
  clampEditorSubPanelHeight,
  clampEditorSubPanelWidth,
  clampEditorTimelineHeight,
} from '@/utils/editorLayout';
import { clampRotoMotionBlurSamples } from '@/utils/rotoMotionBlur';
import {
  DEFAULT_ROTO_POINT_WEIGHT_MODE,
  isRotoPointWeightMode,
  type RotoPointWeightMode,
} from '@/utils/rotoPointWeights';
import { DEFAULT_COMFY_ENDPOINT, normalizeComfyEndpoint } from '@/services/comfy/client';
import {
  DEFAULT_AI_TASK_ROUTES,
  DEFAULT_OPENAI_BASE_URL,
  isAiProvider,
  normalizeAiTaskRoutes,
  normalizeOpenAiBaseUrl,
  type AiTaskRoutes,
} from '@/utils/aiRouting';

const PREFERENCES_KEY = 'photo-editor-preferences-v2';
const ROTO_TRAIL_MIN_FRAMES = 1;
const ROTO_TRAIL_MAX_FRAMES = 8;
const ROTO_TRAIL_DEFAULT_FRAMES = 3;
const ROTO_MOTION_BLUR_INTERACTIVE_DEFAULT_SAMPLES = 16;
export const ROTO_TRACKING_DRIFT_TOLERANCE_MIN = 1;
export const ROTO_TRACKING_DRIFT_TOLERANCE_MAX = 50;
export const ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT = 15;
const PREFETCH_WINDOW_MIN_FRAMES = 1;
const PREFETCH_WINDOW_MAX_FRAMES = 240;
const PREFETCH_WINDOW_DEFAULT_FRAMES = 24;
const MAX_CACHED_FRAMES_MIN = 1;
const MAX_CACHED_FRAMES_MAX = 480;
const MAX_CACHED_FRAMES_DEFAULT = 48;
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
const DEFAULT_OLLAMA_TASK_MODELS = {
  generateShader: '',
} as const;
export const DEFAULT_PAINT_BRUSH_SETTINGS: PaintBrushSettings = {
  size: 24,
  softness: 30,
  opacity: 100,
  color: [1, 1, 1],
  alpha: 1,
  channels: 'view',
};

type ColorPalette = { [key: string]: { [key: number]: string } };

export const colors: ColorPalette = {
  teal: {
    50: '240 253 250',
    100: '204 251 241',
    200: '167 243 235',
    300: '107 231 214',
    400: '45 212 191',
    500: '20 184 166',
    600: '13 148 136',
    700: '15 118 110',
    800: '17 94 89',
    900: '19 78 74',
    950: '4 47 46',
  },
  blue: {
    50: '239 246 255',
    100: '219 234 254',
    200: '191 219 254',
    300: '147 197 253',
    400: '96 165 250',
    500: '59 130 246',
    600: '37 99 235',
    700: '29 78 216',
    800: '30 64 175',
    900: '30 58 138',
    950: '23 37 84',
  },
  rose: {
    50: '255 241 242',
    100: '255 228 230',
    200: '254 205 211',
    300: '253 164 175',
    400: '251 113 133',
    500: '244 63 94',
    600: '225 29 72',
    700: '190 18 60',
    800: '159 18 57',
    900: '136 19 55',
    950: '76 5 25',
  },
  amber: {
    50: '255 251 235',
    100: '254 243 199',
    200: '253 230 138',
    300: '252 211 77',
    400: '251 191 36',
    500: '245 158 11',
    600: '217 119 6',
    700: '180 83 9',
    800: '146 64 14',
    900: '120 53 15',
    950: '69 28 8',
  },
  green: {
    50: '240 253 244',
    100: '220 252 231',
    200: '187 247 208',
    300: '134 239 172',
    400: '74 222 128',
    500: '34 197 94',
    600: '22 163 74',
    700: '21 128 61',
    800: '22 101 52',
    900: '20 83 45',
    950: '5 46 22',
  },
  indigo: {
    50: '238 242 255',
    100: '224 231 255',
    200: '199 210 254',
    300: '165 180 252',
    400: '129 140 248',
    500: '99 102 241',
    600: '79 70 229',
    700: '67 56 202',
    800: '55 48 163',
    900: '49 46 129',
    950: '30 27 75',
  },
};

export const colorHues: { [key: string]: number } = {
  teal: 172,
  blue: 217,
  rose: 350,
  amber: 38,
  green: 145,
  indigo: 239,
};

const applyTheme = (color: string) => {
  const palette = colors[color] || colors.teal;
  const root = document.documentElement;
  for (const shade in palette) {
    root.style.setProperty(`--color-primary-${shade}`, palette[shade]);
  }
  const hue = colorHues[color] || colorHues.teal;
  root.style.setProperty('--color-primary-hue', String(hue));
};

const applyUiStyle = (style: 'glass' | 'solid') => {
  document.body.classList.remove('ui-glass', 'ui-solid');
  document.body.classList.add(`ui-${style}`);
};

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
  if (!Number.isFinite(numericValue)) return ROTO_TRAIL_DEFAULT_FRAMES;
  return Math.max(ROTO_TRAIL_MIN_FRAMES, Math.min(ROTO_TRAIL_MAX_FRAMES, Math.round(numericValue)));
};

export const clampRotoTrackingDriftTolerance = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT;
  return Math.max(
    ROTO_TRACKING_DRIFT_TOLERANCE_MIN,
    Math.min(ROTO_TRACKING_DRIFT_TOLERANCE_MAX, numericValue),
  );
};

export type ThumbnailMode = 'live' | 'static' | 'off';
export type RotoMotionBlurPreviewBackend = 'realtime_canvas' | 'gpu_float';
export type BackgroundPrefetchMode = 'on_demand' | 'forward' | 'bidirectional';
export type CacheBudgetMode = 'auto_memory' | 'manual_memory' | 'frame_count';

const isRotoMotionBlurPreviewBackend = (value: unknown): value is RotoMotionBlurPreviewBackend =>
  value === 'realtime_canvas' || value === 'gpu_float';

const isBackgroundPrefetchMode = (value: unknown): value is BackgroundPrefetchMode =>
  value === 'on_demand' || value === 'forward' || value === 'bidirectional';

const isCacheBudgetMode = (value: unknown): value is CacheBudgetMode =>
  value === 'auto_memory' || value === 'manual_memory' || value === 'frame_count';

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
    PREFETCH_WINDOW_DEFAULT_FRAMES,
    PREFETCH_WINDOW_MIN_FRAMES,
    PREFETCH_WINDOW_MAX_FRAMES,
  );

const clampMaxCachedFrames = (value: unknown): number =>
  clampPositiveInteger(
    value,
    MAX_CACHED_FRAMES_DEFAULT,
    MAX_CACHED_FRAMES_MIN,
    MAX_CACHED_FRAMES_MAX,
  );

const clampPaintBrushSize = (value: unknown): number =>
  clampPositiveInteger(value, DEFAULT_PAINT_BRUSH_SETTINGS.size, 1, 256);

const clampUnit = (value: unknown, fallback: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(0, Math.min(1, numericValue));
};

const normalizeStringPreference = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value.trim() : fallback;

const normalizeOllamaEndpoint = (value: unknown): string => {
  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  return trimmedValue || DEFAULT_OLLAMA_ENDPOINT;
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
    size: clampPaintBrushSize(candidate.size),
    softness: clampPercent(candidate.softness, DEFAULT_PAINT_BRUSH_SETTINGS.softness),
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

interface Preferences {
  primaryColor: string;
  thumbnailMode: ThumbnailMode;
  flowPanelHeight: number;
  uiStyle: 'glass' | 'solid';
  editorPanelWidth: number;
  editorTimelineHeight: number;
  editorSubPanelWidth: number;
  editorSubPanelHeight: number;
  editorItemsPanelPercent: number;
  codeEditorWordWrap: boolean;
  flowListDirection: 'bottom-up' | 'top-down';
  playbackMode: 'realtime' | 'every_frame';
  backgroundPrefetchMode: BackgroundPrefetchMode;
  backgroundPrefetchFrameWindow: number;
  cacheBudgetMode: CacheBudgetMode;
  maxCacheSizeMB: number;
  maxCachedFrames: number;
  geminiApiKey: string;
  openAiApiKey: string;
  openAiBaseUrl: string;
  ollamaEndpoint: string;
  aiTaskRoutes: AiTaskRoutes;
  comfyEndpoint: string;
  comfyMissingModelDetailsVisible: boolean;
  enableToolSorting: boolean;
  toolUsageCounts: Record<string, number>;
  rotoMotionCueEnabled: boolean;
  rotoMotionCueMode: RotoMotionCueMode;
  rotoMotionCueScope: RotoMotionCueScope;
  rotoMotionPathVisible: boolean;
  rotoMotionBlurPathVisible: boolean;
  rotoMotionTrailFrames: number;
  rotoMotionBlurPreviewBackend: RotoMotionBlurPreviewBackend;
  rotoMotionBlurInteractivePreviewEnabled: boolean;
  rotoMotionBlurInteractivePreviewSamples: number;
  rotoPointWeightMode: RotoPointWeightMode;
  rotoTrackingBackgroundEnabled: boolean;
  rotoTrackingDriftTolerance: number;
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
  viewportInterpolation: 'nearest' | 'linear';
}

interface PreferencesContextType extends Preferences {
  availableColors: string[];
  setPreferences: (prefs: Partial<Preferences>) => void;
  incrementToolUsage: (toolName: string) => void;
}

export const getRecommendedCacheSizeMB = () => {
  const nav =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  if (nav && nav.deviceMemory) {
    // deviceMemory is in GB. Set to 50% of available memory.
    return Math.floor(nav.deviceMemory * 1024 * 0.5);
  }
  return 1024; // Default to 1GB if unknown
};

const defaultPrefs: Preferences = {
  primaryColor: 'teal',
  thumbnailMode: 'live' as ThumbnailMode,
  flowPanelHeight: 50,
  uiStyle: 'glass',
  editorPanelWidth: EDITOR_PANEL_WIDTH_DEFAULT,
  editorTimelineHeight: EDITOR_TIMELINE_HEIGHT_DEFAULT,
  editorSubPanelWidth: EDITOR_SUB_PANEL_WIDTH_DEFAULT,
  editorSubPanelHeight: EDITOR_SUB_PANEL_HEIGHT_DEFAULT,
  editorItemsPanelPercent: EDITOR_ITEMS_PANEL_PERCENT_DEFAULT,
  codeEditorWordWrap: false,
  flowListDirection: 'top-down',
  playbackMode: 'realtime',
  backgroundPrefetchMode: 'forward',
  backgroundPrefetchFrameWindow: PREFETCH_WINDOW_DEFAULT_FRAMES,
  cacheBudgetMode: 'manual_memory',
  maxCacheSizeMB: getRecommendedCacheSizeMB(),
  maxCachedFrames: MAX_CACHED_FRAMES_DEFAULT,
  geminiApiKey: '',
  openAiApiKey: '',
  openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
  ollamaEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  aiTaskRoutes: {
    assistantChat: { provider: 'gemini', model: '' },
    shaderGeneration: { provider: 'gemini', model: '' },
    shaderPromptTools: { provider: 'gemini', model: '' },
    imagePromptTools: { provider: 'gemini', model: '' },
  },
  comfyEndpoint: DEFAULT_COMFY_ENDPOINT,
  comfyMissingModelDetailsVisible: true,
  enableToolSorting: true,
  toolUsageCounts: {},
  rotoMotionCueEnabled: false,
  rotoMotionCueMode: 'gradient_trail',
  rotoMotionCueScope: 'selected',
  rotoMotionPathVisible: true,
  rotoMotionBlurPathVisible: true,
  rotoMotionTrailFrames: ROTO_TRAIL_DEFAULT_FRAMES,
  rotoMotionBlurPreviewBackend: 'realtime_canvas',
  rotoMotionBlurInteractivePreviewEnabled: true,
  rotoMotionBlurInteractivePreviewSamples: ROTO_MOTION_BLUR_INTERACTIVE_DEFAULT_SAMPLES,
  rotoPointWeightMode: DEFAULT_ROTO_POINT_WEIGHT_MODE,
  rotoTrackingBackgroundEnabled: false,
  rotoTrackingDriftTolerance: ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT,
  directoryImportModePreference: 'ask',
  flowViewMode: 'list',
  nudgeRadius: 50,
  pinnedNodeActions: [],
  alphaOverlayColorSource: 'accent',
  alphaOverlayCustomColor: [1, 0, 0],
  alphaOverlayOpacity: 35,
  alphaOverlayBgDarken: 0,
  paintBrush: DEFAULT_PAINT_BRUSH_SETTINGS,
  paintStrokePathsVisible: false,
  paintStrokePathsMode: 'all',
  viewportInterpolation: 'nearest',
};

const loadPreferences = (): Preferences => {
  const prefsToSet: Preferences = { ...defaultPrefs };

  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (stored) {
      const loadedPrefs = JSON.parse(stored);
      if (loadedPrefs.primaryColor && colors[loadedPrefs.primaryColor]) {
        prefsToSet.primaryColor = loadedPrefs.primaryColor;
      }
      if (
        loadedPrefs.thumbnailMode === 'live' ||
        loadedPrefs.thumbnailMode === 'static' ||
        loadedPrefs.thumbnailMode === 'off'
      ) {
        prefsToSet.thumbnailMode = loadedPrefs.thumbnailMode;
      } else if (typeof loadedPrefs.liveThumbnailsEnabled === 'boolean') {
        // Migrate legacy boolean preference
        prefsToSet.thumbnailMode = loadedPrefs.liveThumbnailsEnabled ? 'live' : 'off';
      }
      if (typeof loadedPrefs.flowPanelHeight === 'number') {
        prefsToSet.flowPanelHeight = loadedPrefs.flowPanelHeight;
      }
      if (loadedPrefs.uiStyle === 'glass' || loadedPrefs.uiStyle === 'solid') {
        prefsToSet.uiStyle = loadedPrefs.uiStyle;
      }
      if (loadedPrefs.editorPanelWidth !== undefined) {
        prefsToSet.editorPanelWidth = clampEditorPanelWidth(loadedPrefs.editorPanelWidth);
      }
      if (loadedPrefs.editorTimelineHeight !== undefined) {
        prefsToSet.editorTimelineHeight = clampEditorTimelineHeight(
          loadedPrefs.editorTimelineHeight,
        );
      }
      if (loadedPrefs.editorSubPanelWidth !== undefined) {
        prefsToSet.editorSubPanelWidth = clampEditorSubPanelWidth(loadedPrefs.editorSubPanelWidth);
      }
      if (loadedPrefs.editorSubPanelHeight !== undefined) {
        prefsToSet.editorSubPanelHeight = clampEditorSubPanelHeight(
          loadedPrefs.editorSubPanelHeight,
        );
      }
      if (loadedPrefs.editorItemsPanelPercent !== undefined) {
        prefsToSet.editorItemsPanelPercent = clampEditorItemsPanelPercent(
          loadedPrefs.editorItemsPanelPercent,
        );
      }
      if (typeof loadedPrefs.codeEditorWordWrap === 'boolean') {
        prefsToSet.codeEditorWordWrap = loadedPrefs.codeEditorWordWrap;
      }
      if (
        loadedPrefs.flowListDirection === 'bottom-up' ||
        loadedPrefs.flowListDirection === 'top-down'
      ) {
        prefsToSet.flowListDirection = loadedPrefs.flowListDirection;
      }
      if (loadedPrefs.playbackMode === 'realtime' || loadedPrefs.playbackMode === 'every_frame') {
        prefsToSet.playbackMode = loadedPrefs.playbackMode;
      }
      if (isBackgroundPrefetchMode(loadedPrefs.backgroundPrefetchMode)) {
        prefsToSet.backgroundPrefetchMode = loadedPrefs.backgroundPrefetchMode;
      }
      if (loadedPrefs.backgroundPrefetchFrameWindow !== undefined) {
        prefsToSet.backgroundPrefetchFrameWindow = clampPrefetchWindowFrames(
          loadedPrefs.backgroundPrefetchFrameWindow,
        );
      }
      if (isCacheBudgetMode(loadedPrefs.cacheBudgetMode)) {
        prefsToSet.cacheBudgetMode = loadedPrefs.cacheBudgetMode;
      }
      if (typeof loadedPrefs.maxCacheSizeMB === 'number') {
        prefsToSet.maxCacheSizeMB = loadedPrefs.maxCacheSizeMB;
      }
      if (loadedPrefs.maxCachedFrames !== undefined) {
        prefsToSet.maxCachedFrames = clampMaxCachedFrames(loadedPrefs.maxCachedFrames);
      }
      if (loadedPrefs.geminiApiKey !== undefined) {
        prefsToSet.geminiApiKey = normalizeStringPreference(loadedPrefs.geminiApiKey, '');
      }
      if (loadedPrefs.openAiApiKey !== undefined) {
        prefsToSet.openAiApiKey = normalizeStringPreference(loadedPrefs.openAiApiKey, '');
      }
      if (loadedPrefs.openAiBaseUrl !== undefined) {
        prefsToSet.openAiBaseUrl = normalizeOpenAiBaseUrl(
          normalizeStringPreference(loadedPrefs.openAiBaseUrl, DEFAULT_OPENAI_BASE_URL),
        );
      }
      if (loadedPrefs.ollamaEndpoint !== undefined) {
        prefsToSet.ollamaEndpoint = normalizeOllamaEndpoint(loadedPrefs.ollamaEndpoint);
      }
      if (loadedPrefs.aiTaskRoutes !== undefined) {
        prefsToSet.aiTaskRoutes = normalizeAiTaskRoutes(loadedPrefs.aiTaskRoutes);
      } else {
        const legacyRoutes = normalizeAiTaskRoutes(DEFAULT_AI_TASK_ROUTES);
        const legacyProvider = isAiProvider(loadedPrefs.shaderGenerationProvider)
          ? loadedPrefs.shaderGenerationProvider
          : null;
        const legacyOllamaModel =
          typeof loadedPrefs.ollamaTaskModels === 'object' &&
          loadedPrefs.ollamaTaskModels !== null &&
          'generateShader' in loadedPrefs.ollamaTaskModels
            ? normalizeStringPreference(
                (loadedPrefs.ollamaTaskModels as { generateShader?: unknown }).generateShader,
                DEFAULT_OLLAMA_TASK_MODELS.generateShader,
              )
            : DEFAULT_OLLAMA_TASK_MODELS.generateShader;

        if (legacyProvider) {
          legacyRoutes.assistantChat.provider = legacyProvider;
          legacyRoutes.shaderGeneration.provider = legacyProvider;
          if (legacyProvider === 'ollama' && legacyOllamaModel) {
            legacyRoutes.assistantChat.model = legacyOllamaModel;
            legacyRoutes.shaderGeneration.model = legacyOllamaModel;
          }
        }

        prefsToSet.aiTaskRoutes = legacyRoutes;
      }
      if (loadedPrefs.comfyEndpoint !== undefined) {
        prefsToSet.comfyEndpoint = normalizeComfyEndpoint(loadedPrefs.comfyEndpoint);
      }
      if (typeof loadedPrefs.comfyMissingModelDetailsVisible === 'boolean') {
        prefsToSet.comfyMissingModelDetailsVisible = loadedPrefs.comfyMissingModelDetailsVisible;
      }
      if (typeof loadedPrefs.enableToolSorting === 'boolean') {
        prefsToSet.enableToolSorting = loadedPrefs.enableToolSorting;
      }
      if (loadedPrefs.toolUsageCounts) {
        prefsToSet.toolUsageCounts = loadedPrefs.toolUsageCounts;
      }
      if (typeof loadedPrefs.rotoMotionCueEnabled === 'boolean') {
        prefsToSet.rotoMotionCueEnabled = loadedPrefs.rotoMotionCueEnabled;
      }
      if (isRotoMotionCueMode(loadedPrefs.rotoMotionCueMode)) {
        prefsToSet.rotoMotionCueMode = loadedPrefs.rotoMotionCueMode;
      }
      if (loadedPrefs.rotoMotionCueScope === 'selected_path') {
        prefsToSet.rotoMotionCueScope = 'selected';
      } else if (isRotoMotionCueScope(loadedPrefs.rotoMotionCueScope)) {
        prefsToSet.rotoMotionCueScope = loadedPrefs.rotoMotionCueScope;
      }
      if (typeof loadedPrefs.rotoMotionPathVisible === 'boolean') {
        prefsToSet.rotoMotionPathVisible = loadedPrefs.rotoMotionPathVisible;
      }
      if (typeof loadedPrefs.rotoMotionBlurPathVisible === 'boolean') {
        prefsToSet.rotoMotionBlurPathVisible = loadedPrefs.rotoMotionBlurPathVisible;
      }
      if (loadedPrefs.rotoMotionTrailFrames !== undefined) {
        prefsToSet.rotoMotionTrailFrames = clampRotoTrailFrames(loadedPrefs.rotoMotionTrailFrames);
      }
      if (isRotoMotionBlurPreviewBackend(loadedPrefs.rotoMotionBlurPreviewBackend)) {
        prefsToSet.rotoMotionBlurPreviewBackend = loadedPrefs.rotoMotionBlurPreviewBackend;
      }
      if (typeof loadedPrefs.rotoMotionBlurInteractivePreviewEnabled === 'boolean') {
        prefsToSet.rotoMotionBlurInteractivePreviewEnabled =
          loadedPrefs.rotoMotionBlurInteractivePreviewEnabled;
      }
      if (loadedPrefs.rotoMotionBlurInteractivePreviewSamples !== undefined) {
        prefsToSet.rotoMotionBlurInteractivePreviewSamples = clampRotoMotionBlurSamples(
          loadedPrefs.rotoMotionBlurInteractivePreviewSamples,
        );
      }
      if (isRotoPointWeightMode(loadedPrefs.rotoPointWeightMode)) {
        prefsToSet.rotoPointWeightMode = loadedPrefs.rotoPointWeightMode;
      }
      if (typeof loadedPrefs.rotoTrackingBackgroundEnabled === 'boolean') {
        prefsToSet.rotoTrackingBackgroundEnabled = loadedPrefs.rotoTrackingBackgroundEnabled;
      }
      if (loadedPrefs.rotoTrackingDriftTolerance !== undefined) {
        prefsToSet.rotoTrackingDriftTolerance = clampRotoTrackingDriftTolerance(
          loadedPrefs.rotoTrackingDriftTolerance,
        );
      }
      if (isDirectoryImportModePreference(loadedPrefs.directoryImportModePreference)) {
        prefsToSet.directoryImportModePreference = loadedPrefs.directoryImportModePreference;
      }
      if (loadedPrefs.flowViewMode === 'list' || loadedPrefs.flowViewMode === 'graph') {
        prefsToSet.flowViewMode = loadedPrefs.flowViewMode;
      }
      if (typeof loadedPrefs.nudgeRadius === 'number' && loadedPrefs.nudgeRadius > 0) {
        prefsToSet.nudgeRadius = loadedPrefs.nudgeRadius;
      }
      if (Array.isArray(loadedPrefs.pinnedNodeActions)) {
        prefsToSet.pinnedNodeActions = loadedPrefs.pinnedNodeActions.filter(
          (v: unknown) => typeof v === 'string',
        );
      }
      if (isAlphaOverlayColorSource(loadedPrefs.alphaOverlayColorSource)) {
        prefsToSet.alphaOverlayColorSource = loadedPrefs.alphaOverlayColorSource;
      }
      if (isNormalizedRgbTriplet(loadedPrefs.alphaOverlayCustomColor)) {
        prefsToSet.alphaOverlayCustomColor = loadedPrefs.alphaOverlayCustomColor;
      }
      if (loadedPrefs.alphaOverlayOpacity !== undefined) {
        prefsToSet.alphaOverlayOpacity = clampPercent(
          loadedPrefs.alphaOverlayOpacity,
          defaultPrefs.alphaOverlayOpacity,
        );
      }
      if (loadedPrefs.alphaOverlayBgDarken !== undefined) {
        prefsToSet.alphaOverlayBgDarken = clampPercent(
          loadedPrefs.alphaOverlayBgDarken,
          defaultPrefs.alphaOverlayBgDarken,
        );
      }
      if (loadedPrefs.paintBrush !== undefined) {
        prefsToSet.paintBrush = normalizePaintBrushSettings(loadedPrefs.paintBrush);
      }
      if (typeof loadedPrefs.paintStrokePathsVisible === 'boolean') {
        prefsToSet.paintStrokePathsVisible = loadedPrefs.paintStrokePathsVisible;
      }
      if (
        loadedPrefs.paintStrokePathsMode === 'all' ||
        loadedPrefs.paintStrokePathsMode === 'selected_layer'
      ) {
        prefsToSet.paintStrokePathsMode = loadedPrefs.paintStrokePathsMode;
      }
      if (
        loadedPrefs.viewportInterpolation === 'nearest' ||
        loadedPrefs.viewportInterpolation === 'linear'
      ) {
        prefsToSet.viewportInterpolation = loadedPrefs.viewportInterpolation;
      }
    }
  } catch (error) {
    console.error('Failed to load preferences:', error);
  }
  return prefsToSet;
};

export const initTheme = () => {
  const prefs = loadPreferences();
  applyTheme(prefs.primaryColor);
  applyUiStyle(prefs.uiStyle);
};

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};

export const PreferencesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [preferences, setPreferencesState] = useState<Preferences>(loadPreferences);

  const saveToStorage = (newPrefs: Preferences) => {
    try {
      const toStore = {
        primaryColor: newPrefs.primaryColor,
        thumbnailMode: newPrefs.thumbnailMode,
        flowPanelHeight: newPrefs.flowPanelHeight,
        uiStyle: newPrefs.uiStyle,
        editorPanelWidth: newPrefs.editorPanelWidth,
        editorTimelineHeight: newPrefs.editorTimelineHeight,
        editorSubPanelWidth: newPrefs.editorSubPanelWidth,
        editorSubPanelHeight: newPrefs.editorSubPanelHeight,
        editorItemsPanelPercent: newPrefs.editorItemsPanelPercent,
        codeEditorWordWrap: newPrefs.codeEditorWordWrap,
        flowListDirection: newPrefs.flowListDirection,
        playbackMode: newPrefs.playbackMode,
        backgroundPrefetchMode: newPrefs.backgroundPrefetchMode,
        backgroundPrefetchFrameWindow: newPrefs.backgroundPrefetchFrameWindow,
        cacheBudgetMode: newPrefs.cacheBudgetMode,
        maxCacheSizeMB: newPrefs.maxCacheSizeMB,
        maxCachedFrames: newPrefs.maxCachedFrames,
        geminiApiKey: newPrefs.geminiApiKey,
        openAiApiKey: newPrefs.openAiApiKey,
        openAiBaseUrl: newPrefs.openAiBaseUrl,
        ollamaEndpoint: newPrefs.ollamaEndpoint,
        aiTaskRoutes: newPrefs.aiTaskRoutes,
        comfyEndpoint: newPrefs.comfyEndpoint,
        comfyMissingModelDetailsVisible: newPrefs.comfyMissingModelDetailsVisible,
        enableToolSorting: newPrefs.enableToolSorting,
        toolUsageCounts: newPrefs.toolUsageCounts,
        rotoMotionCueEnabled: newPrefs.rotoMotionCueEnabled,
        rotoMotionCueMode: newPrefs.rotoMotionCueMode,
        rotoMotionCueScope: newPrefs.rotoMotionCueScope,
        rotoMotionPathVisible: newPrefs.rotoMotionPathVisible,
        rotoMotionBlurPathVisible: newPrefs.rotoMotionBlurPathVisible,
        rotoMotionTrailFrames: newPrefs.rotoMotionTrailFrames,
        rotoMotionBlurPreviewBackend: newPrefs.rotoMotionBlurPreviewBackend,
        rotoMotionBlurInteractivePreviewEnabled: newPrefs.rotoMotionBlurInteractivePreviewEnabled,
        rotoMotionBlurInteractivePreviewSamples: newPrefs.rotoMotionBlurInteractivePreviewSamples,
        rotoPointWeightMode: newPrefs.rotoPointWeightMode,
        rotoTrackingBackgroundEnabled: newPrefs.rotoTrackingBackgroundEnabled,
        rotoTrackingDriftTolerance: newPrefs.rotoTrackingDriftTolerance,
        directoryImportModePreference: newPrefs.directoryImportModePreference,
        flowViewMode: newPrefs.flowViewMode,
        nudgeRadius: newPrefs.nudgeRadius,
        pinnedNodeActions: newPrefs.pinnedNodeActions,
        alphaOverlayColorSource: newPrefs.alphaOverlayColorSource,
        alphaOverlayCustomColor: newPrefs.alphaOverlayCustomColor,
        alphaOverlayOpacity: newPrefs.alphaOverlayOpacity,
        alphaOverlayBgDarken: newPrefs.alphaOverlayBgDarken,
        paintBrush: newPrefs.paintBrush,
        paintStrokePathsVisible: newPrefs.paintStrokePathsVisible,
        paintStrokePathsMode: newPrefs.paintStrokePathsMode,
        viewportInterpolation: newPrefs.viewportInterpolation,
      };
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(toStore));
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  };

  const setPreferences = (prefs: Partial<Preferences>) => {
    setPreferencesState((currentPrefs) => {
      const newPrefs = { ...currentPrefs, ...prefs };
      if (prefs.rotoMotionTrailFrames !== undefined) {
        newPrefs.rotoMotionTrailFrames = clampRotoTrailFrames(prefs.rotoMotionTrailFrames);
      }
      if (prefs.backgroundPrefetchFrameWindow !== undefined) {
        newPrefs.backgroundPrefetchFrameWindow = clampPrefetchWindowFrames(
          prefs.backgroundPrefetchFrameWindow,
        );
      }
      if (prefs.editorPanelWidth !== undefined) {
        newPrefs.editorPanelWidth = clampEditorPanelWidth(prefs.editorPanelWidth);
      }
      if (prefs.editorTimelineHeight !== undefined) {
        newPrefs.editorTimelineHeight = clampEditorTimelineHeight(prefs.editorTimelineHeight);
      }
      if (prefs.editorSubPanelWidth !== undefined) {
        newPrefs.editorSubPanelWidth = clampEditorSubPanelWidth(prefs.editorSubPanelWidth);
      }
      if (prefs.editorSubPanelHeight !== undefined) {
        newPrefs.editorSubPanelHeight = clampEditorSubPanelHeight(prefs.editorSubPanelHeight);
      }
      if (prefs.editorItemsPanelPercent !== undefined) {
        newPrefs.editorItemsPanelPercent = clampEditorItemsPanelPercent(
          prefs.editorItemsPanelPercent,
        );
      }
      if (prefs.maxCachedFrames !== undefined) {
        newPrefs.maxCachedFrames = clampMaxCachedFrames(prefs.maxCachedFrames);
      }
      if (prefs.geminiApiKey !== undefined) {
        newPrefs.geminiApiKey = normalizeStringPreference(prefs.geminiApiKey, '');
      }
      if (prefs.openAiApiKey !== undefined) {
        newPrefs.openAiApiKey = normalizeStringPreference(prefs.openAiApiKey, '');
      }
      if (prefs.openAiBaseUrl !== undefined) {
        newPrefs.openAiBaseUrl = normalizeOpenAiBaseUrl(prefs.openAiBaseUrl);
      }
      if (prefs.ollamaEndpoint !== undefined) {
        newPrefs.ollamaEndpoint = normalizeOllamaEndpoint(prefs.ollamaEndpoint);
      }
      if (prefs.aiTaskRoutes !== undefined) {
        newPrefs.aiTaskRoutes = normalizeAiTaskRoutes(
          prefs.aiTaskRoutes,
          currentPrefs.aiTaskRoutes,
        );
      }
      if (prefs.comfyEndpoint !== undefined) {
        newPrefs.comfyEndpoint = normalizeComfyEndpoint(prefs.comfyEndpoint);
      }
      if (prefs.rotoMotionBlurInteractivePreviewSamples !== undefined) {
        newPrefs.rotoMotionBlurInteractivePreviewSamples = clampRotoMotionBlurSamples(
          prefs.rotoMotionBlurInteractivePreviewSamples,
        );
      }
      if (prefs.rotoTrackingDriftTolerance !== undefined) {
        newPrefs.rotoTrackingDriftTolerance = clampRotoTrackingDriftTolerance(
          prefs.rotoTrackingDriftTolerance,
        );
      }
      if (prefs.alphaOverlayOpacity !== undefined) {
        newPrefs.alphaOverlayOpacity = clampPercent(
          prefs.alphaOverlayOpacity,
          currentPrefs.alphaOverlayOpacity,
        );
      }
      if (prefs.alphaOverlayBgDarken !== undefined) {
        newPrefs.alphaOverlayBgDarken = clampPercent(
          prefs.alphaOverlayBgDarken,
          currentPrefs.alphaOverlayBgDarken,
        );
      }
      if (prefs.paintBrush !== undefined) {
        newPrefs.paintBrush = normalizePaintBrushSettings(prefs.paintBrush);
      }
      if (
        prefs.alphaOverlayCustomColor !== undefined &&
        isNormalizedRgbTriplet(prefs.alphaOverlayCustomColor)
      ) {
        newPrefs.alphaOverlayCustomColor = prefs.alphaOverlayCustomColor;
      }
      saveToStorage(newPrefs);

      if (prefs.primaryColor && prefs.primaryColor !== currentPrefs.primaryColor) {
        applyTheme(prefs.primaryColor);
      }

      if (prefs.uiStyle && prefs.uiStyle !== currentPrefs.uiStyle) {
        applyUiStyle(prefs.uiStyle);
      }

      return newPrefs;
    });
  };

  const incrementToolUsage = (toolName: string) => {
    setPreferencesState((currentPrefs) => {
      const currentCount = currentPrefs.toolUsageCounts[toolName] || 0;
      const newPrefs = {
        ...currentPrefs,
        toolUsageCounts: {
          ...currentPrefs.toolUsageCounts,
          [toolName]: currentCount + 1,
        },
      };
      saveToStorage(newPrefs);
      return newPrefs;
    });
  };

  const value: PreferencesContextType = {
    ...preferences,
    availableColors: Object.keys(colors),
    setPreferences,
    incrementToolUsage,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};
