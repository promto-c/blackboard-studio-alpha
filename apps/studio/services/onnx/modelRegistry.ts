import type {
  OnnxBackend,
  OnnxModelScale,
  OnnxModelTask,
  OnnxModelVariantMetadata,
  OnnxNormalization,
  OnnxPrecision,
} from '@blackboard/types';

export interface OnnxModelRecipe {
  id: string;
  name: string;
  task: OnnxModelTask;
  defaultRepoName: string;
  defaultInputSize: { width: number; height: number };
  inputPortLabel: string;
  outputPortLabel: string;
  preprocessing: string;
  postprocessing: string;
  supportedBackends: OnnxBackend[];
  normalization: OnnxNormalization;
}

export interface HuggingFaceRepoFile {
  path: string;
  size?: number;
  type?: string;
}

export const DEPTH_ANYTHING_V2_RECIPE: OnnxModelRecipe = {
  id: 'depth-anything-v2',
  name: 'Depth Anything V2',
  task: 'depth-estimation',
  defaultRepoName: 'onnx-community/depth-anything-v2-small-ONNX',
  defaultInputSize: { width: 518, height: 518 },
  inputPortLabel: 'Image',
  outputPortLabel: 'Depth Map',
  preprocessing: 'Resize to square input, ImageNet normalization, NCHW float tensor.',
  postprocessing: 'Normalize first output tensor to grayscale depth map.',
  supportedBackends: ['webgpu', 'wasm'],
  normalization: 'imagenet',
};

export const LAMA_RECIPE: OnnxModelRecipe = {
  id: 'lama',
  name: 'LaMa Inpainting',
  task: 'inpainting',
  defaultRepoName: 'opencv/inpainting_lama',
  defaultInputSize: { width: 512, height: 512 },
  inputPortLabel: 'Image + Mask',
  outputPortLabel: 'Inpainted',
  preprocessing: 'Resize to 512x512, scale pixel values to [0, 1].',
  postprocessing: 'Clamp raw output values to [0, 255].',
  supportedBackends: ['webgpu', 'wasm'],
  normalization: 'zeroToOne',
};

export const ONNX_MODEL_RECIPES: OnnxModelRecipe[] = [DEPTH_ANYTHING_V2_RECIPE, LAMA_RECIPE];

export const GENERIC_ONNX_RECIPE: OnnxModelRecipe = {
  id: 'generic',
  name: 'Generic ONNX',
  task: 'generic',
  defaultRepoName: '',
  defaultInputSize: { width: 224, height: 224 },
  inputPortLabel: 'Input',
  outputPortLabel: 'Output',
  preprocessing: 'Resize to model input size, convert to tensor.',
  postprocessing: 'Convert output tensor to image.',
  supportedBackends: ['webgpu', 'wasm'],
  normalization: 'imagenet',
};

export const resolveRecipe = (repoName: string): OnnxModelRecipe => {
  const normalized = normalizeHuggingFaceRepoName(repoName);
  for (const recipe of ONNX_MODEL_RECIPES) {
    if (
      recipe.defaultRepoName &&
      normalizeHuggingFaceRepoName(recipe.defaultRepoName) === normalized
    ) {
      return recipe;
    }
  }
  return GENERIC_ONNX_RECIPE;
};

export const DEFAULT_ONNX_REPO = DEPTH_ANYTHING_V2_RECIPE.defaultRepoName;

export const getVariantTotalSize = (variant: OnnxModelVariantMetadata): number | undefined => {
  if (variant.sizeBytes == null) return undefined;
  let total = variant.sizeBytes;
  if (variant.externalDataFiles?.length) {
    total += variant.externalDataFiles.reduce((sum, f) => sum + (f.size ?? 0), 0);
  }
  return total;
};

export interface VariantRequiredFile {
  path: string;
  size?: number;
  type: 'onnx' | 'external-data';
}

export const getVariantRequiredFiles = (
  variant: OnnxModelVariantMetadata,
): VariantRequiredFile[] => {
  const files: VariantRequiredFile[] = [
    { path: variant.filePath, size: variant.sizeBytes, type: 'onnx' },
  ];
  if (variant.externalDataFiles?.length) {
    for (const ext of variant.externalDataFiles) {
      files.push({ path: ext.path, size: ext.size, type: 'external-data' });
    }
  }
  return files;
};

export const getOnnxModelRecipe = (recipeId?: string): OnnxModelRecipe =>
  ONNX_MODEL_RECIPES.find((recipe) => recipe.id === recipeId) ?? GENERIC_ONNX_RECIPE;

export const normalizeHuggingFaceRepoName = (value: string): string =>
  value
    .trim()
    .replace(/^https:\/\/huggingface\.co\//, '')
    .replace(/\/tree\/[^/]+.*$/, '')
    .replace(/^\/+|\/+$/g, '');

const EXTERNAL_DATA_EXTENSIONS = [
  '.onnx_data',
  '.bin',
  '.data',
  '.weights',
  '.blob',
  '.raw',
  '.params',
];

const isExternalDataFile = (path: string): boolean => {
  const lower = path.toLowerCase();
  return EXTERNAL_DATA_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const getDirectoryPath = (filePath: string): string => {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
};

const getPathTokens = (path: string): string[] =>
  path
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const detectScale = (path: string): OnnxModelScale => {
  const tokens = getPathTokens(path);
  if (tokens.includes('small') || tokens.includes('s')) return 'small';
  if (tokens.includes('base') || tokens.includes('b')) return 'base';
  if (tokens.includes('large') || tokens.includes('l')) return 'large';
  return 'unknown';
};

const detectPrecision = (path: string): OnnxPrecision => {
  const normalized = path.toLowerCase();

  // Specific bit-width types (check before generic quantized)
  if (normalized.includes('q4f16')) return 'q4f16';
  if (normalized.includes('q4') || normalized.includes('4bit')) return 'q4';
  if (normalized.includes('q2') || normalized.includes('2bit')) return 'q2';
  if (normalized.includes('bfloat16') || normalized.includes('bf16')) return 'bfloat16';
  if (
    normalized.includes('fp64') ||
    normalized.includes('float64') ||
    normalized.includes('double')
  )
    return 'fp64';
  if (normalized.includes('int8')) return 'int8';
  if (normalized.includes('uint8')) return 'uint8';
  if (normalized.includes('int16')) return 'int16';
  if (normalized.includes('uint16')) return 'uint16';
  if (normalized.includes('int32')) return 'int32';
  if (normalized.includes('uint32')) return 'uint32';

  // Generic quantized (catch-all for other quantization schemes)
  if (normalized.includes('quant')) return 'quantized';

  // Standard floating point
  if (normalized.includes('fp16') || normalized.includes('float16')) return 'fp16';
  if (normalized.includes('fp32') || normalized.includes('float32')) return 'fp32';

  return 'unknown';
};

const detectBackends = (path: string): OnnxBackend[] => {
  const normalized = path.toLowerCase();
  if (normalized.includes('wasm')) return ['wasm'];
  if (normalized.includes('webgpu')) return ['webgpu', 'wasm'];
  // FP16, BF16, and quantized types are WebGPU-friendly
  if (
    normalized.includes('fp16') ||
    normalized.includes('float16') ||
    normalized.includes('bf16') ||
    normalized.includes('bfloat16') ||
    normalized.includes('q4') ||
    normalized.includes('q2') ||
    normalized.includes('int8') ||
    normalized.includes('uint8')
  )
    return ['webgpu', 'wasm'];
  return ['webgpu', 'wasm'];
};

const getVariantLabel = (path: string): string => {
  const scale = detectScale(path);
  const precision = detectPrecision(path);
  const parts = [
    scale !== 'unknown' ? scale[0].toUpperCase() + scale.slice(1) : null,
    precision !== 'unknown' ? precision.toUpperCase() : null,
    'ONNX',
  ].filter(Boolean);
  return parts.join(' ');
};

const getVariantRank = (variant: OnnxModelVariantMetadata): number => {
  const scaleRank = variant.scale === 'small' ? 0 : variant.scale === 'base' ? 20 : 40;
  const precisionRank =
    variant.precision === 'q2'
      ? 0
      : variant.precision === 'q4f16'
        ? 1
        : variant.precision === 'q4'
          ? 2
          : variant.precision === 'int8' || variant.precision === 'uint8'
            ? 3
            : variant.precision === 'quantized'
              ? 4
              : variant.precision === 'bfloat16'
                ? 5
                : variant.precision === 'fp16'
                  ? 6
                  : variant.precision === 'fp32'
                    ? 11
                    : variant.precision === 'fp64'
                      ? 13
                      : 16;
  const backendRank = variant.supportedBackends.includes('webgpu') ? 0 : 5;
  const sizeRank = variant.sizeBytes ? Math.min(50, variant.sizeBytes / 1024 / 1024 / 100) : 25;
  return scaleRank + precisionRank + backendRank + sizeRank;
};

const getAssociatedExternalData = (
  onnxPath: string,
  files: HuggingFaceRepoFile[],
): { path: string; size?: number }[] => {
  const dir = getDirectoryPath(onnxPath);
  const fullFileName = onnxPath.slice(dir.length > 0 ? dir.length + 1 : 0);
  return files.filter((f) => {
    if (f.path === onnxPath || getDirectoryPath(f.path) !== dir || !isExternalDataFile(f.path)) {
      return false;
    }
    const fName = f.path.slice(dir.length > 0 ? dir.length + 1 : 0);
    return fName.startsWith(fullFileName);
  });
};

export const resolveOnnxVariantsFromRepoFiles = ({
  repoName,
  files,
  recipe = DEPTH_ANYTHING_V2_RECIPE,
}: {
  repoName: string;
  files: HuggingFaceRepoFile[];
  recipe?: OnnxModelRecipe;
}): OnnxModelVariantMetadata[] => {
  const variants = files
    .filter((file) => file.path.toLowerCase().endsWith('.onnx'))
    .map((file) => {
      const scale = detectScale(file.path);
      const precision = detectPrecision(file.path);
      const supportedBackends = detectBackends(file.path);
      return {
        id: `${repoName}:${file.path}`,
        repoName,
        filePath: file.path,
        label: getVariantLabel(file.path),
        sizeBytes: file.size,
        precision,
        scale,
        supportedBackends,
        preprocessing: recipe.preprocessing,
        postprocessing: recipe.postprocessing,
        externalDataFiles: getAssociatedExternalData(file.path, files),
      } satisfies OnnxModelVariantMetadata;
    });

  return variants.sort((a, b) => getVariantRank(a) - getVariantRank(b));
};

export const selectDefaultOnnxVariant = (
  variants: OnnxModelVariantMetadata[],
): OnnxModelVariantMetadata | null => variants[0] ?? null;

const getHuggingFaceApiUrl = (repoName: string): string =>
  `https://huggingface.co/api/models/${encodeURIComponent(repoName).replace('%2F', '/')}/tree/main?recursive=1`;

export const fetchHuggingFaceOnnxRepoFiles = async (
  repoName: string,
  signal?: AbortSignal,
): Promise<HuggingFaceRepoFile[]> => {
  const normalizedRepoName = normalizeHuggingFaceRepoName(repoName);
  if (!normalizedRepoName.includes('/')) {
    throw new Error('Enter a Hugging Face repo in owner/name format.');
  }

  const response = await fetch(getHuggingFaceApiUrl(normalizedRepoName), { signal });
  if (!response.ok) {
    throw new Error(`Could not browse ${normalizedRepoName}: HTTP ${response.status}`);
  }

  const data = (await response.json()) as Array<{
    path?: unknown;
    size?: unknown;
    type?: unknown;
  }>;

  return data
    .map((entry) => ({
      path: typeof entry.path === 'string' ? entry.path : '',
      size: typeof entry.size === 'number' ? entry.size : undefined,
      type: typeof entry.type === 'string' ? entry.type : undefined,
    }))
    .filter((entry) => entry.path && entry.type !== 'directory');
};

export const searchHuggingFaceOnnxModels = async (
  query: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const params = new URLSearchParams({
    search: query.trim() || 'onnx',
    library: 'onnx',
    limit: '12',
  });
  const response = await fetch(`https://huggingface.co/api/models?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`Hugging Face search failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as Array<{ id?: unknown; modelId?: unknown }>;
  return data
    .map((entry) => {
      const id = typeof entry.id === 'string' ? entry.id : entry.modelId;
      return typeof id === 'string' ? id : '';
    })
    .filter(Boolean);
};
