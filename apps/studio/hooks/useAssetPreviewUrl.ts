import { useEffect, useRef, useState } from 'react';
import {
  createAssetPreviewCacheKey,
  isAbortError,
  requestAssetPreview,
  type AssetPreviewMode,
  type AssetPreviewSource,
  type PreviewPriority,
  type PreviewStrategy,
} from '@/services/assetPreview';
import { useMediaPreviewColorManagement } from './useMediaPreviewColorManagement';

export type { AssetPreviewSource };

export const GALLERY_THUMBNAIL_MAX_DIMENSION = 320;

export interface UseAssetPreviewOptions {
  mode: AssetPreviewMode;
  maxDimension: number;
  priority: PreviewPriority;
  enabled?: boolean;
  autoDetectDisplayView?: boolean;
}

export interface UseAssetPreviewResult {
  url: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: Error | null;
  strategy: PreviewStrategy | null;
}

const IDLE_RESULT: UseAssetPreviewResult = {
  url: null,
  status: 'idle',
  error: null,
  strategy: null,
};

export const useAssetPreview = (
  source: AssetPreviewSource | null,
  options: UseAssetPreviewOptions,
): UseAssetPreviewResult => {
  const projectColorManagement = useMediaPreviewColorManagement(
    source?.mediaColorManagement ?? null,
    options.autoDetectDisplayView,
  );
  const [result, setResult] = useState<UseAssetPreviewResult>(IDLE_RESULT);
  const enabled = options.enabled ?? true;
  const previewKey = source
    ? createAssetPreviewCacheKey(source, projectColorManagement, {
        mode: options.mode,
        maxDimension: options.maxDimension,
      })
    : null;
  const requestRef = useRef({ source, projectColorManagement, options });
  requestRef.current = { source, projectColorManagement, options };

  useEffect(() => {
    const current = requestRef.current;
    if (!enabled || !previewKey || !current.source) {
      setResult(IDLE_RESULT);
      return;
    }

    const controller = new AbortController();
    const lease = requestAssetPreview({
      source: current.source,
      projectColorManagement: current.projectColorManagement,
      mode: current.options.mode,
      maxDimension: current.options.maxDimension,
      priority: current.options.priority,
      signal: controller.signal,
    });
    setResult({ url: null, status: 'loading', error: null, strategy: null });
    void lease.promise
      .then((preview) => {
        if (!controller.signal.aborted) {
          setResult({
            url: preview.url,
            status: 'ready',
            error: null,
            strategy: preview.strategy,
          });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) return;
        const error = cause instanceof Error ? cause : new Error('Asset preview failed.');
        console.error(`Failed to render asset preview ${current.source?.assetId}`, error);
        setResult({ url: null, status: 'error', error, strategy: null });
      });

    return () => {
      controller.abort();
      lease.release();
    };
  }, [enabled, options.priority, previewKey]);

  return result;
};

export const useAssetPreviewUrl = (
  source: AssetPreviewSource | null,
  maxDimension = 512,
): string | null =>
  useAssetPreview(source, {
    mode: 'viewer-preview',
    maxDimension,
    priority: 'viewer',
  }).url;

export default useAssetPreviewUrl;
