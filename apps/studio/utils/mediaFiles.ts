import { colorManagementService } from '@/color-management/service';
import { resolveImportedMediaColorManagement } from '@/color-management/mediaMetadata';
import type { MediaColorManagement } from '@/color-management';

export type MediaBlobLike = Blob & Partial<Pick<File, 'name'>>;

const EXR_FILE_EXTENSION_REGEX = /\.exr$/i;
const HDR_FILE_EXTENSION_REGEX = /\.(?:hdr|pic|rgbe)$/i;
const IMAGE_FILE_EXTENSION_REGEX = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp|exr|hdr|pic|rgbe)$/i;
const VIDEO_FILE_EXTENSION_REGEX = /\.(mp4|m4v|mov|webm|og[gv])$/i;

const EXR_MIME_TYPES = new Set([
  'application/exr',
  'application/x-exr',
  'image/exr',
  'image/x-exr',
]);
const HDR_MIME_TYPES = new Set(['image/vnd.radiance', 'image/x-hdr', 'image/x-rgbe']);

export const IMAGE_IMPORT_ACCEPT =
  'image/png, image/jpeg, image/webp, image/x-exr, application/x-exr, image/exr, application/exr, image/vnd.radiance, image/x-hdr, .exr, .hdr';
export const IMPORT_MEDIA_ACCEPT = `${IMAGE_IMPORT_ACCEPT}, video/mp4, video/webm`;

export const getBlobName = (blob: MediaBlobLike, nameHint?: string): string =>
  nameHint || blob.name || '';

const isExrMimeType = (mimeType: string): boolean =>
  EXR_MIME_TYPES.has(mimeType.trim().toLowerCase());

export const isExrFileLike = (blob: MediaBlobLike, nameHint?: string): boolean => {
  if (isExrMimeType(blob.type)) return true;
  return EXR_FILE_EXTENSION_REGEX.test(getBlobName(blob, nameHint));
};

export const isHdrFileLike = (blob: MediaBlobLike, nameHint?: string): boolean => {
  if (HDR_MIME_TYPES.has(blob.type.trim().toLowerCase())) return true;
  return HDR_FILE_EXTENSION_REGEX.test(getBlobName(blob, nameHint));
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

export const getImportedImageColorManagement = (
  blob: MediaBlobLike,
  nameHint?: string,
): Promise<MediaColorManagement> => {
  const fileName = getBlobName(blob, nameHint);
  const isOpenExr = isExrFileLike(blob, nameHint);

  return resolveImportedMediaColorManagement({
    blob,
    fileName,
    isOpenExr,
    resolveConfiguredColorSpaceName: (value) =>
      colorManagementService.resolveConfiguredColorSpaceName(value),
    resolveFileRule: (name) => colorManagementService.resolveFileRule(name),
  });
};
