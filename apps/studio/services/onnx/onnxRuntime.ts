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
import { validateTensorShape } from './onnxShape';
import {
  createOnnxSession,
  getOnnxRuntimeCompatibility,
  inferDefaultChannelMode,
  readInputMetadata,
  resolveBackend,
  type OnnxRuntimePreferences,
} from './onnxSession';
import { assertReasonableIoTensorMemory, getOrtRunErrorMessage } from './onnxMemory';
import {
  prepareModelInputTensor,
  prepareModelInputTensorFromFloat,
  prepareScalarInputTensor,
  tensorToDepthMapBlob,
  tensorToImageBlob,
  type FloatInput,
} from './onnxTensorTransforms';

export {
  createOnnxSession,
  getOnnxRuntimeCompatibility,
  inferDefaultChannelMode,
  readInputMetadata,
  readOutputMetadata,
  type OnnxIoMetadata,
  type OnnxRuntimeCompatibility,
  type OnnxRuntimePreferences,
} from './onnxSession';
export {
  clearOnnxOutputCache,
  getOnnxOutputCache,
  setOnnxOutputCache,
  type OnnxOutputCacheEntry,
} from './onnxOutputCache';
export type { FloatInput } from './onnxTensorTransforms';

export interface RunDepthModelOptions {
  model: InstalledOnnxModel;
  imageBlob: Blob;
  backend: OnnxBackend;
  inputSize: { width: number; height: number };
  inputChannelModes?: Record<string, OnnxChannelMode>;
  runtimePreferences?: OnnxRuntimePreferences;
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
  /** Per-input normalization overrides. Keyed by input name. If set, overrides `normalization`. */
  inputNormalizationOverrides?: Record<string, OnnxNormalization>;
  /** Per-output normalization overrides. Keyed by output name. If set, overrides `normalization`. */
  outputNormalizationOverrides?: Record<string, OnnxNormalization>;
  normalization?: OnnxNormalization;
  runtimePreferences?: OnnxRuntimePreferences;
}

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
  inputNormalizationOverrides,
  outputNormalizationOverrides,
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
        const resolvedNormalization = inputNormalizationOverrides?.[meta.name] ?? normalization;
        const { tensor } =
          'data' in rawInput
            ? prepareModelInputTensorFromFloat(
                rawInput,
                inputSize,
                channelMode,
                resolvedNormalization,
              )
            : await prepareModelInputTensor(
                rawInput,
                inputSize,
                channelMode,
                resolvedNormalization,
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

    assertReasonableIoTensorMemory(inputMetadata, outputMetadata, inputSize);

    let outputs: Awaited<ReturnType<ort.InferenceSession['run']>>;
    try {
      outputs = await session.run(feeds);
    } catch (error) {
      throw new Error(getOrtRunErrorMessage(error, resolvedBackend, inputSize));
    }

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
        const resolvedOutputNormalization =
          outputNormalizationOverrides?.[outMeta.name] ?? normalization;
        const { blob, width, height } = await tensorToImageBlob(
          tensor,
          resolvedOutputNormalization,
        );
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
