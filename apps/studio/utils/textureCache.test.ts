import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TextureCache } from './textureCache';

const createTexture = () => {
  const texture = new THREE.Texture();
  (texture as THREE.Texture & { image: { width: number; height: number } }).image = {
    width: 8,
    height: 8,
  };
  return texture;
};

describe('TextureCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evicts the oldest frame entries first when frame budget is exceeded', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });

    const cache = new TextureCache(2048, 2);
    cache.add('base', createTexture());
    cache.add('frame-1', createTexture(), undefined, undefined, 1);
    cache.add('frame-2', createTexture(), undefined, undefined, 2);

    cache.get('frame-1');
    cache.add('frame-3', createTexture(), undefined, undefined, 3);

    expect(cache.has('base')).toBe(true);
    expect(cache.has('frame-1')).toBe(true);
    expect(cache.has('frame-2')).toBe(false);
    expect(cache.has('frame-3')).toBe(true);
  });

  it('re-applies frame eviction when the frame limit is lowered', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });

    const cache = new TextureCache(2048, 3);
    cache.add('frame-1', createTexture(), undefined, undefined, 1);
    cache.add('frame-2', createTexture(), undefined, undefined, 2);
    cache.add('frame-3', createTexture(), undefined, undefined, 3);

    cache.get('frame-3');
    cache.setFrameLimit(1);

    expect(cache.has('frame-1')).toBe(false);
    expect(cache.has('frame-2')).toBe(false);
    expect(cache.has('frame-3')).toBe(true);
  });
});
