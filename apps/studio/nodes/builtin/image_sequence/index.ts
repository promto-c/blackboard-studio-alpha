import { NodeType, BlendMode, ImageFitMode, ImageSequenceNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import { mediaTransformAnimation } from '../../animationHelpers';
import ImageSequenceAdjustments from './ImageSequenceAdjustments';
import * as Icons from '@blackboard/icons';
import ImageSequenceToolButton from './ImageSequenceToolButton';
import { createSourceTransformUpdate, sourceMediaNodeFlags } from '../../sourceNodeBehavior';

export const imageSequenceNode: NodeDefinition = {
  type: NodeType.IMAGE_SEQUENCE,
  name: 'Image Sequence',
  category: 'Image',
  renderMode: 'media',
  IconComponent: Icons.FolderOpen,
  ToolComponent: ImageSequenceToolButton,
  AdjustmentComponent: ImageSequenceAdjustments,
  flags: {
    ...sourceMediaNodeFlags,
    isLooping: true,
  },
  animation: mediaTransformAnimation,
  getInitialNodeProps: (): Omit<ImageSequenceNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    frames: [],
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'sRGB Encoded Rec.709 (sRGB)',
    sourceAlphaMode: 'file',
    useOutputSizeAsScene: false,
    fps: 30,
    startFrame: 0,
    loop: true,
  }),
  mediaDescriptor: {
    getAssetIds: (node) => {
      const imageSeq = node as ImageSequenceNode;
      return imageSeq.frames ? imageSeq.frames.filter(Boolean) : [];
    },
    checkFrameReady: (node, frame, caches) => {
      const seq = node as ImageSequenceNode;
      if (!seq.frames || seq.frames.length === 0) return true;
      const idx = Math.floor(frame) % seq.frames.length;
      const safeIdx = (idx + seq.frames.length) % seq.frames.length;
      const assetId = seq.frames[safeIdx];
      return !assetId || caches.imageCache.has(assetId);
    },
    getMediaTextureKey: (node, frame) => {
      const seq = node as ImageSequenceNode;
      if (!seq.frames || seq.frames.length === 0) return '';
      const idx = Math.floor(frame!) % seq.frames.length;
      const safeIdx = (idx + seq.frames.length) % seq.frames.length;
      return seq.frames[safeIdx] || '';
    },
    getColorSpace: (node) => (node as ImageSequenceNode).colorSpace ?? 'sRGB',
  },
  onNodeUpdate: (node, changes, context) => {
    return createSourceTransformUpdate(node as ImageSequenceNode, changes, context) ?? { changes };
  },
};
