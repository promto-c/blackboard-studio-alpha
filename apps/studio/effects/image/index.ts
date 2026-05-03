import {
  NodeType,
  BlendMode,
  ImageFitMode,
  ImageNode,
  ImageTransform,
  SceneNode,
} from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import { mediaTransformAnimation } from '../effectAnimationHelpers';
import ImageAdjustments from './ImageAdjustments';
import * as Icons from '@blackboard/icons';
import ImageImportToolButton from './ImageImportToolButton';
import { calculateTransformForFitMode } from '@/state/editor/selectors';

export const imageEffect: EffectDefinition = {
  type: NodeType.IMAGE,
  name: 'Image',
  category: 'Image',
  renderMode: 'media',
  IconComponent: Icons.Photo,
  ToolComponent: ImageImportToolButton,
  AdjustmentComponent: ImageAdjustments,
  flags: {
    isSource: true,
    isRenderable: true,
    isMediaNode: true,
    showDataWindow: true,
    hasThumbnail: true,
  },
  animation: mediaTransformAnimation,
  getInitialNodeProps: () => ({
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'sRGB',
  }),
  getAssetIds: (node) => {
    const src = (node as any).src;
    return src ? [src] : [];
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      const src = (node as any).src;
      return src ? [src] : [];
    },
    checkFrameReady: (node, _frame, caches) => {
      const src = (node as any).src;
      return !src || caches.imageCache.has(src);
    },
    getMediaTextureKey: (node) => (node as any).src || '',
    getColorSpace: (node) => (node as any).colorSpace,
  },
  onNodeUpdate: (node, changes, context) => {
    const imgNode = node as ImageNode;

    if ('transform' in changes && changes.transform && context.sceneNode) {
      const oldTransform = imgNode.transform;
      const newTransformPartial = changes.transform as Partial<ImageTransform>;
      const label = `Transform ${node.name}`;
      const sceneNode = context.sceneNode as SceneNode;

      if (newTransformPartial.fitMode && newTransformPartial.fitMode !== oldTransform.fitMode) {
        const { scale } = calculateTransformForFitMode(
          { width: imgNode.width, height: imgNode.height },
          { width: sceneNode.width, height: sceneNode.height },
          newTransformPartial.fitMode,
        );
        return {
          changes: {
            ...changes,
            transform: { ...oldTransform, ...newTransformPartial, scale, x: 0, y: 0 },
          },
          label,
        };
      }

      return {
        changes: {
          ...changes,
          transform: { ...oldTransform, ...newTransformPartial },
        },
        label,
      };
    }

    return { changes };
  },
};
