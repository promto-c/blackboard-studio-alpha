import type {
  InstalledOnnxModel,
  ModelCatalogReference,
  OnnxModelExternalData,
  OnnxModelVariantMetadata,
} from '@blackboard/types';
import { GENERIC_ONNX_RECIPE, getVariantRequiredFiles, getVariantTotalSize } from './modelRegistry';
import { getTransformersCachedModelFile } from '@/services/models/transformersModelCache';
import {
  BROWSER_STORAGE_MOUNT_ID,
  StorageMountPaths,
  createMountedAssetId,
  deleteStorageFile,
  getDefaultStorageMountId,
  joinStorageMountPath,
  listStorageMounts,
  parseMountedAssetId,
  readStorageFile,
  writeStorageFile,
} from '@blackboard/project-store';

const DB_NAME = 'BlackboardOnnxModels';
const DB_VERSION = 1;
const MODEL_STORE = 'models';
const BLOB_STORE = 'blobs';
const MODEL_CATALOG_PATH = joinStorageMountPath(StorageMountPaths.models, 'models.json');
const MODEL_CATALOG_FORMAT = 'blackboard-studio-onnx-models';
const MODEL_CATALOG_VERSION = 1;

interface MountedModelCatalog {
  format: typeof MODEL_CATALOG_FORMAT;
  version: typeof MODEL_CATALOG_VERSION;
  models: InstalledOnnxModel[];
}

let db: IDBDatabase | null = null;
const catalogWriteQueues = new Map<string, Promise<void>>();

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      db.onclose = () => {
        db = null;
      };
      db.onversionchange = () => {
        db?.close();
        db = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const dbInstance = request.result;
      if (!dbInstance.objectStoreNames.contains(MODEL_STORE)) {
        dbInstance.createObjectStore(MODEL_STORE, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(BLOB_STORE)) {
        dbInstance.createObjectStore(BLOB_STORE);
      }
    };
  });

const performTransaction = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getBrowserInstalledOnnxModels = async (): Promise<InstalledOnnxModel[]> => {
  if (typeof indexedDB === 'undefined') return [];
  return performTransaction<InstalledOnnxModel[]>(MODEL_STORE, 'readonly', (store) =>
    store.getAll(),
  );
};

const loadMountedModelCatalog = async (mountId: string): Promise<MountedModelCatalog> => {
  const blob = await readStorageFile(mountId, MODEL_CATALOG_PATH);
  if (!blob) {
    return { format: MODEL_CATALOG_FORMAT, version: MODEL_CATALOG_VERSION, models: [] };
  }
  try {
    const catalog = JSON.parse(await blob.text()) as MountedModelCatalog;
    if (
      catalog.format !== MODEL_CATALOG_FORMAT ||
      catalog.version !== MODEL_CATALOG_VERSION ||
      !Array.isArray(catalog.models)
    ) {
      throw new Error('Unsupported ONNX model catalog.');
    }
    return catalog;
  } catch (error) {
    console.warn(`Could not read ONNX model catalog from ${mountId}.`, error);
    return { format: MODEL_CATALOG_FORMAT, version: MODEL_CATALOG_VERSION, models: [] };
  }
};

const updateMountedModelCatalog = async (
  mountId: string,
  update: (models: InstalledOnnxModel[]) => InstalledOnnxModel[],
): Promise<void> => {
  const previous = catalogWriteQueues.get(mountId) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const catalog = await loadMountedModelCatalog(mountId);
      const models = update(catalog.models).map((model) => ({ ...model, storageMountId: mountId }));
      await writeStorageFile(
        mountId,
        MODEL_CATALOG_PATH,
        new Blob(
          [
            JSON.stringify(
              {
                format: MODEL_CATALOG_FORMAT,
                version: MODEL_CATALOG_VERSION,
                models,
              } satisfies MountedModelCatalog,
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
    });
  catalogWriteQueues.set(mountId, operation);
  try {
    await operation;
  } finally {
    if (catalogWriteQueues.get(mountId) === operation) catalogWriteQueues.delete(mountId);
  }
};

const getConnectedModelMountIds = async (): Promise<string[]> =>
  (await listStorageMounts())
    .filter(
      (mount) =>
        mount.id !== BROWSER_STORAGE_MOUNT_ID &&
        mount.connected &&
        mount.resources.includes('models'),
    )
    .map((mount) => mount.id);

const getMountedModelId = (mountId: string, logicalCacheKey: string, extension: string): string => {
  const fileName = `${encodeURIComponent(logicalCacheKey)}${extension}`;
  return createMountedAssetId(
    mountId,
    joinStorageMountPath(StorageMountPaths.models, 'blobs', fileName),
  );
};

const putCachedOnnxModelBlob = async (cacheKey: string, blob: Blob): Promise<void> => {
  const mounted = parseMountedAssetId(cacheKey);
  if (mounted) {
    await writeStorageFile(mounted.mountId, mounted.path, blob);
    return;
  }
  await performTransaction(BLOB_STORE, 'readwrite', (store) => store.put(blob, cacheKey));
};

const deleteCachedOnnxModelBlob = async (cacheKey: string): Promise<void> => {
  const mounted = parseMountedAssetId(cacheKey);
  if (mounted) {
    await deleteStorageFile(mounted.mountId, mounted.path);
    return;
  }
  if (typeof indexedDB === 'undefined') return;
  await performTransaction(BLOB_STORE, 'readwrite', (store) => store.delete(cacheKey));
};

const putInstalledOnnxModel = async (model: InstalledOnnxModel): Promise<void> => {
  if (model.storageMountId && model.storageMountId !== BROWSER_STORAGE_MOUNT_ID) {
    await updateMountedModelCatalog(model.storageMountId, (models) => [
      model,
      ...models.filter((candidate) => candidate.id !== model.id),
    ]);
    return;
  }
  await performTransaction(MODEL_STORE, 'readwrite', (store) => store.put(model));
};

const deleteInstalledOnnxModelRecord = async (model: InstalledOnnxModel): Promise<void> => {
  if (model.storageMountId && model.storageMountId !== BROWSER_STORAGE_MOUNT_ID) {
    await updateMountedModelCatalog(model.storageMountId, (models) =>
      models.filter((candidate) => candidate.id !== model.id),
    );
    return;
  }
  if (typeof indexedDB === 'undefined') return;
  await performTransaction(MODEL_STORE, 'readwrite', (store) => store.delete(model.id));
};

export const getOnnxDownloadUrl = (variant: OnnxModelVariantMetadata): string =>
  `https://huggingface.co/${variant.repoName}/resolve/main/${variant.filePath}`;

const getExternalDownloadUrl = (repoName: string, filePath: string): string =>
  `https://huggingface.co/${repoName}/resolve/main/${filePath}`;

const externalDataCacheKey = (modelCacheKey: string, extPath: string): string =>
  `${modelCacheKey}:ext:${extPath.replace(/\//g, '_')}`;

const streamDownloadAsBlob = async (
  url: string,
  onDelta: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<Blob> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      onDelta(value.byteLength);
    }
  } else {
    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    onDelta(buffer.byteLength);
  }

  return new Blob(chunks, { type: 'application/octet-stream' });
};

const downloadOrReuseTransformersFile = async (
  repoName: string,
  filePath: string,
  url: string,
  onDelta: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<Blob> => {
  const cached = await getTransformersCachedModelFile(repoName, filePath);
  if (cached) {
    onDelta(cached.size);
    return cached;
  }
  return streamDownloadAsBlob(url, onDelta, signal);
};

const getAllInstalledOnnxModelRecords = async (): Promise<InstalledOnnxModel[]> => {
  const browserModels = await getBrowserInstalledOnnxModels();
  const mountIds = await getConnectedModelMountIds();
  const mountedModels = await Promise.all(
    mountIds.map(async (mountId) => {
      try {
        const catalog = await loadMountedModelCatalog(mountId);
        return catalog.models.map((model) => ({ ...model, storageMountId: mountId }));
      } catch (error) {
        console.warn(`Could not load ONNX models from ${mountId}.`, error);
        return [];
      }
    }),
  );
  return [...browserModels, ...mountedModels.flat()];
};

export const getInstalledOnnxModels = async (): Promise<InstalledOnnxModel[]> => {
  const modelsById = new Map<string, InstalledOnnxModel>();
  (await getAllInstalledOnnxModelRecords()).forEach((model) => {
    const current = modelsById.get(model.id);
    if (!current || current.installedAt < model.installedAt) modelsById.set(model.id, model);
  });
  return Array.from(modelsById.values()).sort((a, b) => b.installedAt - a.installedAt);
};

export const getInstalledOnnxModel = async (id: string): Promise<InstalledOnnxModel | null> => {
  return (await getInstalledOnnxModels()).find((model) => model.id === id) ?? null;
};

export const getCachedOnnxModelBlob = async (cacheKey: string): Promise<Blob | null> => {
  const mounted = parseMountedAssetId(cacheKey);
  if (mounted) return readStorageFile(mounted.mountId, mounted.path);
  if (typeof indexedDB === 'undefined') return null;
  const blob = await performTransaction<Blob | undefined>(BLOB_STORE, 'readonly', (store) =>
    store.get(cacheKey),
  );
  return blob ?? null;
};

export const getCachedOnnxExternalDataBlobs = async (
  model: InstalledOnnxModel,
): Promise<{ path: string; data: ArrayBuffer }[]> => {
  if (!model.externalData?.length) return [];
  const results: { path: string; data: ArrayBuffer }[] = [];
  for (const ext of model.externalData) {
    const blob = await getCachedOnnxModelBlob(ext.cacheKey);
    if (blob) {
      const data = await blob.arrayBuffer();
      results.push({ path: ext.path, data });
    }
  }
  return results;
};

export const deleteInstalledOnnxModel = async (modelId: string): Promise<void> => {
  const models = (await getAllInstalledOnnxModelRecords()).filter((model) => model.id === modelId);
  await Promise.all(
    models.map(async (model) => {
      await Promise.all([
        deleteCachedOnnxModelBlob(model.cacheKey),
        ...(model.externalData ?? []).map((external) =>
          deleteCachedOnnxModelBlob(external.cacheKey),
        ),
      ]);
      await deleteInstalledOnnxModelRecord(model);
    }),
  );
};

export interface DownloadProgress {
  loaded: number;
  total?: number;
  percent?: number;
  currentFile?: string;
  currentFileLoaded?: number;
  currentFileSize?: number;
  fileIndex: number;
  fileCount: number;
}

export const downloadAndCacheOnnxModel = async ({
  variant,
  catalogRef,
  onProgress,
  signal,
}: {
  variant: OnnxModelVariantMetadata;
  catalogRef?: ModelCatalogReference;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<InstalledOnnxModel> => {
  const modelUrl = getOnnxDownloadUrl(variant);
  const requiredFiles = getVariantRequiredFiles(variant);
  const fileCount = requiredFiles.length;
  const grandTotal = getVariantTotalSize(variant) ?? variant.sizeBytes ?? 0;
  let cumulativeLoaded = 0;
  let currentFileName: string | undefined;
  let currentFileLoaded = 0;
  let currentFileSize: number | undefined;
  let currentFileIndex = 0;

  const reportProgress = (
    overrides?: Partial<
      Pick<DownloadProgress, 'currentFile' | 'currentFileLoaded' | 'currentFileSize' | 'fileIndex'>
    >,
  ) => {
    onProgress?.({
      loaded: cumulativeLoaded,
      total: grandTotal,
      percent: grandTotal ? Math.min(100, (cumulativeLoaded / grandTotal) * 100) : undefined,
      currentFile: currentFileName,
      currentFileLoaded,
      currentFileSize,
      fileIndex: currentFileIndex,
      fileCount,
      ...overrides,
    });
  };

  const onDelta = (bytes: number) => {
    cumulativeLoaded += bytes;
    currentFileLoaded += bytes;
    reportProgress();
  };

  // Download main ONNX file
  currentFileName = requiredFiles[0]?.path.split('/').pop() ?? variant.filePath;
  currentFileLoaded = 0;
  currentFileSize = variant.sizeBytes;
  currentFileIndex = 0;
  reportProgress({
    currentFile: currentFileName,
    currentFileLoaded: 0,
    currentFileSize,
    fileIndex: 0,
  });

  const blob = await downloadOrReuseTransformersFile(
    variant.repoName,
    variant.filePath,
    modelUrl,
    onDelta,
    signal,
  );
  const modelId = `generic:${variant.repoName}:${variant.filePath}`;
  const logicalCacheKey = `${modelId}:${Date.now()}`;
  const storageMountId = getDefaultStorageMountId('models');
  const cacheKey =
    storageMountId === BROWSER_STORAGE_MOUNT_ID
      ? logicalCacheKey
      : getMountedModelId(storageMountId, logicalCacheKey, '.onnx');

  const externalData: OnnxModelExternalData[] = [];
  if (variant.externalDataFiles?.length) {
    for (let i = 0; i < variant.externalDataFiles.length; i++) {
      const extFile = variant.externalDataFiles[i];
      currentFileName = extFile.path.split('/').pop() ?? extFile.path;
      currentFileLoaded = 0;
      currentFileSize = extFile.size;
      currentFileIndex = i + 1;
      const extUrl = getExternalDownloadUrl(variant.repoName, extFile.path);
      reportProgress({
        currentFile: currentFileName,
        currentFileLoaded: 0,
        currentFileSize,
        fileIndex: currentFileIndex,
      });
      const extBlob = await downloadOrReuseTransformersFile(
        variant.repoName,
        extFile.path,
        extUrl,
        onDelta,
        signal,
      );
      const logicalExtKey = externalDataCacheKey(logicalCacheKey, extFile.path);
      const extKey =
        storageMountId === BROWSER_STORAGE_MOUNT_ID
          ? logicalExtKey
          : getMountedModelId(storageMountId, logicalExtKey, '.data');
      externalData.push({
        path: extFile.path,
        cacheKey: extKey,
        sizeBytes: extBlob.size,
      });
      await putCachedOnnxModelBlob(extKey, extBlob);
    }
  }

  const name =
    catalogRef?.modelName ??
    variant.repoName
      .split('/')
      .pop()
      ?.replace(/[-_](ONNX|onnx)$/, '')
      .replace(/[-_]/g, ' ') ??
    GENERIC_ONNX_RECIPE.name;

  const installedModel: InstalledOnnxModel = {
    id: modelId,
    name,
    repoName: variant.repoName,
    variant: {
      ...variant,
      sizeBytes: variant.sizeBytes ?? blob.size,
      inputShape: variant.inputShape ?? undefined,
      supportedBackends: variant.supportedBackends.length
        ? variant.supportedBackends
        : GENERIC_ONNX_RECIPE.supportedBackends,
      preprocessing: variant.preprocessing ?? GENERIC_ONNX_RECIPE.preprocessing,
      postprocessing: variant.postprocessing ?? GENERIC_ONNX_RECIPE.postprocessing,
    },
    cacheKey,
    installedAt: Date.now(),
    sizeBytes: blob.size,
    externalData: externalData.length > 0 ? externalData : undefined,
    catalogRef,
    storageMountId: storageMountId === BROWSER_STORAGE_MOUNT_ID ? undefined : storageMountId,
  };

  const existingModels = (await getAllInstalledOnnxModelRecords()).filter(
    (model) => model.id === modelId,
  );
  await putCachedOnnxModelBlob(cacheKey, blob);
  await Promise.all(
    existingModels.map(async (existingModel) => {
      await Promise.all([
        deleteCachedOnnxModelBlob(existingModel.cacheKey),
        ...(existingModel.externalData ?? []).map((external) =>
          deleteCachedOnnxModelBlob(external.cacheKey),
        ),
      ]);
      await deleteInstalledOnnxModelRecord(existingModel);
    }),
  );
  await putInstalledOnnxModel(installedModel);

  cumulativeLoaded = grandTotal || blob.size;
  reportProgress({
    currentFile: undefined,
    currentFileLoaded: undefined,
    currentFileSize: undefined,
  });
  return installedModel;
};

export const updateInstalledOnnxModel = async (model: InstalledOnnxModel): Promise<void> => {
  await putInstalledOnnxModel(model);
};
