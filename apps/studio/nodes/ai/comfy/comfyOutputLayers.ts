import type {
  ComfyNode,
  GeneratedOutput,
  SceneNode,
  ViewportPromptRegion,
} from '@blackboard/types';
import type { MediaCompositeLayer } from '@/nodes/NodeDefinition';
import { getComfyOutputTransform } from './comfyOutputTransform';
import { isComfy3DGeneratedOutput } from './comfyOutputActivation';
export {
  getComfyGeneratedOutputsForActivation,
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyOutputActivationRegionId,
} from './comfyOutputActivation';

export const isComfyRegionVisible = (region: ViewportPromptRegion | null | undefined): boolean =>
  region?.visible !== false;

export const isComfyGeneratedOutputVisible = (
  node: ComfyNode,
  output: GeneratedOutput,
): boolean => {
  if (output.deletedAt || output.visible === false) return false;
  const region = output.regionId
    ? (node.viewportPromptRegions ?? []).find((candidate) => candidate.id === output.regionId)
    : null;
  return isComfyRegionVisible(region);
};

export const getComfyGeneratedOutputTextureKey = (
  output: GeneratedOutput,
  frame: number,
): { textureKey: string; assetId: string; isVideoFile: boolean } | null => {
  if (isComfy3DGeneratedOutput(output)) return null;
  if (!output.src && (!output.frames || output.frames.length === 0)) return null;
  if (output.mediaKind === 'video') {
    return {
      textureKey: `${output.src}:${Math.round(frame)}`,
      assetId: output.src,
      isVideoFile: true,
    };
  }
  if (output.mediaKind === 'image_sequence' && output.frames?.length) {
    const index = Math.floor(frame);
    const safeIndex =
      ((index % output.frames.length) + output.frames.length) % output.frames.length;
    const assetId = output.frames[safeIndex] ?? output.src;
    return assetId ? { textureKey: assetId, assetId, isVideoFile: false } : null;
  }
  return output.src ? { textureKey: output.src, assetId: output.src, isVideoFile: false } : null;
};

const getOrderValue = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;

export const getOrderedComfyGeneratedOutputs = (node: ComfyNode): GeneratedOutput[] => {
  const outputs = node.generatedOutputs ?? [];
  const outputIndexById = new Map(outputs.map((output, index) => [output.id, index]));
  const liveRegionIds = new Set((node.viewportPromptRegions ?? []).map((region) => region.id));
  const outputsByRegionId = new Map<string, GeneratedOutput[]>();

  outputs.forEach((output) => {
    if (!output.regionId || !liveRegionIds.has(output.regionId)) return;
    const regionOutputs = outputsByRegionId.get(output.regionId) ?? [];
    regionOutputs.push(output);
    outputsByRegionId.set(output.regionId, regionOutputs);
  });

  const sortOutputs = (items: GeneratedOutput[]) =>
    [...items].sort((a, b) => {
      const aIndex = outputIndexById.get(a.id) ?? 0;
      const bIndex = outputIndexById.get(b.id) ?? 0;
      return getOrderValue(a.stackOrder, aIndex) - getOrderValue(b.stackOrder, bIndex);
    });

  const topLevel: Array<
    | { type: 'region'; regionId: string; stackOrder: number; fallbackIndex: number }
    | { type: 'output'; output: GeneratedOutput; stackOrder: number; fallbackIndex: number }
  > = [
    ...(node.viewportPromptRegions ?? []).map((region, index) => ({
      type: 'region' as const,
      regionId: region.id,
      stackOrder: getOrderValue(region.stackOrder, index),
      fallbackIndex: index,
    })),
    ...outputs
      .filter((output) => !output.regionId || !liveRegionIds.has(output.regionId))
      .map((output, index) => ({
        type: 'output' as const,
        output,
        stackOrder: getOrderValue(
          output.stackOrder,
          (node.viewportPromptRegions ?? []).length + index,
        ),
        fallbackIndex: (node.viewportPromptRegions ?? []).length + index,
      })),
  ].sort((a, b) => a.stackOrder - b.stackOrder || a.fallbackIndex - b.fallbackIndex);

  return topLevel.flatMap((item) => {
    if (item.type === 'output') return [item.output];
    return sortOutputs(outputsByRegionId.get(item.regionId) ?? []);
  });
};

export const getVisibleComfyGeneratedOutputs = (node: ComfyNode): GeneratedOutput[] =>
  getOrderedComfyGeneratedOutputs(node).filter(
    (output) => !isComfy3DGeneratedOutput(output) && isComfyGeneratedOutputVisible(node, output),
  );

export const getComfyGeneratedOutputsForGalleryScope = (
  node: Pick<ComfyNode, 'generatedOutputs'>,
  regionId?: string | null,
): GeneratedOutput[] =>
  (node.generatedOutputs ?? []).filter(
    (output) => !output.deletedAt && (!regionId || output.regionId === regionId),
  );

export const getComfyCompositeLayers = (
  node: ComfyNode,
  frame: number,
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
): MediaCompositeLayer[] =>
  [...getVisibleComfyGeneratedOutputs(node)].reverse().flatMap((output) => {
    const texture = getComfyGeneratedOutputTextureKey(output, frame);
    if (!texture) return [];
    const transform = getComfyOutputTransform({ node, output, sceneNode });

    return [
      {
        id: output.id,
        textureKey: texture.textureKey,
        assetId: texture.assetId,
        isVideoFile: texture.isVideoFile,
        width: output.width,
        height: output.height,
        transform,
        opacity: 100,
        colorSpace: output.colorSpace ?? node.colorSpace,
      },
    ];
  });
