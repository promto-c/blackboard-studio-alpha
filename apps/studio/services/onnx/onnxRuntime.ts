import * as ort from 'onnxruntime-web';
import type {
  InstalledOnnxModel,
  OnnxBackend,
  OnnxChannelMode,
  OnnxInputMetadata,
  OnnxNodeOutput,
  OnnxNormalization,
  OnnxOutputMetadata,
} from '@blackboard/types';
import {
  inferInputKind,
  inferOutputKind,
  isDynamicShape,
  formatOnnxShape,
  validateTensorShape,
} from './onnxShape';
import { getCachedOnnxExternalDataBlobs, getCachedOnnxModelBlob } from './modelCache';

ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}wasm/`;

export interface OnnxIoMetadata {
  inputs: OnnxInputMetadata[];
  outputs: OnnxOutputMetadata[];
}

// Session Metadata Readers
// ------------------------
export const readInputMetadata = (session: ort.InferenceSession): OnnxInputMetadata[] =>
  session.inputNames.map((name, index) => {
    const meta = session.inputMetadata[index];
    const rawDims: Array<number | string> =
      meta && 'shape' in meta ? (meta.shape as ReadonlyArray<number | string>).slice() : [];
    const numericDims = rawDims.map((d) => (typeof d === 'number' ? d : -1));
    const tensorType = meta && 'type' in meta ? String(meta.type) : 'unknown';

    return {
      name,
      type: tensorType,
      dims: numericDims,
      isDynamic: isDynamicShape(numericDims),
      dimsLabel: numericDims.length > 0 ? formatOnnxShape(numericDims) : 'unknown',
      kind: inferInputKind(numericDims, tensorType),
    };
  });

export const readOutputMetadata = (session: ort.InferenceSession): OnnxOutputMetadata[] =>
  session.outputNames.map((name, index) => {
    const meta = session.outputMetadata[index];
    const rawDims: Array<number | string> =
      meta && 'shape' in meta ? (meta.shape as ReadonlyArray<number | string>).slice() : [];
    const numericDims = rawDims.map((d) => (typeof d === 'number' ? d : -1));
    const tensorType = meta && 'type' in meta ? String(meta.type) : 'unknown';

    return {
      name,
      type: tensorType,
      dims: numericDims,
      isDynamic: isDynamicShape(numericDims),
      dimsLabel: numericDims.length > 0 ? formatOnnxShape(numericDims) : 'unknown',
      kind: inferOutputKind(numericDims, tensorType),
    };
  });

// Session Creation
// ----------------
export const createOnnxSession = async (
  model: InstalledOnnxModel,
  backend: OnnxBackend,
  sessionOptions?: Partial<Omit<Parameters<typeof ort.InferenceSession.create>[1], 'externalData'>>,
): Promise<ort.InferenceSession> => {
  const modelBlob = await getCachedOnnxModelBlob(model.cacheKey);

  if (!modelBlob) {
    throw new Error('The selected ONNX model is missing from the local cache.');
  }

  const modelBuffer = await modelBlob.arrayBuffer();
  const externalDataList = await getCachedOnnxExternalDataBlobs(model);
  const externalData = externalDataList.map((ext) => ({
    path: ext.path.split('/').pop() || ext.path,
    data: ext.data,
  }));

  return ort.InferenceSession.create(modelBuffer, {
    executionProviders: [backend],
    externalData: externalData.length > 0 ? externalData : undefined,
    ...sessionOptions,
  });
};

// Runtime Compatibility
// ---------------------
export interface OnnxRuntimeCompatibility {
  webgpu: boolean;
  wasm: boolean;
  rawWebGpu: boolean;
  rawWasm: boolean;
  warning?: string;
}

export interface OnnxRuntimePreferences {
  webgpuEnabled?: boolean;
  wasmEnabled?: boolean;
}

export interface RunDepthModelOptions {
  model: InstalledOnnxModel;
  imageBlob: Blob;
  backend: OnnxBackend;
  inputSize: { width: number; height: number };
  inputChannelModes?: Record<string, OnnxChannelMode>;
  runtimePreferences?: OnnxRuntimePreferences;
}

export interface FloatInput {
  data: Float32Array;
  width: number;
  height: number;
  channels: number;
}

export interface RunOnnxModelOptions {
  model: InstalledOnnxModel;
  imageInputs: Record<string, Blob | FloatInput>;
  scalarInputs: Record<string, number | string | boolean>;
  inputMetadata: OnnxInputMetadata[];
  outputMetadata: OnnxOutputMetadata[];
  backend: OnnxBackend;
  inputSize: { width: number; height: number };
  inputChannelModes?: Record<string, OnnxChannelMode>;
  normalization?: OnnxNormalization;
  runtimePreferences?: OnnxRuntimePreferences;
}

export function inferDefaultChannelMode(
  inputs: OnnxInputMetadata[],
): Record<string, OnnxChannelMode> {
  const result: Record<string, OnnxChannelMode> = {};

  for (const input of inputs) {
    if (input.dims.length >= 2) {
      const cDim = input.dims[1];
      result[input.name] = cDim === 1 ? 'A' : 'RGB';
    } else {
      result[input.name] = 'RGB';
    }
  }

  return result;
}

export const getOnnxRuntimeCompatibility = (
  preferences: OnnxRuntimePreferences = {},
): OnnxRuntimeCompatibility => {
  const hasNavigator = typeof navigator !== 'undefined';
  const rawWebGpu = Boolean(hasNavigator && 'gpu' in navigator);
  const rawWasm = typeof WebAssembly !== 'undefined';
  const webgpu = rawWebGpu && preferences.webgpuEnabled !== false;
  const wasm = rawWasm && preferences.wasmEnabled !== false;

  return {
    webgpu,
    wasm,
    rawWebGpu,
    rawWasm,
    warning: webgpu
      ? undefined
      : wasm
        ? 'WebGPU is unavailable in this browser. ONNX nodes will use WASM fallback.'
        : 'This browser does not expose WebGPU or WebAssembly for ONNX Runtime Web.',
  };
};

// Float Input Utilities
// ---------------------
function bilinearResizeRgba(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return src;
  const dst = new Float32Array(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const sx = x * xRatio;
      const sy = y * yRatio;
      const x1 = Math.min(Math.floor(sx), srcWidth - 1);
      const y1 = Math.min(Math.floor(sy), srcHeight - 1);
      const x2 = Math.min(x1 + 1, srcWidth - 1);
      const y2 = Math.min(y1 + 1, srcHeight - 1);
      const fx = sx - x1;
      const fy = sy - y1;
      for (let c = 0; c < 4; c++) {
        const tl = src[(y1 * srcWidth + x1) * 4 + c];
        const tr = src[(y1 * srcWidth + x2) * 4 + c];
        const bl = src[(y2 * srcWidth + x1) * 4 + c];
        const br = src[(y2 * srcWidth + x2) * 4 + c];
        const top = tl + (tr - tl) * fx;
        const bot = bl + (br - bl) * fx;
        dst[(y * dstWidth + x) * 4 + c] = top + (bot - top) * fy;
      }
    }
  }
  return dst;
}

export function prepareModelInputTensorFromFloat(
  floatInput: FloatInput,
  inputSize: { width: number; height: number },
  channelMode: OnnxChannelMode,
  normalization?: OnnxNormalization,
): { tensor: ort.Tensor; width: number; height: number } {
  const { data, width, height, channels } = floatInput;
  const dstW = inputSize.width;
  const dstH = inputSize.height;
  const planeSize = dstW * dstH;
  const resized = bilinearResizeRgba(data, width, height, dstW, dstH);

  if (channelMode === 'RGB') {
    if (normalization === 'none') {
      const values = new Float32Array(3 * planeSize);
      for (let i = 0; i < planeSize; i++) {
        const s = i * 4;
        values[i] = resized[s];
        values[planeSize + i] = resized[s + 1];
        values[planeSize * 2 + i] = resized[s + 2];
      }
      return {
        tensor: new ort.Tensor('float32', values, [1, 3, dstH, dstW]),
        width: dstW,
        height: dstH,
      };
    }

    if (normalization === 'zeroToOne') {
      const values = new Float32Array(3 * planeSize);
      for (let i = 0; i < planeSize; i++) {
        const s = i * 4;
        values[i] = resized[s];
        values[planeSize + i] = resized[s + 1];
        values[planeSize * 2 + i] = resized[s + 2];
      }
      return {
        tensor: new ort.Tensor('float32', values, [1, 3, dstH, dstW]),
        width: dstW,
        height: dstH,
      };
    }

    const values = new Float32Array(3 * planeSize);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    for (let i = 0; i < planeSize; i++) {
      const s = i * 4;
      values[i] = (resized[s] - mean[0]) / std[0];
      values[planeSize + i] = (resized[s + 1] - mean[1]) / std[1];
      values[planeSize * 2 + i] = (resized[s + 2] - mean[2]) / std[2];
    }
    return {
      tensor: new ort.Tensor('float32', values, [1, 3, dstH, dstW]),
      width: dstW,
      height: dstH,
    };
  }

  const values = new Float32Array(planeSize);
  for (let i = 0; i < planeSize; i++) {
    const s = i * 4;
    const r = resized[s];
    const g = resized[s + 1];
    const b = resized[s + 2];
    const a = resized[s + 3];
    if (channelMode === 'R') values[i] = r;
    else if (channelMode === 'G') values[i] = g;
    else if (channelMode === 'B') values[i] = b;
    else if (channelMode === 'A') values[i] = a;
    else values[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return {
    tensor: new ort.Tensor('float32', values, [1, 1, dstH, dstW]),
    width: dstW,
    height: dstH,
  };
}

export interface OnnxOutputCacheEntry {
  data: Float32Array;
  width: number;
  height: number;
  channels: number;
  dims: number[];
}

const onnxOutputTensorCache = new Map<string, OnnxOutputCacheEntry>();

export function setOnnxOutputCache(nodeId: string, entry: OnnxOutputCacheEntry): void {
  onnxOutputTensorCache.set(nodeId, entry);
}

export function getOnnxOutputCache(nodeId: string): OnnxOutputCacheEntry | undefined {
  return onnxOutputTensorCache.get(nodeId);
}

export function clearOnnxOutputCache(nodeId?: string): void {
  if (nodeId) onnxOutputTensorCache.delete(nodeId);
  else onnxOutputTensorCache.clear();
}

// Image IO
// --------
type DecodedImage = ImageBitmap | HTMLImageElement;

const createImageBitmapFromBlob = async (blob: Blob): Promise<DecodedImage> => {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not decode input image.'));
      element.src = objectUrl;
    });

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const canvasToBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Could not encode ONNX output image.'));
      }
    }, 'image/png');
  });

function extractChannelPixel(
  pixels: Uint8ClampedArray,
  index: number,
  channelMode: OnnxChannelMode,
): number {
  const sourceIndex = index * 4;

  if (channelMode === 'R') return pixels[sourceIndex] / 255;
  if (channelMode === 'G') return pixels[sourceIndex + 1] / 255;
  if (channelMode === 'B') return pixels[sourceIndex + 2] / 255;
  if (channelMode === 'A') return pixels[sourceIndex + 3] / 255;

  if (channelMode === 'Luminance') {
    return (
      0.2126 * (pixels[sourceIndex] / 255) +
      0.7152 * (pixels[sourceIndex + 1] / 255) +
      0.0722 * (pixels[sourceIndex + 2] / 255)
    );
  }

  return 0;
}

const prepareModelInputTensor = async (
  imageBlob: Blob,
  inputSize: { width: number; height: number },
  channelMode: OnnxChannelMode,
  normalization?: OnnxNormalization,
): Promise<{ tensor: ort.Tensor; width: number; height: number }> => {
  const dstW = inputSize.width;
  const dstH = inputSize.height;
  const bitmap = await createImageBitmapFromBlob(imageBlob);
  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Could not create ONNX preprocessing canvas.');
  }

  context.drawImage(bitmap, 0, 0, dstW, dstH);

  if ('close' in bitmap) {
    bitmap.close();
  }

  const pixels = context.getImageData(0, 0, dstW, dstH).data;
  const planeSize = dstW * dstH;

  if (channelMode === 'RGB') {
    if (normalization === 'none') {
      const values = new Float32Array(3 * planeSize);
      for (let i = 0; i < planeSize; i += 1) {
        const sourceIndex = i * 4;
        values[i] = pixels[sourceIndex];
        values[planeSize + i] = pixels[sourceIndex + 1];
        values[planeSize * 2 + i] = pixels[sourceIndex + 2];
      }
      return {
        tensor: new ort.Tensor('float32', values, [1, 3, dstH, dstW]),
        width: dstW,
        height: dstH,
      };
    }

    if (normalization === 'zeroToOne') {
      const values = new Float32Array(3 * planeSize);
      for (let i = 0; i < planeSize; i += 1) {
        const sourceIndex = i * 4;
        values[i] = pixels[sourceIndex] / 255;
        values[planeSize + i] = pixels[sourceIndex + 1] / 255;
        values[planeSize * 2 + i] = pixels[sourceIndex + 2] / 255;
      }
      return {
        tensor: new ort.Tensor('float32', values, [1, 3, dstH, dstW]),
        width: dstW,
        height: dstH,
      };
    }

    const values = new Float32Array(3 * planeSize);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let i = 0; i < planeSize; i += 1) {
      const sourceIndex = i * 4;
      values[i] = (pixels[sourceIndex] / 255 - mean[0]) / std[0];
      values[planeSize + i] = (pixels[sourceIndex + 1] / 255 - mean[1]) / std[1];
      values[planeSize * 2 + i] = (pixels[sourceIndex + 2] / 255 - mean[2]) / std[2];
    }

    return {
      tensor: new ort.Tensor('float32', values, [1, 3, dstH, dstW]),
      width: dstW,
      height: dstH,
    };
  }

  const values = new Float32Array(planeSize);

  for (let i = 0; i < planeSize; i += 1) {
    values[i] = extractChannelPixel(pixels, i, channelMode);
  }

  return {
    tensor: new ort.Tensor('float32', values, [1, 1, dstH, dstW]),
    width: dstW,
    height: dstH,
  };
};

const tensorToDepthMapBlob = async (tensor: ort.Tensor): Promise<Blob> => {
  const dims = tensor.dims;
  const width = dims[dims.length - 1] ?? 1;
  const height = dims[dims.length - 2] ?? 1;
  const data = tensor.data as Float32Array | number[];
  const length = width * height;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < length; i += 1) {
    const value = Number(data[i]);

    if (!Number.isFinite(value)) {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const range = max > min ? max - min : 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not create ONNX postprocessing canvas.');
  }

  const imageData = context.createImageData(width, height);

  for (let i = 0; i < length; i += 1) {
    const normalized = Math.max(
      0,
      Math.min(255, Math.round(((Number(data[i]) - min) / range) * 255)),
    );
    const targetIndex = i * 4;

    imageData.data[targetIndex] = normalized;
    imageData.data[targetIndex + 1] = normalized;
    imageData.data[targetIndex + 2] = normalized;
    imageData.data[targetIndex + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};

const tensorToImageBlob = async (
  tensor: ort.Tensor,
  normalization?: OnnxNormalization,
): Promise<{ blob: Blob; width: number; height: number }> => {
  const dims = tensor.dims;

  if (dims.length === 4) {
    const channels = dims[1];
    const height = dims[2];
    const width = dims[3];

    if (channels === 3 || channels === 1) {
      const data = tensor.data as Float32Array | number[];
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Could not create ONNX output canvas.');
      }

      const imageData = context.createImageData(width, height);

      const ch0 = (i: number): number => Number(data[i]);
      const ch1 = (i: number): number => Number(data[width * height + i]);
      const ch2 = (i: number): number => Number(data[width * height * 2 + i]);

      if (normalization === 'none' || normalization === 'zeroToOne') {
        const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(Number(v))));

        if (channels === 1) {
          for (let i = 0; i < width * height; i += 1) {
            const val = clamp(data[i]);
            const idx = i * 4;
            imageData.data[idx] = val;
            imageData.data[idx + 1] = val;
            imageData.data[idx + 2] = val;
            imageData.data[idx + 3] = 255;
          }
        } else {
          for (let i = 0; i < width * height; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = clamp(ch0(i));
            imageData.data[idx + 1] = clamp(ch1(i));
            imageData.data[idx + 2] = clamp(ch2(i));
            imageData.data[idx + 3] = 255;
          }
        }
      } else if (channels === 1) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < width * height; i += 1) {
          const value = Number(data[i]);
          if (Number.isFinite(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }

        const range = max > min ? max - min : 1;

        for (let i = 0; i < width * height; i += 1) {
          const normalized = Math.max(
            0,
            Math.min(255, Math.round(((Number(data[i]) - min) / range) * 255)),
          );
          const idx = i * 4;
          imageData.data[idx] = normalized;
          imageData.data[idx + 1] = normalized;
          imageData.data[idx + 2] = normalized;
          imageData.data[idx + 3] = 255;
        }
      } else {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < width * height * 3; i += 1) {
          const value = Number(data[i]);
          if (Number.isFinite(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }

        const range = max > min ? max - min : 1;

        for (let i = 0; i < width * height; i += 1) {
          const idx = i * 4;
          imageData.data[idx] = Math.max(
            0,
            Math.min(255, Math.round(((ch0(i) - min) / range) * 255)),
          );
          imageData.data[idx + 1] = Math.max(
            0,
            Math.min(255, Math.round(((ch1(i) - min) / range) * 255)),
          );
          imageData.data[idx + 2] = Math.max(
            0,
            Math.min(255, Math.round(((ch2(i) - min) / range) * 255)),
          );
          imageData.data[idx + 3] = 255;
        }
      }

      context.putImageData(imageData, 0, 0);
      const blob = await canvasToBlob(canvas);
      return { blob, width, height };
    }
  }

  if (dims.length === 3) {
    const height = dims[1];
    const width = dims[2];
    const channels = dims[0];

    if (channels <= 4) {
      return tensorToDepthMapBlob(tensor).then((blob) => ({ blob, width, height }));
    }
  }

  if (dims.length === 2) {
    const height = dims[0];
    const width = dims[1];
    return tensorToDepthMapBlob(tensor).then((blob) => ({ blob, width, height }));
  }

  return tensorToDepthMapBlob(tensor).then((blob) => ({ blob, width: 1, height: 1 }));
};

const prepareScalarInputTensor = (
  value: number | string | boolean,
  targetDims: readonly number[],
  expectedType: string,
): ort.Tensor => {
  const dims = targetDims.length > 0 ? [...targetDims] : [];

  if (typeof value === 'boolean') {
    return new ort.Tensor('bool', new Uint8Array([value ? 1 : 0]), dims);
  }

  if (typeof value === 'string') {
    return new ort.Tensor('string', [value], dims);
  }

  switch (expectedType) {
    case 'float64':
      return new ort.Tensor('float64', new Float64Array([value]), dims);
    case 'float32':
      return new ort.Tensor('float32', new Float32Array([value]), dims);
    case 'float16':
      return new ort.Tensor('float16', new Uint16Array([value]), dims);
    case 'int64':
      return new ort.Tensor('int64', new BigInt64Array([BigInt(Math.round(value))]), dims);
    case 'uint64':
      return new ort.Tensor('uint64', new BigUint64Array([BigInt(Math.round(value))]), dims);
    case 'int32':
      return new ort.Tensor('int32', new Int32Array([Math.round(value)]), dims);
    case 'uint32':
      return new ort.Tensor('uint32', new Uint32Array([Math.round(value)]), dims);
    case 'int16':
      return new ort.Tensor('int16', new Int16Array([Math.round(value)]), dims);
    case 'uint16':
      return new ort.Tensor('uint16', new Uint16Array([Math.round(value)]), dims);
    case 'int8':
      return new ort.Tensor('int8', new Int8Array([Math.round(value)]), dims);
    case 'uint8':
      return new ort.Tensor('uint8', new Uint8Array([Math.round(value)]), dims);
    case 'int4':
      return new ort.Tensor('int4', new Int8Array([Math.round(value)]), dims);
    case 'uint4':
      return new ort.Tensor('uint4', new Uint8Array([Math.round(value)]), dims);
    default:
      return new ort.Tensor('float32', new Float32Array([value]), dims);
  }
};

const resolveBackend = (
  backend: OnnxBackend,
  compatibility: OnnxRuntimeCompatibility,
): OnnxBackend => {
  const resolved = backend === 'webgpu' && !compatibility.webgpu ? 'wasm' : backend;

  if (backend === 'wasm' && !compatibility.wasm) {
    throw new Error('WASM is disabled or unavailable for ONNX Runtime Web.');
  }
  if (backend === 'webgpu' && !compatibility.webgpu && !compatibility.wasm) {
    throw new Error('WebGPU is disabled or unavailable, and WASM fallback is not available.');
  }
  if (resolved === 'wasm' && !compatibility.wasm) {
    throw new Error('ONNX Runtime Web requires WebGPU or WASM support.');
  }

  return resolved;
};

// Inference
// ---------
export interface OnnxModelRunOutput extends OnnxNodeOutput {
  blob?: Blob;
  rawFloatData?: Float32Array;
}

export async function runOnnxModel({
  model,
  imageInputs,
  scalarInputs,
  inputMetadata,
  outputMetadata,
  backend,
  inputSize,
  inputChannelModes = {},
  normalization,
  runtimePreferences,
}: RunOnnxModelOptions): Promise<OnnxModelRunOutput[]> {
  const compatibility = getOnnxRuntimeCompatibility(runtimePreferences);
  const resolvedBackend = resolveBackend(backend, compatibility);

  ort.env.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));

  const session = await createOnnxSession(model, resolvedBackend);

  try {
    const feeds: Record<string, ort.Tensor> = {};

    for (const meta of inputMetadata) {
      if (meta.kind === 'image') {
        const rawInput = imageInputs[meta.name];
        if (!rawInput) {
          throw new Error(`Missing image input for "${meta.name}".`);
        }

        const defaults = inferDefaultChannelMode([meta]);
        const channelMode = inputChannelModes[meta.name] ?? defaults[meta.name] ?? 'RGB';
        const { tensor } =
          'data' in rawInput
            ? prepareModelInputTensorFromFloat(
                rawInput as FloatInput,
                inputSize,
                channelMode,
                normalization,
              )
            : await prepareModelInputTensor(
                rawInput as Blob,
                inputSize,
                channelMode,
                normalization,
              );

        if (!meta.isDynamic && meta.dims.length > 0) {
          const errors = validateTensorShape(meta.dims, tensor.dims as number[]);
          if (errors.length > 0) {
            throw new Error(
              `Shape mismatch for "${meta.name}": ${errors.join(', ')}. Expected shape: ${meta.dimsLabel}.`,
            );
          }
        }

        feeds[meta.name] = tensor;
      } else {
        const value = meta.name in scalarInputs ? scalarInputs[meta.name] : meta.defaultValue;
        if (value === undefined || value === null) {
          throw new Error(`Missing scalar input value for "${meta.name}".`);
        }
        feeds[meta.name] = prepareScalarInputTensor(value, meta.dims, meta.type);
      }
    }

    const outputs = await session.run(feeds);
    const now = Date.now();
    const results: OnnxModelRunOutput[] = [];

    for (let i = 0; i < outputMetadata.length; i++) {
      const outMeta = outputMetadata[i];
      const outputName = session.outputNames[i] ?? outMeta.name;
      const tensor = outputs[outputName];

      if (!tensor) {
        continue;
      }

      if (outMeta.kind === 'image') {
        const { blob, width, height } = await tensorToImageBlob(tensor, normalization);
        const rawData = tensor.data as Float32Array | number[];
        const rawFloatData =
          rawData instanceof Float32Array ? new Float32Array(rawData) : undefined;
        results.push({
          id: `${model.id}:out:${i}:${now}`,
          name: outMeta.name,
          outputIndex: i,
          src: '',
          width,
          height,
          createdAt: now,
          kind: 'image',
          dims: [...tensor.dims],
          type: outMeta.type,
          blob,
          rawFloatData,
        });
      } else {
        const data = tensor.data as Float32Array | number[];
        const scalarValue = Number(data[0]);
        results.push({
          id: `${model.id}:out:${i}:${now}`,
          name: outMeta.name,
          outputIndex: i,
          src: '',
          width: 0,
          height: 0,
          createdAt: now,
          kind: 'scalar',
          scalarValue,
          dims: [...tensor.dims],
          type: outMeta.type,
        });
      }
    }

    return results;
  } finally {
    await session.release?.();
  }
}

export const runDepthOnnxModel = async ({
  model,
  imageBlob,
  backend,
  inputSize,
  inputChannelModes = {},
  runtimePreferences,
}: RunDepthModelOptions): Promise<{ blob: Blob; width: number; height: number }> => {
  const compatibility = getOnnxRuntimeCompatibility(runtimePreferences);
  const resolvedBackend = resolveBackend(backend, compatibility);
  const session = await createOnnxSession(model, resolvedBackend);

  try {
    const metadata = readInputMetadata(session);
    const firstInput = metadata[0];

    if (!firstInput) {
      throw new Error('The ONNX model does not expose an input tensor.');
    }

    const defaults = inferDefaultChannelMode(metadata);
    const resolvedChannelMode =
      inputChannelModes[firstInput.name] ?? defaults[firstInput.name] ?? 'RGB';

    const input = await prepareModelInputTensor(imageBlob, inputSize, resolvedChannelMode);

    if (!firstInput.isDynamic && firstInput.dims.length > 0) {
      const errors = validateTensorShape(firstInput.dims, input.tensor.dims as number[]);

      if (errors.length > 0) {
        throw new Error(
          `Shape mismatch for "${firstInput.name}": ${errors.join(
            ', ',
          )}. Expected shape: ${firstInput.dimsLabel}.`,
        );
      }
    }

    const feeds: Record<string, ort.Tensor> = {};

    for (const [i, inputMeta] of metadata.entries()) {
      if (i === 0) {
        feeds[inputMeta.name] = input.tensor;
      } else {
        const channelMode = inputChannelModes[inputMeta.name] ?? defaults[inputMeta.name] ?? 'RGB';
        const tensorInput = await prepareModelInputTensor(imageBlob, inputSize, channelMode);
        feeds[inputMeta.name] = tensorInput.tensor;
      }
    }

    const outputs = await session.run(feeds);
    const outputName = session.outputNames[0];
    const output = outputName ? outputs[outputName] : Object.values(outputs)[0];

    if (!output) {
      throw new Error('The ONNX model did not return an output tensor.');
    }

    const blob = await tensorToDepthMapBlob(output);

    return {
      blob,
      width: input.width,
      height: input.height,
    };
  } finally {
    await session.release?.();
  }
};
