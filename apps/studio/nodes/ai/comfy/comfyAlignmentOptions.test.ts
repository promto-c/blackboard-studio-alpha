import { describe, expect, it } from 'vitest';
import {
  COMFY_ALIGNMENT_QUALITY_PRESETS,
  getComfyAlignmentQuality,
  resolveComfyAlignmentOptions,
} from './comfyAlignmentOptions';

describe('Comfy alignment quality presets', () => {
  it('defaults to Fast with every refinement disabled', () => {
    expect(resolveComfyAlignmentOptions()).toEqual(COMFY_ALIGNMENT_QUALITY_PRESETS.fast);
    expect(getComfyAlignmentQuality()).toBe('fast');
    expect(Object.values(resolveComfyAlignmentOptions()).every((enabled) => !enabled)).toBe(true);
  });

  it('recognizes Balanced and Precise presets', () => {
    expect(getComfyAlignmentQuality(COMFY_ALIGNMENT_QUALITY_PRESETS.balanced)).toBe('balanced');
    expect(getComfyAlignmentQuality(COMFY_ALIGNMENT_QUALITY_PRESETS.precise)).toBe('precise');
  });

  it('leaves custom refinement combinations without a selected quality', () => {
    expect(
      getComfyAlignmentQuality({
        ...COMFY_ALIGNMENT_QUALITY_PRESETS.fast,
        subPixelRefinement: true,
      }),
    ).toBeNull();
  });
});
