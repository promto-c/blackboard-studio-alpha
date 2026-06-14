import { NodeType, BlendMode, ImageFitMode, MediaSourceNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import { mediaTransformAnimation } from '../../animationHelpers';
import MediaSourceAdjustments from './MediaSourceAdjustments';
import { Photo } from '@blackboard/icons';
import MediaSourceImportToolButton from './MediaSourceImportToolButton';
import { createSourceTransformUpdate, sourceMediaNodeFlags } from '../../sourceNodeBehavior';

export const mediaSourceNode: NodeDefinition = {
  type: NodeType.MEDIA_SOURCE,
  name: 'Media Source',
  category: 'Image',
  renderMode: 'media',
  IconComponent: Photo,
  ToolComponent: MediaSourceImportToolButton,
  AdjustmentComponent: MediaSourceAdjustments,
  flags: {
    ...sourceMediaNodeFlags,
    isLooping: true,
  },
  animation: mediaTransformAnimation,
  getInitialNodeProps: () => ({
    src: '',
    mediaKind: 'image',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'sRGB Encoded Rec.709 (sRGB)',
    sourceAlphaMode: 'file',
    useOutputSizeAsScene: false,
    loop: true,
  }),
  mediaDescriptor: {
    getAssetIds: (node) => {
      const src = (node as MediaSourceNode).src;
      return src ? [src] : [];
    },
    checkFrameReady: (node, frame, caches) => {
      const mediaNode = node as MediaSourceNode;
      const src = mediaNode.src;
      if (!src) return true;
      if (mediaNode.mediaKind === 'video') {
        const frameKey = `${src}:${Math.round(frame)}`;
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
        return `${mediaNode.src}:${Math.round(frame!)}`;
      }
      return mediaNode.src;
    },
    getColorSpace: (node) => (node as MediaSourceNode).colorSpace,
    isVideoFile: (node) => (node as MediaSourceNode).mediaKind === 'video',
  },
  onNodeUpdate: (node, changes, context) => {
    return createSourceTransformUpdate(node as MediaSourceNode, changes, context) ?? { changes };
  },
};
