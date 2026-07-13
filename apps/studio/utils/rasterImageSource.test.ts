import { afterEach, describe, expect, it, vi } from 'vitest';
import { readExrPixelData } from '@/utils/exr';
import { decodeRasterImageSource } from './rasterImageSource';

vi.mock('@/utils/exr', () => ({
  readExrPixelData: vi.fn(),
}));

class LoadableImage {
  naturalWidth = 320;
  naturalHeight = 180;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('decodeRasterImageSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to the HTML image decoder when createImageBitmap rejects a valid image', async () => {
    const bitmapDecode = vi
      .fn()
      .mockRejectedValue(new DOMException('The source image could not be decoded.'));
    vi.stubGlobal('createImageBitmap', bitmapDecode);
    vi.stubGlobal('Image', LoadableImage);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:alignment-input');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const decoded = await decodeRasterImageSource(new Blob(['valid'], { type: 'image/png' }), {
      label: 'alignment input image',
    });

    expect(bitmapDecode).toHaveBeenCalledOnce();
    expect(decoded).toMatchObject({ width: 320, height: 180 });
    expect(decoded.source).toBeInstanceOf(LoadableImage);

    decoded.close();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:alignment-input');
  });

  it('routes EXR images through Studio decoding instead of createImageBitmap', async () => {
    const bitmapDecode = vi.fn();
    const imageData = { data: new Uint8ClampedArray(8) };
    const context = {
      createImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.stubGlobal('createImageBitmap', bitmapDecode);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    vi.mocked(readExrPixelData).mockResolvedValue({
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
      width: 2,
      height: 1,
    });

    const decoded = await decodeRasterImageSource(
      new Blob(['exr'], { type: 'application/octet-stream' }),
      { nameHint: 'generated.exr', cacheKey: 'asset:generated' },
    );

    expect(readExrPixelData).toHaveBeenCalledWith(expect.any(Blob), {
      cacheKey: 'asset:generated',
    });
    expect(bitmapDecode).not.toHaveBeenCalled();
    expect(decoded).toMatchObject({ source: canvas, width: 2, height: 1 });
    expect(imageData.data).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]));
  });
});
