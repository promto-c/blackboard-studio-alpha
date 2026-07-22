import type {
  MediaColorManagement,
  OcioColorSpaceName,
  Scene3DAssetReference,
  VideoColorMetadata,
} from '@blackboard/types';
import { performTransaction } from './assetStorage';
import {
  BROWSER_STORAGE_MOUNT_ID,
  StorageMountPaths,
  getDefaultStorageMountId,
  listStorageMounts,
  readStorageFile,
  writeStorageFile,
} from './storageMounts';

const GALLERY_STORE_NAME = 'gallery';
const GALLERY_KEY = 'app-gallery';

export interface GalleryEntry {
  id: string;
  source: 'Comfy';
  assetId: string;
  mediaKind?: 'image' | 'image_sequence' | 'video' | 'model_3d';
  scene3dAsset?: Scene3DAssetReference;
  colorSpace?: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  frames?: string[];
  width: number;
  height: number;
  duration?: number;
  fps?: number;
  videoColorMetadata?: VideoColorMetadata;
  createdAt: number;
  deletedAt?: number;
  label?: string;
  prompt?: string;
  detail?: string;
  tags: string[];
  nodeName?: string;
  outputId?: string;
  workflowId?: string;
  workflowName?: string;
  promptId?: string;
  /** The store containing this Gallery record. Added when reading mounted galleries. */
  storageMountId?: string;
}

export const AssetTag = {
  SOURCE: 'source:',
  PROJECT: 'project:',
  NODE: 'node:',
  WORKFLOW: 'workflow:',
  BRANCH: 'branch:',
} as const;

export const makeProjectTag = (projectId: string): string => `${AssetTag.PROJECT}${projectId}`;
export const makeNodeTag = (nodeId: string): string => `${AssetTag.NODE}${nodeId}`;
export const makeWorkflowTag = (workflowId: string): string => `${AssetTag.WORKFLOW}${workflowId}`;
export const makeBranchTag = (branchId: string): string => `${AssetTag.BRANCH}${branchId}`;
export const makeSourceTag = (source: 'Comfy'): string =>
  `${AssetTag.SOURCE}${source.toLowerCase()}`;

export const getTagValue = (tags: string[], prefix: string): string | undefined => {
  const tag = tags.find((t) => t.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : undefined;
};

export const hasTag = (tags: string[], tag: string): boolean => tags.includes(tag);

type GalleryStoreDocument = {
  entries: GalleryEntry[];
};

const loadBrowserGalleryDocument = async (): Promise<GalleryStoreDocument> => {
  const result = await performTransaction<GalleryStoreDocument | undefined>(
    GALLERY_STORE_NAME,
    'readonly',
    (store) => store.get(GALLERY_KEY),
  );
  return result ?? { entries: [] };
};

const saveBrowserGalleryDocument = async (doc: GalleryStoreDocument): Promise<void> => {
  await performTransaction(GALLERY_STORE_NAME, 'readwrite', (store) => store.put(doc, GALLERY_KEY));
};

const parseGalleryDocument = (value: unknown): GalleryStoreDocument => {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as GalleryStoreDocument).entries)
  ) {
    return { entries: [] };
  }
  return { entries: (value as GalleryStoreDocument).entries };
};

const loadGalleryDocument = async (mountId: string): Promise<GalleryStoreDocument> => {
  if (mountId === BROWSER_STORAGE_MOUNT_ID) return loadBrowserGalleryDocument();
  const blob = await readStorageFile(mountId, StorageMountPaths.gallery);
  if (!blob) return { entries: [] };
  try {
    return parseGalleryDocument(JSON.parse(await blob.text()) as unknown);
  } catch (error) {
    console.warn(`Could not parse Gallery data from storage mount ${mountId}.`, error);
    return { entries: [] };
  }
};

const saveGalleryDocument = async (mountId: string, doc: GalleryStoreDocument): Promise<void> => {
  if (mountId === BROWSER_STORAGE_MOUNT_ID) {
    await saveBrowserGalleryDocument(doc);
    return;
  }
  await writeStorageFile(
    mountId,
    StorageMountPaths.gallery,
    new Blob([JSON.stringify(doc)], { type: 'application/json' }),
  );
};

const listGalleryMountIds = async (writableOnly = false): Promise<string[]> => {
  const mounts = await listStorageMounts();
  return mounts
    .filter(
      (mount) =>
        mount.connected &&
        (!writableOnly || !mount.readOnly) &&
        mount.resources.includes('gallery'),
    )
    .map((mount) => mount.id);
};

export const loadGalleryEntries = async (options?: {
  mountIds?: string[];
}): Promise<GalleryEntry[]> => {
  const mountIds = options?.mountIds ?? (await listGalleryMountIds());
  const documents = await Promise.all(
    mountIds.map(async (mountId) => {
      try {
        return { mountId, document: await loadGalleryDocument(mountId) };
      } catch (error) {
        console.warn(`Could not read Gallery storage mount ${mountId}.`, error);
        return { mountId, document: { entries: [] } as GalleryStoreDocument };
      }
    }),
  );

  const entriesById = new Map<string, GalleryEntry>();
  documents.forEach(({ mountId, document }) => {
    document.entries.forEach((entry) => {
      if (!entriesById.has(entry.id)) {
        entriesById.set(entry.id, { ...entry, storageMountId: mountId });
      }
    });
  });
  return Array.from(entriesById.values()).sort((a, b) => b.createdAt - a.createdAt);
};

export const addGalleryEntries = async (
  entries: GalleryEntry[],
  options?: { mountId?: string },
): Promise<void> => {
  const mountId = options?.mountId ?? getDefaultStorageMountId('gallery');
  const doc = await loadGalleryDocument(mountId);
  const existingIds = new Set(doc.entries.map((e) => e.id));
  const newEntries = entries
    .filter((e) => !existingIds.has(e.id))
    .map((entry) => ({ ...entry, storageMountId: mountId }));
  if (newEntries.length === 0) return;
  doc.entries.push(...newEntries);
  doc.entries.sort((a, b) => b.createdAt - a.createdAt);
  await saveGalleryDocument(mountId, doc);
};

const mutateGalleryDocuments = async (
  mutate: (doc: GalleryStoreDocument, mountId: string) => boolean,
): Promise<void> => {
  const mountIds = await listGalleryMountIds(true);
  await Promise.all(
    mountIds.map(async (mountId) => {
      const document = await loadGalleryDocument(mountId);
      if (mutate(document, mountId)) await saveGalleryDocument(mountId, document);
    }),
  );
};

export const updateGalleryEntry = async (
  id: string,
  updates: Partial<GalleryEntry>,
): Promise<void> => {
  await mutateGalleryDocuments((doc, mountId) => {
    const index = doc.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    doc.entries[index] = { ...doc.entries[index], ...updates, storageMountId: mountId };
    return true;
  });
};

export const softDeleteGalleryEntries = async (ids: string[]): Promise<void> => {
  const now = Date.now();
  const idSet = new Set(ids);
  await mutateGalleryDocuments((doc) => {
    let changed = false;
    doc.entries.forEach((entry) => {
      if (!idSet.has(entry.id)) return;
      entry.deletedAt = now;
      changed = true;
    });
    return changed;
  });
};

export const restoreGalleryEntries = async (ids: string[]): Promise<void> => {
  const idSet = new Set(ids);
  await mutateGalleryDocuments((doc) => {
    let changed = false;
    for (const entry of doc.entries) {
      if (idSet.has(entry.id) && entry.deletedAt) {
        delete entry.deletedAt;
        changed = true;
      }
    }
    return changed;
  });
};

export const permanentDeleteGalleryEntries = async (ids: string[]): Promise<void> => {
  const idSet = new Set(ids);
  await mutateGalleryDocuments((doc) => {
    const entries = doc.entries.filter((entry) => !idSet.has(entry.id));
    if (entries.length === doc.entries.length) return false;
    doc.entries = entries;
    return true;
  });
};

export const createEntryId = (): string =>
  `gallery_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
