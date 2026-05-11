import type {
  InstalledOnnxModel,
  OnnxBackend,
  OnnxInputMetadata,
  OnnxOutputMetadata,
} from '@blackboard/types';
import { readOnnxMetadataFromBlobProgressively } from './onnxMetadataParser';
import { getCachedOnnxModelBlob, updateInstalledOnnxModel } from './modelCache';
import { createOnnxSession, readInputMetadata, readOutputMetadata } from './onnxRuntime';
import type { OnnxIoMetadata } from './onnxRuntime';

const ioMetadataCache = new Map<string, Promise<OnnxIoMetadata>>();

const resolvedInputMetadata = new Map<string, OnnxInputMetadata[]>();
const resolvedOutputMetadata = new Map<string, OnnxOutputMetadata[]>();

function metadataCacheKey(model: InstalledOnnxModel, backend: OnnxBackend): string {
  return `${model.id}:${model.cacheKey}:${backend}`;
}

export function getCachedOnnxModelInputMetadata(
  model: InstalledOnnxModel,
): OnnxInputMetadata[] | null {
  if (model.variant.inputMetadata) {
    resolvedInputMetadata.set(model.id, model.variant.inputMetadata);
    return model.variant.inputMetadata;
  }

  return null;
}

export function getCachedOnnxModelOutputMetadata(
  model: InstalledOnnxModel,
): OnnxOutputMetadata[] | null {
  if (model.variant.outputMetadata) {
    resolvedOutputMetadata.set(model.id, model.variant.outputMetadata);
    return model.variant.outputMetadata;
  }

  return null;
}

export function getOnnxModelMetadataError(model: InstalledOnnxModel): string | null {
  return model.variant.metadataError ?? null;
}

export async function loadOnnxModelMetadataCached(
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxInputMetadata[]> {
  const persisted = getCachedOnnxModelInputMetadata(model);

  if (persisted) {
    return persisted;
  }

  const persistedError = getOnnxModelMetadataError(model);

  if (persistedError) {
    throw new Error(persistedError);
  }

  const metadata = await loadOnnxModelIoMetadataCached(model, backend);
  return metadata.inputs;
}

export async function loadOnnxModelOutputMetadataCached(
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxOutputMetadata[]> {
  const persisted = getCachedOnnxModelOutputMetadata(model);

  if (persisted) {
    return persisted;
  }

  const persistedError = getOnnxModelMetadataError(model);

  if (persistedError) {
    throw new Error(persistedError);
  }

  const metadata = await loadOnnxModelIoMetadataCached(model, backend);
  return metadata.outputs;
}

export function clearOnnxModelMetadataCache(modelId?: string): void {
  if (modelId) {
    const prefix = `${modelId}:`;

    for (const key of ioMetadataCache.keys()) {
      if (key.startsWith(prefix)) {
        ioMetadataCache.delete(key);
      }
    }

    resolvedInputMetadata.delete(modelId);
    resolvedOutputMetadata.delete(modelId);
    return;
  }

  ioMetadataCache.clear();
  resolvedInputMetadata.clear();
  resolvedOutputMetadata.clear();
}

export function getResolvedInputMetadata(modelId: string): OnnxInputMetadata[] | null {
  return resolvedInputMetadata.get(modelId) ?? null;
}

export function getResolvedOutputMetadata(modelId: string): OnnxOutputMetadata[] | null {
  return resolvedOutputMetadata.get(modelId) ?? null;
}

export function primeMetadataFromModel(model: InstalledOnnxModel): void {
  if (model.variant.inputMetadata) {
    resolvedInputMetadata.set(model.id, model.variant.inputMetadata);
  }

  if (model.variant.outputMetadata) {
    resolvedOutputMetadata.set(model.id, model.variant.outputMetadata);
  }
}

const readOnnxMetadataFromSession = async (
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxIoMetadata> => {
  const session = await createOnnxSession(model, backend);

  try {
    return {
      inputs: readInputMetadata(session),
      outputs: readOutputMetadata(session),
    };
  } finally {
    await session.release?.();
  }
};

export async function loadOnnxModelIoMetadata(
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxIoMetadata> {
  const modelBlob = await getCachedOnnxModelBlob(model.cacheKey);

  if (modelBlob) {
    const parsed = await readOnnxMetadataFromBlobProgressively(modelBlob);

    if (parsed && parsed.inputs.length > 0) {
      return parsed;
    }
  }

  return readOnnxMetadataFromSession(model, backend);
}

export async function loadOnnxModelIoMetadataCached(
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxIoMetadata> {
  const persistedInput = getCachedOnnxModelInputMetadata(model);
  const persistedOutput = getCachedOnnxModelOutputMetadata(model);

  if (persistedInput && persistedOutput) {
    return {
      inputs: persistedInput,
      outputs: persistedOutput,
    };
  }

  const persistedError = getOnnxModelMetadataError(model);

  if (persistedError) {
    throw new Error(persistedError);
  }

  const key = metadataCacheKey(model, backend);
  const inFlight = ioMetadataCache.get(key);

  if (inFlight) {
    return inFlight;
  }

  const promise = loadOnnxModelIoMetadata(model, backend)
    .then((metadata) => {
      if (metadata.inputs.length > 0) {
        model.variant.inputMetadata = metadata.inputs;
        resolvedInputMetadata.set(model.id, metadata.inputs);
      }

      if (metadata.outputs.length > 0) {
        model.variant.outputMetadata = metadata.outputs;
        resolvedOutputMetadata.set(model.id, metadata.outputs);
      }

      model.variant.metadataError = undefined;
      updateInstalledOnnxModel(model).catch(() => {});

      return metadata;
    })
    .catch((err) => {
      ioMetadataCache.delete(key);

      const message = err instanceof Error ? err.message : 'Failed to load model metadata';
      model.variant.metadataError = message;
      updateInstalledOnnxModel(model).catch(() => {});

      throw err;
    });

  ioMetadataCache.set(key, promise);
  return promise;
}

export async function loadOnnxModelMetadata(
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxInputMetadata[]> {
  const metadata = await loadOnnxModelIoMetadata(model, backend);
  return metadata.inputs;
}

export async function loadOnnxModelOutputMetadata(
  model: InstalledOnnxModel,
  backend: OnnxBackend,
): Promise<OnnxOutputMetadata[]> {
  const metadata = await loadOnnxModelIoMetadata(model, backend);
  return metadata.outputs;
}
