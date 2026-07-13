import type { GeneratedOutputDifferenceMask, ImageTransform } from '@blackboard/types';

export const DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS = {
  enabled: false,
  thresholdLow: 0.03,
  thresholdHigh: 0.14,
  comparisonBlur: 1.25,
  edgeAdjustment: 0,
  removeSpecks: 0,
  fillHoles: 0,
  morphologyShape: 'round',
  invert: false,
  previewMode: 'result',
} as const satisfies Pick<
  GeneratedOutputDifferenceMask,
  | 'enabled'
  | 'thresholdLow'
  | 'thresholdHigh'
  | 'comparisonBlur'
  | 'edgeAdjustment'
  | 'removeSpecks'
  | 'fillHoles'
  | 'morphologyShape'
  | 'invert'
  | 'previewMode'
>;

const finiteOrDefault = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Resolves stored/runtime mask data to the complete settings contract used by UI and rendering. */
export const resolveComfyDifferenceMask = (
  mask: GeneratedOutputDifferenceMask,
): GeneratedOutputDifferenceMask => ({
  ...mask,
  enabled: mask.enabled ?? DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.enabled,
  thresholdLow: finiteOrDefault(
    mask.thresholdLow,
    DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.thresholdLow,
  ),
  thresholdHigh: finiteOrDefault(
    mask.thresholdHigh,
    DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.thresholdHigh,
  ),
  comparisonBlur: finiteOrDefault(
    mask.comparisonBlur,
    DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.comparisonBlur,
  ),
  edgeAdjustment: finiteOrDefault(
    mask.edgeAdjustment,
    DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.edgeAdjustment,
  ),
  removeSpecks: finiteOrDefault(
    mask.removeSpecks,
    DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.removeSpecks,
  ),
  fillHoles: finiteOrDefault(mask.fillHoles, DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.fillHoles),
  morphologyShape:
    mask.morphologyShape === 'square'
      ? 'square'
      : DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.morphologyShape,
  invert: mask.invert ?? DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.invert,
  previewMode: mask.previewMode ?? DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.previewMode,
});

export const createComfyDifferenceMask = ({
  referenceAssetId,
  referenceWidth,
  referenceHeight,
  referenceTransform,
}: {
  referenceAssetId: string;
  referenceWidth: number;
  referenceHeight: number;
  referenceTransform?: Pick<ImageTransform, 'x' | 'y' | 'scaleX' | 'scaleY'>;
}): GeneratedOutputDifferenceMask => ({
  ...DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS,
  referenceAssetId,
  referenceWidth,
  referenceHeight,
  referenceTransform,
});
