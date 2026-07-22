import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalogReference, OnnxModelVariantMetadata } from '@blackboard/types';
import {
  BROWSER_STORAGE_MOUNT_ID,
  registerStorageMount,
  setDefaultStorageMountId,
  type StorageMountAdapter,
} from '@blackboard/project-store';
import {
  deleteInstalledOnnxModel,
  downloadAndCacheOnnxModel,
  getCachedOnnxExternalDataBlobs,
  getCachedOnnxModelBlob,
  getInstalledOnnxModels,
} from './modelCache';

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.unstubAllGlobals();
  setDefaultStorageMountId('models', BROWSER_STORAGE_MOUNT_ID);
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

const createMemoryAdapter = () => {
  const files = new Map<string, Blob>();
  const adapter: StorageMountAdapter = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, value) => {
      files.set(path, value);
    },
    delete: async (path) => {
      files.delete(path);
    },
    list: async (prefix = '') =>
      Array.from(files, ([path, value]) => ({ path, size: value.size })).filter((file) =>
        file.path.startsWith(prefix),
      ),
  };
  return { adapter, files };
};

describe('mounted ONNX model cache', () => {
  it('stores, discovers, reads, and deletes model graphs and external data on a mount', async () => {
    const { adapter, files } = createMemoryAdapter();
    cleanups.push(
      registerStorageMount(
        {
          id: 'onnx-models',
          name: 'ONNX models',
          kind: 'custom',
          resources: ['models'],
          readOnly: false,
        },
        adapter,
      ),
    );
    setDefaultStorageMountId('models', 'onnx-models');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('.data')
          ? new Response(new Uint8Array([4, 5, 6]))
          : new Response(new Uint8Array([1, 2, 3])),
      ),
    );

    const variant: OnnxModelVariantMetadata = {
      id: 'model-variant',
      repoName: 'example/model-onnx',
      filePath: 'model.onnx',
      label: 'Model',
      sizeBytes: 3,
      supportedBackends: ['wasm'],
      externalDataFiles: [{ path: 'weights.data', size: 3 }],
    };
    const catalogRef: ModelCatalogReference = {
      modelId: 'builtin:model',
      modelName: 'Built-in Model',
      origin: 'builtin',
      runtime: 'onnxruntime',
      targetId: 'encoder',
      targetLabel: 'Encoder',
    };
    const installed = await downloadAndCacheOnnxModel({ variant, catalogRef });

    expect(installed.storageMountId).toBe('onnx-models');
    expect(installed.name).toBe('Built-in Model');
    expect(installed.catalogRef).toEqual(catalogRef);
    expect(installed.cacheKey).toMatch(/^mount:\/\/onnx-models\//);
    expect(
      new Uint8Array(await (await getCachedOnnxModelBlob(installed.cacheKey))!.arrayBuffer()),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(await getCachedOnnxExternalDataBlobs(installed)).toEqual([
      { path: 'weights.data', data: new Uint8Array([4, 5, 6]).buffer },
    ]);
    expect(await getInstalledOnnxModels()).toEqual([
      expect.objectContaining({ id: installed.id, storageMountId: 'onnx-models' }),
    ]);
    expect(Array.from(files.keys())).toEqual(
      expect.arrayContaining([
        '.blackboard-studio/models/models.json',
        expect.stringContaining('.blackboard-studio/models/blobs/'),
      ]),
    );

    await deleteInstalledOnnxModel(installed.id);
    expect(await getInstalledOnnxModels()).toEqual([]);
    expect(Array.from(files.keys())).toEqual(['.blackboard-studio/models/models.json']);
  });
});
