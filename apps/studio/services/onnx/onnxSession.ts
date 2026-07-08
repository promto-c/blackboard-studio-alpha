import * as ort from 'onnxruntime-web';
import type {
  InstalledOnnxModel,
  OnnxBackend,
  OnnxChannelMode,
  OnnxInputMetadata,
  OnnxOutputMetadata,
} from '@blackboard/types';
import { inferInputKind, inferOutputKind, isDynamicShape, formatOnnxShape } from './onnxShape';
import { getCachedOnnxExternalDataBlobs, getCachedOnnxModelBlob } from './modelCache';

ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}wasm/`;

export interface OnnxIoMetadata {
  inputs: OnnxInputMetadata[];
  outputs: OnnxOutputMetadata[];
}

type OnnxSessionOptions = NonNullable<Parameters<typeof ort.InferenceSession.create>[1]>;
export type OnnxSessionOptionOverrides = Partial<Omit<OnnxSessionOptions, 'externalData'>>;

const getSessionOptionsForBackend = (backend: OnnxBackend): OnnxSessionOptionOverrides => {
  if (backend !== 'wasm') {
    return {};
  }

  return {
    graphOptimizationLevel: 'disabled',
  };
};

const getSessionCreationErrorMessage = (error: unknown, backend: OnnxBackend): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (
    backend === 'wasm' &&
    (message.includes('SimplifiedLayerNormFusion') ||
      message.includes('Attempting to get index by a name which does not exist'))
  ) {
    return `${message}\n\nThis model hit an ONNX Runtime WASM graph-optimization bug. Use the WebGPU backend for this node, or keep WASM disabled in Preferences > Models for this model.`;
  }

  return message;
};

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
      kind: inferInputKind(numericDims),
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
      kind: inferOutputKind(numericDims),
    };
  });

export const createOnnxSession = async (
  model: InstalledOnnxModel,
  backend: OnnxBackend,
  sessionOptions?: OnnxSessionOptionOverrides,
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

  try {
    return await ort.InferenceSession.create(modelBuffer, {
      ...getSessionOptionsForBackend(backend),
      ...sessionOptions,
      executionProviders: [backend],
      externalData: externalData.length > 0 ? externalData : undefined,
    });
  } catch (error) {
    throw new Error(getSessionCreationErrorMessage(error, backend));
  }
};

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

export const resolveBackend = (
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
