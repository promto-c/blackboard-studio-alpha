import type { ComfyNode, GeneratedOutput } from '@blackboard/types';
import { createAutoFitTransform } from '@/nodes/sourceNodeBehavior';
import { getImageFitModeTransformUpdate, isCustomImageFitMode } from '@/nodes/imageFitMode';
import { hasPositiveSize } from '@/utils/guards';

type OutputRect = { x: number; y: number; width: number; height: number };
type SceneSize = { width: number; height: number };

const getOutputRegionRect = (
  node: ComfyNode,
  output: Pick<GeneratedOutput, 'regionId' | 'regionRect'>,
): OutputRect | null => {
  const region = output.regionId
    ? (node.viewportPromptRegions ?? []).find((r) => r.id === output.regionId)
    : null;
  if (region) return { ...region.rect };
  return output.regionRect ? { ...output.regionRect } : null;
};

const getCenteredRegionOffset = (
  regionRect: OutputRect,
  sceneNode: SceneSize,
): { x: number; y: number } => ({
  x: regionRect.x + regionRect.width / 2 - sceneNode.width / 2,
  y: sceneNode.height / 2 - (regionRect.y + regionRect.height / 2),
});

export const getComfyOutputRegionOffset = ({
  node,
  output,
  sceneNode,
}: {
  node: ComfyNode;
  output: Pick<GeneratedOutput, 'regionId' | 'regionRect' | 'useOutputSizeAsScene'>;
  sceneNode: SceneSize | null | undefined;
}): { x: number; y: number } => {
  if (output.useOutputSizeAsScene || !sceneNode || !hasPositiveSize(sceneNode)) {
    return { x: 0, y: 0 };
  }
  const regionRect = getOutputRegionRect(node, output);
  return regionRect ? getCenteredRegionOffset(regionRect, sceneNode) : { x: 0, y: 0 };
};

export const getComfyOutputTransform = ({
  node,
  output,
  sceneNode,
}: {
  node: ComfyNode;
  output: Pick<
    GeneratedOutput,
    'width' | 'height' | 'transform' | 'useOutputSizeAsScene' | 'regionId' | 'regionRect'
  >;
  sceneNode: { width: number; height: number } | null | undefined;
}): ComfyNode['transform'] => {
  // Priority for effective scene:
  // 1. If useOutputSizeAsScene → output pixel dimensions (no scaling)
  // 2. If output is in a region → region dimensions ("Keep Scene" relative to region)
  // 3. Otherwise → full scene dimensions
  const regionRect = !output.useOutputSizeAsScene ? getOutputRegionRect(node, output) : null;
  const effectiveScene =
    output.useOutputSizeAsScene && hasPositiveSize(output)
      ? { width: output.width, height: output.height }
      : hasPositiveSize(regionRect)
        ? regionRect
        : sceneNode;

  if (!hasPositiveSize(output) || !hasPositiveSize(effectiveScene)) {
    const storedTransform = output.transform ?? node.transform;
    return {
      ...storedTransform,
      ...getImageFitModeTransformUpdate(storedTransform.fitMode),
    };
  }

  // Auto-fit using the effective scene (region dimensions when output is in a region)
  const fitMode = output.transform?.fitMode ?? node.transform.fitMode;
  const transform = createAutoFitTransform({
    node,
    imageSize: { width: output.width, height: output.height },
    sceneNode: effectiveScene,
    fitMode,
  });

  // Preserve per-output transform overrides when the user has manually
  // adjusted scale. Auto-fit returns plain computed numbers, but the output
  // may have keyframe arrays or user-set values that should take effect.
  let effectiveTransform = transform;
  if (output.transform && !output.useOutputSizeAsScene && isCustomImageFitMode(fitMode)) {
    effectiveTransform = {
      ...transform,
      x: output.transform.x ?? transform.x,
      y: output.transform.y ?? transform.y,
      scaleX: output.transform.scaleX ?? transform.scaleX,
      scaleY: output.transform.scaleY ?? transform.scaleY,
    };
  }

  // Region rectangles are top-left/down-positive; media transforms are
  // centered offsets with positive Y moving up in the renderer.
  if (regionRect && sceneNode && hasPositiveSize(sceneNode)) {
    const regionOffset = getComfyOutputRegionOffset({ node, output, sceneNode });
    return {
      ...effectiveTransform,
      x: (effectiveTransform.x as number) + regionOffset.x,
      y: (effectiveTransform.y as number) + regionOffset.y,
    };
  }

  return effectiveTransform;
};
