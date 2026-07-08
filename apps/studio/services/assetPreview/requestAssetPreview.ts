import { getAsset } from '@/state/assetStorage';
import { renderMediaAssetToBlob } from '@/utils/thumbnailRenderer';
import { assetPreviewCache } from './assetPreviewCache';
import { createAssetPreviewCacheKey } from './assetPreviewKey';
import { isAbortError } from './assetPreviewScheduler';
import { resolveAssetPreviewStrategy } from './assetPreviewStrategy';
import { recordAssetPreviewMetric } from './previewMetrics';
import type { AssetPreviewLease, AssetPreviewRequest, AssetPreviewResult } from './types';

export function requestAssetPreview(request: AssetPreviewRequest): AssetPreviewLease {
  const cacheKey = createAssetPreviewCacheKey(request.source, request.projectColorManagement, {
    mode: request.mode,
    maxDimension: request.maxDimension,
  });
  recordAssetPreviewMetric('requests');

  return assetPreviewCache.acquire(
    cacheKey,
    async (signal): Promise<AssetPreviewResult> => {
      recordAssetPreviewMetric('cacheMisses');
      try {
        const blob = await getAsset(request.source.assetId);
        if (signal.aborted) throw new DOMException('Preview canceled.', 'AbortError');
        if (!blob) throw new Error(`Asset "${request.source.assetId}" was not found.`);

        const strategy = resolveAssetPreviewStrategy(request.source, request.mode, blob);
        if (strategy === 'unsupported') {
          throw new Error(`Asset "${request.source.assetId}" is not browser-previewable.`);
        }

        let previewBlob = blob;
        if (strategy === 'color-managed-render') {
          recordAssetPreviewMetric('rendererExecutions');
          previewBlob = await renderMediaAssetToBlob(
            request.source,
            request.projectColorManagement,
            request.maxDimension,
            { priority: request.priority, signal },
          );
        } else {
          recordAssetPreviewMetric('nativeObjectUrls');
        }
        if (signal.aborted) throw new DOMException('Preview canceled.', 'AbortError');

        return {
          url: URL.createObjectURL(previewBlob),
          strategy,
          cacheKey,
          width: request.source.width,
          height: request.source.height,
        };
      } catch (error) {
        if (isAbortError(error)) {
          recordAssetPreviewMetric('cancellations');
        } else {
          recordAssetPreviewMetric('failures');
        }
        throw error;
      }
    },
    request.signal,
  );
}
