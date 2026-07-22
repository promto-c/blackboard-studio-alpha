export interface TransformersModelCacheInfo {
  fileCount: number;
  sizeBytes: number;
  files: string[];
}

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

const matchesModel = (url: string, modelId: string): boolean => {
  const encodedModelPath = `/${modelId}/resolve/`;
  return url.includes(encodedModelPath);
};

const getCachedFilePath = (url: string, modelId: string): string => {
  const marker = `/${modelId}/resolve/`;
  return decodeURIComponent(url.split(marker)[1]?.replace(/^main\//, '') ?? '');
};

export const getTransformersCachedModelFile = async (
  modelId: string,
  filePath: string,
): Promise<Blob | null> => {
  if (typeof caches === 'undefined') return null;
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const request = (await cache.keys()).find(
    (candidate) =>
      matchesModel(candidate.url, modelId) &&
      getCachedFilePath(candidate.url, modelId) === filePath,
  );
  if (!request) return null;
  const response = await cache.match(request);
  return response ? response.blob() : null;
};

export const getTransformersModelCacheInfo = async (
  modelId: string,
): Promise<TransformersModelCacheInfo> => {
  if (typeof caches === 'undefined') return { fileCount: 0, sizeBytes: 0, files: [] };
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const requests = (await cache.keys()).filter((request) => matchesModel(request.url, modelId));
  let sizeBytes = 0;
  const files: string[] = [];

  for (const request of requests) {
    const response = await cache.match(request);
    const contentLength = Number(response?.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 0) {
      sizeBytes += contentLength;
    } else if (response) {
      sizeBytes += (await response.clone().blob()).size;
    }
    files.push(getCachedFilePath(request.url, modelId));
  }

  return { fileCount: requests.length, sizeBytes, files };
};

export const deleteTransformersModelCache = async (modelId: string): Promise<number> => {
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const requests = (await cache.keys()).filter((request) => matchesModel(request.url, modelId));
  const deleted = await Promise.all(requests.map((request) => cache.delete(request)));
  return deleted.filter(Boolean).length;
};
