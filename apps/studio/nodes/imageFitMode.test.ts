import { describe, expect, it } from 'vitest';
import { ImageFitMode } from '@blackboard/types';
import { getImageFitModeTransformUpdate } from './imageFitMode';

describe('getImageFitModeTransformUpdate', () => {
  it('resets scale and offsets for native-size None mode', () => {
    expect(getImageFitModeTransformUpdate(ImageFitMode.NONE)).toEqual({
      fitMode: ImageFitMode.NONE,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it.each([ImageFitMode.FILL, ImageFitMode.FIT, ImageFitMode.STRETCH, ImageFitMode.CUSTOM])(
    'leaves %s transform resolution to its normal behavior',
    (fitMode) => {
      expect(getImageFitModeTransformUpdate(fitMode)).toEqual({ fitMode });
    },
  );
});
