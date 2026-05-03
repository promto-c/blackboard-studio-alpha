import { ImageNode, ImageSequenceNode } from '@blackboard/types';

export type MediaBlobLike = Blob & Partial<Pick<File, 'name'>>;

export const EXR_FILE_EXTENSION_REGEX = /\.exr$/i;
export const IMAGE_FILE_EXTENSION_REGEX = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp|exr)$/i;
export const VIDEO_FILE_EXTENSION_REGEX = /\.(mp4|m4v|mov|webm|og[gv])$/i;

const EXR_MIME_TYPES = new Set([
  'application/exr',
  'application/x-exr',
  'image/exr',
  'image/x-exr',
]);

export const IMAGE_IMPORT_ACCEPT = 'image/png, image/jpeg, image/webp, .exr';
export const IMPORT_MEDIA_ACCEPT = `${IMAGE_IMPORT_ACCEPT}, video/mp4, video/webm`;

export const getBlobName = (blob: MediaBlobLike, nameHint?: string): string =>
  nameHint || blob.name || '';

export const isExrMimeType = (mimeType: string): boolean =>
  EXR_MIME_TYPES.has(mimeType.trim().toLowerCase());

export const isExrFileLike = (blob: MediaBlobLike, nameHint?: string): boolean => {
  if (isExrMimeType(blob.type)) return true;
  return EXR_FILE_EXTENSION_REGEX.test(getBlobName(blob, nameHint));
};

export const isImageFileLike = (blob: MediaBlobLike, nameHint?: string): boolean => {
  if (blob.type.startsWith('image/')) return true;
  return IMAGE_FILE_EXTENSION_REGEX.test(getBlobName(blob, nameHint));
};

export const isVideoFileLike = (blob: MediaBlobLike, nameHint?: string): boolean => {
  if (blob.type.startsWith('video/')) return true;
  return VIDEO_FILE_EXTENSION_REGEX.test(getBlobName(blob, nameHint));
};

export const getMediaFileKind = (
  blob: MediaBlobLike,
  nameHint?: string,
): 'image' | 'video' | 'unknown' => {
  if (isImageFileLike(blob, nameHint)) return 'image';
  if (isVideoFileLike(blob, nameHint)) return 'video';
  return 'unknown';
};

export const getImportedImageColorSpace = (
  blob: MediaBlobLike,
  nameHint?: string,
): ImageNode['colorSpace'] | ImageSequenceNode['colorSpace'] =>
  isExrFileLike(blob, nameHint) ? 'Linear' : 'sRGB';
