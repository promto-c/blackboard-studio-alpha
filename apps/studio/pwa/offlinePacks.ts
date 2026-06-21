export type OfflinePackSource = 'bundle' | 'marketplace';

export interface OfflinePackAssetMetadata {
  group: string;
  label: string;
  description: string;
  source: OfflinePackSource;
  removable: boolean;
}

export interface OfflinePackDefinition {
  id: string;
  label: string;
  description: string;
  source: OfflinePackSource;
  removable: boolean;
  chunkName?: string;
  assetPathStartsWith?: readonly string[];
  assetPathIncludes?: readonly string[];
  moduleIdIncludes?: readonly string[];
}

const gaussianSplatChunkName = 'gaussian-splat';

export const BUNDLED_OFFLINE_PACKS: readonly OfflinePackDefinition[] = [
  {
    id: 'gaussian-splat',
    label: 'Gaussian splat renderer',
    description: 'Renders Gaussian splat assets in 3D scenes.',
    source: 'bundle',
    removable: true,
    chunkName: gaussianSplatChunkName,
    assetPathStartsWith: [`assets/${gaussianSplatChunkName}`],
    moduleIdIncludes: ['@sparkjsdev/spark', '@sparkjsdev+spark'],
  },
  {
    id: 'onnx-runtime',
    label: 'ONNX node runtime',
    description: 'Runs local AI model nodes in the browser.',
    source: 'bundle',
    removable: true,
    assetPathStartsWith: ['wasm/ort-wasm', 'assets/ort-wasm'],
  },
  {
    id: 'color-management',
    label: 'Color management',
    description: 'Enables OCIO transforms and color-managed preview.',
    source: 'bundle',
    removable: true,
    chunkName: 'color-management',
    assetPathIncludes: ['ocio-wasm', 'color-management'],
    moduleIdIncludes: ['@bb-studio/ocio', '@bb-studio+ocio'],
  },
];

const normalizeModuleId = (id: string) => id.split('\\').join('/');

const matchesAny = (value: string, candidates: readonly string[] | undefined) =>
  Boolean(candidates?.some((candidate) => value.includes(candidate)));

const startsWithAny = (value: string, candidates: readonly string[] | undefined) =>
  Boolean(candidates?.some((candidate) => value.startsWith(candidate)));

export const findOfflinePackByAssetPath = (relativePath: string) =>
  BUNDLED_OFFLINE_PACKS.find(
    (pack) =>
      startsWithAny(relativePath, pack.assetPathStartsWith) ||
      matchesAny(relativePath, pack.assetPathIncludes),
  ) ?? null;

export const findOfflinePackByModuleId = (moduleId: string) => {
  const normalizedId = normalizeModuleId(moduleId);
  return (
    BUNDLED_OFFLINE_PACKS.find((pack) => matchesAny(normalizedId, pack.moduleIdIncludes)) ?? null
  );
};

export const getOfflinePackManualChunk = (moduleId: string) =>
  findOfflinePackByModuleId(moduleId)?.chunkName ?? null;

export const getOfflinePackAssetMetadata = (
  relativePath: string,
): OfflinePackAssetMetadata | null => {
  const pack = findOfflinePackByAssetPath(relativePath);
  if (!pack) return null;

  return {
    group: pack.id,
    label: pack.label,
    description: pack.description,
    source: pack.source,
    removable: pack.removable,
  };
};
