import type {
  MediaColorManagement,
  OcioColorSpaceName,
  Scene3DAssetReference,
  VideoColorMetadata,
} from '@blackboard/types';

export const IN_APP_MEDIA_DRAG_TYPE = 'application/x-blackboard-media-source';

export interface InAppMediaDragPayload {
  version: 1;
  assetId: string;
  mediaKind: 'image' | 'image_sequence' | 'video' | 'model_3d';
  label?: string;
  width: number;
  height: number;
  duration?: number;
  fps?: number;
  frames?: string[];
  colorSpace?: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  videoColorMetadata?: VideoColorMetadata;
  scene3dAsset?: Scene3DAssetReference;
  useOutputSizeAsScene?: boolean;
}

export type InAppMediaDragSource = Omit<InAppMediaDragPayload, 'version'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readFiniteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const readOptionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export const createInAppMediaDragPayload = (
  source: InAppMediaDragSource,
): InAppMediaDragPayload | null => {
  const assetId = source.assetId.trim();
  const frames = source.frames?.filter((frame) => !!frame.trim());
  if (source.mediaKind === 'image_sequence' && !frames?.length) return null;
  if (source.mediaKind === 'model_3d' && !source.scene3dAsset) return null;
  if (!assetId && source.mediaKind !== 'image_sequence') return null;

  return {
    version: 1,
    ...source,
    assetId,
    ...(frames ? { frames } : {}),
  };
};

export const writeInAppMediaDrag = (dataTransfer: DataTransfer, payload: InAppMediaDragPayload) => {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(IN_APP_MEDIA_DRAG_TYPE, JSON.stringify(payload));
};

export const hasInAppMediaDrag = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types).includes(IN_APP_MEDIA_DRAG_TYPE);

export const readInAppMediaDrag = (dataTransfer: DataTransfer): InAppMediaDragPayload | null => {
  const serialized = dataTransfer.getData(IN_APP_MEDIA_DRAG_TYPE);
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== 1) return null;
    const mediaKind = value.mediaKind;
    if (
      mediaKind !== 'image' &&
      mediaKind !== 'image_sequence' &&
      mediaKind !== 'video' &&
      mediaKind !== 'model_3d'
    ) {
      return null;
    }

    const assetId = readOptionalString(value.assetId) ?? '';
    const frames = Array.isArray(value.frames)
      ? value.frames.filter((frame): frame is string => typeof frame === 'string' && !!frame.trim())
      : undefined;
    if (mediaKind === 'image_sequence' && !frames?.length) return null;
    if (mediaKind !== 'image_sequence' && !assetId) return null;
    if (mediaKind === 'model_3d' && !isRecord(value.scene3dAsset)) return null;

    return {
      version: 1,
      assetId,
      mediaKind,
      width: readFiniteNumber(value.width),
      height: readFiniteNumber(value.height),
      ...(readOptionalString(value.label) ? { label: readOptionalString(value.label) } : {}),
      ...(readOptionalFiniteNumber(value.duration) !== undefined
        ? { duration: readOptionalFiniteNumber(value.duration) }
        : {}),
      ...(readOptionalFiniteNumber(value.fps) !== undefined
        ? { fps: readOptionalFiniteNumber(value.fps) }
        : {}),
      ...(frames ? { frames } : {}),
      ...(readOptionalString(value.colorSpace)
        ? { colorSpace: readOptionalString(value.colorSpace) as OcioColorSpaceName }
        : {}),
      ...(isRecord(value.mediaColorManagement)
        ? { mediaColorManagement: value.mediaColorManagement as unknown as MediaColorManagement }
        : {}),
      ...(isRecord(value.videoColorMetadata)
        ? { videoColorMetadata: value.videoColorMetadata as unknown as VideoColorMetadata }
        : {}),
      ...(isRecord(value.scene3dAsset)
        ? { scene3dAsset: value.scene3dAsset as unknown as Scene3DAssetReference }
        : {}),
      ...(typeof value.useOutputSizeAsScene === 'boolean'
        ? { useOutputSizeAsScene: value.useOutputSizeAsScene }
        : {}),
    };
  } catch {
    return null;
  }
};
