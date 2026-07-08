import type {
  DisplayOutputSelection,
  DisplayViewSelection,
  ViewerSettings,
} from '@blackboard/types';

export type DisplayOutputPresetKind = DisplayOutputSelection['kind'];

export interface DisplayOutputPresetOption {
  value: DisplayOutputPresetKind;
  label: string;
  secondaryLabel: string;
  badges?: string[];
  searchText: string;
}

export interface ResolvedDisplayOutput {
  finalColorSpace: 'match_viewport' | 'srgb';
  viewerSettings?: ViewerSettings;
  displayView?: DisplayViewSelection;
  outputColorSpace?: string;
}

export const DEFAULT_DISPLAY_OUTPUT: DisplayOutputSelection = { kind: 'project_view' };

export const DISPLAY_OUTPUT_PRESET_OPTIONS: readonly DisplayOutputPresetOption[] = [
  {
    value: 'project_view',
    label: 'Project View',
    secondaryLabel: 'Project display/view without local viewer adjustments',
    badges: ['Default'],
    searchText: 'project view display view normal export',
  },
  {
    value: 'current_viewer',
    label: 'Current Viewer',
    secondaryLabel: 'Project display/view with current viewer adjustments',
    badges: ['Viewer'],
    searchText: 'current viewer gain gamma saturation channels overlay',
  },
  {
    value: 'display_view',
    label: 'Selected Display/View',
    secondaryLabel: 'Explicit OCIO display and view',
    badges: ['OCIO'],
    searchText: 'selected explicit ocio display view look',
  },
  {
    value: 'direct_encoding',
    label: 'Direct Encoding',
    secondaryLabel: 'Advanced color-space transform without DisplayView',
    badges: ['Advanced'],
    searchText: 'direct encoding color space no display transform advanced',
  },
];

const PROJECT_VIEWER_SETTINGS: ViewerSettings = {
  channels: 'RGB',
  alphaOverlay: false,
  gamutWarning: false,
  showOverlays: false,
  gain: 1,
  gamma: 1,
  saturation: 1,
  lastCustomGain: 1,
  lastCustomGamma: 1,
  lastCustomSaturation: 1,
};

export const resolveProjectDisplayOutput = (
  displayView: DisplayViewSelection,
): ResolvedDisplayOutput => ({
  finalColorSpace: 'match_viewport',
  displayView,
  viewerSettings: PROJECT_VIEWER_SETTINGS,
});

export const createDisplayOutputSelection = (
  kind: DisplayOutputPresetKind,
  defaults: {
    projectDisplayView: DisplayViewSelection;
    directColorSpace: string;
  },
): DisplayOutputSelection => {
  if (kind === 'display_view') {
    return {
      kind,
      displayView: { ...defaults.projectDisplayView },
    };
  }
  if (kind === 'direct_encoding') {
    return {
      kind,
      colorSpace: defaults.directColorSpace,
    };
  }
  return { kind };
};

export const resolveDisplayOutput = (
  selection: DisplayOutputSelection,
  context: {
    projectDisplayView: DisplayViewSelection;
    currentViewerDisplayView: DisplayViewSelection;
    currentViewerSettings: ViewerSettings;
  },
): ResolvedDisplayOutput => {
  if (selection.kind === 'direct_encoding') {
    return {
      finalColorSpace: 'srgb',
      outputColorSpace: selection.colorSpace,
    };
  }

  if (selection.kind === 'current_viewer') {
    return {
      finalColorSpace: 'match_viewport',
      displayView: context.currentViewerDisplayView,
      viewerSettings: {
        ...context.currentViewerSettings,
        gamutWarning: false,
      },
    };
  }

  return resolveProjectDisplayOutput(
    selection.kind === 'display_view' ? selection.displayView : context.projectDisplayView,
  );
};
