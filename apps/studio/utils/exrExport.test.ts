import { readExr } from '@bb-studio/exr';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OPEN_EXR_OUTPUT_PRESETS } from '@/color-management/openExrOutputPresets';
import { encodeOpenExr, encodeRenderTargetOpenExr, readRenderTargetRgbaFloat } from './exrExport';

describe('OpenEXR export', () => {
  it('reads half-float targets without clamping and flips rows into image order', () => {
    const sourceValues = [-0.5, 2, 0.25, 1, 4, 0.5, 1.5, 0.75];
    const source = new Uint16Array(sourceValues.map((value) => THREE.DataUtils.toHalfFloat(value)));
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
    const target = new THREE.WebGLRenderTarget(1, 2, { type: THREE.HalfFloatType });

    const image = readRenderTargetRgbaFloat(renderer, target);

    expect(Array.from(image.rgba)).toEqual([4, 0.5, 1.5, 0.75, -0.5, 2, 0.25, 1]);
  });

  it.each([
    ['half', 1],
    ['float', 2],
  ] as const)('encodes %s-float RGB and alpha channels', async (precision, pixelType) => {
    const blob = await encodeOpenExr(
      {
        width: 2,
        height: 1,
        rgba: new Float32Array([-0.5, 0.25, 2, 1, 4, 0.5, 1.5, 0.75]),
      },
      { precision, includeAlpha: true },
    );
    const decoded = readExr(await blob.arrayBuffer());

    expect(blob.type).toBe('image/x-exr');
    expect(decoded.structure.parts[0]?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'R', pixelType }),
        expect.objectContaining({ name: 'G', pixelType }),
        expect.objectContaining({ name: 'B', pixelType }),
        expect.objectContaining({ name: 'A', pixelType }),
      ]),
    );
    expect(Array.from(decoded.part.channels.R.data)).toEqual(
      precision === 'half' ? [-0.5, 4] : [-0.5, 4],
    );
    expect(Array.from(decoded.part.channels.B.data)).toEqual(
      precision === 'half' ? [2, 1.5] : [2, 1.5],
    );
  });

  it.each(OPEN_EXR_OUTPUT_PRESETS)(
    'roundtrips $colorSpace pixels and color metadata',
    async (preset) => {
      const blob = await encodeOpenExr(
        {
          width: 1,
          height: 1,
          rgba: new Float32Array([-0.5, 0.18, 4, 1]),
        },
        {
          precision: preset.precision,
          includeAlpha: true,
          attributes: preset.attributes,
        },
      );
      const decoded = readExr(await blob.arrayBuffer());
      const attributes = decoded.structure.parts[0].attributes;

      expect(attributes.ocioColorSpace).toBe(preset.colorSpace);
      const expectedChromaticities = preset.attributes.chromaticities;
      expect(expectedChromaticities.type).toBe('chromaticities');
      if (expectedChromaticities.type === 'chromaticities') {
        const actualChromaticities = attributes.chromaticities as Record<string, number>;
        for (const [name, value] of Object.entries(expectedChromaticities.value)) {
          expect(actualChromaticities[name]).toBeCloseTo(value, 5);
        }
      }
      expect(Array.from(decoded.part.channels.R.data)).toEqual([-0.5]);
      expect(Array.from(decoded.part.channels.G.data)[0]).toBeCloseTo(0.18, 3);
      expect(Array.from(decoded.part.channels.B.data)).toEqual([4]);
    },
  );

  it('preserves named data channels independently at full precision', async () => {
    const depth = new Float32Array([-0.25, 65536.5]);
    const blob = await encodeOpenExr(
      {
        width: 2,
        height: 1,
        rgba: new Float32Array([-0.5, 0.25, 2, 1, 4, 0.5, 1.5, 0.75]),
        namedChannels: [{ name: 'depth.Z', data: depth }],
      },
      { precision: 'half', includeAlpha: false },
    );
    const decoded = readExr(await blob.arrayBuffer());

    expect(decoded.structure.parts[0]?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'R', pixelType: 1 }),
        expect.objectContaining({ name: 'depth.Z', pixelType: 2 }),
      ]),
    );
    expect(Array.from(decoded.part.channels['depth.Z'].data)).toEqual(Array.from(depth));
  });

  it('rejects duplicate or incorrectly sized named channels', async () => {
    const image = {
      width: 1,
      height: 1,
      rgba: new Float32Array([0, 0, 0, 1]),
    };

    await expect(
      encodeOpenExr(
        { ...image, namedChannels: [{ name: 'R', data: new Float32Array([1]) }] },
        { precision: 'half', includeAlpha: false },
      ),
    ).rejects.toThrow('channel name "R" is duplicated');
    await expect(
      encodeOpenExr(
        { ...image, namedChannels: [{ name: 'depth.Z', data: new Float32Array(2) }] },
        { precision: 'half', includeAlpha: false },
      ),
    ).rejects.toThrow('data length does not match');
  });

  it('encodes a technical render target as one named full-float channel', async () => {
    const renderer = {
      readRenderTargetPixels: vi.fn(
        (
          _target: THREE.WebGLRenderTarget,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          output: Float32Array,
        ) => output.set([-0.25, -0.25, -0.25, -0.25, 65536.5, 65536.5, 65536.5, 65536.5]),
      ),
    } as unknown as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(2, 1, { type: THREE.FloatType });
    const blob = await encodeRenderTargetOpenExr(renderer, target, {
      precision: 'float',
      includeAlpha: false,
      technicalChannelName: 'Z',
    });
    const decoded = readExr(await blob.arrayBuffer());

    expect(decoded.structure.parts[0]?.channels).toEqual([
      expect.objectContaining({ name: 'Z', pixelType: 2 }),
    ]);
    expect(Array.from(decoded.part.channels.Z.data)).toEqual([-0.25, 65536.5]);
  });

  it('combines multiple captured technical targets with the primary RGB output', async () => {
    const primary = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
    const depth = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
    const mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
    const renderer = {
      readRenderTargetPixels: vi.fn(
        (
          target: THREE.WebGLRenderTarget,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          output: Float32Array,
        ) => {
          if (target === depth) output.set([42.5, 42.5, 42.5, 42.5]);
          else if (target === mask) output.set([0.75, 0.75, 0.75, 0.75]);
          else output.set([-0.5, 0.25, 2, 1]);
        },
      ),
    } as unknown as THREE.WebGLRenderer;

    const blob = await encodeRenderTargetOpenExr(renderer, primary, {
      precision: 'half',
      includeAlpha: false,
      namedChannelTargets: [
        { name: 'Z', target: depth },
        { name: 'mask.Y', target: mask },
      ],
    });
    const decoded = readExr(await blob.arrayBuffer());

    expect(decoded.structure.parts[0]?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'R', pixelType: 1 }),
        expect.objectContaining({ name: 'Z', pixelType: 2 }),
        expect.objectContaining({ name: 'mask.Y', pixelType: 2 }),
      ]),
    );
    expect(Array.from(decoded.part.channels.Z.data)).toEqual([42.5]);
    expect(Array.from(decoded.part.channels['mask.Y'].data)).toEqual([0.75]);
  });
});
