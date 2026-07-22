/**
 * Capability-based storage mounts used by projects, assets, Gallery data, and
 * future workspace/plugin file views. Browser persistence remains a special
 * built-in mount; every other mount exposes the same small object-store API.
 */

export const BROWSER_STORAGE_MOUNT_ID = 'browser';

export const STORAGE_MOUNT_RESOURCES = [
  'projects',
  'assets',
  'gallery',
  'models',
  'workspace',
  'plugins',
] as const;

export type StorageMountResource = (typeof STORAGE_MOUNT_RESOURCES)[number];
export type StorageMountKind = 'browser' | 'file-system' | 'object-storage' | 'custom';

export interface StorageMountDescriptor {
  id: string;
  name: string;
  kind: StorageMountKind;
  resources: StorageMountResource[];
  readOnly: boolean;
  createdAt: number;
  detail?: string;
}

export interface StorageMountInfo extends StorageMountDescriptor {
  connected: boolean;
  permission: PermissionState | 'unavailable';
  defaultFor: StorageMountResource[];
}

export interface StorageMountFile {
  path: string;
  size?: number;
  lastModified?: number;
}

export interface StorageMountAdapter {
  read(path: string): Promise<Blob | null>;
  write(path: string, value: Blob): Promise<void>;
  delete(path: string): Promise<void>;
  list?(prefix?: string): Promise<StorageMountFile[]>;
}

/**
 * Minimal client contract for S3-compatible gateways, cloud SDKs, or plugin
 * supplied object stores. Authentication stays with the caller/plugin and is
 * never persisted by project-store.
 */
export interface ObjectStorageClient {
  getObject(key: string): Promise<Blob | ArrayBuffer | Uint8Array | null>;
  putObject(key: string, value: Blob): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects?(
    prefix: string,
  ): Promise<Array<{ key: string; size?: number; lastModified?: number }>>;
}

type PersistedDirectoryMountRecord = StorageMountDescriptor & {
  kind: 'file-system';
  handle: FileSystemDirectoryHandle;
};

const MOUNT_DB_NAME = 'BlackboardStorageMounts';
const MOUNT_DB_VERSION = 2;
const MOUNT_STORE_NAME = 'mounts';
const BROWSER_FILE_STORE_NAME = 'browser-files';
const MOUNT_DEFAULTS_KEY = 'blackboard-studio-storage-mount-defaults';
const MOUNTS_CHANGED_EVENT = 'blackboard-storage-mounts-changed';

export const StorageMountPaths = {
  root: '.blackboard-studio',
  identity: '.blackboard-studio/mount.json',
  assets: '.blackboard-studio/assets',
  projects: '.blackboard-studio/projects',
  gallery: '.blackboard-studio/gallery/gallery.json',
  models: '.blackboard-studio/models',
  workspace: 'workspace',
  plugins: 'plugins',
} as const;

const MOUNT_IDENTITY_FORMAT = 'blackboard-studio-storage-mount';
const MOUNT_IDENTITY_VERSION = 1;

const runtimeMounts = new Map<
  string,
  { descriptor: StorageMountDescriptor; adapter: StorageMountAdapter }
>();
const directoryAdapterCache = new Map<string, StorageMountAdapter>();
let mountDb: IDBDatabase | null = null;
let memoryDefaults: Partial<Record<StorageMountResource, string>> = {};

const createStorageId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const emitMountsChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MOUNTS_CHANGED_EVENT));
  }
};

export const subscribeToStorageMounts = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(MOUNTS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(MOUNTS_CHANGED_EVENT, listener);
};

/** Normalize a mount-relative path and reject traversal or absolute paths. */
export const normalizeStorageMountPath = (value: string): string => {
  if (typeof value !== 'string') throw new Error('Storage path must be a string.');
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\0')) {
    throw new Error(`Storage path must be mount-relative: ${value}`);
  }

  const segments = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Storage path cannot traverse outside its mount: ${value}`);
  }
  return segments.join('/');
};

export const joinStorageMountPath = (...parts: string[]): string =>
  normalizeStorageMountPath(parts.filter(Boolean).join('/'));

const openMountDB = async (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === 'undefined') return null;
  if (mountDb) return mountDb;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MOUNT_DB_NAME, MOUNT_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open storage mounts.'));
    request.onsuccess = () => {
      mountDb = request.result;
      mountDb.onclose = () => {
        mountDb = null;
      };
      mountDb.onversionchange = () => {
        mountDb?.close();
        mountDb = null;
      };
      resolve(mountDb);
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MOUNT_STORE_NAME)) {
        database.createObjectStore(MOUNT_STORE_NAME, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(BROWSER_FILE_STORE_NAME)) {
        database.createObjectStore(BROWSER_FILE_STORE_NAME);
      }
    };
  });
};

const storageTransaction = async <T>(
  storeName: typeof MOUNT_STORE_NAME | typeof BROWSER_FILE_STORE_NAME,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> => {
  const database = await openMountDB();
  if (!database) return undefined;

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getPersistedDirectoryMounts = async (): Promise<PersistedDirectoryMountRecord[]> =>
  (await storageTransaction(MOUNT_STORE_NAME, 'readonly', (store) => store.getAll())) ?? [];

const getPersistedDirectoryMount = async (
  mountId: string,
): Promise<PersistedDirectoryMountRecord | null> => {
  const result = await storageTransaction<PersistedDirectoryMountRecord>(
    MOUNT_STORE_NAME,
    'readonly',
    (store) => store.get(mountId),
  );
  return result ?? null;
};

const readDefaults = (): Partial<Record<StorageMountResource, string>> => {
  if (typeof localStorage === 'undefined') return memoryDefaults;
  try {
    const parsed = JSON.parse(localStorage.getItem(MOUNT_DEFAULTS_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      STORAGE_MOUNT_RESOURCES.flatMap((resource) => {
        const value = (parsed as Record<string, unknown>)[resource];
        return typeof value === 'string' && value ? [[resource, value]] : [];
      }),
    );
  } catch {
    return {};
  }
};

const writeDefaults = (defaults: Partial<Record<StorageMountResource, string>>): void => {
  memoryDefaults = defaults;
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MOUNT_DEFAULTS_KEY, JSON.stringify(defaults));
};

export const getDefaultStorageMountId = (resource: StorageMountResource): string =>
  readDefaults()[resource] ?? BROWSER_STORAGE_MOUNT_ID;

export const setDefaultStorageMountId = (resource: StorageMountResource, mountId: string): void => {
  writeDefaults({ ...readDefaults(), [resource]: mountId || BROWSER_STORAGE_MOUNT_ID });
  emitMountsChanged();
};

const ensureDirectoryPermission = async (
  record: PersistedDirectoryMountRecord,
  request: boolean,
): Promise<PermissionState> => {
  const mode = record.readOnly ? 'read' : 'readwrite';
  let permission = await record.handle.queryPermission({ mode });
  if (request && permission !== 'granted') {
    permission = await record.handle.requestPermission({ mode });
  }
  return permission;
};

const getDirectoryAtPath = async (
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  let directory = root;
  const normalized = normalizeStorageMountPath(path);
  for (const segment of normalized ? normalized.split('/') : []) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory;
};

const getFileParts = (path: string): { directoryPath: string; fileName: string } => {
  const normalized = normalizeStorageMountPath(path);
  const segments = normalized.split('/');
  const fileName = segments.pop();
  if (!fileName) throw new Error('Storage file path cannot be empty.');
  return { directoryPath: segments.join('/'), fileName };
};

const createDirectoryAdapter = (record: PersistedDirectoryMountRecord): StorageMountAdapter => {
  const assertConnected = async () => {
    const permission = await ensureDirectoryPermission(record, false);
    if (permission !== 'granted') {
      throw new Error(`Storage mount “${record.name}” needs permission.`);
    }
  };

  const listDirectory = async (
    directory: FileSystemDirectoryHandle,
    path: string,
  ): Promise<StorageMountFile[]> => {
    const files: StorageMountFile[] = [];
    for await (const [name, handle] of directory.entries()) {
      const childPath = joinStorageMountPath(path, name);
      if (handle.kind === 'directory') {
        files.push(...(await listDirectory(handle as FileSystemDirectoryHandle, childPath)));
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        files.push({ path: childPath, size: file.size, lastModified: file.lastModified });
      }
    }
    return files;
  };

  return {
    async read(path) {
      await assertConnected();
      const { directoryPath, fileName } = getFileParts(path);
      try {
        const directory = await getDirectoryAtPath(record.handle, directoryPath, false);
        return await (await directory.getFileHandle(fileName)).getFile();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return null;
        throw error;
      }
    },
    async write(path, value) {
      if (record.readOnly) throw new Error(`Storage mount “${record.name}” is read-only.`);
      await assertConnected();
      const { directoryPath, fileName } = getFileParts(path);
      const directory = await getDirectoryAtPath(record.handle, directoryPath, true);
      const writable = await (
        await directory.getFileHandle(fileName, { create: true })
      ).createWritable();
      await writable.write(value);
      await writable.close();
    },
    async delete(path) {
      if (record.readOnly) throw new Error(`Storage mount “${record.name}” is read-only.`);
      await assertConnected();
      const { directoryPath, fileName } = getFileParts(path);
      try {
        const directory = await getDirectoryAtPath(record.handle, directoryPath, false);
        await directory.removeEntry(fileName);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return;
        throw error;
      }
    },
    async list(prefix = '') {
      await assertConnected();
      const normalizedPrefix = normalizeStorageMountPath(prefix);
      try {
        const directory = await getDirectoryAtPath(record.handle, normalizedPrefix, false);
        return listDirectory(directory, normalizedPrefix);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return [];
        throw error;
      }
    },
  };
};

const browserStorageAdapter: StorageMountAdapter = {
  async read(path) {
    return (
      (await storageTransaction<Blob>(BROWSER_FILE_STORE_NAME, 'readonly', (store) =>
        store.get(path),
      )) ?? null
    );
  },
  async write(path, value) {
    const result = await storageTransaction(BROWSER_FILE_STORE_NAME, 'readwrite', (store) =>
      store.put(value, path),
    );
    if (typeof indexedDB === 'undefined' || result === undefined) {
      throw new Error('Browser file storage is unavailable.');
    }
  },
  async delete(path) {
    await storageTransaction(BROWSER_FILE_STORE_NAME, 'readwrite', (store) => store.delete(path));
  },
  async list(prefix = '') {
    const keys =
      (await storageTransaction<IDBValidKey[]>(BROWSER_FILE_STORE_NAME, 'readonly', (store) =>
        store.getAllKeys(),
      )) ?? [];
    const paths = keys.filter(
      (key): key is string => typeof key === 'string' && key.startsWith(prefix),
    );
    return Promise.all(
      paths.map(async (path) => {
        const blob = await browserStorageAdapter.read(path);
        return { path, size: blob?.size };
      }),
    );
  },
};

const getStorageMountAdapter = async (mountId: string): Promise<StorageMountAdapter> => {
  if (mountId === BROWSER_STORAGE_MOUNT_ID) return browserStorageAdapter;
  const runtime = runtimeMounts.get(mountId);
  if (runtime) return runtime.adapter;

  const cached = directoryAdapterCache.get(mountId);
  if (cached) return cached;

  const record = await getPersistedDirectoryMount(mountId);
  if (!record) throw new Error(`Storage mount “${mountId}” is not connected.`);
  const adapter = createDirectoryAdapter(record);
  directoryAdapterCache.set(mountId, adapter);
  return adapter;
};

export const createObjectStorageAdapter = (
  client: ObjectStorageClient,
  options: { prefix?: string } = {},
): StorageMountAdapter => {
  const rootPrefix = normalizeStorageMountPath(options.prefix ?? '');
  const getKey = (path: string) => joinStorageMountPath(rootPrefix, path);

  return {
    async read(path) {
      const value = await client.getObject(getKey(path));
      if (value === null) return null;
      return value instanceof Blob ? value : new Blob([value]);
    },
    write: (path, value) => client.putObject(getKey(path), value),
    delete: (path) => client.deleteObject(getKey(path)),
    list: client.listObjects
      ? async (prefix = '') => {
          const keyPrefix = getKey(prefix);
          const items = await client.listObjects!(keyPrefix);
          const stripPrefix = rootPrefix ? `${rootPrefix}/` : '';
          return items
            .filter(
              (item) =>
                !keyPrefix || item.key === keyPrefix || item.key.startsWith(`${keyPrefix}/`),
            )
            .map((item) => ({
              path: normalizeStorageMountPath(
                stripPrefix && item.key.startsWith(stripPrefix)
                  ? item.key.slice(stripPrefix.length)
                  : item.key,
              ),
              size: item.size,
              lastModified: item.lastModified,
            }));
        }
      : undefined,
  };
};

/** Register a live plugin/object-store adapter. Returns an unregister function. */
export const registerStorageMount = (
  descriptor: Omit<StorageMountDescriptor, 'createdAt'> & { createdAt?: number },
  adapter: StorageMountAdapter,
): (() => void) => {
  if (!descriptor.id || descriptor.id === BROWSER_STORAGE_MOUNT_ID) {
    throw new Error('A custom storage mount needs a unique non-browser id.');
  }
  runtimeMounts.set(descriptor.id, {
    descriptor: { ...descriptor, createdAt: descriptor.createdAt ?? Date.now() },
    adapter,
  });
  emitMountsChanged();
  return () => {
    runtimeMounts.delete(descriptor.id);
    STORAGE_MOUNT_RESOURCES.forEach((resource) => {
      if (getDefaultStorageMountId(resource) === descriptor.id) {
        setDefaultStorageMountId(resource, BROWSER_STORAGE_MOUNT_ID);
      }
    });
    emitMountsChanged();
  };
};

export const mountDirectory = async (
  handle: FileSystemDirectoryHandle,
  options: {
    name?: string;
    resources?: StorageMountResource[];
    readOnly?: boolean;
    detail?: string;
  } = {},
): Promise<StorageMountDescriptor> => {
  for (const existing of await getPersistedDirectoryMounts()) {
    try {
      if (await existing.handle.isSameEntry(handle)) {
        const permission = await ensureDirectoryPermission(existing, true);
        if (permission !== 'granted') throw new Error('Folder permission was not granted.');
        directoryAdapterCache.set(existing.id, createDirectoryAdapter(existing));
        emitMountsChanged();
        const { handle: _handle, ...descriptor } = existing;
        return descriptor;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Folder permission was not granted.') {
        throw error;
      }
    }
  }

  const record: PersistedDirectoryMountRecord = {
    id: createStorageId('fs'),
    name: options.name?.trim() || handle.name,
    kind: 'file-system',
    resources: options.resources?.length
      ? [...new Set(options.resources)]
      : [...STORAGE_MOUNT_RESOURCES],
    readOnly: options.readOnly ?? false,
    createdAt: Date.now(),
    detail: options.detail ?? handle.name,
    handle,
  };

  const permission = await ensureDirectoryPermission(record, true);
  if (permission !== 'granted') throw new Error('Folder permission was not granted.');
  const provisionalAdapter = createDirectoryAdapter(record);
  try {
    const identityBlob = await provisionalAdapter.read(StorageMountPaths.identity);
    const identity = identityBlob
      ? (JSON.parse(await identityBlob.text()) as Record<string, unknown>)
      : null;
    if (
      identity?.format === MOUNT_IDENTITY_FORMAT &&
      identity.version === MOUNT_IDENTITY_VERSION &&
      typeof identity.id === 'string' &&
      /^[a-zA-Z0-9_.-]+$/.test(identity.id) &&
      identity.id !== BROWSER_STORAGE_MOUNT_ID
    ) {
      record.id = identity.id;
    }
  } catch {
    // A missing or malformed identity is replaced below for writable mounts.
  }
  if (!record.readOnly) {
    await createDirectoryAdapter(record).write(
      StorageMountPaths.identity,
      new Blob(
        [
          JSON.stringify(
            {
              format: MOUNT_IDENTITY_FORMAT,
              version: MOUNT_IDENTITY_VERSION,
              id: record.id,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
  }
  await storageTransaction(MOUNT_STORE_NAME, 'readwrite', (store) => store.put(record));
  directoryAdapterCache.set(record.id, createDirectoryAdapter(record));
  emitMountsChanged();

  const { handle: _handle, ...descriptor } = record;
  return descriptor;
};

export const requestStorageMountPermission = async (mountId: string): Promise<boolean> => {
  const runtime = runtimeMounts.get(mountId);
  if (runtime) return true;
  const record = await getPersistedDirectoryMount(mountId);
  if (!record) return false;
  const granted = (await ensureDirectoryPermission(record, true)) === 'granted';
  if (granted) directoryAdapterCache.set(record.id, createDirectoryAdapter(record));
  emitMountsChanged();
  return granted;
};

export const unmountStorage = async (mountId: string): Promise<void> => {
  if (mountId === BROWSER_STORAGE_MOUNT_ID) return;
  runtimeMounts.delete(mountId);
  directoryAdapterCache.delete(mountId);
  await storageTransaction(MOUNT_STORE_NAME, 'readwrite', (store) => store.delete(mountId));
  const defaults = readDefaults();
  STORAGE_MOUNT_RESOURCES.forEach((resource) => {
    if (defaults[resource] === mountId) defaults[resource] = BROWSER_STORAGE_MOUNT_ID;
  });
  writeDefaults(defaults);
  emitMountsChanged();
};

export const listStorageMounts = async (): Promise<StorageMountInfo[]> => {
  const defaults = readDefaults();
  const defaultFor = (id: string) =>
    STORAGE_MOUNT_RESOURCES.filter(
      (resource) => (defaults[resource] ?? BROWSER_STORAGE_MOUNT_ID) === id,
    );
  const browser: StorageMountInfo = {
    id: BROWSER_STORAGE_MOUNT_ID,
    name: 'Browser storage',
    kind: 'browser',
    resources: [...STORAGE_MOUNT_RESOURCES],
    readOnly: false,
    createdAt: 0,
    detail: 'IndexedDB and localStorage in this browser',
    connected: true,
    permission: 'granted',
    defaultFor: defaultFor(BROWSER_STORAGE_MOUNT_ID),
  };

  const persisted = await getPersistedDirectoryMounts();
  const persistedInfos = await Promise.all(
    persisted.map(async (record): Promise<StorageMountInfo> => {
      let permission: PermissionState | 'unavailable' = 'unavailable';
      try {
        permission = await ensureDirectoryPermission(record, false);
      } catch {
        permission = 'unavailable';
      }
      const { handle: _handle, ...descriptor } = record;
      return {
        ...descriptor,
        connected: permission === 'granted',
        permission,
        defaultFor: defaultFor(record.id),
      };
    }),
  );

  const persistedIds = new Set(persistedInfos.map((mount) => mount.id));
  const runtimeInfos = Array.from(runtimeMounts.values())
    .filter(({ descriptor }) => !persistedIds.has(descriptor.id))
    .map(
      ({ descriptor }): StorageMountInfo => ({
        ...descriptor,
        connected: true,
        permission: 'granted',
        defaultFor: defaultFor(descriptor.id),
      }),
    );

  return [browser, ...persistedInfos, ...runtimeInfos].sort((a, b) => a.createdAt - b.createdAt);
};

export const getStorageMount = async (mountId: string): Promise<StorageMountInfo | null> =>
  (await listStorageMounts()).find((mount) => mount.id === mountId) ?? null;

export const readStorageFile = async (mountId: string, path: string): Promise<Blob | null> => {
  return (await getStorageMountAdapter(mountId)).read(normalizeStorageMountPath(path));
};

export const writeStorageFile = async (
  mountId: string,
  path: string,
  value: Blob | string,
): Promise<void> => {
  const blob = typeof value === 'string' ? new Blob([value], { type: 'text/plain' }) : value;
  await (await getStorageMountAdapter(mountId)).write(normalizeStorageMountPath(path), blob);
};

export const deleteStorageFile = async (mountId: string, path: string): Promise<void> => {
  await (await getStorageMountAdapter(mountId)).delete(normalizeStorageMountPath(path));
};

export const listStorageFiles = async (
  mountId: string,
  prefix = '',
): Promise<StorageMountFile[]> => {
  const adapter = await getStorageMountAdapter(mountId);
  return adapter.list ? adapter.list(normalizeStorageMountPath(prefix)) : [];
};

export const deleteStorageTree = async (mountId: string, prefix: string): Promise<void> => {
  const files = await listStorageFiles(mountId, prefix);
  await Promise.all(files.map((file) => deleteStorageFile(mountId, file.path)));
};

export interface StorageFileScopeOptions {
  mountId?: string;
}

const getScopedMountId = (
  resource: 'workspace' | 'plugins',
  options?: StorageFileScopeOptions,
): string => options?.mountId ?? getDefaultStorageMountId(resource);

const getWorkspaceFilePath = (path: string): string =>
  joinStorageMountPath(StorageMountPaths.workspace, path);

const getPluginFilePath = (pluginId: string, path: string): string => {
  const normalizedPluginId = normalizeStorageMountPath(pluginId);
  if (!normalizedPluginId || normalizedPluginId.includes('/')) {
    throw new Error('Plugin storage ids must be a single path segment.');
  }
  return joinStorageMountPath(StorageMountPaths.plugins, normalizedPluginId, path);
};

export const readWorkspaceFile = (
  path: string,
  options?: StorageFileScopeOptions,
): Promise<Blob | null> =>
  readStorageFile(getScopedMountId('workspace', options), getWorkspaceFilePath(path));

export const writeWorkspaceFile = (
  path: string,
  value: Blob | string,
  options?: StorageFileScopeOptions,
): Promise<void> =>
  writeStorageFile(getScopedMountId('workspace', options), getWorkspaceFilePath(path), value);

export const deleteWorkspaceFile = (
  path: string,
  options?: StorageFileScopeOptions,
): Promise<void> =>
  deleteStorageFile(getScopedMountId('workspace', options), getWorkspaceFilePath(path));

export const listWorkspaceFiles = (
  options?: StorageFileScopeOptions,
): Promise<StorageMountFile[]> =>
  listStorageFiles(
    getScopedMountId('workspace', options),
    normalizeStorageMountPath(StorageMountPaths.workspace),
  );

export const readPluginFile = (
  pluginId: string,
  path: string,
  options?: StorageFileScopeOptions,
): Promise<Blob | null> =>
  readStorageFile(getScopedMountId('plugins', options), getPluginFilePath(pluginId, path));

export const writePluginFile = (
  pluginId: string,
  path: string,
  value: Blob | string,
  options?: StorageFileScopeOptions,
): Promise<void> =>
  writeStorageFile(getScopedMountId('plugins', options), getPluginFilePath(pluginId, path), value);

export const deletePluginFile = (
  pluginId: string,
  path: string,
  options?: StorageFileScopeOptions,
): Promise<void> =>
  deleteStorageFile(getScopedMountId('plugins', options), getPluginFilePath(pluginId, path));

export const listPluginFiles = (
  pluginId: string,
  options?: StorageFileScopeOptions,
): Promise<StorageMountFile[]> =>
  listStorageFiles(getScopedMountId('plugins', options), getPluginFilePath(pluginId, ''));

export const createMountedAssetId = (mountId: string, path: string): string => {
  if (!mountId || mountId === BROWSER_STORAGE_MOUNT_ID) {
    throw new Error('Mounted asset ids require a non-browser storage mount.');
  }
  const normalized = normalizeStorageMountPath(path);
  return `mount://${encodeURIComponent(mountId)}/${normalized
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
};

export const parseMountedAssetId = (assetId: string): { mountId: string; path: string } | null => {
  if (!assetId.startsWith('mount://')) return null;
  const separator = assetId.indexOf('/', 'mount://'.length);
  if (separator < 0) return null;
  try {
    const mountId = decodeURIComponent(assetId.slice('mount://'.length, separator));
    const path = normalizeStorageMountPath(
      assetId
        .slice(separator + 1)
        .split('/')
        .map(decodeURIComponent)
        .join('/'),
    );
    return mountId && path ? { mountId, path } : null;
  } catch {
    return null;
  }
};

export const createStorageMountAssetPath = (fileName?: string): string => {
  const fallbackName = createStorageId('asset');
  const safeName =
    (fileName ?? fallbackName)
      .trim()
      .replace(/[\\/]+/g, '-')
      .replace(/^\.+/, '') || fallbackName;
  return joinStorageMountPath(StorageMountPaths.assets, `${createStorageId('asset')}-${safeName}`);
};
