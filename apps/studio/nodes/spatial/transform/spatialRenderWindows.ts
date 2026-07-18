import type { ReformatNode } from '@blackboard/types';
import type { RenderContext } from '@blackboard/renderer';

export const getReformatRenderWindowUniforms = (node: ReformatNode, context: RenderContext) => {
  const sourceWidth = node.sourceWidth ?? context.scene.width;
  const sourceHeight = node.sourceHeight ?? context.scene.height;

  return {
    sourceSize: [sourceWidth, sourceHeight],
    targetSize: [node.width, node.height],
    sourceStorageSize: [
      context.storageWindow?.width ?? sourceWidth,
      context.storageWindow?.height ?? sourceHeight,
    ],
    targetStorageSize: [
      context.outputStorageWindow?.width ?? node.width,
      context.outputStorageWindow?.height ?? node.height,
    ],
  };
};
