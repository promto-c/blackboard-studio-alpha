import {
  getAsset,
  getAssetReferenceExportRecord,
  saveAsset,
  saveDirectoryAssetReferences,
  deleteAssets,
} from '@/state/assetStorage';
import { getNodeAssetIds } from '@/effects/effectHelpers';
import type { AnyNode, EditorStateSlice, Flow, HistoryEntry } from '@blackboard/types';
import { validateRootFlow } from '@blackboard/types';

type StoredProjectState = Omit<EditorStateSlice, 'projectId'>;

type LegacyExportedProjectAsset = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
};

type LegacyExportedProjectBundle = {
  format: 'blackboard-studio-project';
  version: 1;
  exportedAt: string;
  project: {
    name: string;
    thumbnail: string | null;
    state: StoredProjectState;
  };
  assets: LegacyExportedProjectAsset[];
};

type ExportedEmbeddedProjectAsset = {
  id: string;
  kind: 'embedded';
  name: string;
  type: string;
  dataUrl: string;
};

type ExportedReferencedProjectAsset = {
  id: string;
  kind: 'directory-file';
  referenceGroupId: string;
  relativePath: string;
  name: string;
  type: string;
};

type ExportedProjectAsset = ExportedEmbeddedProjectAsset | ExportedReferencedProjectAsset;

type ExportedProjectReferenceGroup = {
  id: string;
  directoryName: string;
};

type ExportedProjectBundle = {
  format: 'blackboard-studio-project';
  version: 2;
  exportedAt: string;
  project: {
    name: string;
    thumbnail: string | null;
    state: StoredProjectState;
  };
  assets: ExportedProjectAsset[];
  referenceGroups: ExportedProjectReferenceGroup[];
};

type ParsedReferencedProjectAsset = ExportedReferencedProjectAsset & {
  directoryName: string;
};

type ParsedProjectAsset = ExportedEmbeddedProjectAsset | ParsedReferencedProjectAsset;

type ParsedProjectBundle = {
  projectName: string;
  thumbnail: string | null;
  state: StoredProjectState;
  assets: ParsedProjectAsset[];
  referenceGroups: ProjectBundleReferenceGroup[];
};

type RawProjectBundle = {
  format?: unknown;
  version?: unknown;
  project?: {
    name?: unknown;
    thumbnail?: unknown;
    state?: unknown;
  } | null;
  assets?: unknown;
  referenceGroups?: unknown;
};

export type ProjectBundleReferenceGroup = {
  id: string;
  directoryName: string;
  fileCount: number;
  sampleRelativePath: string | null;
};

const PROJECT_BUNDLE_FORMAT = 'blackboard-studio-project';
const PROJECT_BUNDLE_VERSION = 2;

export const PROJECT_BUNDLE_EXTENSION = '.blackboard-project.json';
export const PROJECT_BUNDLE_ACCEPT = `${PROJECT_BUNDLE_EXTENSION},application/json`;

const blobToDataUrl = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read project asset.'));
    reader.readAsDataURL(blob);
  });

const dataUrlToFile = async (dataUrl: string, name: string, type: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, {
    type: type || blob.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
};

const sanitizeFileNameSegment = (value: string): string => {
  const trimmed = value.trim();
  const sanitized = Array.from(trimmed)
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code <= 31 || '<>:"/\\|?*'.includes(character)) {
        return '-';
      }
      return character;
    })
    .join('');
  return sanitized || 'project';
};

const getFileNameFromPath = (value: string): string => {
  const segments = value.split('/').filter(Boolean);
  return segments[segments.length - 1] || value || 'asset';
};

const collectAssetIdsFromNodes = (nodes: AnyNode[] | undefined, assetIds: Set<string>): void => {
  if (!nodes) return;
  nodes.forEach((node) => {
    getNodeAssetIds(node).forEach((assetId) => {
      if (assetId) {
        assetIds.add(assetId);
      }
    });
  });
};

const collectAssetIdsFromFlows = (
  flows: Record<string, Flow> | undefined,
  assetIds: Set<string>,
): void => {
  if (!flows) return;
  Object.values(flows).forEach((flow) => {
    collectAssetIdsFromNodes(flow.nodes, assetIds);
  });
};

const collectProjectAssetIds = (state: StoredProjectState): string[] => {
  const assetIds = new Set<string>();

  collectAssetIdsFromFlows(state.flows, assetIds);

  (state.history || []).forEach((entry: HistoryEntry) => {
    collectAssetIdsFromNodes(entry.state.nodes, assetIds);
    collectAssetIdsFromFlows(entry.state.flows, assetIds);
  });

  return Array.from(assetIds);
};

const remapAssetIdsInValue = <T>(value: T, assetIdMap: ReadonlyMap<string, string>): T => {
  if (typeof value === 'string') {
    return (assetIdMap.get(value) ?? value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => remapAssetIdsInValue(item, assetIdMap)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const nextValue: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
    nextValue[key] = remapAssetIdsInValue(nestedValue, assetIdMap);
  });
  return nextValue as T;
};

const assertStoredProjectState = (state: StoredProjectState): void => {
  if (!state || typeof state !== 'object') {
    throw new Error('Project file is missing state data.');
  }

  if (state.rootFlowId && state.flows?.[state.rootFlowId]) {
    const issues = validateRootFlow(state.flows[state.rootFlowId]);
    if (issues.length > 0) {
      throw new Error(`Project file is invalid: ${issues[0]?.message || 'flow validation failed'}`);
    }
  }
};

const parseProjectBundle = (value: unknown): ParsedProjectBundle => {
  if (!value || typeof value !== 'object') {
    throw new Error('Unsupported project file.');
  }

  const bundle = value as RawProjectBundle;
  if (bundle.format !== PROJECT_BUNDLE_FORMAT || !bundle.project || !Array.isArray(bundle.assets)) {
    throw new Error('Unsupported project file.');
  }

  if (typeof bundle.project.name !== 'string' || !bundle.project.state) {
    throw new Error('Project file is missing state data.');
  }

  const state = bundle.project.state as StoredProjectState;
  assertStoredProjectState(state);

  if (bundle.version === 1) {
    const assets: ParsedProjectAsset[] = bundle.assets.flatMap((asset) => {
      const candidate = asset as Record<string, unknown>;
      if (
        asset &&
        typeof asset === 'object' &&
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.type === 'string' &&
        typeof candidate.dataUrl === 'string'
      ) {
        return [
          {
            id: candidate.id,
            kind: 'embedded' as const,
            name: candidate.name,
            type: candidate.type,
            dataUrl: candidate.dataUrl,
          },
        ];
      }
      return [];
    });

    return {
      projectName: bundle.project.name,
      thumbnail: typeof bundle.project.thumbnail === 'string' ? bundle.project.thumbnail : null,
      state,
      assets,
      referenceGroups: [],
    };
  }

  if (bundle.version !== PROJECT_BUNDLE_VERSION) {
    throw new Error('Unsupported project file.');
  }

  const referenceGroupNameById = new Map<string, string>();
  (Array.isArray(bundle.referenceGroups) ? bundle.referenceGroups : []).forEach((group) => {
    const candidate = group as Record<string, unknown>;
    if (
      group &&
      typeof group === 'object' &&
      typeof candidate.id === 'string' &&
      typeof candidate.directoryName === 'string' &&
      candidate.id.trim()
    ) {
      referenceGroupNameById.set(candidate.id, candidate.directoryName);
    }
  });

  const assets: ParsedProjectAsset[] = [];
  const referenceGroupsById = new Map<string, ProjectBundleReferenceGroup>();

  bundle.assets.forEach((asset) => {
    const candidate = asset as Record<string, unknown>;
    if (!asset || typeof asset !== 'object' || typeof candidate.id !== 'string') {
      return;
    }

    if (
      candidate.kind === 'embedded' &&
      typeof candidate.name === 'string' &&
      typeof candidate.type === 'string' &&
      typeof candidate.dataUrl === 'string'
    ) {
      assets.push({
        id: candidate.id,
        kind: 'embedded',
        name: candidate.name,
        type: candidate.type,
        dataUrl: candidate.dataUrl,
      });
      return;
    }

    if (
      candidate.kind === 'directory-file' &&
      typeof candidate.referenceGroupId === 'string' &&
      typeof candidate.relativePath === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.type === 'string'
    ) {
      const directoryName = referenceGroupNameById.get(candidate.referenceGroupId) ?? '';
      assets.push({
        id: candidate.id,
        kind: 'directory-file',
        referenceGroupId: candidate.referenceGroupId,
        relativePath: candidate.relativePath,
        name: candidate.name,
        type: candidate.type,
        directoryName,
      });

      const currentGroup = referenceGroupsById.get(candidate.referenceGroupId);
      if (currentGroup) {
        currentGroup.fileCount += 1;
        if (!currentGroup.sampleRelativePath) {
          currentGroup.sampleRelativePath = candidate.relativePath;
        }
      } else {
        referenceGroupsById.set(candidate.referenceGroupId, {
          id: candidate.referenceGroupId,
          directoryName,
          fileCount: 1,
          sampleRelativePath: candidate.relativePath,
        });
      }
    }
  });

  return {
    projectName: bundle.project.name,
    thumbnail: typeof bundle.project.thumbnail === 'string' ? bundle.project.thumbnail : null,
    state,
    assets,
    referenceGroups: Array.from(referenceGroupsById.values()),
  };
};

export const isProjectBundleFile = (file: Pick<File, 'name'>): boolean =>
  file.name.toLowerCase().endsWith(PROJECT_BUNDLE_EXTENSION);

export const inspectProjectBundle = async (
  file: File,
): Promise<{ projectName: string; referenceGroups: ProjectBundleReferenceGroup[] }> => {
  const parsed = parseProjectBundle(JSON.parse(await file.text()) as unknown);
  return {
    projectName: parsed.projectName.trim() || sanitizeFileNameSegment(file.name),
    referenceGroups: parsed.referenceGroups,
  };
};

export const exportProjectBundle = async (params: {
  projectName: string;
  thumbnail?: string | null;
  state: StoredProjectState;
}): Promise<{ blob: Blob; filename: string }> => {
  assertStoredProjectState(params.state);

  const assets: ExportedProjectAsset[] = [];
  const referenceGroups = new Map<string, ExportedProjectReferenceGroup>();

  for (const assetId of collectProjectAssetIds(params.state)) {
    const referenceRecord = await getAssetReferenceExportRecord(assetId);
    if (referenceRecord) {
      referenceGroups.set(referenceRecord.handleId, {
        id: referenceRecord.handleId,
        directoryName: referenceRecord.directoryName,
      });
      assets.push({
        id: assetId,
        kind: 'directory-file',
        referenceGroupId: referenceRecord.handleId,
        relativePath: referenceRecord.relativePath,
        name: getFileNameFromPath(referenceRecord.relativePath),
        type: '',
      });
      continue;
    }

    const assetBlob = await getAsset(assetId);
    if (!assetBlob) {
      throw new Error(`Could not read asset "${assetId}" while exporting the project.`);
    }

    assets.push({
      id: assetId,
      kind: 'embedded',
      name: 'name' in assetBlob && typeof assetBlob.name === 'string' ? assetBlob.name : assetId,
      type: assetBlob.type || 'application/octet-stream',
      dataUrl: await blobToDataUrl(assetBlob),
    });
  }

  const bundle: ExportedProjectBundle = {
    format: PROJECT_BUNDLE_FORMAT,
    version: PROJECT_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      name: params.projectName,
      thumbnail: params.thumbnail ?? null,
      state: params.state,
    },
    assets,
    referenceGroups: Array.from(referenceGroups.values()),
  };

  return {
    filename: `${sanitizeFileNameSegment(params.projectName)}${PROJECT_BUNDLE_EXTENSION}`,
    blob: new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
  };
};

export const importProjectBundle = async (
  file: File,
  options?: {
    referenceDirectoriesByGroupId?: ReadonlyMap<string, FileSystemDirectoryHandle>;
  },
): Promise<{ projectName: string; thumbnail: string | null; state: StoredProjectState }> => {
  const createdAssetIds: string[] = [];

  try {
    const parsed = parseProjectBundle(JSON.parse(await file.text()) as unknown);
    const requiredAssetIds = new Set(collectProjectAssetIds(parsed.state));
    const embeddedAssetsById = new Map<string, ExportedEmbeddedProjectAsset>();
    const referenceAssetsById = new Map<string, ParsedReferencedProjectAsset>();
    const referenceAssetsByGroupId = new Map<string, ParsedReferencedProjectAsset[]>();

    parsed.assets.forEach((asset) => {
      if (asset.kind === 'embedded') {
        embeddedAssetsById.set(asset.id, asset);
        return;
      }

      referenceAssetsById.set(asset.id, asset);
      const groupAssets = referenceAssetsByGroupId.get(asset.referenceGroupId) ?? [];
      groupAssets.push(asset);
      referenceAssetsByGroupId.set(asset.referenceGroupId, groupAssets);
    });

    const missingAssetIds = Array.from(requiredAssetIds).filter((assetId) => {
      return !embeddedAssetsById.has(assetId) && !referenceAssetsById.has(assetId);
    });
    if (missingAssetIds.length > 0) {
      throw new Error(`Project file is missing ${missingAssetIds.length} required asset(s).`);
    }

    const assetIdMap = new Map<string, string>();

    for (const assetId of requiredAssetIds) {
      const embeddedAsset = embeddedAssetsById.get(assetId);
      if (!embeddedAsset) {
        continue;
      }

      const restoredFile = await dataUrlToFile(
        embeddedAsset.dataUrl,
        embeddedAsset.name || assetId,
        embeddedAsset.type,
      );
      const newAssetId = await saveAsset(restoredFile);
      createdAssetIds.push(newAssetId);
      assetIdMap.set(assetId, newAssetId);
    }

    for (const referenceGroup of parsed.referenceGroups) {
      const groupAssets = (referenceAssetsByGroupId.get(referenceGroup.id) || []).filter((asset) =>
        requiredAssetIds.has(asset.id),
      );
      if (groupAssets.length === 0) {
        continue;
      }

      const directoryHandle = options?.referenceDirectoriesByGroupId?.get(referenceGroup.id);
      if (!directoryHandle) {
        const directoryName = referenceGroup.directoryName || 'an external folder';
        throw new Error(`Project import requires relinking "${directoryName}".`);
      }

      const newAssetIds = await saveDirectoryAssetReferences(
        directoryHandle,
        groupAssets.map((asset) => asset.relativePath),
      );
      if (newAssetIds.length !== groupAssets.length) {
        throw new Error(
          `Failed to relink "${referenceGroup.directoryName || directoryHandle.name || 'folder'}".`,
        );
      }

      newAssetIds.forEach((newAssetId, index) => {
        createdAssetIds.push(newAssetId);
        assetIdMap.set(groupAssets[index].id, newAssetId);
      });
    }

    const remappedState = remapAssetIdsInValue(parsed.state, assetIdMap);
    assertStoredProjectState(remappedState);

    return {
      projectName: parsed.projectName.trim() || sanitizeFileNameSegment(file.name),
      thumbnail: parsed.thumbnail,
      state: remappedState,
    };
  } catch (error) {
    if (createdAssetIds.length > 0) {
      await deleteAssets(createdAssetIds);
    }
    throw error;
  }
};
