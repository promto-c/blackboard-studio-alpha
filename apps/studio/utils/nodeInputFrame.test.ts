import { describe, expect, it } from 'vitest';
import { clampPixelRect, cropFloatInputToPngBlob } from './nodeInputFrame';

const readPngSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  const view = new DataView(await blob.arrayBuffer());
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
};

describe('node input frame crops', () => {
  it('clamps region rects to pixel bounds', () => {
    expect(
      clampPixelRect({ x: 1.2, y: 2.4, width: 4.2, height: 3.1 }, { width: 10, height: 8 }),
    ).toEqual({
      x: 1,
      y: 2,
      width: 5,
      height: 4,
    });
    expect(clampPixelRect({ x: 12, y: 1, width: 4, height: 4 }, { width: 10, height: 8 })).toBe(
      null,
    );
  });

  it('encodes only the selected region from a rendered RGBA frame', async () => {
    const blob = await cropFloatInputToPngBlob(
      {
        width: 4,
        height: 3,
        channels: 4,
        data: new Float32Array(4 * 3 * 4).fill(1),
      },
      { x: 1, y: 1, width: 2, height: 1 },
    );

    await expect(readPngSize(blob)).resolves.toEqual({ width: 2, height: 1 });
  });

  it('pads the output with transparent pixels when region extends beyond bounds (outpainting)', async () => {
    // 4x3 scene with RGBA data all set to 0.5 (mid-gray, fully opaque)
    const channels = 4;
    const data = new Float32Array(4 * 3 * channels);
    for (let i = 0; i < data.length; i += channels) {
      data[i] = 0.5; // R
      data[i + 1] = 0.5; // G
      data[i + 2] = 0.5; // B
      data[i + 3] = 1.0; // A
    }

    const input = { width: 4, height: 3, channels, data };

    // Region that starts at x=-1, y=-1, with size 6x5 — extends beyond bounds
    const blob = await cropFloatInputToPngBlob(input, { x: -1, y: -1, width: 6, height: 5 });

    await expect(readPngSize(blob)).resolves.toEqual({ width: 6, height: 5 });
  });

  it('returns a zeroed buffer when the region is entirely outside the frame', async () => {
    const blob = await cropFloatInputToPngBlob(
      {
        width: 4,
        height: 3,
        channels: 4,
        data: new Float32Array(4 * 3 * 4).fill(1),
      },
      { x: -10, y: -10, width: 2, height: 2 },
    );

    // Should not throw — returns a transparent 2x2 image
    await expect(readPngSize(blob)).resolves.toEqual({ width: 2, height: 2 });
  });
});
