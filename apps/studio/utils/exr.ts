import * as THREE from 'three';
import type { DecodedPart, ExrPart, ExrStructure } from '@bb-studio/exr';

type ExrCoreModule = typeof import('@bb-studio/exr');
type ExrBrowserModule = typeof import('@bb-studio/exr/browser');

type BlobLike = Blob & Partial<Pick<File, 'lastModified' | 'name'>>;

export interface DecodedExrImage {
  width: number;
  height: number;
  rgba: Float32Array;
  previewExposure: number;
}

const DECODED_EXR_CACHE_LIMIT = 8;

let exrModulesPromise: Promise<{
  core: ExrCoreModule;
  browser: ExrBrowserModule;
}> | null = null;

const decodedExrCache = new Map<string, Promise<DecodedExrImage>>();

const loadExrModules = async () => {
  if (!exrModulesPromise) {
    exrModulesPromise = Promise.all([
      import('@bb-studio/exr'),
      import('@bb-studio/exr/browser'),
    ]).then(([core, browser]) => ({ core, browser }));
  }
  return exrModulesPromise;
};

const buildFallbackCacheKey = (blob: BlobLike): string =>
  [blob.name || 'blob', blob.size, blob.type, blob.lastModified || 'na'].join(':');

const touchDecodedCache = (cacheKey: string, entry: Promise<DecodedExrImage>) => {
  if (decodedExrCache.has(cacheKey)) {
    decodedExrCache.delete(cacheKey);
  }
  decodedExrCache.set(cacheKey, entry);
  while (decodedExrCache.size > DECODED_EXR_CACHE_LIMIT) {
    const oldestKey = decodedExrCache.keys().next().value;
    if (!oldestKey) break;
    decodedExrCache.delete(oldestKey);
  }
};

const getFirstDecodablePart = (structure: ExrStructure): ExrPart => {
  const part = structure.parts.find((candidate) => candidate.dataWindow);
  if (!part?.dataWindow) {
    throw new Error('EXR file does not contain a decodable scanline part.');
  }
  return part;
};

const getPartDimensions = (part: ExrPart): { width: number; height: number } => {
  if (!part.dataWindow) {
    throw new Error('EXR part is missing a data window.');
  }
  return {
    width: part.dataWindow.xMax - part.dataWindow.xMin + 1,
    height: part.dataWindow.yMax - part.dataWindow.yMin + 1,
  };
};

const normalizeChannelName = (name: string): string => name.split('.').pop()?.toUpperCase() || '';

const pickExpandedChannel = (
  channels: Record<string, Float32Array>,
  aliases: string[],
): Float32Array | null => {
  const exact = aliases.find((alias) => channels[alias]);
  if (exact) return channels[exact];

  const normalizedAliases = new Set(aliases.map((alias) => alias.toUpperCase()));
  for (const [name, channel] of Object.entries(channels)) {
    if (normalizedAliases.has(normalizeChannelName(name))) {
      return channel;
    }
  }

  return null;
};

const toneMapLinear = (value: number, exposure: number): number => {
  const scaled = Math.max(0, value * exposure);
  return scaled / (1 + scaled);
};

const linearToSrgb = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
};

const computePreviewExposure = (rgba: Float32Array): number => {
  const pixelCount = Math.max(1, Math.floor(rgba.length / 4));
  const step = Math.max(1, Math.floor(pixelCount / 4096));
  const samples: number[] = [];

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += step) {
    const offset = pixelIndex * 4;
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const peak = Math.max(0, r, g, b);
    samples.push(Number.isFinite(peak) ? peak : 0);
  }

  if (samples.length === 0) return 1;

  samples.sort((left, right) => left - right);
  const percentileIndex = Math.floor((samples.length - 1) * 0.95);
  const percentileValue = samples[percentileIndex] || samples[samples.length - 1] || 1;
  return percentileValue > 1 ? 1 / percentileValue : 1;
};

const createDisplayPixelBuffer = (
  decoded: DecodedExrImage,
  width = decoded.width,
  height = decoded.height,
): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(decoded.height - 1, Math.floor((y / height) * decoded.height));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(decoded.width - 1, Math.floor((x / width) * decoded.width));
      const srcOffset = (srcY * decoded.width + srcX) * 4;
      const dstOffset = (y * width + x) * 4;

      const r = linearToSrgb(toneMapLinear(decoded.rgba[srcOffset], decoded.previewExposure));
      const g = linearToSrgb(toneMapLinear(decoded.rgba[srcOffset + 1], decoded.previewExposure));
      const b = linearToSrgb(toneMapLinear(decoded.rgba[srcOffset + 2], decoded.previewExposure));
      const a = Math.max(0, Math.min(1, decoded.rgba[srcOffset + 3]));

      output[dstOffset] = Math.round(r * 255);
      output[dstOffset + 1] = Math.round(g * 255);
      output[dstOffset + 2] = Math.round(b * 255);
      output[dstOffset + 3] = Math.round(a * 255);
    }
  }

  return output;
};

const expandDecodedChannels = async (
  core: ExrCoreModule,
  browser: ExrBrowserModule,
  buffer: ArrayBuffer,
  structure: ExrStructure,
  part: ExrPart,
): Promise<DecodedPart> => {
  try {
    if (typeof Worker !== 'undefined') {
      return await browser.decodeExrPartWithWorkers(buffer, structure, { partId: part.id });
    }
  } catch (error) {
    console.warn('Falling back to single-threaded EXR decode.', error);
  }

  return core.decodeExrPart(buffer, structure, { partId: part.id });
};

const decodeExrBuffer = async (blob: BlobLike): Promise<DecodedExrImage> => {
  const { core, browser } = await loadExrModules();
  const buffer = await blob.arrayBuffer();
  const structure = core.parseExr(buffer);
  const part = getFirstDecodablePart(structure);
  const decoded = await expandDecodedChannels(core, browser, buffer, structure, part);
  const expandedChannels = browser.expandDecodedPartChannels(decoded, part.dataWindow!);

  const fallback =
    Object.values(expandedChannels)[0] || new Float32Array(decoded.width * decoded.height);
  const red = pickExpandedChannel(expandedChannels, ['R', 'RED']) || fallback;
  const green =
    pickExpandedChannel(expandedChannels, ['G', 'GREEN']) ||
    pickExpandedChannel(expandedChannels, ['Y', 'LUMA', 'LUMINANCE']) ||
    red;
  const blue =
    pickExpandedChannel(expandedChannels, ['B', 'BLUE']) ||
    pickExpandedChannel(expandedChannels, ['Y', 'LUMA', 'LUMINANCE']) ||
    red;
  const alpha = pickExpandedChannel(expandedChannels, ['A', 'ALPHA']);

  const pixelCount = decoded.width * decoded.height;
  const rgba = new Float32Array(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    rgba[offset] = Number.isFinite(red[index]) ? red[index] : 0;
    rgba[offset + 1] = Number.isFinite(green[index]) ? green[index] : rgba[offset];
    rgba[offset + 2] = Number.isFinite(blue[index]) ? blue[index] : rgba[offset];
    rgba[offset + 3] = alpha ? Math.max(0, alpha[index]) : 1;
  }

  return {
    width: decoded.width,
    height: decoded.height,
    rgba,
    previewExposure: computePreviewExposure(rgba),
  };
};

export const readExrDimensions = async (
  blob: BlobLike,
): Promise<{ width: number; height: number }> => {
  const { core } = await loadExrModules();
  const buffer = await blob.arrayBuffer();
  const structure = core.parseExr(buffer);
  return getPartDimensions(getFirstDecodablePart(structure));
};

export const decodeExrImage = async (
  blob: BlobLike,
  options?: { cacheKey?: string },
): Promise<DecodedExrImage> => {
  const cacheKey = options?.cacheKey || buildFallbackCacheKey(blob);
  const cached = decodedExrCache.get(cacheKey);
  if (cached) {
    touchDecodedCache(cacheKey, cached);
    return cached;
  }

  const pending = decodeExrBuffer(blob);
  touchDecodedCache(cacheKey, pending);

  try {
    return await pending;
  } catch (error) {
    decodedExrCache.delete(cacheKey);
    throw error;
  }
};

export const createExrTexture = async (
  blob: BlobLike,
  options?: { cacheKey?: string },
): Promise<THREE.DataTexture> => {
  const decoded = await decodeExrImage(blob, options);
  const texture = new THREE.DataTexture(
    decoded.rgba,
    decoded.width,
    decoded.height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export const createExrPreviewDataUrl = async (
  blob: BlobLike,
  options?: { cacheKey?: string; maxDimension?: number },
): Promise<string> => {
  const decoded = await decodeExrImage(blob, options);
  const maxDimension = Math.max(1, options?.maxDimension ?? 512);
  const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create a canvas context for EXR preview generation.');
  }

  const imageData = new ImageData(createDisplayPixelBuffer(decoded, width, height), width, height);
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

export const readExrPixelData = async (
  blob: BlobLike,
  options?: { cacheKey?: string },
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> => {
  const decoded = await decodeExrImage(blob, options);
  return {
    data: createDisplayPixelBuffer(decoded),
    width: decoded.width,
    height: decoded.height,
  };
};
