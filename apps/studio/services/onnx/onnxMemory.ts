import type { OnnxBackend, OnnxInputMetadata, OnnxOutputMetadata } from '@blackboard/types';

const ONNX_IO_MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024;

const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getTensorElementByteSize = (type: string): number => {
  if (type.includes('float64') || type.includes('int64') || type.includes('uint64')) return 8;
  if (type.includes('float16') || type.includes('int16') || type.includes('uint16')) return 2;
  if (type.includes('int8') || type.includes('uint8') || type.includes('bool')) return 1;
  return 4;
};

const getImageTensorChannelCount = (metadata: OnnxInputMetadata | OnnxOutputMetadata): number => {
  const channelDim = metadata.dims.length >= 4 ? metadata.dims[1] : metadata.dims[0];
  return Number.isFinite(channelDim) && channelDim > 0 ? channelDim : 3;
};

const estimateImageTensorBytes = (
  metadata: OnnxInputMetadata | OnnxOutputMetadata,
  inputSize: { width: number; height: number },
): number => {
  const channels = getImageTensorChannelCount(metadata);
  const width = metadata.dims.at(-1);
  const height = metadata.dims.at(-2);
  const resolvedWidth = Number.isFinite(width) && width && width > 0 ? width : inputSize.width;
  const resolvedHeight =
    Number.isFinite(height) && height && height > 0 ? height : inputSize.height;
  const batch = metadata.dims.length >= 4 && metadata.dims[0] > 0 ? metadata.dims[0] : 1;
  return (
    batch * channels * resolvedWidth * resolvedHeight * getTensorElementByteSize(metadata.type)
  );
};

const estimateMetadataTensorBytes = (
  metadata: OnnxInputMetadata | OnnxOutputMetadata,
  inputSize: { width: number; height: number },
): number => {
  if (metadata.kind === 'image') {
    return estimateImageTensorBytes(metadata, inputSize);
  }

  const elementCount = metadata.dims.reduce((total, dim) => total * (dim > 0 ? dim : 1), 1);
  return elementCount * getTensorElementByteSize(metadata.type);
};

const estimateIoTensorBytes = (
  inputs: OnnxInputMetadata[],
  outputs: OnnxOutputMetadata[],
  inputSize: { width: number; height: number },
): number =>
  [...inputs, ...outputs].reduce(
    (total, metadata) => total + estimateMetadataTensorBytes(metadata, inputSize),
    0,
  );

export const assertReasonableIoTensorMemory = (
  inputs: OnnxInputMetadata[],
  outputs: OnnxOutputMetadata[],
  inputSize: { width: number; height: number },
): void => {
  const estimatedBytes = estimateIoTensorBytes(inputs, outputs, inputSize);
  if (estimatedBytes <= ONNX_IO_MEMORY_LIMIT_BYTES) return;

  throw new Error(
    `ONNX run needs at least ${formatBytes(
      estimatedBytes,
    )} just for input/output tensors at ${inputSize.width} x ${inputSize.height}. Reduce Input Width/Height, use a smaller model, or switch to a lower-resolution source before running.`,
  );
};

export const getOrtRunErrorMessage = (
  error: unknown,
  backend: OnnxBackend,
  inputSize: { width: number; height: number },
): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('std::bad_alloc') || message.includes('bad_alloc')) {
    return `${message}\n\nONNX Runtime ran out of memory while executing this model with ${backend.toUpperCase()} at ${inputSize.width} x ${inputSize.height}. Reduce the ONNX Input Width/Height, use a smaller model variant, close other GPU-heavy browser tabs, or disable WASM fallback and run the node with WebGPU only.`;
  }

  return message;
};
