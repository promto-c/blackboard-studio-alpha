import { ImageFitMode, type ImageTransform } from '@blackboard/types';

export const IMAGE_FIT_MODE_OPTIONS: Array<{ value: ImageFitMode; label: string }> = [
  { value: ImageFitMode.FILL, label: 'Fill' },
  { value: ImageFitMode.FIT, label: 'Fit' },
  { value: ImageFitMode.NONE, label: 'None' },
  { value: ImageFitMode.STRETCH, label: 'Stretch' },
];

export const isCustomImageFitMode = (fitMode: ImageFitMode): boolean =>
  fitMode === ImageFitMode.CUSTOM;

export const isAutoImageFitMode = (fitMode: ImageFitMode): boolean =>
  fitMode === ImageFitMode.FILL || fitMode === ImageFitMode.FIT || fitMode === ImageFitMode.STRETCH;

/**
 * Build the transform update for a user-selected fit mode. None means native-size placement, so it
 * also clears every scale/offset value (including keyframed values) back to the neutral transform.
 */
export const getImageFitModeTransformUpdate = (
  fitMode: ImageFitMode,
): Partial<ImageTransform> & Pick<ImageTransform, 'fitMode'> =>
  fitMode === ImageFitMode.NONE ? { fitMode, x: 0, y: 0, scaleX: 1, scaleY: 1 } : { fitMode };

export const shouldApplyImageFitPreset = ({
  fitMode,
  fitModeChanged,
  sizeChanged,
}: {
  fitMode: ImageFitMode;
  fitModeChanged: boolean;
  sizeChanged: boolean;
}): boolean =>
  !isCustomImageFitMode(fitMode) &&
  (fitModeChanged || (sizeChanged && fitMode !== ImageFitMode.NONE));
