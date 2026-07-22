import type {
  Processor,
  ProgressInfo,
  RawImage as TransformersRawImage,
  Sam3TrackerModel,
  Tensor,
} from '@huggingface/transformers';
import type {
  SegmentationFrameInput,
  SegmentationModelProgress,
  SegmentationPrediction,
  SegmentationPredictionInput,
} from './types';
import type { OnnxBackend, RotoSegmentationModelVariant } from '@blackboard/types';
import {
  DEFAULT_SAM3_MODEL_VARIANT,
  getSam3ModelVariant,
  getSam3RuntimeDtypeConfig,
  SAM3_TRACKER_MODEL_ID,
} from '@/services/models/builtinModelRegistry';
import type { OnnxRuntimePreferences } from '@/services/onnx/onnxSession';

export { SAM3_TRACKER_MODEL_ID } from '@/services/models/builtinModelRegistry';

interface Sam3Runtime {
  model: Sam3TrackerModel;
  processor: Processor & {
    reshape_input_points: (...args: unknown[]) => Tensor;
    post_process_masks: (...args: unknown[]) => Promise<Tensor[]>;
  };
  RawImage: typeof TransformersRawImage;
  Tensor: typeof Tensor;
  backend: 'webgpu' | 'wasm';
  key: string;
  variantId: RotoSegmentationModelVariant;
}

interface PreparedSam3Frame {
  key: string;
  width: number;
  height: number;
  originalSizes: [number, number][];
  reshapedInputSizes: [number, number][];
  embeddings: Record<string, Tensor>;
  lastUsedAt: number;
  runtime: Sam3Runtime;
}

const MAX_EMBEDDING_CACHE_ENTRIES = 2;
const MAX_MASK_LONG_EDGE = 1024;
const modelProgressListeners = new Set<(progress: SegmentationModelProgress) => void>();
const preparedFrames = new Map<string, PreparedSam3Frame>();
const pendingFrames = new Map<string, Promise<PreparedSam3Frame>>();
let activeRuntime: { key: string; promise: Promise<Sam3Runtime> } | null = null;

const reportModelProgress = (info: ProgressInfo): void => {
  const status = info.status;
  const progress =
    (status === 'progress' || status === 'progress_total') && Number.isFinite(info.progress)
      ? info.progress
      : null;
  const loaded =
    status === 'progress' || status === 'progress_total' ? Math.max(0, info.loaded) : 0;
  const total =
    status === 'progress' || status === 'progress_total' ? Math.max(0, info.total) : null;
  const file = 'file' in info && typeof info.file === 'string' ? info.file : null;
  const update = { progress, file, loaded, total } satisfies SegmentationModelProgress;
  modelProgressListeners.forEach((listener) => listener(update));
};

const detectRuntimeCapabilities = async (): Promise<{
  webgpu: boolean;
  wasm: boolean;
  supportsFp16: boolean;
}> => {
  const wasm = typeof WebAssembly !== 'undefined';
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { webgpu: false, wasm, supportsFp16: false };
  }

  try {
    const gpu = (
      navigator as Navigator & {
        gpu: {
          requestAdapter: () => Promise<{ features: { has: (name: string) => boolean } } | null>;
        };
      }
    ).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { webgpu: false, wasm, supportsFp16: false };
    return { webgpu: true, wasm, supportsFp16: adapter.features.has('shader-f16') };
  } catch {
    return { webgpu: false, wasm, supportsFp16: false };
  }
};

interface ResolvedSam3RuntimeConfig {
  key: string;
  variantId: RotoSegmentationModelVariant;
  backend: OnnxBackend;
  allowWasmFallback: boolean;
}

const resolveRuntimeConfig = async (
  variantId: RotoSegmentationModelVariant,
  preferences: OnnxRuntimePreferences,
): Promise<ResolvedSam3RuntimeConfig> => {
  const variant = getSam3ModelVariant(variantId);
  const capabilities = await detectRuntimeCapabilities();
  const webgpu = capabilities.webgpu && preferences.webgpuEnabled !== false;
  const wasm = capabilities.wasm && preferences.wasmEnabled !== false;
  const requiresWebGpu = !variant.supportedBackends.includes('wasm');

  let backend: OnnxBackend;
  if (requiresWebGpu) {
    if (!webgpu) {
      throw new Error(
        `${variant.label} requires WebGPU. Enable it in Preferences > Models or choose Auto/Q8.`,
      );
    }
    backend = 'webgpu';
  } else if (webgpu) {
    backend = 'webgpu';
  } else if (wasm) {
    backend = 'wasm';
  } else {
    throw new Error(
      'SAM3 requires WebGPU or WASM. Enable an ONNX backend in Preferences > Models.',
    );
  }

  if (variant.requiresShaderF16 && !capabilities.supportsFp16) {
    throw new Error('Q4F16 requires WebGPU shader-f16 support. Choose Auto, Q4, or Q8.');
  }

  const dtype = getSam3RuntimeDtypeConfig(variant.id, backend);
  return {
    key: `${variant.id}:${backend}:${dtype.vision_encoder}:${dtype.prompt_encoder_mask_decoder}`,
    variantId: variant.id,
    backend,
    allowWasmFallback: variant.id === 'auto' && wasm,
  };
};

const loadRuntimeForBackend = async (
  transformers: typeof import('@huggingface/transformers'),
  config: ResolvedSam3RuntimeConfig,
): Promise<Sam3Runtime> => {
  const dtype = getSam3RuntimeDtypeConfig(config.variantId, config.backend);

  const [model, processor] = await Promise.all([
    transformers.Sam3TrackerModel.from_pretrained(SAM3_TRACKER_MODEL_ID, {
      device: config.backend,
      dtype,
      progress_callback: reportModelProgress,
    }),
    transformers.AutoProcessor.from_pretrained(SAM3_TRACKER_MODEL_ID, {
      progress_callback: reportModelProgress,
    }),
  ]);

  return {
    model: model as Sam3TrackerModel,
    processor: processor as Sam3Runtime['processor'],
    RawImage: transformers.RawImage,
    Tensor: transformers.Tensor,
    backend: config.backend,
    key: config.key,
    variantId: config.variantId,
  };
};

const loadRuntime = async (config: ResolvedSam3RuntimeConfig): Promise<Sam3Runtime> => {
  const transformers = await import('@huggingface/transformers');
  try {
    return await loadRuntimeForBackend(transformers, config);
  } catch (error) {
    if (!config.allowWasmFallback || config.backend !== 'webgpu') throw error;
    console.warn('SAM3 WebGPU initialization failed; falling back to WASM.', error);
    return loadRuntimeForBackend(transformers, {
      ...config,
      key: 'auto:wasm:q8:q8',
      backend: 'wasm',
      allowWasmFallback: false,
    });
  }
};

const getRuntime = async (
  variantId = DEFAULT_SAM3_MODEL_VARIANT,
  preferences: OnnxRuntimePreferences = {},
): Promise<Sam3Runtime> => {
  const config = await resolveRuntimeConfig(variantId, preferences);
  if (activeRuntime?.key === config.key) return activeRuntime.promise;

  const previousRuntime = activeRuntime;
  const promise = loadRuntime(config);
  activeRuntime = { key: config.key, promise };
  preparedFrames.forEach(disposePreparedFrame);
  preparedFrames.clear();
  pendingFrames.clear();

  try {
    const runtime = await promise;
    if (activeRuntime?.promise === promise) activeRuntime.key = runtime.key;
    if (previousRuntime && previousRuntime.promise !== promise) {
      void previousRuntime.promise
        .then((previous) => previous.model.dispose())
        .catch(() => undefined);
    }
    return runtime;
  } catch (error) {
    if (activeRuntime?.promise === promise) activeRuntime = null;
    throw error;
  }
};

const getMaskOutputSize = (frame: PreparedSam3Frame): [number, number] => {
  const scale = Math.min(1, MAX_MASK_LONG_EDGE / Math.max(frame.width, frame.height));
  return [
    Math.max(1, Math.round(frame.height * scale)),
    Math.max(1, Math.round(frame.width * scale)),
  ];
};

function disposePreparedFrame(frame: PreparedSam3Frame): void {
  Object.values(frame.embeddings).forEach((tensor) => tensor.dispose());
}

export const resetSam3Runtime = async (): Promise<void> => {
  const runtime = activeRuntime;
  activeRuntime = null;
  preparedFrames.forEach(disposePreparedFrame);
  preparedFrames.clear();
  pendingFrames.clear();
  if (runtime) {
    await runtime.promise.then((resolved) => resolved.model.dispose()).catch(() => undefined);
  }
};

const retainPreparedFrame = (frame: PreparedSam3Frame): PreparedSam3Frame => {
  preparedFrames.delete(frame.key);
  preparedFrames.set(frame.key, frame);
  while (preparedFrames.size > MAX_EMBEDDING_CACHE_ENTRIES) {
    const oldest = preparedFrames.entries().next().value as [string, PreparedSam3Frame] | undefined;
    if (!oldest) break;
    preparedFrames.delete(oldest[0]);
    disposePreparedFrame(oldest[1]);
  }
  return frame;
};

export const subscribeToSam3ModelProgress = (
  listener: (progress: SegmentationModelProgress) => void,
): (() => void) => {
  modelProgressListeners.add(listener);
  return () => modelProgressListeners.delete(listener);
};

export const prepareSam3Frame = async (
  input: SegmentationFrameInput,
  options: {
    onEncoderStart?: () => void;
    variantId?: RotoSegmentationModelVariant;
    runtimePreferences?: OnnxRuntimePreferences;
  } = {},
): Promise<{
  key: string;
  backend: 'webgpu' | 'wasm';
  variantId: RotoSegmentationModelVariant;
}> => {
  const runtime = await getRuntime(options.variantId, options.runtimePreferences);
  const preparedKey = `${runtime.key}:${input.key}`;
  const cached = preparedFrames.get(preparedKey);
  if (cached) {
    cached.lastUsedAt = Date.now();
    retainPreparedFrame(cached);
    return { key: cached.key, backend: runtime.backend, variantId: runtime.variantId };
  }

  const existing = pendingFrames.get(preparedKey);
  if (existing) {
    const frame = await existing;
    return { key: frame.key, backend: runtime.backend, variantId: runtime.variantId };
  }

  const pending = (async () => {
    options.onEncoderStart?.();
    const image = new runtime.RawImage(input.data, input.width, input.height, 4).rgb();
    const processed = (await (
      runtime.processor as unknown as (image: TransformersRawImage) => Promise<{
        pixel_values: Tensor;
        original_sizes: [number, number][];
        reshaped_input_sizes: [number, number][];
      }>
    )(image)) as {
      pixel_values: Tensor;
      original_sizes: [number, number][];
      reshaped_input_sizes: [number, number][];
    };

    try {
      const embeddings = await runtime.model.get_image_embeddings({
        pixel_values: processed.pixel_values,
      });
      return retainPreparedFrame({
        key: preparedKey,
        width: input.width,
        height: input.height,
        originalSizes: processed.original_sizes,
        reshapedInputSizes: processed.reshaped_input_sizes,
        embeddings,
        lastUsedAt: Date.now(),
        runtime,
      });
    } finally {
      processed.pixel_values.dispose();
    }
  })();
  pendingFrames.set(preparedKey, pending);

  try {
    const frame = await pending;
    return { key: frame.key, backend: runtime.backend, variantId: runtime.variantId };
  } finally {
    pendingFrames.delete(preparedKey);
  }
};

const scenePointToImagePoint = (
  point: { x: number; y: number },
  input: SegmentationPredictionInput,
  frame: PreparedSam3Frame,
): [number, number] => [
  Math.max(
    0,
    Math.min(frame.width - 1, ((point.x + input.sceneWidth / 2) / input.sceneWidth) * frame.width),
  ),
  Math.max(
    0,
    Math.min(
      frame.height - 1,
      ((point.y + input.sceneHeight / 2) / input.sceneHeight) * frame.height,
    ),
  ),
];

type Sam3BoxPromptBatch = [[[number, number, number, number]]];

/** Builds the processor's required `[batch][box][x1, y1, x2, y2]` input shape. */
export const createSam3BoxPromptBatch = (
  first: [number, number],
  second: [number, number],
): Sam3BoxPromptBatch => [
  [
    [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
    ],
  ],
];

export const predictSam3Mask = async (
  input: SegmentationPredictionInput,
): Promise<SegmentationPrediction> => {
  const frame = preparedFrames.get(input.preparedKey);
  if (!frame) throw new Error('The frame embedding expired. Analyze the frame again.');
  if (input.points.length === 0 && !input.box) {
    throw new Error('Add an include point or draw a box first.');
  }

  frame.lastUsedAt = Date.now();
  retainPreparedFrame(frame);
  const runtime = frame.runtime;
  const modelInputs: Record<string, Tensor> = { ...frame.embeddings };
  const disposableInputs: Tensor[] = [];

  if (input.points.length > 0) {
    const imagePoints = input.points.map((point) => scenePointToImagePoint(point, input, frame));
    const inputPoints = runtime.processor.reshape_input_points(
      [imagePoints],
      frame.originalSizes,
      frame.reshapedInputSizes,
    );
    const inputLabels = new runtime.Tensor(
      'int64',
      BigInt64Array.from(input.points.map((point) => (point.label === 'include' ? 1n : 0n))),
      [1, 1, input.points.length],
    );
    modelInputs.input_points = inputPoints;
    modelInputs.input_labels = inputLabels;
    disposableInputs.push(inputPoints, inputLabels);
  }

  if (input.box) {
    const first = scenePointToImagePoint({ x: input.box.x1, y: input.box.y1 }, input, frame);
    const second = scenePointToImagePoint({ x: input.box.x2, y: input.box.y2 }, input, frame);
    const inputBox = runtime.processor.reshape_input_points(
      createSam3BoxPromptBatch(first, second),
      frame.originalSizes,
      frame.reshapedInputSizes,
      true,
    );
    modelInputs.input_boxes = inputBox;
    disposableInputs.push(inputBox);
  }

  try {
    const output = await (
      runtime.model as unknown as (inputs: Record<string, Tensor>) => Promise<{
        pred_masks: Tensor;
        iou_scores: Tensor;
        object_score_logits?: Tensor;
      }>
    )(modelInputs);
    try {
      const scores = Array.from(output.iou_scores.data as ArrayLike<number>, Number);
      let bestIndex = 0;
      for (let index = 1; index < scores.length; index += 1) {
        if (scores[index] > scores[bestIndex]) bestIndex = index;
      }

      const processedMasks = await runtime.processor.post_process_masks(
        output.pred_masks,
        [getMaskOutputSize(frame)],
        frame.reshapedInputSizes,
        { binarize: false },
      );
      const batchMasks = processedMasks[0];
      try {
        const objectMasks = batchMasks._getitem(0);
        try {
          const bestMask = objectMasks._getitem(bestIndex);
          try {
            const logits = Float32Array.from(bestMask.data as ArrayLike<number>, Number);
            const [height, width] = bestMask.dims.slice(-2);
            return {
              logits,
              width: width ?? frame.width,
              height: height ?? frame.height,
              score: scores[bestIndex] ?? 0,
            };
          } finally {
            bestMask.dispose();
          }
        } finally {
          objectMasks.dispose();
        }
      } finally {
        batchMasks.dispose();
      }
    } finally {
      output.pred_masks.dispose();
      output.iou_scores.dispose();
      output.object_score_logits?.dispose();
    }
  } finally {
    disposableInputs.forEach((tensor) => tensor.dispose());
  }
};

export const clearSam3EmbeddingCache = (): void => {
  preparedFrames.forEach(disposePreparedFrame);
  preparedFrames.clear();
};
