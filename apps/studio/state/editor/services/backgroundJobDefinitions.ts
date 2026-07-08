export type BackgroundJobType =
  | 'comfy'
  | 'render'
  | 'tracking'
  | 'ai'
  | 'agent'
  | 'onnx-download'
  | 'onnx-inference'
  | 'model-download'
  | 'download'
  | 'other';

export type BackgroundJobResumabilityMode = 'none' | 'reconnect' | 'restart';

export interface BackgroundJobRetryPolicy {
  maxAttempts: number;
  retryDelayMs: number;
  backoffMultiplier?: number;
  retryablePhases?: string[];
}

export interface BackgroundJobProgressDefaults {
  progress?: number;
  indeterminate?: boolean;
  detail?: string;
}

export interface DurableJobDefinition<TType extends BackgroundJobType = BackgroundJobType> {
  type: TType;
  label: string;
  version: number;
  durable: boolean;
  defaultCancellable: boolean;
  progress: {
    mode: 'determinate' | 'indeterminate' | 'mixed';
    initial: BackgroundJobProgressDefaults;
  };
  retryPolicy?: BackgroundJobRetryPolicy;
  resumability: {
    mode: BackgroundJobResumabilityMode;
    detail?: string;
    canResume?: (source: BackgroundJobSource | undefined) => boolean;
  };
}

export interface BackgroundJobSource {
  projectId?: string;
  branchId?: string;
  nodeId?: string;
  workflowId?: string;
  batchId?: string;
  historyId?: string;
  promptId?: string;
  comfyEndpoint?: string;
  comfyInputContext?: 'props' | 'viewportTool';
  comfyViewportRect?: { x: number; y: number; width: number; height: number };
  comfyRegionId?: string;
  outputNodeIds?: string[];
  restoredFromStorage?: boolean;
  chatId?: string;
  taskId?: string;
  modelId?: string;
  runIndex?: number;
  runCount?: number;
  completedCount?: number;
  upstreamNodeIds?: string[];
  downloadId?: string;
  repoName?: string;
  variantId?: string;
  url?: string;
  filename?: string;
}

export interface BackgroundJobProgressState {
  label?: string;
  detail?: string;
  loaded?: number;
  total?: number;
  percent?: number;
  currentFile?: {
    name: string;
    loaded?: number;
    size?: number;
    index?: number;
    count?: number;
  };
}

const canResumeComfyJob = (source: BackgroundJobSource | undefined): boolean => !!source?.promptId;

const canRestartDownloadJob = (source: BackgroundJobSource | undefined): boolean =>
  !!source?.url || !!source?.modelId || !!source?.downloadId;

export const BACKGROUND_JOB_DEFINITIONS = {
  comfy: {
    type: 'comfy',
    label: 'Comfy',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'mixed', initial: { progress: 8, indeterminate: true } },
    retryPolicy: {
      maxAttempts: Number.POSITIVE_INFINITY,
      retryDelayMs: 5_000,
      retryablePhases: ['checking', 'waiting'],
    },
    resumability: {
      mode: 'reconnect',
      detail: 'Reconnecting to ComfyUI...',
      canResume: canResumeComfyJob,
    },
  },
  render: {
    type: 'render',
    label: 'Render',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'determinate', initial: { progress: 0, indeterminate: false } },
    resumability: { mode: 'none' },
  },
  tracking: {
    type: 'tracking',
    label: 'Tracking',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'determinate', initial: { progress: 0, indeterminate: false } },
    resumability: { mode: 'none' },
  },
  ai: {
    type: 'ai',
    label: 'AI',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'indeterminate', initial: { progress: 25, indeterminate: true } },
    retryPolicy: { maxAttempts: 2, retryDelayMs: 1_500, backoffMultiplier: 2 },
    resumability: { mode: 'none' },
  },
  agent: {
    type: 'agent',
    label: 'Agent',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'indeterminate', initial: { progress: 20, indeterminate: true } },
    retryPolicy: { maxAttempts: 2, retryDelayMs: 1_500, backoffMultiplier: 2 },
    resumability: { mode: 'none' },
  },
  'onnx-download': {
    type: 'onnx-download',
    label: 'ONNX Download',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'determinate', initial: { progress: 0, indeterminate: false } },
    retryPolicy: { maxAttempts: 3, retryDelayMs: 2_000, backoffMultiplier: 2 },
    resumability: {
      mode: 'restart',
      detail: 'Ready to restart ONNX download',
      canResume: canRestartDownloadJob,
    },
  },
  'onnx-inference': {
    type: 'onnx-inference',
    label: 'ONNX Inference',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'mixed', initial: { progress: 0, indeterminate: true } },
    resumability: { mode: 'none' },
  },
  'model-download': {
    type: 'model-download',
    label: 'Model Download',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'determinate', initial: { progress: 0, indeterminate: false } },
    retryPolicy: { maxAttempts: 3, retryDelayMs: 2_000, backoffMultiplier: 2 },
    resumability: {
      mode: 'restart',
      detail: 'Ready to restart model download',
      canResume: canRestartDownloadJob,
    },
  },
  download: {
    type: 'download',
    label: 'Download',
    version: 1,
    durable: true,
    defaultCancellable: true,
    progress: { mode: 'determinate', initial: { progress: 0, indeterminate: false } },
    retryPolicy: { maxAttempts: 3, retryDelayMs: 2_000, backoffMultiplier: 2 },
    resumability: {
      mode: 'restart',
      detail: 'Ready to restart download',
      canResume: canRestartDownloadJob,
    },
  },
  other: {
    type: 'other',
    label: 'Job',
    version: 1,
    durable: true,
    defaultCancellable: false,
    progress: { mode: 'indeterminate', initial: { progress: 0, indeterminate: true } },
    resumability: { mode: 'none' },
  },
} satisfies Record<BackgroundJobType, DurableJobDefinition>;

export const backgroundJobTypes = new Set<BackgroundJobType>(
  Object.keys(BACKGROUND_JOB_DEFINITIONS) as BackgroundJobType[],
);

export const getBackgroundJobDefinition = (
  type: BackgroundJobType | string | undefined,
): DurableJobDefinition =>
  type && backgroundJobTypes.has(type as BackgroundJobType)
    ? BACKGROUND_JOB_DEFINITIONS[type as BackgroundJobType]
    : BACKGROUND_JOB_DEFINITIONS.other;

export const isBackgroundJobType = (value: unknown): value is BackgroundJobType =>
  typeof value === 'string' && backgroundJobTypes.has(value as BackgroundJobType);
