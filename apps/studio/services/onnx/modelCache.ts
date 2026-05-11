import type {
  InstalledOnnxModel,
  OnnxModelExternalData,
  OnnxModelVariantMetadata,
} from '@blackboard/types';
import { getOnnxModelRecipe, getVariantRequiredFiles, getVariantTotalSize } from './modelRegistry';

const DB_NAME = 'BlackboardOnnxModels';
const DB_VERSION = 1;
const MODEL_STORE = 'models';
const BLOB_STORE = 'blobs';

let db: IDBDatabase | null = null;

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

export const getInstalledOnnxModels = async (): Promise<InstalledOnnxModel[]> => {
  const models = await performTransaction<InstalledOnnxModel[]>(MODEL_STORE, 'readonly', (store) =>
    store.getAll(),
  );
  return models.sort((a, b) => b.installedAt - a.installedAt);
};

export const getInstalledOnnxModel = async (id: string): Promise<InstalledOnnxModel | null> => {
  const model = await performTransaction<InstalledOnnxModel | undefined>(
    MODEL_STORE,
    'readonly',
    (store) => store.get(id),
  );
  return model ?? null;
};

export const getCachedOnnxModelBlob = async (cacheKey: string): Promise<Blob | null> => {
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
  const model = await getInstalledOnnxModel(modelId);
  if (!model) return;
  const dbInstance = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = dbInstance.transaction([MODEL_STORE, BLOB_STORE], 'readwrite');
    const blobStore = transaction.objectStore(BLOB_STORE);
    blobStore.delete(model.cacheKey);
    if (model.externalData) {
      for (const ext of model.externalData) {
        blobStore.delete(ext.cacheKey);
      }
    }
    transaction.objectStore(MODEL_STORE).delete(model.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
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
  recipeId,
  onProgress,
  signal,
}: {
  variant: OnnxModelVariantMetadata;
  recipeId: string;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<InstalledOnnxModel> => {
  const modelUrl = getOnnxDownloadUrl(variant);
  const requiredFiles = getVariantRequiredFiles(variant);
  const fileCount = requiredFiles.length;
  const grandTotal = getVariantTotalSize(variant) ?? variant.sizeBytes ?? 0;
  let cumulativeLoaded = 0;

  const reportProgress = (
    overrides?: Partial<
      Pick<DownloadProgress, 'currentFile' | 'currentFileLoaded' | 'currentFileSize' | 'fileIndex'>
    >,
  ) => {
    onProgress?.({
      loaded: cumulativeLoaded,
      total: grandTotal,
      percent: grandTotal ? Math.min(100, (cumulativeLoaded / grandTotal) * 100) : undefined,
      fileIndex: 0,
      fileCount,
      ...overrides,
    });
  };

  const onDelta = (bytes: number) => {
    cumulativeLoaded += bytes;
    reportProgress();
  };

  // Download main ONNX file
  const mainFileName = requiredFiles[0]?.path.split('/').pop() ?? variant.filePath;
  reportProgress({
    currentFile: mainFileName,
    currentFileLoaded: 0,
    currentFileSize: variant.sizeBytes,
    fileIndex: 0,
  });

  const blob = await streamDownloadAsBlob(modelUrl, onDelta, signal);
  const recipe = getOnnxModelRecipe(recipeId);
  const modelId = `${recipe.id}:${variant.repoName}:${variant.filePath}`;
  const cacheKey = `${modelId}:${Date.now()}`;

  const externalData: OnnxModelExternalData[] = [];
  if (variant.externalDataFiles?.length) {
    for (let i = 0; i < variant.externalDataFiles.length; i++) {
      const extFile = variant.externalDataFiles[i];
      const extFileName = extFile.path.split('/').pop() ?? extFile.path;
      const extUrl = getExternalDownloadUrl(variant.repoName, extFile.path);
      reportProgress({
        currentFile: extFileName,
        currentFileLoaded: 0,
        currentFileSize: extFile.size,
        fileIndex: i + 1,
      });
      const extBlob = await streamDownloadAsBlob(extUrl, onDelta, signal);
      const extKey = externalDataCacheKey(cacheKey, extFile.path);
      externalData.push({
        path: extFile.path,
        cacheKey: extKey,
        sizeBytes: extBlob.size,
      });
      const dbInstance = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = dbInstance.transaction([BLOB_STORE], 'readwrite');
        tx.objectStore(BLOB_STORE).put(extBlob, extKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  const installedModel: InstalledOnnxModel = {
    id: modelId,
    recipeId: recipe.id,
    name:
      recipe.id === 'generic'
        ? (variant.repoName
            .split('/')
            .pop()
            ?.replace(/[-_](ONNX|onnx)$/, '')
            .replace(/[-_]/g, ' ') ?? recipe.name)
        : recipe.name,
    repoName: variant.repoName,
    variant: {
      ...variant,
      sizeBytes: variant.sizeBytes ?? blob.size,
      inputShape: variant.inputShape ?? undefined,
      supportedBackends: variant.supportedBackends.length
        ? variant.supportedBackends
        : recipe.supportedBackends,
      preprocessing: variant.preprocessing ?? recipe.preprocessing,
      postprocessing: variant.postprocessing ?? recipe.postprocessing,
    },
    cacheKey,
    installedAt: Date.now(),
    sizeBytes: blob.size,
    externalData: externalData.length > 0 ? externalData : undefined,
  };

  const existingModel = await getInstalledOnnxModel(modelId);
  const dbInstance = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = dbInstance.transaction([MODEL_STORE, BLOB_STORE], 'readwrite');
    const blobStore = transaction.objectStore(BLOB_STORE);
    if (existingModel) {
      blobStore.delete(existingModel.cacheKey);
      if (existingModel.externalData) {
        for (const ext of existingModel.externalData) {
          blobStore.delete(ext.cacheKey);
        }
      }
    }
    blobStore.put(blob, cacheKey);
    transaction.objectStore(MODEL_STORE).put(installedModel);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  cumulativeLoaded = grandTotal || blob.size;
  reportProgress({
    currentFile: undefined,
    currentFileLoaded: undefined,
    currentFileSize: undefined,
  });
  return installedModel;
};

export const updateInstalledOnnxModel = async (model: InstalledOnnxModel): Promise<void> => {
  const dbInstance = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = dbInstance.transaction(MODEL_STORE, 'readwrite');
    tx.objectStore(MODEL_STORE).put(model);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};
