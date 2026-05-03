import { writeExr } from '@bb-studio/exr';
import { describe, expect, it } from 'vitest';
import { decodeExrImage, readExrDimensions } from './exr';
import { getImportedImageColorSpace, getMediaFileKind, isImageFileLike } from './mediaFiles';

const createTestExr = () =>
  new Blob(
    [
      writeExr({
        parts: [
          {
            compression: 0,
            dataWindow: { xMin: 0, yMin: 0, xMax: 1, yMax: 0 },
            channels: [
              { name: 'R', pixelType: 2, data: new Float32Array([0.25, 1.5]) },
              { name: 'G', pixelType: 2, data: new Float32Array([0.5, 0.75]) },
              { name: 'B', pixelType: 2, data: new Float32Array([0.75, 0.25]) },
              { name: 'A', pixelType: 2, data: new Float32Array([1, 0.5]) },
            ],
          },
        ],
      }),
    ],
    { type: 'image/x-exr' },
  );

describe('EXR helpers', () => {
  it('recognises EXR blobs as linear image media', () => {
    const exr = createTestExr();

    expect(isImageFileLike(exr, 'plate.exr')).toBe(true);
    expect(getMediaFileKind(exr, 'plate.exr')).toBe('image');
    expect(getImportedImageColorSpace(exr, 'plate.exr')).toBe('Linear');
  });

  it('reads dimensions and decodes float RGBA channels', async () => {
    const exr = createTestExr();

    await expect(readExrDimensions(exr)).resolves.toEqual({ width: 2, height: 1 });

    const decoded = await decodeExrImage(exr, { cacheKey: 'unit-test-exr' });
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([0.25, 0.5, 0.75, 1, 1.5, 0.75, 0.25, 0.5]);
    expect(decoded.previewExposure).toBeGreaterThan(0);
  });
});
