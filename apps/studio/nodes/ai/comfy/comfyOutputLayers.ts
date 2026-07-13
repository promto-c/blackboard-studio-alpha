import {
  ImageFitMode,
  type AnyNode,
  type ComfyNode,
  type GeneratedOutput,
  type SceneNode,
  type ViewportPromptRegion,
} from '@blackboard/types';
import type { MediaCompositeLayer } from '@/nodes/NodeDefinition';
import { isDataChannel, isDataMediaColorManagement } from '@/color-management';
import { createAutoFitTransform, type SourceTransformNode } from '../../sourceNodeBehavior';
import { getComfyOutputTransform } from './comfyOutputTransform';
import { isComfy3DGeneratedOutput } from './comfyOutputActivation';
import { resolveComfyDifferenceMask } from './comfyDifferenceMask';
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
  nodes?: readonly AnyNode[],
): MediaCompositeLayer[] => {
  const hiddenPortIds = new Set(node.hiddenInputPortIds ?? []);

  // Directly-loaded input port images — rendered behind generated outputs.
  // Reversed so the last port entry renders on top (matching output layer convention).
  const inputLayers: MediaCompositeLayer[] = Object.entries(node.workflowInputImages ?? {})
    .filter(([portName]) => !hiddenPortIds.has(portName))
    .reverse()
    .map(([portName, inputImage]) => {
      const fitTransform = createAutoFitTransform({
        node: node as unknown as SourceTransformNode,
        imageSize: { width: inputImage.width, height: inputImage.height },
        sceneNode,
        fitMode: ImageFitMode.FIT,
      });
      return {
        id: `${node.id}:input:${portName}`,
        textureKey: inputImage.assetId,
        assetId: inputImage.assetId,
        width: inputImage.width,
        height: inputImage.height,
        transform: fitTransform,
        colorSpace: node.colorSpace,
        isData:
          isDataMediaColorManagement(node.mediaColorManagement) ||
          isDataChannel(portName) ||
          isDataChannel(inputImage.name),
      } satisfies MediaCompositeLayer;
    });

  // Graph-edge connected input ports (upstream nodes feeding into Comfy inputs).
  // These are resolved as additional composite layers so they render at the
  // correct Z-order alongside directly-loaded images.
  if (nodes) {
    Object.entries(node.inputs ?? {})
      .filter(
        ([portName]) =>
          portName !== 'pipe' &&
          !hiddenPortIds.has(portName) &&
          !node.workflowInputImages?.[portName],
      )
      .forEach(([portName, sourceId]) => {
        const upstreamNode = nodes.find((n) => n.id === sourceId);
        if (!upstreamNode) return;
        const src = (upstreamNode as { src?: string }).src;
        if (!src) return;
        const width = (upstreamNode as { width?: number }).width ?? 0;
        const height = (upstreamNode as { height?: number }).height ?? 0;
        if (!width || !height) return;

        const fitTransform = createAutoFitTransform({
          node: node as unknown as SourceTransformNode,
          imageSize: { width, height },
          sceneNode,
          fitMode: ImageFitMode.FIT,
        });

        // Use the upstream node's own color space so the pipeline can
        // apply the correct transform (e.g. sRGB→Linear) instead of
        // assuming the Comfy node's colorSpace, which may be an OCIO
        // name like 'sRGB Encoded Rec.709 (sRGB)'.
        const upstreamColorSpace = (upstreamNode as { colorSpace?: string }).colorSpace;
        const upstreamMediaColorManagement = (
          upstreamNode as { mediaColorManagement?: ComfyNode['mediaColorManagement'] }
        ).mediaColorManagement;

        inputLayers.push({
          id: `${node.id}:input-graph:${portName}`,
          textureKey: src,
          assetId: src,
          width,
          height,
          transform: fitTransform,
          colorSpace: upstreamColorSpace ?? node.colorSpace,
          isData:
            isDataMediaColorManagement(upstreamMediaColorManagement) || isDataChannel(portName),
        } satisfies MediaCompositeLayer);
      });
  }

  // Visible generated outputs — rendered on top of all input images
  const outputLayers: MediaCompositeLayer[] = [...getVisibleComfyGeneratedOutputs(node)]
    .reverse()
    .flatMap((output) => {
      const texture = getComfyGeneratedOutputTextureKey(output, frame);
      if (!texture) return [];

      const transform = getComfyOutputTransform({ node, output, sceneNode });
      const differenceMask = output.differenceMask?.enabled
        ? resolveComfyDifferenceMask(output.differenceMask)
        : null;
      const differenceMaskTransform = differenceMask
        ? (differenceMask.referenceTransform ??
          createAutoFitTransform({
            node: node as unknown as SourceTransformNode,
            imageSize: {
              width: differenceMask.referenceWidth,
              height: differenceMask.referenceHeight,
            },
            sceneNode,
            fitMode: ImageFitMode.FIT,
          }))
        : null;

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
          isData:
            isDataMediaColorManagement(output.mediaColorManagement) || isDataChannel(output.label),
          ...(differenceMask && differenceMaskTransform
            ? {
                differenceMask: {
                  textureKey: differenceMask.referenceAssetId,
                  assetId: differenceMask.referenceAssetId,
                  width: differenceMask.referenceWidth,
                  height: differenceMask.referenceHeight,
                  transform: differenceMaskTransform,
                  thresholdLow: differenceMask.thresholdLow,
                  thresholdHigh: differenceMask.thresholdHigh,
                  comparisonBlur: differenceMask.comparisonBlur,
                  edgeAdjustment: differenceMask.edgeAdjustment,
                  removeSpecks: differenceMask.removeSpecks ?? 0,
                  fillHoles: differenceMask.fillHoles ?? 0,
                  morphologyShape: differenceMask.morphologyShape,
                  invert: differenceMask.invert,
                  previewMode: differenceMask.previewMode,
                },
              }
            : {}),
        } satisfies MediaCompositeLayer,
      ];
    });

  return [...inputLayers, ...outputLayers];
};
