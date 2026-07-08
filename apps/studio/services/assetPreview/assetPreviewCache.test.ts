import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetPreviewCache } from './assetPreviewCache';
import type { AssetPreviewResult } from './types';

const result = (key: string): AssetPreviewResult => ({
  url: `blob:${key}`,
  strategy: 'color-managed-render',
  cacheKey: key,
});

describe('AssetPreviewCache', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  it('shares pending work and keeps it alive while another consumer remains', async () => {
    const cache = new AssetPreviewCache();
    const load = vi.fn(async () => result('same'));
    const firstController = new AbortController();
    const first = cache.acquire('same', load, firstController.signal);
    const second = cache.acquire('same', load);
    firstController.abort();

    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second.promise).resolves.toEqual(result('same'));
    expect(load).toHaveBeenCalledOnce();
    second.release();
  });

  it('removes failed loads so a later request can retry', async () => {
    const cache = new AssetPreviewCache();
    const load = vi
      .fn<(signal: AbortSignal) => Promise<AssetPreviewResult>>()
      .mockRejectedValueOnce(new Error('decode failed'))
      .mockResolvedValueOnce(result('retry'));
    const first = cache.acquire('retry', load);
    await expect(first.promise).rejects.toThrow('decode failed');
    first.release();
    const second = cache.acquire('retry', load);
    await expect(second.promise).resolves.toEqual(result('retry'));
    expect(load).toHaveBeenCalledTimes(2);
    second.release();
  });

  it('enforces its LRU limit and revokes only inactive managed URLs', async () => {
    const cache = new AssetPreviewCache(2);
    const first = cache.acquire('one', async () => result('one'));
    await first.promise;
    first.release();
    const second = cache.acquire('two', async () => result('two'));
    await second.promise;
    second.release();
    const third = cache.acquire('three', async () => result('three'));
    await third.promise;
    third.release();

    expect(cache.size).toBe(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one');
  });
});
