export interface AssetPreviewMetrics {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  nativeObjectUrls: number;
  rendererExecutions: number;
  cancellations: number;
  failures: number;
  metadataInteractiveMs: number | null;
  firstVisibleThumbnailMs: number | null;
  viewerPreviewMs: number | null;
}

type PreviewCounter = Exclude<
  keyof AssetPreviewMetrics,
  'cacheHits' | 'metadataInteractiveMs' | 'firstVisibleThumbnailMs' | 'viewerPreviewMs'
>;
export type AssetPreviewMilestone =
  | 'metadataInteractiveMs'
  | 'firstVisibleThumbnailMs'
  | 'viewerPreviewMs';

const counters: Record<PreviewCounter, number> = {
  requests: 0,
  cacheMisses: 0,
  nativeObjectUrls: 0,
  rendererExecutions: 0,
  cancellations: 0,
  failures: 0,
};
const timings: Record<AssetPreviewMilestone, number | null> = {
  metadataInteractiveMs: null,
  firstVisibleThumbnailMs: null,
  viewerPreviewMs: null,
};
let profileStartedAt: number | null = null;

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

export const recordAssetPreviewMetric = (metric: PreviewCounter) => {
  counters[metric] += 1;
};

export const beginAssetPreviewProfile = () => {
  profileStartedAt = now();
  timings.metadataInteractiveMs = null;
  timings.firstVisibleThumbnailMs = null;
  timings.viewerPreviewMs = null;
};

export const markAssetPreviewMilestone = (milestone: AssetPreviewMilestone) => {
  if (profileStartedAt === null || timings[milestone] !== null) return;
  timings[milestone] = now() - profileStartedAt;
};

export const getAssetPreviewMetrics = (): Readonly<AssetPreviewMetrics> => ({
  ...counters,
  cacheHits: Math.max(0, counters.requests - counters.cacheMisses),
  ...timings,
});

export const resetAssetPreviewMetrics = () => {
  Object.keys(counters).forEach((key) => {
    counters[key as PreviewCounter] = 0;
  });
  profileStartedAt = null;
  timings.metadataInteractiveMs = null;
  timings.firstVisibleThumbnailMs = null;
  timings.viewerPreviewMs = null;
};

if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, { __blackboardAssetPreviewMetrics: getAssetPreviewMetrics });
}
