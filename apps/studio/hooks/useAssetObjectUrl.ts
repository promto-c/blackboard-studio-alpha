import { useEffect, useState } from 'react';
import { getAsset } from '@/state/assetStorage';

export const useAssetObjectUrl = (assetId: string | null): string | null => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadAsset = async () => {
      if (!assetId) {
        setUrl(null);
        return;
      }

      try {
        const blob = await getAsset(assetId);
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (error) {
        console.error(`Failed to load asset ${assetId}`, error);
        if (!cancelled) setUrl(null);
      }
    };

    setUrl(null);
    void loadAsset();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  return url;
};

export default useAssetObjectUrl;
