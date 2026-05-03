import { useEffect, useState } from 'react';
import { getAsset } from '@/state/assetStorage';
import { createExrPreviewDataUrl } from '@/utils/exr';
import { type MediaBlobLike, getBlobName, isExrFileLike } from '@/utils/mediaFiles';

export const useAssetPreviewUrl = (assetId: string, maxDimension = 512): string | null => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) {
      setPreviewUrl(null);
      return;
    }

    let isCancelled = false;
    let cleanup: (() => void) | null = null;

    const loadPreview = async () => {
      try {
        const blob = await getAsset(assetId);
        if (!blob || isCancelled) {
          if (!isCancelled) setPreviewUrl(null);
          return;
        }

        const assetBlob = blob as MediaBlobLike;

        if (isExrFileLike(assetBlob, getBlobName(assetBlob))) {
          const dataUrl = await createExrPreviewDataUrl(assetBlob, {
            cacheKey: assetId,
            maxDimension,
          });
          if (!isCancelled) {
            setPreviewUrl(dataUrl);
          }
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        cleanup = () => URL.revokeObjectURL(objectUrl);
        if (!isCancelled) {
          setPreviewUrl(objectUrl);
        }
      } catch (error) {
        console.error(`Failed to load asset preview ${assetId}`, error);
        if (!isCancelled) {
          setPreviewUrl(null);
        }
      }
    };

    void loadPreview();

    return () => {
      isCancelled = true;
      cleanup?.();
    };
  }, [assetId, maxDimension]);

  return previewUrl;
};

export default useAssetPreviewUrl;
