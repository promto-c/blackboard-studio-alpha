import { getAssetSize } from '@/state/assetStorage';
import { loadProjectState } from '@/state/persist';
import { getNodeAssetIds } from '@/effects/effectHelpers';
import { NodeType, type AnyNode, type ProjectIndexEntry } from '@blackboard/types';

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

const sumBytes = async (ids: Set<string>): Promise<number> => {
  let total = 0;
  for (const id of ids) {
    const size = await getAssetSize(id);
    if (typeof size === 'number' && Number.isFinite(size)) {
      total += size;
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
): Promise<ProjectStorageSummary | null> => {
  const projectState = await loadProjectState(project.id);
  if (!projectState) return null;

  const breakdown: StorageBreakdown = {
    assets: 0,
    cache: estimateDataUrlBytes(project.thumbnail),
    renders: 0,
    exports: 0,
    temp: 0,
    projectData: new Blob([JSON.stringify(projectState)]).size,
  };

  const nodes = gatherReferencedNodes(projectState as ProjectStateLike);
  const assetIds = new Set<string>();
  const renderIds = new Set<string>();

  nodes.forEach((node) => {
    if (node.type === NodeType.COMFY) {
      const comfyNode = node as Extract<AnyNode, { type: typeof NodeType.COMFY }>;
      addIdSet(
        assetIds,
        Object.values(comfyNode.workflowInputImages ?? {}).map((inputImage) => inputImage.assetId),
      );
      addIdSet(renderIds, [
        comfyNode.src,
        ...(comfyNode.generatedOutputs ?? []).map((output) => output.src),
      ]);
      return;
    }

    if (node.type === NodeType.PAINT) {
      addIdSet(renderIds, getNodeAssetIds(node));
      return;
    }

    if (node.type === NodeType.IMAGE && 'aiMetadata' in node && node.aiMetadata) {
      const aiNode = node as Extract<AnyNode, { type: typeof NodeType.IMAGE }> & {
        aiMetadata?: { variants?: Array<{ src?: string | null }> };
      };
      addIdSet(renderIds, [
        aiNode.src,
        ...(aiNode.aiMetadata?.variants ?? []).map((variant) => variant.src ?? ''),
      ]);
      return;
    }

    addIdSet(assetIds, getNodeAssetIds(node));
  });

  breakdown.assets = await sumBytes(assetIds);
  breakdown.renders = await sumBytes(renderIds);

  const totalBytes = STORAGE_KEYS.reduce((total, key) => total + breakdown[key], 0);
  return { totalBytes, breakdown };
};

export const formatStorageBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unitIndex;
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};
