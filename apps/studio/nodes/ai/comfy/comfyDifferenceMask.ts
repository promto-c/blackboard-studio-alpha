import type { GeneratedOutputDifferenceMask, ImageTransform } from '@blackboard/types';

export const DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS = {
  enabled: false,
  thresholdLow: 0.06,
  thresholdHigh: 0.18,
  edgeAdjustment: 0,
  removeSpecks: 0,
  fillHoles: 0,
  invert: false,
  previewMode: 'result',
} as const satisfies Pick<
  GeneratedOutputDifferenceMask,
  | 'enabled'
  | 'thresholdLow'
  | 'thresholdHigh'
  | 'edgeAdjustment'
  | 'removeSpecks'
  | 'fillHoles'
  | 'invert'
  | 'previewMode'
>;

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
