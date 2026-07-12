import { NodeType, BlendMode, ImageFitMode, MediaSourceNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import { mediaTransformAnimation } from '../../animationHelpers';
import MediaSourceAdjustments from './MediaSourceAdjustments';
import { Photo } from '@blackboard/icons';
import MediaSourceImportToolButton from './MediaSourceImportToolButton';
import { createSourceTransformUpdate, sourceMediaNodeFlags } from '../../sourceNodeBehavior';
import {
  ColorManagementDefaults,
  createProjectDefaultMediaColorManagement,
  getMediaSourceColorSpace,
  isDataMediaColorManagement,
} from '@/color-management';
import { resolveTemporalSourceFrame } from '../../sourceFrameRange';

export const mediaSourceNode: NodeDefinition = {
  type: NodeType.MEDIA_SOURCE,
  name: 'Media Source',
  category: 'Image',
  renderMode: 'media',
  processingDomain: 'scene_linear',
  IconComponent: Photo,
  ToolComponent: MediaSourceImportToolButton,
  AdjustmentComponent: MediaSourceAdjustments,
  flags: sourceMediaNodeFlags,
  animation: mediaTransformAnimation,
  getInitialNodeProps: () => ({
    src: '',
    mediaKind: 'image',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
    mediaColorManagement: createProjectDefaultMediaColorManagement(),
    sourceAlphaMode: 'file',
    useOutputSizeAsScene: false,
    startFrame: 0,
    beforeRangeBehavior: 'black',
    afterRangeBehavior: 'black',
  }),
  mediaDescriptor: {
    getAssetIds: (node) => {
      const src = (node as MediaSourceNode).src;
      return src ? [src] : [];
    },
    resolveFrame: (node, frame) => {
      const mediaNode = node as MediaSourceNode;
      return mediaNode.mediaKind === 'video'
        ? resolveTemporalSourceFrame(mediaNode, frame)
        : Math.round(frame);
    },
    checkFrameReady: (node, frame, caches) => {
      const mediaNode = node as MediaSourceNode;
      const src = mediaNode.src;
      if (!src) return true;
      if (mediaNode.mediaKind === 'video') {
        const sourceFrame = resolveTemporalSourceFrame(mediaNode, frame);
        if (sourceFrame === null) return true;
        const frameKey = `${src}:${sourceFrame}`;
        if (caches.imageCache.has(frameKey)) return true;
        const entry = caches.videoElements.get(src);
        if (!entry) return false;
        if (entry.seeking || entry.readyState < 2) return false;
        return true;
      }
      return caches.imageCache.has(src);
    },
    getMediaTextureKey: (node, frame) => {
      const mediaNode = node as MediaSourceNode;
      if (!mediaNode.src) return '';
      if (mediaNode.mediaKind === 'video') {
        const sourceFrame = resolveTemporalSourceFrame(mediaNode, frame);
        return sourceFrame === null ? '' : `${mediaNode.src}:${sourceFrame}`;
      }
      return mediaNode.src;
    },
    getColorSpace: (node) => {
      const mediaNode = node as MediaSourceNode;
      return getMediaSourceColorSpace(mediaNode.mediaColorManagement) ?? mediaNode.colorSpace;
    },
    isData: (node) => isDataMediaColorManagement((node as MediaSourceNode).mediaColorManagement),
    isVideoFile: (node) => (node as MediaSourceNode).mediaKind === 'video',
  },
  onNodeUpdate: (node, changes, context) => {
    return createSourceTransformUpdate(node as MediaSourceNode, changes, context) ?? { changes };
  },
};
