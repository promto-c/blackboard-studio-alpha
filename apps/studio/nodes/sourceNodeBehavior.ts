import {
  ComfyNode,
  ImageFitMode,
  ImageSequenceNode,
  ImageTransform,
  MediaSourceNode,
  OnnxModelNode,
  SceneNode,
} from '@blackboard/types';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import type { NodeFlags, NodeUpdateContext, NodeUpdateResult } from './NodeDefinition';
import { IMAGE_FIT_MODE_OPTIONS, shouldApplyImageFitPreset } from './imageFitMode';

export type SourceTransformNode = MediaSourceNode | ImageSequenceNode | ComfyNode | OnnxModelNode;

export const sourceMediaNodeFlags: NodeFlags = {
  isSource: true,
  isRenderable: true,
  isMediaNode: true,
  showDataWindow: true,
  hasThumbnail: true,
};

export const SOURCE_FIT_MODE_OPTIONS = IMAGE_FIT_MODE_OPTIONS;

const hasRenderableSize = (size: { width: number; height: number }): boolean =>
  Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

export const createAutoFitTransform = ({
  node,
  imageSize,
  sceneNode,
  fitMode = node.transform.fitMode,
}: {
  node: SourceTransformNode;
  imageSize: { width: number; height: number };
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
  fitMode?: ImageFitMode;
}): ImageTransform => {
  const sceneRect = { x: 0, y: 0, width: sceneNode.width, height: sceneNode.height };
  if (!hasRenderableSize(imageSize) || !hasRenderableSize(sceneRect)) {
    return node.transform;
  }

  const fittedTransform = calculateTransformForFitMode(
    imageSize,
    { width: sceneRect.width, height: sceneRect.height },
    fitMode,
  );

  return {
    ...node.transform,
    ...fittedTransform,
    fitMode,
    x: fittedTransform.x,
    y: fittedTransform.y,
  };
};

export const createSourceTransformUpdate = (
  node: SourceTransformNode,
  changes: Record<string, unknown>,
  context: NodeUpdateContext,
): NodeUpdateResult | null => {
  const incomingTransform = changes.transform as Partial<ImageTransform> | undefined;
  const width = typeof changes.width === 'number' ? changes.width : node.width;
  const height = typeof changes.height === 'number' ? changes.height : node.height;
  const sceneNode = context.sceneNode as SceneNode | undefined;
  if (!incomingTransform && !('width' in changes) && !('height' in changes)) {
    return null;
  }

  const oldTransform = node.transform;
  const nextTransform = incomingTransform
    ? { ...oldTransform, ...incomingTransform }
    : { ...oldTransform };
  const fitModeChanged =
    incomingTransform?.fitMode !== undefined && incomingTransform.fitMode !== oldTransform.fitMode;
  const sizeChanged = width !== node.width || height !== node.height;
  const shouldFit =
    sceneNode &&
    node.useOutputSizeAsScene !== true &&
    hasRenderableSize({ width, height }) &&
    shouldApplyImageFitPreset({
      fitMode: nextTransform.fitMode,
      fitModeChanged,
      sizeChanged,
    });

  if (shouldFit) {
    return {
      changes: {
        ...changes,
        transform: createAutoFitTransform({
          node: { ...node, transform: nextTransform },
          imageSize: { width, height },
          sceneNode,
          fitMode: nextTransform.fitMode,
        }),
      },
      label: `Transform ${node.name}`,
    };
  }

  if (incomingTransform) {
    return {
      changes: {
        ...changes,
        transform: nextTransform,
      },
      label: `Transform ${node.name}`,
    };
  }

  return null;
};
