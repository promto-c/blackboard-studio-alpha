import { getAssetSize } from '@/state/assetStorage';
import { loadProjectState } from '@/state/persist';
import { getNodeAssetIds } from '@/effects/effectHelpers';
import { NodeType, type AnyNode, type ProjectIndexEntry } from '@blackboard/types';

const STORAGE_CACHE_KEY = 'blackboard-storage-cache-v2';

type StorageBreakdown = {
  assets: number;
  cache: number;
  renders: number;
  exports: number;
  temp: number;
  projectData: number;
};

type ProjectStateLike = {
  flows?: Record<string, { nodes?: AnyNode[] }>;
  history?: Array<{ state?: ProjectStateLike }>;
};

export type ProjectStorageSummary = {
  totalBytes: number;
  breakdown: StorageBreakdown;
};

export type ProjectStorageResult = {
  summary: ProjectStorageSummary | null;
  isStale: boolean;
};

type StorageCacheEntry = {
  lastModified: number;
  summary: ProjectStorageSummary;
};

type StorageCache = Record<string, StorageCacheEntry>;

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const getStorageCache = (): StorageCache => {
  try {
    const cached = localStorage.getItem(STORAGE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as StorageCache;
    }
  } catch (e) {
    console.warn('Failed to load storage cache', e);
  }
  return {};
};

const setStorageCache = (cache: StorageCache): void => {
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Failed to save storage cache', e);
  }
};

export const getCachedStorageResult = (
  project: ProjectIndexEntry,
): ProjectStorageResult | undefined => {
  const cache = getStorageCache();
  const entry = cache[project.id];
  if (!entry) {
    return undefined;
  }
  return {
    summary: entry.summary,
    isStale: entry.lastModified !== project.lastModified,
  };
};

export const setCachedStorageSummary = (
  project: ProjectIndexEntry,
  summary: ProjectStorageSummary,
): void => {
  const cache = getStorageCache();
  cache[project.id] = {
    lastModified: project.lastModified,
    summary,
  };
  setStorageCache(cache);
};

export const clearStorageCache = (): void => {
  localStorage.removeItem(STORAGE_CACHE_KEY);
};

export const invalidateProjectStorageCache = (projectId: string): void => {
  const cache = getStorageCache();
  const entry = cache[projectId];
  if (entry) {
    cache[projectId] = {
      ...entry,
      lastModified: 0,
    };
    setStorageCache(cache);
  }
};

export const isCacheStale = (project: ProjectIndexEntry): boolean => {
  const cache = getStorageCache();
  const entry = cache[project.id];
  if (!entry) return false;
  return entry.lastModified !== project.lastModified;
};

const AUTO_CALC_PROJECT_LIMIT = 5;

export const shouldAutoCalculate = (project: ProjectIndexEntry, projectIndex: number): boolean => {
  const result = getCachedStorageResult(project);
  if (result && !result.isStale) {
    return false;
  }
  if (result && result.isStale) {
    return true;
  }
  return projectIndex < AUTO_CALC_PROJECT_LIMIT;
};

const STORAGE_KEYS: Array<keyof StorageBreakdown> = [
  'assets',
  'cache',
  'renders',
  'exports',
  'temp',
  'projectData',
];

const estimateDataUrlBytes = (value: string | null | undefined): number => {
  if (!value) return 0;
  const commaIndex = value.indexOf(',');
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  const trimmed = payload.trim();
  if (!trimmed) return 0;
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
};

const addIdSet = (set: Set<string>, ids: string[]) => {
  ids.forEach((id) => {
    if (id) {
      set.add(id);
    }
  });
};

const collectNodesFromState = (state: ProjectStateLike): AnyNode[] =>
  Object.values(state.flows ?? {}).flatMap((flow) => flow.nodes ?? []);

const sumBytes = async (ids: Set<string>, signal?: AbortSignal): Promise<number> => {
  const idArray = Array.from(ids);
  if (idArray.length === 0) return 0;

  const BATCH_SIZE = 10;
  let total = 0;
  for (let i = 0; i < idArray.length; i += BATCH_SIZE) {
    if (signal?.aborted) return 0;
    await yieldToMain();
    if (signal?.aborted) return 0;

    const batch = idArray.slice(i, i + BATCH_SIZE);
    const sizes = await Promise.all(batch.map((id) => getAssetSize(id)));
    for (const size of sizes) {
      if (typeof size === 'number' && Number.isFinite(size)) {
        total += size;
      }
    }
  }
  return total;
};

const gatherReferencedNodes = (projectState: ProjectStateLike): AnyNode[] => {
  const nodes: AnyNode[] = [];
  nodes.push(...collectNodesFromState(projectState));

  (projectState.history ?? []).forEach((entry) => {
    nodes.push(...collectNodesFromState(entry.state ?? {}));
  });

  return nodes;
};

export const getProjectStorageSummary = async (
  project: ProjectIndexEntry,
  signal?: AbortSignal,
): Promise<ProjectStorageSummary | null> => {
  const cachedResult = getCachedStorageResult(project);
  if (cachedResult && !cachedResult.isStale) {
    return cachedResult.summary;
  }

  if (signal?.aborted) return null;

  const projectState = await loadProjectState(project.id);
  if (!projectState) return null;

  return computeStorageSummary(project, projectState as ProjectStateLike, signal);
};

const computeStorageSummary = async (
  project: ProjectIndexEntry,
  projectState: ProjectStateLike,
  signal?: AbortSignal,
): Promise<ProjectStorageSummary | null> => {
  if (signal?.aborted) return null;
  await yieldToMain();
  if (signal?.aborted) return null;

  const projectDataJson = JSON.stringify(projectState);
  const projectDataSize = new Blob([projectDataJson]).size;

  if (signal?.aborted) return null;
  await yieldToMain();
  if (signal?.aborted) return null;

  const breakdown: StorageBreakdown = {
    assets: 0,
    cache: estimateDataUrlBytes(project.thumbnail),
    renders: 0,
    exports: 0,
    temp: 0,
    projectData: projectDataSize,
  };

  const nodes = gatherReferencedNodes(projectState);
  const assetIds = new Set<string>();
  const renderIds = new Set<string>();

  const batchSize = 50;
  for (let i = 0; i < nodes.length; i += batchSize) {
    if (signal?.aborted) return null;

    const batch = nodes.slice(i, i + batchSize);
    for (const node of batch) {
      if (node.type === NodeType.COMFY) {
        const comfyNode = node as Extract<AnyNode, { type: typeof NodeType.COMFY }>;
        addIdSet(
          assetIds,
          Object.values(comfyNode.workflowInputImages ?? {}).map(
            (inputImage) => inputImage.assetId,
          ),
        );
        addIdSet(renderIds, [
          comfyNode.src,
          ...(comfyNode.generatedOutputs ?? []).map((output) => output.src),
        ]);
        continue;
      }

      if (node.type === NodeType.PAINT) {
        addIdSet(renderIds, getNodeAssetIds(node));
        continue;
      }

      if (node.type === NodeType.IMAGE && 'aiMetadata' in node && node.aiMetadata) {
        const aiNode = node as Extract<AnyNode, { type: typeof NodeType.IMAGE }> & {
          aiMetadata?: { variants?: Array<{ src?: string | null }> };
        };
        addIdSet(renderIds, [
          aiNode.src,
          ...(aiNode.aiMetadata?.variants ?? []).map((variant) => variant.src ?? ''),
        ]);
        continue;
      }

      addIdSet(assetIds, getNodeAssetIds(node));
    }

    await yieldToMain();
  }

  if (signal?.aborted) return null;

  breakdown.assets = await sumBytes(assetIds, signal);
  if (signal?.aborted) return null;

  breakdown.renders = await sumBytes(renderIds, signal);
  if (signal?.aborted) return null;

  const totalBytes = STORAGE_KEYS.reduce((total, key) => total + breakdown[key], 0);
  const summary: ProjectStorageSummary = { totalBytes, breakdown };

  setCachedStorageSummary(project, summary);

  return summary;
};

export const formatStorageBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unitIndex;
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};
