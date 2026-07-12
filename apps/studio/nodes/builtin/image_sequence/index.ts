import { NodeType, BlendMode, ImageFitMode, ImageSequenceNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import { mediaTransformAnimation } from '../../animationHelpers';
import ImageSequenceAdjustments from './ImageSequenceAdjustments';
import * as Icons from '@blackboard/icons';
import ImageSequenceToolButton from './ImageSequenceToolButton';
import { createSourceTransformUpdate, sourceMediaNodeFlags } from '../../sourceNodeBehavior';
import {
  ColorManagementDefaults,
  createProjectDefaultMediaColorManagement,
  getMediaSourceColorSpace,
  isDataMediaColorManagement,
} from '@/color-management';
import { resolveTemporalSourceFrame } from '../../sourceFrameRange';

export const imageSequenceNode: NodeDefinition = {
  type: NodeType.IMAGE_SEQUENCE,
  name: 'Image Sequence',
  category: 'Image',
  renderMode: 'media',
  processingDomain: 'scene_linear',
  IconComponent: Icons.FolderOpen,
  ToolComponent: ImageSequenceToolButton,
  AdjustmentComponent: ImageSequenceAdjustments,
  flags: sourceMediaNodeFlags,
  animation: mediaTransformAnimation,
  getInitialNodeProps: (): Omit<ImageSequenceNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    frames: [],
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
    mediaColorManagement: createProjectDefaultMediaColorManagement(),
    sourceAlphaMode: 'file',
    useOutputSizeAsScene: false,
    fps: 30,
    startFrame: 0,
    beforeRangeBehavior: 'black',
    afterRangeBehavior: 'black',
  }),
  mediaDescriptor: {
    getAssetIds: (node) => {
      const imageSeq = node as ImageSequenceNode;
      return imageSeq.frames ? imageSeq.frames.filter(Boolean) : [];
    },
    resolveFrame: (node, frame) => resolveTemporalSourceFrame(node as ImageSequenceNode, frame),
    checkFrameReady: (node, frame, caches) => {
      const seq = node as ImageSequenceNode;
      if (!seq.frames || seq.frames.length === 0) return true;
      const index = resolveTemporalSourceFrame(seq, frame);
      if (index === null) return true;
      const assetId = seq.frames[index];
      return !assetId || caches.imageCache.has(assetId);
    },
    getMediaTextureKey: (node, frame) => {
      const seq = node as ImageSequenceNode;
      if (!seq.frames || seq.frames.length === 0) return '';
      const index = resolveTemporalSourceFrame(seq, frame);
      return index === null ? '' : seq.frames[index] || '';
    },
    getColorSpace: (node) => {
      const sequenceNode = node as ImageSequenceNode;
      return (
        getMediaSourceColorSpace(sequenceNode.mediaColorManagement) ??
        sequenceNode.colorSpace ??
        ColorManagementDefaults.TEXTURE_SPACE
      );
    },
    isData: (node) => isDataMediaColorManagement((node as ImageSequenceNode).mediaColorManagement),
  },
  onNodeUpdate: (node, changes, context) => {
    return createSourceTransformUpdate(node as ImageSequenceNode, changes, context) ?? { changes };
  },
};
