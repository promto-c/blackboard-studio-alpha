import type { ComfyNode, GeneratedOutput } from '@blackboard/types';

const getLiveRegionIdSet = (node: Pick<ComfyNode, 'viewportPromptRegions'>): Set<string> =>
  new Set((node.viewportPromptRegions ?? []).map((region) => region.id));

export const getComfyOutputActivationRegionId = (
  node: Pick<ComfyNode, 'viewportPromptRegions'>,
  output: Pick<GeneratedOutput, 'regionId'>,
): string | undefined => {
  if (!output.regionId) return undefined;
  return getLiveRegionIdSet(node).has(output.regionId) ? output.regionId : undefined;
};

const getComfyOutputActivationBucketId = (
  node: Pick<ComfyNode, 'viewportPromptRegions'>,
  output: Pick<GeneratedOutput, 'regionId'>,
): string | null => getComfyOutputActivationRegionId(node, output) ?? null;

export const getComfyGeneratedOutputsForActivation = ({
  node,
  outputs = node.generatedOutputs ?? [],
  activatedOutput,
}: {
  node: Pick<ComfyNode, 'generatedOutputs' | 'viewportPromptRegions'>;
  outputs?: readonly GeneratedOutput[];
  activatedOutput: GeneratedOutput;
}): GeneratedOutput[] => {
  const activatedBucketId = getComfyOutputActivationBucketId(node, activatedOutput);

  return outputs.map((output) => {
    if (output.deletedAt) return output;
    if (output.id === activatedOutput.id) {
      return output.visible === true ? output : { ...output, visible: true };
    }

    const outputBucketId = getComfyOutputActivationBucketId(node, output);
    if (outputBucketId !== activatedBucketId) return output;

    return output.visible === false ? output : { ...output, visible: false };
  });
};

export const getComfyGeneratedOutputsForGalleryActivation = (
  node: Pick<ComfyNode, 'generatedOutputs' | 'viewportPromptRegions'>,
  activatedOutput: GeneratedOutput,
): GeneratedOutput[] => getComfyGeneratedOutputsForActivation({ node, activatedOutput });
