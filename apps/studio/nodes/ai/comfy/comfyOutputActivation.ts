import type { ComfyNode, GeneratedOutput } from '@blackboard/types';

export const isComfy3DGeneratedOutput = (output: Pick<GeneratedOutput, 'mediaKind'>): boolean =>
  output.mediaKind === 'model_3d';

export const getComfyMediaOutput = (
  outputs: readonly GeneratedOutput[],
): GeneratedOutput | undefined => outputs.find((output) => !isComfy3DGeneratedOutput(output));

export const getComfyOutputActivationUpdates = (output: GeneratedOutput): Partial<ComfyNode> => {
  const common = {
    activeGeneratedOutputId: output.id,
    lastPromptId: output.promptId,
    lastRunAt: output.createdAt,
  } satisfies Partial<ComfyNode>;

  if (isComfy3DGeneratedOutput(output)) return common;

  return {
    ...common,
    src: output.src,
    mediaKind: output.mediaKind === 'model_3d' ? 'image' : (output.mediaKind ?? 'image'),
    ...(output.colorSpace ? { colorSpace: output.colorSpace } : {}),
    ...(output.mediaColorManagement ? { mediaColorManagement: output.mediaColorManagement } : {}),
    frames: output.frames,
    duration: output.duration,
    fps: output.fps,
    videoColorMetadata: output.videoColorMetadata,
    width: output.width,
    height: output.height,
  };
};

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
  if (isComfy3DGeneratedOutput(activatedOutput)) return [...outputs];
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
