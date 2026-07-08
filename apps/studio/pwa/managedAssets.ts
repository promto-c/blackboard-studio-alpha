export interface ManagedAssetMetadata {
  group: string;
  label: string;
  description: string;
  removable: boolean;
}

export interface ManagedAssetGroupDefinition {
  id: string;
  label: string;
  description: string;
  removable: boolean;
  chunkName?: string;
  assetPathStartsWith?: readonly string[];
  assetPathIncludes?: readonly string[];
  moduleIdIncludes?: readonly string[];
}

const gaussianSplatChunkName = 'gaussian-splat';

export const MANAGED_ASSET_GROUPS: readonly ManagedAssetGroupDefinition[] = [
  {
    id: 'gaussian-splat',
    label: 'Gaussian splat renderer',
    description: 'Renders Gaussian splat assets in 3D scenes.',
    removable: true,
    chunkName: gaussianSplatChunkName,
    assetPathStartsWith: [`assets/${gaussianSplatChunkName}`],
    moduleIdIncludes: ['@sparkjsdev/spark', '@sparkjsdev+spark'],
  },
  {
    id: 'onnx-runtime',
    label: 'ONNX node runtime',
    description: 'Runs local AI model nodes in the browser.',
    removable: true,
    assetPathStartsWith: ['wasm/ort-wasm', 'assets/ort-wasm'],
  },
];

const normalizeModuleId = (id: string) => id.split('\\').join('/');

const matchesAny = (value: string, candidates: readonly string[] | undefined) =>
  Boolean(candidates?.some((candidate) => value.includes(candidate)));

const startsWithAny = (value: string, candidates: readonly string[] | undefined) =>
  Boolean(candidates?.some((candidate) => value.startsWith(candidate)));

export const findManagedAssetGroupByAssetPath = (relativePath: string) =>
  MANAGED_ASSET_GROUPS.find(
    (group) =>
      startsWithAny(relativePath, group.assetPathStartsWith) ||
      matchesAny(relativePath, group.assetPathIncludes),
  ) ?? null;

export const findManagedAssetGroupByModuleId = (moduleId: string) => {
  const normalizedId = normalizeModuleId(moduleId);
  return (
    MANAGED_ASSET_GROUPS.find((group) => matchesAny(normalizedId, group.moduleIdIncludes)) ?? null
  );
};

export const getManagedAssetManualChunk = (moduleId: string) =>
  findManagedAssetGroupByModuleId(moduleId)?.chunkName ?? null;

export const getManagedAssetMetadata = (relativePath: string): ManagedAssetMetadata | null => {
  const group = findManagedAssetGroupByAssetPath(relativePath);
  if (!group) return null;

  return {
    group: group.id,
    label: group.label,
    description: group.description,
    removable: group.removable,
  };
};
