import { describe, expect, it } from 'vitest';
import { ComfyInputUploadCache, getComfyInputBlobFingerprint } from './comfyInputUploadCache';

describe('ComfyInputUploadCache', () => {
  it('creates stable fingerprints for identical blob content', async () => {
    const a = await getComfyInputBlobFingerprint(new Blob(['same pixels'], { type: 'image/png' }));
    const b = await getComfyInputBlobFingerprint(new Blob(['same pixels'], { type: 'image/png' }));
    const c = await getComfyInputBlobFingerprint(
      new Blob(['different pixels'], { type: 'image/png' }),
    );

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('reuses entries by normalized endpoint and fingerprint', () => {
    const cache = new ComfyInputUploadCache();
    cache.set({
      endpoint: 'http://127.0.0.1:8188/',
      fingerprint: 'image/png:4:abcd',
      imageName: 'blackboard/input.png',
      uploadedAt: 1,
    });

    expect(cache.get('http://127.0.0.1:8188', 'image/png:4:abcd')?.imageName).toBe(
      'blackboard/input.png',
    );
    expect(cache.get('http://127.0.0.1:8189', 'image/png:4:abcd')).toBeNull();
  });

  it('evicts least recently used entries', () => {
    const cache = new ComfyInputUploadCache({ maxEntries: 1 });
    cache.set({
      endpoint: 'http://127.0.0.1:8188',
      fingerprint: 'image/png:4:first',
      imageName: 'blackboard/first.png',
      uploadedAt: 1,
    });
    cache.set({
      endpoint: 'http://127.0.0.1:8188',
      fingerprint: 'image/png:4:second',
      imageName: 'blackboard/second.png',
      uploadedAt: 2,
    });

    expect(cache.get('http://127.0.0.1:8188', 'image/png:4:first')).toBeNull();
    expect(cache.get('http://127.0.0.1:8188', 'image/png:4:second')?.imageName).toBe(
      'blackboard/second.png',
    );
  });

  it('deletes stale cached entries by returned Comfy image name', () => {
    const cache = new ComfyInputUploadCache();
    cache.set({
      endpoint: 'http://127.0.0.1:8188/',
      fingerprint: 'image/png:4:first',
      imageName: 'blackboard/first.png',
      uploadedAt: 1,
    });
    cache.set({
      endpoint: 'http://127.0.0.1:8188/',
      fingerprint: 'image/png:4:second',
      imageName: 'blackboard/second.png',
      uploadedAt: 2,
    });

    cache.deleteByImageName('http://127.0.0.1:8188', 'blackboard/first.png');

    expect(cache.get('http://127.0.0.1:8188', 'image/png:4:first')).toBeNull();
    expect(cache.get('http://127.0.0.1:8188', 'image/png:4:second')?.imageName).toBe(
      'blackboard/second.png',
    );
  });
});
