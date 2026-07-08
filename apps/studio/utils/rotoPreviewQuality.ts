import type { SceneNode } from '@blackboard/types';

export const RotoInteractivePreviewSize = {
  MIN: 320,
  MAX: 2160,
  STEP: 80,
  DEFAULT: 1280,
} as const;

export const clampRotoInteractivePreviewSize = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return RotoInteractivePreviewSize.DEFAULT;
  }
  return Math.round(
    Math.min(RotoInteractivePreviewSize.MAX, Math.max(RotoInteractivePreviewSize.MIN, value)),
  );
};

export const resolveViewportRotoMaskRasterSize = (
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
  viewportSize: { width: number; height: number },
  interactive: boolean,
  maxInteractiveDimension: number = RotoInteractivePreviewSize.DEFAULT,
): { width: number; height: number } => {
  const sceneWidth = Math.max(1, sceneNode.width);
  const sceneHeight = Math.max(1, sceneNode.height);
  if (!interactive) {
    return { width: sceneWidth, height: sceneHeight };
  }

  const viewportScale =
    viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(viewportSize.width / sceneWidth, viewportSize.height / sceneHeight)
      : 1;
  const budgetScale =
    clampRotoInteractivePreviewSize(maxInteractiveDimension) / Math.max(sceneWidth, sceneHeight);
  const scale = Math.min(1, viewportScale, budgetScale);

  return {
    width: Math.max(1, Math.round(sceneWidth * scale)),
    height: Math.max(1, Math.round(sceneHeight * scale)),
  };
};
