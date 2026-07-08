import type { ProjectColorManagement } from '@blackboard/types';
import type { AssetPreviewOptions, AssetPreviewSource } from './types';

const sortedRecord = (value: Record<string, string> | undefined) =>
  value ? Object.entries(value).sort(([left], [right]) => left.localeCompare(right)) : [];

export function createAssetPreviewCacheKey(
  source: AssetPreviewSource,
  projectColorManagement: ProjectColorManagement,
  options: AssetPreviewOptions,
): string {
  const config = projectColorManagement.config;
  return JSON.stringify([
    'asset-preview-v1',
    source.assetId,
    source.width,
    source.height,
    source.mediaKind ?? 'image',
    source.fps ?? null,
    source.fileName ?? null,
    source.mimeType ?? null,
    source.mediaColorManagement.sourceColorSpace,
    source.mediaColorManagement.isData,
    options.mode,
    options.maxDimension,
    config.kind,
    config.kind === 'builtin' ? config.id : null,
    config.uri,
    projectColorManagement.workingSpace.override ?? null,
    projectColorManagement.viewer.display,
    projectColorManagement.viewer.view,
    projectColorManagement.viewer.look ?? null,
    sortedRecord(projectColorManagement.roleOverrides),
    sortedRecord(projectColorManagement.context),
  ]);
}
