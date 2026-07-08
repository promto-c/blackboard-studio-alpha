import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  readRenderTargetPixelRgbaFloat,
  readRenderTargetRgbaFloat,
} from '../../../packages/renderer/src/readback';

describe('floating render-target readback', () => {
  it('preserves negative, HDR, and alpha values while flipping image rows', () => {
    const source = new Float32Array([-2, 0.25, 8, 0.5, 1, 2, 3, 0]);
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

    expect(Array.from(readRenderTargetRgbaFloat(renderer, target))).toEqual([
      1, 2, 3, 0, -2, 0.25, 8, 0.5,
    ]);
  });

  it('decodes half-float pixel inspection without clamping', () => {
    const values = [-1, 0.5, 4, 0.25];
    const encoded = new Uint16Array(values.map(THREE.DataUtils.toHalfFloat));
    const renderer = {
      readRenderTargetPixels: vi.fn(
        (
          _target: THREE.WebGLRenderTarget,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          output: Uint16Array,
        ) => output.set(encoded),
      ),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });

    expect(readRenderTargetPixelRgbaFloat(renderer, target, 0, 0)).toEqual(values);
  });

  it('rejects byte targets at internal readback boundaries', () => {
    const renderer = {
      readRenderTargetPixels: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(1, 1);

    expect(() => readRenderTargetRgbaFloat(renderer, target)).toThrow(
      'Internal render-target readback requires floating-point RGBA data.',
    );
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();
  });

  it('temporarily unbinds an external pixel-pack buffer for CPU readback', () => {
    const pixelPackBuffer = {} as WebGLBuffer;
    const gl = {
      PIXEL_PACK_BUFFER: 0x88eb,
      PIXEL_PACK_BUFFER_BINDING: 0x88ed,
      getParameter: vi.fn(() => pixelPackBuffer),
      bindBuffer: vi.fn(),
    };
    const renderer = {
      getContext: vi.fn(() => gl),
      readRenderTargetPixels: vi.fn(
        (
          _target: THREE.WebGLRenderTarget,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          output: Float32Array,
        ) => output.set([0.1, 0.2, 0.3, 0.4]),
      ),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });

    const result = readRenderTargetPixelRgbaFloat(renderer, target, 0, 0);

    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.3);
    expect(result[3]).toBeCloseTo(0.4);
    expect(gl.bindBuffer.mock.calls).toEqual([
      [gl.PIXEL_PACK_BUFFER, null],
      [gl.PIXEL_PACK_BUFFER, pixelPackBuffer],
    ]);
  });
});
