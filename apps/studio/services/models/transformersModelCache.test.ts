import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteTransformersModelCache,
  getTransformersCachedModelFile,
  getTransformersModelCacheInfo,
} from './transformersModelCache';

afterEach(() => vi.unstubAllGlobals());

describe('Transformers model cache', () => {
  it('reports and removes only files belonging to the requested model bundle', async () => {
    const samRequest = new Request(
      'https://huggingface.co/onnx-community/sam3-tracker-ONNX/resolve/main/onnx/vision_encoder_q4.onnx',
    );
    const otherRequest = new Request(
      'https://huggingface.co/onnx-community/other-model/resolve/main/onnx/model.onnx',
    );
    const deleteEntry = vi.fn(async (_request: Request) => true);
    const cache = {
      keys: vi.fn(async () => [samRequest, otherRequest]),
      match: vi.fn(async (request: Request) =>
        request === samRequest
          ? new Response(new Uint8Array([1]), { headers: { 'content-length': '400' } })
          : undefined,
      ),
      delete: deleteEntry,
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });

    await expect(
      getTransformersModelCacheInfo('onnx-community/sam3-tracker-ONNX'),
    ).resolves.toEqual({
      fileCount: 1,
      sizeBytes: 400,
      files: ['onnx/vision_encoder_q4.onnx'],
    });

    const cachedFile = await getTransformersCachedModelFile(
      'onnx-community/sam3-tracker-ONNX',
      'onnx/vision_encoder_q4.onnx',
    );
    await expect(cachedFile?.arrayBuffer()).resolves.toEqual(new Uint8Array([1]).buffer);
    await expect(
      getTransformersCachedModelFile('onnx-community/sam3-tracker-ONNX', 'onnx/missing.onnx'),
    ).resolves.toBeNull();

    await expect(deleteTransformersModelCache('onnx-community/sam3-tracker-ONNX')).resolves.toBe(1);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect((deleteEntry.mock.calls[0]?.[0] as Request).url).toBe(samRequest.url);
  });
});
