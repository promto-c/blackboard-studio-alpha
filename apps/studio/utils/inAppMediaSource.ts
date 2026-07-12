import { ImageFitMode, NodeType } from '@blackboard/types';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { createScene3DSettingsWithAsset } from '@/nodes/builtin/scene_3d/scene3d';
import type { InAppMediaDragPayload } from './inAppMediaDrag';

export interface InAppMediaNodeSpec {
  nodeType: NodeType;
  name: string;
  props: Record<string, unknown>;
}

export const getInAppMediaNodeSpec = (
  payload: InAppMediaDragPayload,
  sceneSize?: { width: number; height: number } | null,
): InAppMediaNodeSpec | null => {
  const name = payload.label?.trim() || 'Gallery Media';

  if (payload.mediaKind === 'model_3d') {
    if (!payload.scene3dAsset) return null;
    return {
      nodeType: NodeType.SCENE_3D,
      name,
      props: {
        viewportMode: 'scene3d',
        scene3d: createScene3DSettingsWithAsset(
          payload.scene3dAsset,
          sceneSize?.width,
          sceneSize?.height,
        ),
      },
    };
  }

  const fittedTransform =
    sceneSize && payload.width > 0 && payload.height > 0
      ? calculateTransformForFitMode(
          { width: payload.width, height: payload.height },
          sceneSize,
          ImageFitMode.FIT,
        )
      : { scaleX: 1, scaleY: 1 };
  const transform = {
    x: 0,
    y: 0,
    scaleX: fittedTransform.scaleX,
    scaleY: fittedTransform.scaleY,
    fitMode: ImageFitMode.FIT,
  };
  const colorProps = {
    ...(payload.colorSpace ? { colorSpace: payload.colorSpace } : {}),
    ...(payload.mediaColorManagement ? { mediaColorManagement: payload.mediaColorManagement } : {}),
  };

  if (payload.mediaKind === 'image_sequence') {
    if (!payload.frames?.length) return null;
    return {
      nodeType: NodeType.IMAGE_SEQUENCE,
      name,
      props: {
        frames: payload.frames,
        sourceFileName: name,
        width: payload.width,
        height: payload.height,
        fps: payload.fps ?? 30,
        transform,
        useOutputSizeAsScene: payload.useOutputSizeAsScene ?? false,
        ...colorProps,
      },
    };
  }

  return {
    nodeType: NodeType.MEDIA_SOURCE,
    name,
    props: {
      src: payload.assetId,
      sourceFileName: name,
      mediaKind: payload.mediaKind,
      width: payload.width,
      height: payload.height,
      transform,
      useOutputSizeAsScene: payload.useOutputSizeAsScene ?? false,
      ...colorProps,
      ...(payload.mediaKind === 'video'
        ? {
            duration: payload.duration ?? 0,
            frameCount: Math.max(1, Math.ceil((payload.duration ?? 0) * (payload.fps ?? 30))),
            ...(payload.videoColorMetadata
              ? { videoColorMetadata: payload.videoColorMetadata }
              : {}),
          }
        : {}),
    },
  };
};
