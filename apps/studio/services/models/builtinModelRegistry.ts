import type {
  ModelCatalogReference,
  ModelRequirement,
  OnnxBackend,
  OnnxModelVariantMetadata,
  RotoSegmentationModelVariant,
} from '@blackboard/types';

export interface BuiltinModelVariantDefinition<TVariantId extends string = string> {
  id: TVariantId;
  label: string;
  shortLabel: string;
  description: string;
  approximateSizeBytes: number;
  supportedBackends: OnnxBackend[];
  requiresShaderF16?: boolean;
  recommended?: boolean;
  cacheFiles: string[];
}

export interface BuiltinModelBundleDefinition<TVariantId extends string = string> {
  id: string;
  name: string;
  repoName: string;
  runtime: 'transformers-onnx';
  featureLabel: string;
  description: string;
  variants: BuiltinModelVariantDefinition<TVariantId>[];
  onnxNodeTargets?: BuiltinOnnxNodeTargetDefinition[];
}

export interface BuiltinOnnxNodeTargetDefinition {
  id: string;
  label: string;
  description: string;
  outputDescription: string;
  variants: OnnxModelVariantMetadata[];
}

export const SAM3_TRACKER_MODEL_ID = 'onnx-community/sam3-tracker-ONNX';
export const DEFAULT_SAM3_MODEL_VARIANT: RotoSegmentationModelVariant = 'auto';
export const SAM3_TRACKER_SOURCE_URL = `https://huggingface.co/${SAM3_TRACKER_MODEL_ID}`;

export const SAM3_MODEL_REQUIREMENT: ModelRequirement = {
  modelId: SAM3_TRACKER_MODEL_ID,
  modelName: 'SAM3 Tracker',
  purpose: 'Point and box Smart Mask segmentation',
  runtime: 'transformers-onnx',
  optional: true,
  variantIds: ['auto', 'q4', 'q4f16', 'q8'],
  repoName: SAM3_TRACKER_MODEL_ID,
  sourceUrl: SAM3_TRACKER_SOURCE_URL,
};

const Q4_CACHE_FILES = [
  'onnx/vision_encoder_q4.onnx',
  'onnx/vision_encoder_q4.onnx_data',
  'onnx/prompt_encoder_mask_decoder.onnx',
  'onnx/prompt_encoder_mask_decoder.onnx_data',
];

const Q4F16_CACHE_FILES = [
  'onnx/vision_encoder_q4f16.onnx',
  'onnx/vision_encoder_q4f16.onnx_data',
  'onnx/prompt_encoder_mask_decoder_q4f16.onnx',
  'onnx/prompt_encoder_mask_decoder_q4f16.onnx_data',
];

const Q8_CACHE_FILES = [
  'onnx/vision_encoder_quantized.onnx',
  'onnx/vision_encoder_quantized.onnx_data',
  'onnx/prompt_encoder_mask_decoder_quantized.onnx',
  'onnx/prompt_encoder_mask_decoder_quantized.onnx_data',
];

export const SAM3_MODEL_VARIANTS: BuiltinModelVariantDefinition<RotoSegmentationModelVariant>[] = [
  {
    id: 'auto',
    label: 'Auto · Recommended',
    shortLabel: 'Auto',
    description: 'Uses Q4 on WebGPU and the compatible Q8 bundle on WASM.',
    approximateSizeBytes: 392_560_198,
    supportedBackends: ['webgpu', 'wasm'],
    recommended: true,
    cacheFiles: [...Q4_CACHE_FILES, ...Q8_CACHE_FILES],
  },
  {
    id: 'q4',
    label: 'Q4 · Balanced',
    shortLabel: 'Q4',
    description: 'Recommended WebGPU balance: compact vision encoder with full-precision decoder.',
    approximateSizeBytes: 392_560_198,
    supportedBackends: ['webgpu'],
    cacheFiles: Q4_CACHE_FILES,
  },
  {
    id: 'q4f16',
    label: 'Q4F16 · Fastest',
    shortLabel: 'Q4F16',
    description: 'Smallest and fastest WebGPU bundle; requires shader-f16 support.',
    approximateSizeBytes: 302_295_094,
    supportedBackends: ['webgpu'],
    requiresShaderF16: true,
    cacheFiles: Q4F16_CACHE_FILES,
  },
  {
    id: 'q8',
    label: 'Q8 · Compatible',
    shortLabel: 'Q8',
    description: 'Larger 8-bit bundle for WASM fallback or higher quantization fidelity.',
    approximateSizeBytes: 538_740_547,
    supportedBackends: ['webgpu', 'wasm'],
    cacheFiles: Q8_CACHE_FILES,
  },
];

const createSam3EncoderVariant = ({
  label,
  fileStem,
  precision,
  supportedBackends,
}: {
  label: string;
  fileStem: string;
  precision: OnnxModelVariantMetadata['precision'];
  supportedBackends: OnnxBackend[];
}): OnnxModelVariantMetadata => {
  const filePath = `onnx/${fileStem}.onnx`;
  return {
    id: `${SAM3_TRACKER_MODEL_ID}:${filePath}`,
    repoName: SAM3_TRACKER_MODEL_ID,
    filePath,
    label,
    precision,
    scale: 'large',
    supportedBackends,
    preprocessing: 'Resize to the graph input and apply ImageNet normalization.',
    postprocessing: 'Produces image embeddings for a compatible SAM3 prompt decoder.',
    externalDataFiles: [{ path: `onnx/${fileStem}.onnx_data` }],
  };
};

export const SAM3_VISION_ENCODER_TARGET: BuiltinOnnxNodeTargetDefinition = {
  id: 'vision_encoder',
  label: 'Vision Encoder',
  description:
    'Advanced single-graph access for ONNX nodes. Encodes an image once for a compatible SAM3 decoder.',
  outputDescription:
    'Outputs are feature tensors, not a displayable mask. Use the Roto node for the complete prompted segmentation workflow.',
  variants: [
    createSam3EncoderVariant({
      label: 'Vision Encoder · Q4',
      fileStem: 'vision_encoder_q4',
      precision: 'q4',
      supportedBackends: ['webgpu'],
    }),
    createSam3EncoderVariant({
      label: 'Vision Encoder · Q4F16',
      fileStem: 'vision_encoder_q4f16',
      precision: 'q4f16',
      supportedBackends: ['webgpu'],
    }),
    createSam3EncoderVariant({
      label: 'Vision Encoder · Q8',
      fileStem: 'vision_encoder_quantized',
      precision: 'quantized',
      supportedBackends: ['webgpu', 'wasm'],
    }),
  ],
};

export const SAM3_TRACKER_MODEL: BuiltinModelBundleDefinition<RotoSegmentationModelVariant> = {
  id: SAM3_TRACKER_MODEL_ID,
  name: 'SAM3 Tracker',
  repoName: SAM3_TRACKER_MODEL_ID,
  runtime: 'transformers-onnx',
  featureLabel: 'Roto Smart Mask',
  description:
    'Point and box segmentation using a cached image embedding and a real-time prompt decoder.',
  variants: SAM3_MODEL_VARIANTS,
  onnxNodeTargets: [SAM3_VISION_ENCODER_TARGET],
};

export const BUILTIN_MODEL_BUNDLES: BuiltinModelBundleDefinition[] = [SAM3_TRACKER_MODEL];

export const createBuiltinOnnxCatalogReference = (
  model: BuiltinModelBundleDefinition,
  target: BuiltinOnnxNodeTargetDefinition,
): ModelCatalogReference => ({
  modelId: model.id,
  modelName: model.name,
  origin: 'builtin',
  runtime: 'onnxruntime',
  targetId: target.id,
  targetLabel: target.label,
  providerId: 'blackboard-studio',
  providerName: 'Blackboard Studio',
});

export const getSam3ModelVariant = (
  variantId: RotoSegmentationModelVariant | undefined,
): BuiltinModelVariantDefinition<RotoSegmentationModelVariant> =>
  SAM3_MODEL_VARIANTS.find((variant) => variant.id === variantId) ?? SAM3_MODEL_VARIANTS[0];

export interface Sam3RuntimeDtypeConfig extends Record<string, 'fp32' | 'q4' | 'q4f16' | 'q8'> {
  vision_encoder: 'q4' | 'q4f16' | 'q8';
  prompt_encoder_mask_decoder: 'fp32' | 'q4f16' | 'q8';
}

export const getSam3RuntimeDtypeConfig = (
  variantId: RotoSegmentationModelVariant,
  backend: OnnxBackend,
): Sam3RuntimeDtypeConfig => {
  const resolvedVariant = variantId === 'auto' ? (backend === 'webgpu' ? 'q4' : 'q8') : variantId;
  if (resolvedVariant === 'q4f16') {
    return { vision_encoder: 'q4f16', prompt_encoder_mask_decoder: 'q4f16' };
  }
  if (resolvedVariant === 'q4') {
    return { vision_encoder: 'q4', prompt_encoder_mask_decoder: 'fp32' };
  }
  return { vision_encoder: 'q8', prompt_encoder_mask_decoder: 'q8' };
};
