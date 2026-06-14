import * as ort from 'onnxruntime-web';
import type { OnnxChannelMode, OnnxNormalization } from '@blackboard/types';

export interface FloatInput {
  data: Float32Array;
  width: number;
  height: number;
  channels: number;
}

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
  const { data, width, height } = floatInput;
  const dstW = inputSize.width;
  const dstH = inputSize.height;
  const planeSize = dstW * dstH;
  const resized = bilinearResizeRgba(data, width, height, dstW, dstH);

  if (channelMode === 'RGB') {
    if (normalization === 'none' || normalization === 'zeroToOne') {
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

export const prepareModelInputTensor = async (
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

export const tensorToDepthMapBlob = async (tensor: ort.Tensor): Promise<Blob> => {
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

/**
 * Detect whether a 4D tensor uses NCHW (channel-first) or NHWC (channel-last) layout.
 *
 * ONNX standard is NCHW [N, C, H, W], but some models export in NHWC [N, H, W, C].
 * We detect this by checking which dim looks like the channel dimension:
 * if dims[3] is small (≤4, typical channel count) and dims[1] is large (>4), it's NHWC.
 * Otherwise assume NCHW (ONNX default).
 */
function detect4DTensorLayout(dims: readonly number[]): 'nchw' | 'nhwc' {
  if (dims.length === 4 && dims[3] >= 1 && dims[3] <= 4 && dims[1] > 4) {
    return 'nhwc';
  }
  return 'nchw';
}

export const tensorToImageBlob = async (
  tensor: ort.Tensor,
  normalization?: OnnxNormalization,
): Promise<{ blob: Blob; width: number; height: number }> => {
  const dims = tensor.dims;

  if (dims.length === 4) {
    const layout = detect4DTensorLayout(dims);
    const channels = layout === 'nhwc' ? dims[3] : dims[1];
    const height = layout === 'nhwc' ? dims[1] : dims[2];
    const width = layout === 'nhwc' ? dims[2] : dims[3];

    if (channels >= 1 && channels <= 4) {
      const data = tensor.data as Float32Array | number[];
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Could not create ONNX output canvas.');
      }

      const imageData = context.createImageData(width, height);
      const planeSize = width * height;

      // NCHW data: data[planeSize * ch + i]  — all pixels of channel ch in a block
      // NHWC data: data[i * channels + ch]    — all channels of pixel i interleaved
      const ch = (channelIndex: number, i: number): number =>
        Number(
          layout === 'nhwc'
            ? data[i * channels + channelIndex]
            : data[planeSize * channelIndex + i],
        );

      if (normalization === 'none') {
        // Min-max normalization across ALL output values.
        // This handles any range (including negative values) by mapping
        // [min, max] → [0, 255], preserving the full dynamic range.
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        const totalValues = planeSize * channels;

        for (let i = 0; i < totalValues; i += 1) {
          const value = Number(data[i]);
          if (Number.isFinite(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }

        const range = max > min ? max - min : 1;

        const map = (v: number): number =>
          Math.max(0, Math.min(255, Math.round(((Number(v) - min) / range) * 255)));

        if (channels === 4) {
          for (let i = 0; i < planeSize; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = map(ch(0, i));
            imageData.data[idx + 1] = map(ch(1, i));
            imageData.data[idx + 2] = map(ch(2, i));
            imageData.data[idx + 3] = map(ch(3, i));
          }
        } else if (channels === 3) {
          for (let i = 0; i < planeSize; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = map(ch(0, i));
            imageData.data[idx + 1] = map(ch(1, i));
            imageData.data[idx + 2] = map(ch(2, i));
            imageData.data[idx + 3] = 255;
          }
        } else if (channels === 2) {
          for (let i = 0; i < planeSize; i += 1) {
            const val = map(ch(0, i));
            const idx = i * 4;
            imageData.data[idx] = val;
            imageData.data[idx + 1] = val;
            imageData.data[idx + 2] = val;
            imageData.data[idx + 3] = map(ch(1, i));
          }
        } else {
          // channels === 1
          for (let i = 0; i < planeSize; i += 1) {
            const val = map(data[i]);
            const idx = i * 4;
            imageData.data[idx] = val;
            imageData.data[idx + 1] = val;
            imageData.data[idx + 2] = val;
            imageData.data[idx + 3] = 255;
          }
        }
      } else if (normalization === 'zeroToOne') {
        // Map [0, 1] range to [0, 255]. Clamp to [0, 1] first in case
        // the model outputs values slightly outside the expected range.
        const toByte = (v: number): number =>
          Math.max(0, Math.min(255, Math.round(Number(v) * 255)));

        if (channels === 4) {
          for (let i = 0; i < planeSize; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = toByte(ch(0, i));
            imageData.data[idx + 1] = toByte(ch(1, i));
            imageData.data[idx + 2] = toByte(ch(2, i));
            imageData.data[idx + 3] = toByte(ch(3, i));
          }
        } else if (channels === 3) {
          for (let i = 0; i < planeSize; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = toByte(ch(0, i));
            imageData.data[idx + 1] = toByte(ch(1, i));
            imageData.data[idx + 2] = toByte(ch(2, i));
            imageData.data[idx + 3] = 255;
          }
        } else if (channels === 2) {
          for (let i = 0; i < planeSize; i += 1) {
            const val = toByte(ch(0, i));
            const idx = i * 4;
            imageData.data[idx] = val;
            imageData.data[idx + 1] = val;
            imageData.data[idx + 2] = val;
            imageData.data[idx + 3] = toByte(ch(1, i));
          }
        } else {
          // channels === 1
          for (let i = 0; i < planeSize; i += 1) {
            const val = toByte(data[i]);
            const idx = i * 4;
            imageData.data[idx] = val;
            imageData.data[idx + 1] = val;
            imageData.data[idx + 2] = val;
            imageData.data[idx + 3] = 255;
          }
        }
      } else if (channels === 1) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < planeSize; i += 1) {
          const value = Number(data[i]);
          if (Number.isFinite(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }

        const range = max > min ? max - min : 1;

        for (let i = 0; i < planeSize; i += 1) {
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
        // channels === 2, 3, or 4 with imagenet normalization
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        const totalValues = planeSize * channels;

        for (let i = 0; i < totalValues; i += 1) {
          const value = Number(data[i]);
          if (Number.isFinite(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }

        const range = max > min ? max - min : 1;

        if (channels === 4) {
          for (let i = 0; i < planeSize; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = Math.max(
              0,
              Math.min(255, Math.round(((ch(0, i) - min) / range) * 255)),
            );
            imageData.data[idx + 1] = Math.max(
              0,
              Math.min(255, Math.round(((ch(1, i) - min) / range) * 255)),
            );
            imageData.data[idx + 2] = Math.max(
              0,
              Math.min(255, Math.round(((ch(2, i) - min) / range) * 255)),
            );
            imageData.data[idx + 3] = Math.max(
              0,
              Math.min(255, Math.round(((ch(3, i) - min) / range) * 255)),
            );
          }
        } else if (channels === 2) {
          for (let i = 0; i < planeSize; i += 1) {
            const val = Math.max(0, Math.min(255, Math.round(((ch(0, i) - min) / range) * 255)));
            const idx = i * 4;
            imageData.data[idx] = val;
            imageData.data[idx + 1] = val;
            imageData.data[idx + 2] = val;
            imageData.data[idx + 3] = Math.max(
              0,
              Math.min(255, Math.round(((ch(1, i) - min) / range) * 255)),
            );
          }
        } else {
          // channels === 3
          for (let i = 0; i < planeSize; i += 1) {
            const idx = i * 4;
            imageData.data[idx] = Math.max(
              0,
              Math.min(255, Math.round(((ch(0, i) - min) / range) * 255)),
            );
            imageData.data[idx + 1] = Math.max(
              0,
              Math.min(255, Math.round(((ch(1, i) - min) / range) * 255)),
            );
            imageData.data[idx + 2] = Math.max(
              0,
              Math.min(255, Math.round(((ch(2, i) - min) / range) * 255)),
            );
            imageData.data[idx + 3] = 255;
          }
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
      const imageBlob = await tensorToDepthMapBlob(tensor);
      return { blob: imageBlob, width, height };
    }
  }

  if (dims.length === 2) {
    const height = dims[0];
    const width = dims[1];
    const imageBlob = await tensorToDepthMapBlob(tensor);
    return { blob: imageBlob, width, height };
  }

  // Fallback: derive width/height from the last two dims, not hardcoded 1x1
  const flatWidth = dims.length >= 1 ? dims[dims.length - 1] : 1;
  const flatHeight = dims.length >= 2 ? dims[dims.length - 2] : 1;
  const imageBlob = await tensorToDepthMapBlob(tensor);
  return { blob: imageBlob, width: flatWidth, height: flatHeight };
};

export const prepareScalarInputTensor = (
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
