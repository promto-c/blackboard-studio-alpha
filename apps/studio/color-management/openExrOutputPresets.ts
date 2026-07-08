import type { OpenExrOutputPresetId } from '@blackboard/types';
import type { ExrChromaticities, WriteExrAttribute } from '@bb-studio/exr';
import { assertSceneLinearWorkingSpaceCandidate } from './workingSpace';
import type { ColorSpaceInfo } from './types';

export interface OpenExrOutputPreset {
  id: OpenExrOutputPresetId;
  label: string;
  colorSpace: string;
  precision: 'half' | 'float';
  attributes: Readonly<Record<string, WriteExrAttribute>>;
}

export const DEFAULT_OPEN_EXR_OUTPUT_PRESET: OpenExrOutputPresetId = 'acescg_half';

const createColorAttributes = (
  colorSpace: string,
  chromaticities: ExrChromaticities,
): Readonly<Record<string, WriteExrAttribute>> => ({
  ocioColorSpace: { type: 'string', value: colorSpace },
  chromaticities: { type: 'chromaticities', value: chromaticities },
});

export const OPEN_EXR_OUTPUT_PRESETS: readonly OpenExrOutputPreset[] = [
  {
    id: 'acescg_half',
    label: 'ACEScg - Half Float',
    colorSpace: 'ACEScg',
    precision: 'half',
    attributes: createColorAttributes('ACEScg', {
      redX: 0.713,
      redY: 0.293,
      greenX: 0.165,
      greenY: 0.83,
      blueX: 0.128,
      blueY: 0.044,
      whiteX: 0.32168,
      whiteY: 0.33767,
    }),
  },
  {
    id: 'aces2065_1_float',
    label: 'ACES2065-1 - Full Float',
    colorSpace: 'ACES2065-1',
    precision: 'float',
    attributes: createColorAttributes('ACES2065-1', {
      redX: 0.7347,
      redY: 0.2653,
      greenX: 0,
      greenY: 1,
      blueX: 0.0001,
      blueY: -0.077,
      whiteX: 0.32168,
      whiteY: 0.33767,
    }),
  },
];

export const resolveOpenExrOutputPreset = (
  presetId: OpenExrOutputPresetId,
  colorSpaces: readonly ColorSpaceInfo[],
): OpenExrOutputPreset => {
  const preset = OPEN_EXR_OUTPUT_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) {
    throw new Error(`Unknown OpenEXR output preset "${presetId}".`);
  }

  return {
    ...preset,
    colorSpace: assertSceneLinearWorkingSpaceCandidate(
      colorSpaces,
      preset.colorSpace,
      `OpenEXR preset "${preset.label}"`,
    ),
  };
};
