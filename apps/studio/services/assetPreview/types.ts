import type { MediaColorManagement, ProjectColorManagement } from '@blackboard/types';

export type AssetPreviewMode = 'gallery-thumbnail' | 'viewer-preview';

export type PreviewStrategy = 'native-object-url' | 'color-managed-render' | 'unsupported';

export type PreviewPriority = 'viewer' | 'visible-thumbnail' | 'prefetch-thumbnail';

export interface AssetPreviewSource {
  assetId: string;
  width: number;
  height: number;
  mediaKind?: 'image' | 'video';
  mediaColorManagement: MediaColorManagement;
  fps?: number;
  fileName?: string;
  mimeType?: string;
}

export interface AssetPreviewOptions {
  mode: AssetPreviewMode;
  maxDimension: number;
}

export interface AssetPreviewRequest extends AssetPreviewOptions {
  source: AssetPreviewSource;
  projectColorManagement: ProjectColorManagement;
  priority: PreviewPriority;
  signal?: AbortSignal;
}

export interface AssetPreviewResult {
  url: string;
  strategy: Exclude<PreviewStrategy, 'unsupported'>;
  cacheKey: string;
  width?: number;
  height?: number;
}

export interface AssetPreviewLease {
  promise: Promise<AssetPreviewResult>;
  release: () => void;
}
