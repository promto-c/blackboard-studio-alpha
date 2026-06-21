import type { Scene3DAssetReference } from '@blackboard/types';
import { performTransaction, openDB } from './assetStorage';

const GALLERY_STORE_NAME = 'gallery';
const GALLERY_KEY = 'app-gallery';

export interface GalleryEntry {
  id: string;
  source: 'Comfy';
  assetId: string;
  mediaKind?: 'image' | 'image_sequence' | 'video' | 'model_3d';
  scene3dAsset?: Scene3DAssetReference;
  frames?: string[];
  width: number;
  height: number;
  duration?: number;
  fps?: number;
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

const loadGalleryDocument = async (): Promise<GalleryStoreDocument> => {
  const result = await performTransaction<GalleryStoreDocument | undefined>(
    GALLERY_STORE_NAME,
    'readonly',
    (store) => store.get(GALLERY_KEY),
  );
  return result ?? { entries: [] };
};

const saveGalleryDocument = async (doc: GalleryStoreDocument): Promise<void> => {
  await performTransaction(GALLERY_STORE_NAME, 'readwrite', (store) => store.put(doc, GALLERY_KEY));
};

export const loadGalleryEntries = async (): Promise<GalleryEntry[]> => {
  const doc = await loadGalleryDocument();
  return doc.entries;
};

export const addGalleryEntries = async (entries: GalleryEntry[]): Promise<void> => {
  const doc = await loadGalleryDocument();
  const existingIds = new Set(doc.entries.map((e) => e.id));
  const newEntries = entries.filter((e) => !existingIds.has(e.id));
  if (newEntries.length === 0) return;
  doc.entries.push(...newEntries);
  doc.entries.sort((a, b) => b.createdAt - a.createdAt);
  await saveGalleryDocument(doc);
};

export const updateGalleryEntry = async (
  id: string,
  updates: Partial<GalleryEntry>,
): Promise<void> => {
  const doc = await loadGalleryDocument();
  const index = doc.entries.findIndex((e) => e.id === id);
  if (index === -1) return;
  doc.entries[index] = { ...doc.entries[index], ...updates };
  await saveGalleryDocument(doc);
};

export const softDeleteGalleryEntries = async (ids: string[]): Promise<void> => {
  const doc = await loadGalleryDocument();
  const now = Date.now();
  for (const entry of doc.entries) {
    if (ids.includes(entry.id)) {
      entry.deletedAt = now;
    }
  }
  await saveGalleryDocument(doc);
};

export const restoreGalleryEntries = async (ids: string[]): Promise<void> => {
  const doc = await loadGalleryDocument();
  for (const entry of doc.entries) {
    if (ids.includes(entry.id)) {
      delete entry.deletedAt;
    }
  }
  await saveGalleryDocument(doc);
};

export const permanentDeleteGalleryEntries = async (ids: string[]): Promise<void> => {
  const doc = await loadGalleryDocument();
  doc.entries = doc.entries.filter((e) => !ids.includes(e.id));
  await saveGalleryDocument(doc);
};

export const createEntryId = (): string =>
  `gallery_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
