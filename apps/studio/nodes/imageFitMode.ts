import { ImageFitMode } from '@blackboard/types';

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
