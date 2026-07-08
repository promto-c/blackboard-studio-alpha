import { writeExr } from '@bb-studio/exr';
import { beforeAll, describe, expect, it } from 'vitest';
import { colorManagementService } from '@/color-management';
import { decodeExrImage, readExrDimensions } from './exr';
import { getImportedImageColorManagement, getMediaFileKind, isImageFileLike } from './mediaFiles';

const createTestExr = (colorSpace?: string) => {
  const bytes = writeExr({
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
        ...(colorSpace
          ? { attributes: { ocioColorSpace: { type: 'string' as const, value: colorSpace } } }
          : {}),
      },
    ],
  });

  // Ensure we pass an ArrayBuffer-backed view to Blob (avoids SharedArrayBuffer issues)
  const view = new Uint8Array(bytes);
  return new Blob([view.buffer], { type: 'image/x-exr' });
};

describe('EXR helpers', () => {
  beforeAll(async () => {
    const snapshot = await colorManagementService.initialize();
    if (snapshot.error) throw new Error(snapshot.error);
  });

  it('recognises EXR blobs and assigns the native OCIO file rule', async () => {
    const exr = createTestExr();

    expect(isImageFileLike(exr, 'plate.exr')).toBe(true);
    expect(getMediaFileKind(exr, 'plate.exr')).toBe('image');
    await expect(getImportedImageColorManagement(exr, 'plate.exr')).resolves.toEqual({
      sourceColorSpace: 'ACES2065-1',
      assignmentSource: 'file_rule',
      isData: false,
      evidence: {
        automatic: {
          sourceColorSpace: 'ACES2065-1',
          assignmentSource: 'file_rule',
          isData: false,
          detail: 'OCIO file rule: EXR',
          ruleName: 'EXR',
          isDefaultRule: false,
        },
        candidates: [
          {
            sourceColorSpace: 'ACES2065-1',
            assignmentSource: 'file_rule',
            isData: false,
            detail: 'OCIO file rule: EXR',
            ruleName: 'EXR',
            isDefaultRule: false,
          },
        ],
      },
    });
  });

  it('uses config rules rather than camera-gamut filename inference', async () => {
    const exr = createTestExr();

    await expect(
      getImportedImageColorManagement(exr, 'ARRI-Wide-Gamut-4-LogC4.exr'),
    ).resolves.toMatchObject({
      sourceColorSpace: 'ACES2065-1',
      assignmentSource: 'file_rule',
    });
  });

  it('prefers validated EXR metadata over the matched file rule', async () => {
    const exr = createTestExr('ACEScg');

    await expect(getImportedImageColorManagement(exr, 'plate.exr')).resolves.toMatchObject({
      sourceColorSpace: 'ACEScg',
      assignmentSource: 'metadata',
      evidence: {
        candidates: [
          {
            sourceColorSpace: 'ACEScg',
            assignmentSource: 'metadata',
            detail: 'EXR ocioColorSpace metadata',
          },
          {
            sourceColorSpace: 'ACES2065-1',
            assignmentSource: 'file_rule',
            detail: 'OCIO file rule: EXR',
          },
        ],
      },
    });
  });

  it.each([
    ['PNG', 'image/png', 'plate.png'],
    ['JPEG', 'image/jpeg', 'plate.jpg'],
  ])('uses the native default file rule for ordinary %s imports', async (_, mimeType, fileName) => {
    const image = new Blob([], { type: mimeType });

    await expect(getImportedImageColorManagement(image, fileName)).resolves.toMatchObject({
      sourceColorSpace: 'sRGB - Display',
      assignmentSource: 'file_rule',
      isData: false,
    });
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
