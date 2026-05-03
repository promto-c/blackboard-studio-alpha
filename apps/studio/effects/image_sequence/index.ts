import {
  NodeType,
  BlendMode,
  ImageFitMode,
  ImageSequenceNode,
  ImageTransform,
  SceneNode,
} from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import { mediaTransformAnimation } from '../effectAnimationHelpers';
import ImageSequenceAdjustments from './ImageSequenceAdjustments';
import * as Icons from '@blackboard/icons';
import ImageSequenceToolButton from './ImageSequenceToolButton';
import { calculateTransformForFitMode } from '@/state/editor/selectors';

export const imageSequenceEffect: EffectDefinition = {
  type: NodeType.IMAGE_SEQUENCE,
  name: 'Image Sequence',
  category: 'Image',
  renderMode: 'media',
  IconComponent: Icons.FolderOpen,
  ToolComponent: ImageSequenceToolButton,
  AdjustmentComponent: ImageSequenceAdjustments,
  flags: {
    isSource: true,
    isRenderable: true,
    isMediaNode: true,
    isLooping: true,
    showDataWindow: true,
    hasThumbnail: true,
  },
  animation: mediaTransformAnimation,
  getInitialNodeProps: (): Omit<ImageSequenceNode, 'id' | 'name' | 'visible' | 'type'> => ({
    frames: [],
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'sRGB',
    fps: 30,
    startFrame: 0,
    loop: true,
  }),
  getAssetIds: (node) => {
    const frames = (node as any).frames as string[] | undefined;
    return frames ? frames.filter(Boolean) : [];
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      const frames = (node as any).frames as string[] | undefined;
      return frames ? frames.filter(Boolean) : [];
    },
    checkFrameReady: (node, frame, caches) => {
      const seq = node as any;
      if (!seq.frames || seq.frames.length === 0) return true;
      const idx = Math.floor(frame) % seq.frames.length;
      const safeIdx = (idx + seq.frames.length) % seq.frames.length;
      const assetId = seq.frames[safeIdx];
      return !assetId || caches.imageCache.has(assetId);
    },
    getMediaTextureKey: (node, frame) => {
      const seq = node as any;
      if (!seq.frames || seq.frames.length === 0) return '';
      const idx = Math.floor(frame!) % seq.frames.length;
      const safeIdx = (idx + seq.frames.length) % seq.frames.length;
      return seq.frames[safeIdx] || '';
    },
    getColorSpace: (node) => (node as any).colorSpace ?? 'sRGB',
  },
  onNodeUpdate: (node, changes, context) => {
    const seqNode = node as ImageSequenceNode;

    if ('transform' in changes && changes.transform && context.sceneNode) {
      const oldTransform = seqNode.transform;
      const newTransformPartial = changes.transform as Partial<ImageTransform>;
      const label = `Transform ${node.name}`;
      const sceneNode = context.sceneNode as SceneNode;

      if (newTransformPartial.fitMode && newTransformPartial.fitMode !== oldTransform.fitMode) {
        const { scale } = calculateTransformForFitMode(
          { width: seqNode.width, height: seqNode.height },
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
