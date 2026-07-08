import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createCloneAlphaPixels,
  createOpaqueCloneRgbPixels,
  readStraightAlphaRenderTargetRgba,
} from './paintFloatReadback';

describe('paint float readback', () => {
  it('preserves negative and HDR full-float samples while flipping rows', () => {
    const source = new Float32Array([-0.5, 2, 0.25, 1, 4, 0.5, 1.5, 0.75]);
    const renderer = {
      readRenderTargetPixels: vi.fn(
        (
          _target: THREE.WebGLRenderTarget,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          output: Float32Array,
        ) => output.set(source),
      ),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(1, 2, { type: THREE.FloatType });

    expect(Array.from(readStraightAlphaRenderTargetRgba(renderer, target))).toEqual([
      4, 0.5, 1.5, 0.75, -0.5, 2, 0.25, 1,
    ]);
  });

  it('decodes half-float samples without unit-range clamping', () => {
    const values = [-2, 0.25, 8, 1];
    const source = new Uint16Array(values.map((value) => THREE.DataUtils.toHalfFloat(value)));
    const renderer = {
      readRenderTargetPixels: vi.fn(
        (
          _target: THREE.WebGLRenderTarget,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          output: Uint16Array,
        ) => output.set(source),
      ),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });

    expect(Array.from(readStraightAlphaRenderTargetRgba(renderer, target))).toEqual(values);
  });

  it('rejects byte render targets instead of quantizing clone samples', () => {
    const renderer = {
      readRenderTargetPixels: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });

    expect(() => readStraightAlphaRenderTargetRgba(renderer, target)).toThrow(
      'Internal render-target readback requires floating-point RGBA data.',
    );
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();
  });

  it('makes RGB clone coverage independent from transparent upstream alpha', () => {
    const source = new Float32Array([-0.5, 2, 4, 0, 0.25, 0.5, 1.5, 0.75]);

    expect(Array.from(createOpaqueCloneRgbPixels(source))).toEqual([
      -0.5, 2, 4, 1, 0.25, 0.5, 1.5, 1,
    ]);
    expect(Array.from(source)).toEqual([-0.5, 2, 4, 0, 0.25, 0.5, 1.5, 0.75]);
  });

  it('encodes clone alpha as opaque float grayscale data', () => {
    const source = new Float32Array([-0.5, 2, 4, 0, 0.25, 0.5, 1.5, 0.75]);

    expect(Array.from(createCloneAlphaPixels(source))).toEqual([0, 0, 0, 1, 0.75, 0.75, 0.75, 1]);
  });

  it('rejects incomplete clone source pixels', () => {
    expect(() => createOpaqueCloneRgbPixels(new Float32Array([1, 2, 3]))).toThrow(
      'Clone source pixels must contain complete RGBA samples.',
    );
  });
});
