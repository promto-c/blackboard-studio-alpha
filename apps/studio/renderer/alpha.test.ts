import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  configureRawStraightAlphaTexture,
  configureStraightAlphaTexture,
  destinationOutStraightAlphaPixel,
  sourceOverStraightAlphaPixel,
} from '../../../packages/renderer/src/alpha';

describe('straight alpha contract', () => {
  it('disables texture upload premultiplication explicitly', () => {
    const texture = new THREE.Texture();
    texture.premultiplyAlpha = true;

    expect(configureStraightAlphaTexture(texture)).toBe(texture);
    expect(texture.premultiplyAlpha).toBe(false);
  });

  it('configures raw straight-alpha uploads without graphics API color conversion', () => {
    const texture = new THREE.Texture();
    texture.premultiplyAlpha = true;
    texture.generateMipmaps = true;

    configureRawStraightAlphaTexture(texture, THREE.NearestFilter);

    expect(texture.colorSpace).toBe('');
    expect(texture.premultiplyAlpha).toBe(false);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.version).toBeGreaterThan(0);
  });

  it('preserves negative and HDR straight RGB during source-over', () => {
    const target = new Float32Array([-0.5, 2, 4, 0.5]);

    sourceOverStraightAlphaPixel(target, 0, 1, -1, 8, 0.5);

    expect(target[0]).toBeCloseTo(0.5);
    expect(target[1]).toBeCloseTo(0);
    expect(target[2]).toBeCloseTo(20 / 3);
    expect(target[3]).toBeCloseTo(0.75);
  });

  it('changes only coverage during destination-out', () => {
    const target = new Float32Array([-0.5, 2, 4, 1]);

    destinationOutStraightAlphaPixel(target, 0, 0.25);

    expect(Array.from(target)).toEqual([-0.5, 2, 4, 0.75]);
  });

  it('does not erase hidden straight RGB when a transparent sample is composited', () => {
    const target = new Float32Array([-0.5, 2, 4, 0]);

    sourceOverStraightAlphaPixel(target, 0, 1, 1, 1, 0);

    expect(Array.from(target)).toEqual([-0.5, 2, 4, 0]);
  });
});
