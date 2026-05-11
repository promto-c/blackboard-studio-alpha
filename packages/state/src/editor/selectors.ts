import { AnimatableNumber, AnyNode, ImageFitMode, NodeType } from '@blackboard/types';
import { getLinearValueAtFrame } from '@blackboard/renderer';

export const getNodeCount = (nodes: AnyNode[], type: NodeType): number => {
  return nodes.filter((node) => node.type === type).length;
};

export const calculateTransformForFitMode = (
  imageSize: { width: number; height: number },
  sceneSize: { width: number; height: number },
  fitMode: ImageFitMode,
): { scaleX: number; scaleY: number; x: number; y: number } => {
  if (fitMode === ImageFitMode.NONE) {
    return { scaleX: 1, scaleY: 1, x: 0, y: 0 };
  }

  const imageAspect = imageSize.width / imageSize.height;
  const sceneAspect = sceneSize.width / sceneSize.height;

  if (fitMode === ImageFitMode.FIT) {
    const s =
      imageAspect > sceneAspect
        ? sceneSize.width / imageSize.width
        : sceneSize.height / imageSize.height;
    return { scaleX: s, scaleY: s, x: 0, y: 0 };
  }

  if (fitMode === ImageFitMode.STRETCH) {
    return {
      scaleX: sceneSize.width / imageSize.width,
      scaleY: sceneSize.height / imageSize.height,
      x: 0,
      y: 0,
    };
  }
  const s =
    imageAspect > sceneAspect
      ? sceneSize.height / imageSize.height
      : sceneSize.width / imageSize.width;
  return { scaleX: s, scaleY: s, x: 0, y: 0 };
};

export const getMedian = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export const getResolvedPoints = (
  points: { x: AnimatableNumber; y: AnimatableNumber }[],
  frame: number,
  trackPoints?: { x: AnimatableNumber; y: AnimatableNumber }[],
): { x: number; y: number }[] => {
  return points.map((point, index) => {
    const baseX = getLinearValueAtFrame(point.x, frame);
    const baseY = getLinearValueAtFrame(point.y, frame);
    const trackPoint = trackPoints?.[index];
    const trackX = trackPoint ? getLinearValueAtFrame(trackPoint.x, frame) : 0;
    const trackY = trackPoint ? getLinearValueAtFrame(trackPoint.y, frame) : 0;

    return { x: baseX + trackX, y: baseY + trackY };
  });
};
