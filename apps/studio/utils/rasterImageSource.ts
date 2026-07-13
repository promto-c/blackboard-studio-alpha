import { FloatType } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { readExrPixelData } from '@/utils/exr';
import { getBlobName, isExrFileLike, isHdrFileLike, type MediaBlobLike } from '@/utils/mediaFiles';

export interface RasterImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

interface DecodeRasterImageSourceOptions {
  /** Used when an IndexedDB Blob no longer carries its original File name. */
  nameHint?: string;
  /** User-facing description included when every available decoder rejects the image. */
  label?: string;
  /** Stable identity for decoded formats that support caching. */
  cacheKey?: string;
}

const createPixelCanvas = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create an image decoding canvas.');

  const imageData = context.createImageData(width, height);
  imageData.data.set(data);
  context.putImageData(imageData, 0, 0);
  return canvas;
};

const toneMapLinear = (value: number, exposure: number): number => {
  const scaled = Math.max(0, value * exposure);
  return scaled / (1 + scaled);
};

const linearToSrgb = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
};

const getPreviewExposure = (rgba: Float32Array): number => {
  const pixelCount = Math.max(1, Math.floor(rgba.length / 4));
  const step = Math.max(1, Math.floor(pixelCount / 4096));
  const peaks: number[] = [];

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += step) {
    const offset = pixelIndex * 4;
    const peak = Math.max(0, rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    peaks.push(Number.isFinite(peak) ? peak : 0);
  }

  peaks.sort((left, right) => left - right);
  const peak = peaks[Math.floor((peaks.length - 1) * 0.95)] ?? 1;
  return peak > 1 ? 1 / peak : 1;
};

const convertLinearRgbaToDisplayPixels = (rgba: Float32Array): Uint8ClampedArray => {
  const exposure = getPreviewExposure(rgba);
  const result = new Uint8ClampedArray(rgba.length);

  for (let offset = 0; offset < rgba.length; offset += 4) {
    result[offset] = Math.round(linearToSrgb(toneMapLinear(rgba[offset], exposure)) * 255);
    result[offset + 1] = Math.round(linearToSrgb(toneMapLinear(rgba[offset + 1], exposure)) * 255);
    result[offset + 2] = Math.round(linearToSrgb(toneMapLinear(rgba[offset + 2], exposure)) * 255);
    result[offset + 3] = Math.round(Math.max(0, Math.min(1, rgba[offset + 3])) * 255);
  }

  return result;
};

const decodeHighDynamicRangeSource = async (
  blob: MediaBlobLike,
  options: DecodeRasterImageSourceOptions,
): Promise<RasterImageSource | null> => {
  const storedName = getBlobName(blob);
  const isExr =
    isExrFileLike(blob, options.nameHint) ||
    (storedName !== options.nameHint && isExrFileLike(blob, storedName));
  const isHdr =
    isHdrFileLike(blob, options.nameHint) ||
    (storedName !== options.nameHint && isHdrFileLike(blob, storedName));

  if (isExr) {
    const decoded = await readExrPixelData(blob, { cacheKey: options.cacheKey });
    const canvas = createPixelCanvas(decoded.data, decoded.width, decoded.height);
    return {
      source: canvas,
      width: decoded.width,
      height: decoded.height,
      close: () => {},
    };
  }

  if (isHdr) {
    const decoded = new HDRLoader().setDataType(FloatType).parse(await blob.arrayBuffer());
    const data = decoded.data as Float32Array;
    const canvas = createPixelCanvas(
      convertLinearRgbaToDisplayPixels(data),
      decoded.width,
      decoded.height,
    );
    return {
      source: canvas,
      width: decoded.width,
      height: decoded.height,
      close: () => {},
    };
  }

  return null;
};

const decodeWithImageElement = (blob: Blob): Promise<RasterImageSource> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    let settled = false;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(objectUrl);
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: release,
      });
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      release();
      reject(new Error('The HTML image decoder rejected the source.'));
    };
    image.src = objectUrl;
  });

/**
 * Decodes a Studio still-image Blob into a canvas-compatible source.
 *
 * Browser and desktop webviews do not support the same formats through
 * `createImageBitmap` and `<img>`. Try both for ordinary images, while routing
 * EXR and Radiance HDR through Studio's explicit decoders.
 */
export const decodeRasterImageSource = async (
  blob: Blob,
  options: DecodeRasterImageSourceOptions = {},
): Promise<RasterImageSource> => {
  const assetBlob = blob as MediaBlobLike;
  const highDynamicRangeSource = await decodeHighDynamicRangeSource(assetBlob, options);
  if (highDynamicRangeSource) return highDynamicRangeSource;

  let bitmapError: unknown;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch (error) {
      bitmapError = error;
    }
  }

  try {
    return await decodeWithImageElement(blob);
  } catch (imageError) {
    const label = options.label?.trim() || 'image';
    throw new Error(`Could not decode the ${label}.`, {
      cause: imageError ?? bitmapError,
    });
  }
};
