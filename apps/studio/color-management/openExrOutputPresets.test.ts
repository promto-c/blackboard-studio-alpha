import { describe, expect, it } from 'vitest';
import type { ColorSpaceInfo } from './types';
import {
  DEFAULT_OPEN_EXR_OUTPUT_PRESET,
  OPEN_EXR_OUTPUT_PRESETS,
  resolveOpenExrOutputPreset,
} from './openExrOutputPresets';

const colorSpace = (overrides: Partial<ColorSpaceInfo>): ColorSpaceInfo => ({
  name: '',
  aliases: [],
  categories: [],
  family: '',
  encoding: '',
  description: '',
  isData: false,
  ...overrides,
});

describe('OpenEXR output presets', () => {
  it('resolves the default half-float ACEScg preset against the active config', () => {
    const preset = resolveOpenExrOutputPreset(DEFAULT_OPEN_EXR_OUTPUT_PRESET, [
      colorSpace({
        name: 'ACEScg',
        canonicalName: 'ACEScg',
        aliases: ['scene_linear'],
        categories: ['file-io'],
        family: 'ACES',
        encoding: 'scene-linear',
      }),
    ]);

    expect(preset).toMatchObject({
      id: 'acescg_half',
      label: 'ACEScg - Half Float',
      colorSpace: 'ACEScg',
      precision: 'half',
    });
    expect(preset.attributes).toEqual({
      ocioColorSpace: { type: 'string', value: 'ACEScg' },
      chromaticities: {
        type: 'chromaticities',
        value: {
          redX: 0.713,
          redY: 0.293,
          greenX: 0.165,
          greenY: 0.83,
          blueX: 0.128,
          blueY: 0.044,
          whiteX: 0.32168,
          whiteY: 0.33767,
        },
      },
    });
    expect(OPEN_EXR_OUTPUT_PRESETS).toHaveLength(2);
  });

  it('resolves ACES2065-1 as the full-float interchange preset', () => {
    expect(
      resolveOpenExrOutputPreset('aces2065_1_float', [
        colorSpace({
          name: 'ACES2065-1',
          canonicalName: 'ACES2065-1',
          family: 'ACES',
          encoding: 'scene-linear',
        }),
      ]),
    ).toMatchObject({
      id: 'aces2065_1_float',
      label: 'ACES2065-1 - Full Float',
      colorSpace: 'ACES2065-1',
      precision: 'float',
    });
  });

  it('fails explicitly when ACEScg is unavailable', () => {
    expect(() =>
      resolveOpenExrOutputPreset(DEFAULT_OPEN_EXR_OUTPUT_PRESET, [
        colorSpace({
          name: 'ACES2065-1',
          canonicalName: 'ACES2065-1',
          family: 'ACES',
          encoding: 'scene-linear',
        }),
      ]),
    ).toThrow('OpenEXR preset "ACEScg - Half Float" "ACEScg" is not defined');
  });
});
