const DB_NAME = 'BlackboardAssets';
const DB_VERSION = 3;
const ASSET_STORE_NAME = 'images';
const PROJECT_STORE_NAME = 'projects';
const ASSET_REFERENCE_STORE_NAME = 'asset_references';
const DIRECTORY_HANDLE_STORE_NAME = 'directory_handles';
const REFERENCE_BY_HANDLE_INDEX_NAME = 'by_handle';

const ASSET_ID_PREFIX = 'asset_';
const REFERENCE_ASSET_ID_PREFIX = 'ref_';
const DIRECTORY_HANDLE_ID_PREFIX = 'dir_';

type AssetReferenceRecord = {
  id: string;
  kind: 'directory-file';
  handleId: string;
  relativePath: string;
};

export type AssetReferenceExportRecord = {
  handleId: string;
  directoryName: string;
  relativePath: string;
};

type DirectoryHandleRecord = {
  id: string;
  kind: 'directory';
  handle: FileSystemDirectoryHandle;
  name: string;
  createdAt: number;
};

let db: IDBDatabase | null = null;

const directoryHandleCache = new Map<string, FileSystemDirectoryHandle>();
const referenceRecordCache = new Map<string, AssetReferenceRecord>();
const directoryPermissionCache = new Map<string, PermissionState>();

const createId = (prefix: string): string =>
  `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const isReferenceAssetId = (id: string): boolean => id.startsWith(REFERENCE_ASSET_ID_PREFIX);
const normalizeRelativePath = (path: string): string =>
  path
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject('Error opening IndexedDB.');
    };

    request.onsuccess = () => {
      db = request.result;

      db.onclose = () => {
        console.warn('IndexedDB connection closed unexpectedly.');
        db = null;
      };

      db.onversionchange = () => {
        console.warn('IndexedDB version changed externally.');
        if (db) db.close();
        db = null;
      };

      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const request = event.target as IDBOpenDBRequest;
      const dbInstance = request.result;
      const transaction = request.transaction;

      if (!dbInstance.objectStoreNames.contains(ASSET_STORE_NAME)) {
        dbInstance.createObjectStore(ASSET_STORE_NAME);
      }
      if (!dbInstance.objectStoreNames.contains(PROJECT_STORE_NAME)) {
        dbInstance.createObjectStore(PROJECT_STORE_NAME);
      }

      let referenceStore: IDBObjectStore | null = null;
      if (!dbInstance.objectStoreNames.contains(ASSET_REFERENCE_STORE_NAME)) {
        referenceStore = dbInstance.createObjectStore(ASSET_REFERENCE_STORE_NAME, {
          keyPath: 'id',
        });
      } else if (transaction) {
        referenceStore = transaction.objectStore(ASSET_REFERENCE_STORE_NAME);
      }
      if (referenceStore && !referenceStore.indexNames.contains(REFERENCE_BY_HANDLE_INDEX_NAME)) {
        referenceStore.createIndex(REFERENCE_BY_HANDLE_INDEX_NAME, 'handleId', {
          unique: false,
        });
      }

      if (!dbInstance.objectStoreNames.contains(DIRECTORY_HANDLE_STORE_NAME)) {
        dbInstance.createObjectStore(DIRECTORY_HANDLE_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const performTransaction = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      try {
        const transaction = dbInstance.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = operation(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        db = null;
        reject(error);
      }
    });
  } catch (error) {
    db = null;
    throw error;
  }
};

const getReferenceRecord = async (assetId: string): Promise<AssetReferenceRecord | null> => {
  const cached = referenceRecordCache.get(assetId);
  if (cached) return cached;

  const record = await performTransaction<AssetReferenceRecord | undefined>(
    ASSET_REFERENCE_STORE_NAME,
    'readonly',
    (store) => store.get(assetId),
  );
  if (record) {
    referenceRecordCache.set(assetId, record);
  }
  return record || null;
};

const getDirectoryHandleById = async (
  handleId: string,
): Promise<FileSystemDirectoryHandle | null> => {
  const cached = directoryHandleCache.get(handleId);
  if (cached) return cached;

  const record = await performTransaction<DirectoryHandleRecord | undefined>(
    DIRECTORY_HANDLE_STORE_NAME,
    'readonly',
    (store) => store.get(handleId),
  );
  if (!record) return null;

  directoryHandleCache.set(handleId, record.handle);
  return record.handle;
};

const getDirectoryHandleRecordById = async (
  handleId: string,
): Promise<DirectoryHandleRecord | null> => {
  const record = await performTransaction<DirectoryHandleRecord | undefined>(
    DIRECTORY_HANDLE_STORE_NAME,
    'readonly',
    (store) => store.get(handleId),
  );
  return record || null;
};

const ensureDirectoryReadPermission = async (
  handleId: string,
  directoryHandle: FileSystemDirectoryHandle,
): Promise<boolean> => {
  const cached = directoryPermissionCache.get(handleId);
  if (cached === 'granted') return true;
  if (cached === 'denied') return false;

  try {
    const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'read' };
    let permission = await directoryHandle.queryPermission(descriptor);
    if (permission !== 'granted') {
      permission = await directoryHandle.requestPermission(descriptor);
    }
    directoryPermissionCache.set(handleId, permission);
    return permission === 'granted';
  } catch (error) {
    console.warn('Could not request read permission for directory handle:', error);
    directoryPermissionCache.set(handleId, 'denied');
    return false;
  }
};

const readFileFromDirectoryPath = async (
  directoryHandle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<File | null> => {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return null;

  const segments = normalized.split('/');
  const fileName = segments.pop();
  if (!fileName) return null;

  let currentDir = directoryHandle;
  try {
    for (const segment of segments) {
      currentDir = await currentDir.getDirectoryHandle(segment);
    }
    const fileHandle = await currentDir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    return null;
  }
};

const cleanupDirectoryHandleIfUnused = async (handleId: string): Promise<void> => {
  const dbInstance = await openDB();

  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = dbInstance.transaction(
        [ASSET_REFERENCE_STORE_NAME, DIRECTORY_HANDLE_STORE_NAME],
        'readwrite',
      );
      const referenceStore = transaction.objectStore(ASSET_REFERENCE_STORE_NAME);
      const handleStore = transaction.objectStore(DIRECTORY_HANDLE_STORE_NAME);
      const index = referenceStore.index(REFERENCE_BY_HANDLE_INDEX_NAME);

      let referenceCount = 0;
      const countRequest = index.count(handleId);
      countRequest.onsuccess = () => {
        referenceCount = countRequest.result ?? 0;
        if (referenceCount === 0) {
          handleStore.delete(handleId);
        }
      };
      countRequest.onerror = () => {
        referenceCount = 1;
      };

      transaction.oncomplete = () => {
        if (referenceCount === 0) {
          directoryHandleCache.delete(handleId);
          directoryPermissionCache.delete(handleId);
        }
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    } catch (error) {
      reject(error);
    }
  });
};

const getReferencedAsset = async (id: string): Promise<Blob | null> => {
  const reference = await getReferenceRecord(id);
  if (!reference) return null;

  const directoryHandle = await getDirectoryHandleById(reference.handleId);
  if (!directoryHandle) return null;

  const hasPermission = await ensureDirectoryReadPermission(reference.handleId, directoryHandle);
  if (!hasPermission) return null;

  return readFileFromDirectoryPath(directoryHandle, reference.relativePath);
};

export const saveAsset = async (blob: Blob): Promise<string> => {
  const id = createId(ASSET_ID_PREFIX);
  await performTransaction(ASSET_STORE_NAME, 'readwrite', (store) => store.put(blob, id));
  return id;
};

export const saveDirectoryAssetReferences = async (
  directoryHandle: FileSystemDirectoryHandle,
  relativePaths: string[],
): Promise<string[]> => {
  const normalizedPaths = relativePaths.map(normalizeRelativePath).filter(Boolean);
  if (normalizedPaths.length === 0) return [];

  const handleId = createId(DIRECTORY_HANDLE_ID_PREFIX);
  const now = Date.now();
  const referenceRecords: AssetReferenceRecord[] = normalizedPaths.map((relativePath) => ({
    id: createId(REFERENCE_ASSET_ID_PREFIX),
    kind: 'directory-file',
    handleId,
    relativePath,
  }));

  const dbInstance = await openDB();
  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = dbInstance.transaction(
        [DIRECTORY_HANDLE_STORE_NAME, ASSET_REFERENCE_STORE_NAME],
        'readwrite',
      );
      const handleStore = transaction.objectStore(DIRECTORY_HANDLE_STORE_NAME);
      const referenceStore = transaction.objectStore(ASSET_REFERENCE_STORE_NAME);

      const directoryRecord: DirectoryHandleRecord = {
        id: handleId,
        kind: 'directory',
        handle: directoryHandle,
        name: directoryHandle.name,
        createdAt: now,
      };
      handleStore.put(directoryRecord);
      referenceRecords.forEach((record) => {
        referenceStore.put(record);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    } catch (error) {
      reject(error);
    }
  });

  directoryHandleCache.set(handleId, directoryHandle);
  directoryPermissionCache.delete(handleId);
  referenceRecords.forEach((record) => {
    referenceRecordCache.set(record.id, record);
  });
  return referenceRecords.map((record) => record.id);
};

export const requestReferencePermissions = async (assetIds: string[]): Promise<void> => {
  const referenceIds = Array.from(new Set(assetIds.filter(isReferenceAssetId)));
  if (referenceIds.length === 0) return;

  const handleIds = new Set<string>();
  for (const assetId of referenceIds) {
    const record = await getReferenceRecord(assetId);
    if (record) {
      handleIds.add(record.handleId);
    }
  }

  for (const handleId of handleIds) {
    const handle = await getDirectoryHandleById(handleId);
    if (!handle) continue;
    await ensureDirectoryReadPermission(handleId, handle);
  }
};

export const getAssetReferenceExportRecord = async (
  assetId: string,
): Promise<AssetReferenceExportRecord | null> => {
  if (!isReferenceAssetId(assetId)) {
    return null;
  }

  const referenceRecord = await getReferenceRecord(assetId);
  if (!referenceRecord) {
    return null;
  }

  const directoryRecord = await getDirectoryHandleRecordById(referenceRecord.handleId);
  if (!directoryRecord) {
    return null;
  }

  return {
    handleId: referenceRecord.handleId,
    directoryName: directoryRecord.name,
    relativePath: referenceRecord.relativePath,
  };
};

export const getAsset = async (id: string): Promise<Blob | null> => {
  if (isReferenceAssetId(id)) {
    return getReferencedAsset(id);
  }

  const result = await performTransaction<Blob | undefined>(ASSET_STORE_NAME, 'readonly', (store) =>
    store.get(id),
  );
  return result || null;
};

export const getAssetSize = async (
  id: string,
  options?: { resolveReference?: boolean },
): Promise<number | null> => {
  if (isReferenceAssetId(id)) {
    if (!options?.resolveReference) {
      return null;
    }

    const referenceRecord = await getReferenceRecord(id);
    if (!referenceRecord) return null;

    const directoryRecord = await getDirectoryHandleRecordById(referenceRecord.handleId);
    if (!directoryRecord) return null;

    try {
      const permission = await directoryRecord.handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') return null;
      const file = await readFileFromDirectoryPath(
        directoryRecord.handle,
        referenceRecord.relativePath,
      );
      return file?.size ?? null;
    } catch (error) {
      return null;
    }
  }

  const result = await performTransaction<Blob | undefined>(ASSET_STORE_NAME, 'readonly', (store) =>
    store.get(id),
  );
  return result?.size ?? null;
};

export const deleteAssets = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;

  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const storedAssetIds = uniqueIds.filter((id) => !isReferenceAssetId(id));
  const referenceAssetIds = uniqueIds.filter(isReferenceAssetId);

  if (storedAssetIds.length > 0) {
    const dbInstance = await openDB();
    const transaction = dbInstance.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE_NAME);
    const deletePromises = storedAssetIds.map((id) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Failed to delete some copied assets:', error);
    }
  }

  if (referenceAssetIds.length === 0) return;

  const handleIds = new Set<string>();
  for (const assetId of referenceAssetIds) {
    const record = await getReferenceRecord(assetId);
    if (record) {
      handleIds.add(record.handleId);
    }
  }

  await Promise.all(
    referenceAssetIds.map(async (assetId) => {
      try {
        await performTransaction(ASSET_REFERENCE_STORE_NAME, 'readwrite', (store) =>
          store.delete(assetId),
        );
        referenceRecordCache.delete(assetId);
      } catch (error) {
        console.error(`Failed to delete referenced asset ${assetId}`, error);
      }
    }),
  );

  await Promise.all(
    Array.from(handleIds).map(async (handleId) => {
      try {
        await cleanupDirectoryHandleIfUnused(handleId);
      } catch (error) {
        console.error(`Failed to cleanup directory handle ${handleId}`, error);
      }
    }),
  );
};

// --- Project State Persistence (IndexedDB) ---

export const saveProjectStateToDB = async (id: string, state: any): Promise<void> => {
  await performTransaction(PROJECT_STORE_NAME, 'readwrite', (store) => store.put(state, id));
};

export const loadProjectStateFromDB = async (id: string): Promise<any | null> => {
  const result = await performTransaction<any | undefined>(
    PROJECT_STORE_NAME,
    'readonly',
    (store) => store.get(id),
  );
  return result || null;
};

export const deleteProjectStateFromDB = async (id: string): Promise<void> => {
  await performTransaction(PROJECT_STORE_NAME, 'readwrite', (store) => store.delete(id));
};
