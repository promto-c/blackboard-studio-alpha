import { NodeType, BlendMode, ImageFitMode, VideoNode } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import { mediaTransformAnimation } from '../effectAnimationHelpers';
import VideoAdjustments from './VideoAdjustments';
import { Video } from '@blackboard/icons';
import VideoImportToolButton from './VideoImportToolButton';

export const videoEffect: EffectDefinition = {
  type: NodeType.VIDEO,
  name: 'Video',
  category: 'Image',
  renderMode: 'media',
  IconComponent: Video,
  ToolComponent: VideoImportToolButton,
  AdjustmentComponent: VideoAdjustments,
  flags: {
    isSource: true,
    isRenderable: true,
    isMediaNode: true,
    isLooping: true,
    isVideoFile: true,
    showDataWindow: true,
    hasThumbnail: true,
  },
  animation: mediaTransformAnimation,
  getInitialNodeProps: (): Omit<VideoNode, 'id' | 'name' | 'visible' | 'type'> => ({
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    duration: 0,
    loop: true,
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
    checkFrameReady: (node, frame, caches) => {
      const src = (node as any).src;
      if (!src) return true;
      const frameKey = `${src}:${Math.round(frame)}`;
      if (caches.imageCache.has(frameKey)) return true;
      const entry = caches.videoElements.get(src);
      if (!entry) return false;
      if (entry.seeking || entry.readyState < 2) return false;
      return true;
    },
    getMediaTextureKey: (node, frame) => {
      const src = (node as any).src;
      if (!src) return '';
      return `${src}:${Math.round(frame!)}`;
    },
    getColorSpace: () => undefined,
  },
};
