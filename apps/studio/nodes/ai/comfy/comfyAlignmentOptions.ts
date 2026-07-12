import type { ComfyNode } from '@blackboard/types';

export type ComfyAlignmentOptions = NonNullable<ComfyNode['alignmentOptions']>;
export type ComfyAlignmentQuality = 'fast' | 'balanced' | 'precise';

export const ALIGNMENT_OPTION_KEYS = [
  'skipEditedRegions',
  'iterativeRefinement',
  'highResRefinement',
  'edgeAwareSampling',
  'subPixelRefinement',
] as const satisfies readonly (keyof ComfyAlignmentOptions)[];

export const COMFY_ALIGNMENT_QUALITY_PRESETS: Record<
  ComfyAlignmentQuality,
  Required<ComfyAlignmentOptions>
> = {
  fast: {
    skipEditedRegions: false,
    iterativeRefinement: false,
    highResRefinement: false,
    edgeAwareSampling: false,
    subPixelRefinement: false,
  },
  balanced: {
    skipEditedRegions: true,
    iterativeRefinement: true,
    highResRefinement: false,
    edgeAwareSampling: true,
    subPixelRefinement: false,
  },
  precise: {
    skipEditedRegions: true,
    iterativeRefinement: true,
    highResRefinement: true,
    edgeAwareSampling: true,
    subPixelRefinement: true,
  },
};

export const DEFAULT_COMFY_ALIGNMENT_OPTIONS = COMFY_ALIGNMENT_QUALITY_PRESETS.fast;

export const resolveComfyAlignmentOptions = (
  options?: ComfyAlignmentOptions,
): Required<ComfyAlignmentOptions> => ({
  ...DEFAULT_COMFY_ALIGNMENT_OPTIONS,
  ...options,
});

export const getComfyAlignmentQuality = (
  options?: ComfyAlignmentOptions,
): ComfyAlignmentQuality | null => {
  const resolvedOptions = resolveComfyAlignmentOptions(options);
  const qualities: ComfyAlignmentQuality[] = ['fast', 'balanced', 'precise'];

  return (
    qualities.find((quality) =>
      ALIGNMENT_OPTION_KEYS.every(
        (key) => resolvedOptions[key] === COMFY_ALIGNMENT_QUALITY_PRESETS[quality][key],
      ),
    ) ?? null
  );
};
