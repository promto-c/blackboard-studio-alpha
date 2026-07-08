import { isExrFileLike, isHdrFileLike, type MediaBlobLike } from '@/utils/mediaFiles';
import type { AssetPreviewMode, AssetPreviewSource, PreviewStrategy } from './types';

const UNSUPPORTED_BROWSER_IMAGE_TYPES = new Set(['image/tiff', 'image/x-tiff']);

/**
 * Gallery cards deliberately use browser color handling for ordinary display media.
 * The authoritative viewer and HDR/EXR assets use the project OCIO display transform.
 */
export function resolveAssetPreviewStrategy(
  source: AssetPreviewSource,
  mode: AssetPreviewMode,
  blob: Blob,
): PreviewStrategy {
  const assetBlob = blob as MediaBlobLike;
  const nameHint = source.fileName;
  if (isExrFileLike(assetBlob, nameHint) || isHdrFileLike(assetBlob, nameHint)) {
    return 'color-managed-render';
  }

  if (mode === 'viewer-preview' && source.mediaKind !== 'video') {
    return 'color-managed-render';
  }

  const mimeType = (source.mimeType || blob.type).trim().toLowerCase();
  if (source.mediaKind === 'video' || mimeType.startsWith('video/')) {
    return 'native-object-url';
  }
  if (
    !mimeType ||
    (mimeType.startsWith('image/') && !UNSUPPORTED_BROWSER_IMAGE_TYPES.has(mimeType))
  ) {
    return 'native-object-url';
  }
  return 'unsupported';
}
