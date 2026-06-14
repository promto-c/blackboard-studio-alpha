import {
  backgroundJobTypes,
  getBackgroundJobDefinition,
  type BackgroundJobProgressState,
  type BackgroundJobSource,
  type BackgroundJobType,
} from '@/state/editor/services/backgroundJobDefinitions';
import {
  clampBackgroundJobProgress,
  createBackgroundJobResumeUpdate,
  isBackgroundJobResumable,
  requestRegisteredBackgroundJobCancel,
  registerBackgroundJobCancelHandler,
} from '@/state/editor/services/backgroundJobExecutor';

export type { BackgroundJobProgressState, BackgroundJobSource, BackgroundJobType };
export { registerBackgroundJobCancelHandler, requestRegisteredBackgroundJobCancel };

export type BackgroundJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  specVersion?: number;
  title: string;
  subtitle?: string;
  detail?: string;
  status: BackgroundJobStatus;
  progress?: number;
  progressState?: BackgroundJobProgressState;
  indeterminate?: boolean;
  cancellable?: boolean;
  error?: string;
  source?: BackgroundJobSource;
  payload?: unknown;
  attempt?: number;
  maxAttempts?: number;
  retryAt?: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  cancelRequestedAt?: number;
}

const BACKGROUND_JOBS_STORAGE_KEY = 'blackboard-studio-background-jobs';
const PERSISTED_JOB_LIMIT = 8;
const PERSISTED_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const backgroundJobStatuses = new Set<BackgroundJobStatus>([
  'queued',
  'running',
  'cancelling',
  'complete',
  'error',
  'cancelled',
]);

export type BackgroundJobInput = Omit<
  BackgroundJob,
  'id' | 'startedAt' | 'updatedAt' | 'completedAt' | 'cancelRequestedAt'
> & {
  id?: string;
  startedAt?: number;
};

export type BackgroundJobUpdate = Partial<
  Pick<
    BackgroundJob,
    | 'title'
    | 'subtitle'
    | 'detail'
    | 'status'
    | 'progress'
    | 'progressState'
    | 'indeterminate'
    | 'cancellable'
    | 'error'
    | 'source'
    | 'payload'
    | 'attempt'
    | 'maxAttempts'
    | 'retryAt'
  >
>;

export const isBackgroundJobActive = (job: Pick<BackgroundJob, 'status'>): boolean =>
  job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';

export const createBackgroundJobId = (prefix = 'job'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createBackgroundJob = (input: BackgroundJobInput): BackgroundJob => {
  const now = input.startedAt ?? Date.now();
  const definition = getBackgroundJobDefinition(input.type);
  const retryPolicy = definition.retryPolicy;
  const defaultProgress = definition.progress.initial.progress;
  const defaultIndeterminate = definition.progress.initial.indeterminate;
  const defaultDetail = definition.progress.initial.detail;
  const finiteMaxAttempts =
    retryPolicy && Number.isFinite(retryPolicy.maxAttempts) ? retryPolicy.maxAttempts : undefined;

  return {
    ...input,
    id: input.id ?? createBackgroundJobId(input.type),
    specVersion: input.specVersion ?? definition.version,
    detail: input.detail ?? defaultDetail,
    progress:
      input.progress !== undefined ? clampBackgroundJobProgress(input.progress) : defaultProgress,
    indeterminate: input.indeterminate ?? defaultIndeterminate,
    cancellable: input.cancellable ?? definition.defaultCancellable,
    attempt: input.attempt ?? 0,
    ...(input.maxAttempts !== undefined
      ? { maxAttempts: input.maxAttempts }
      : finiteMaxAttempts !== undefined
        ? { maxAttempts: finiteMaxAttempts }
        : {}),
    startedAt: now,
    updatedAt: now,
  };
};

export const upsertBackgroundJob = (jobs: BackgroundJob[], job: BackgroundJob): BackgroundJob[] => {
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  if (index === -1) return [job, ...jobs];
  return jobs.map((candidate, candidateIndex) => (candidateIndex === index ? job : candidate));
};

export const updateBackgroundJobById = (
  jobs: BackgroundJob[],
  jobId: string,
  updates: BackgroundJobUpdate,
): BackgroundJob[] =>
  jobs.map((job) => {
    if (job.id !== jobId) return job;

    const nextStatus = updates.status ?? job.status;
    const completedAt =
      !isBackgroundJobActive({ status: nextStatus }) && !job.completedAt
        ? Date.now()
        : job.completedAt;
    const progress =
      updates.progress !== undefined
        ? clampBackgroundJobProgress(updates.progress)
        : updates.progressState?.percent !== undefined
          ? clampBackgroundJobProgress(updates.progressState.percent)
          : job.progress;

    return {
      ...job,
      ...updates,
      ...(progress !== undefined ? { progress } : {}),
      updatedAt: Date.now(),
      completedAt,
    };
  });

export const requestBackgroundJobCancelById = (
  jobs: BackgroundJob[],
  jobId: string,
): BackgroundJob[] =>
  jobs.map((job) => {
    if (job.id !== jobId || !isBackgroundJobActive(job)) return job;
    const now = Date.now();
    return {
      ...job,
      status: 'cancelling',
      detail: job.detail ?? 'Cancelling...',
      cancelRequestedAt: job.cancelRequestedAt ?? now,
      updatedAt: now,
    };
  });

export const pruneBackgroundJobs = (
  jobs: BackgroundJob[],
  options: { keepRecent?: number; now?: number; maxAgeMs?: number } = {},
): BackgroundJob[] => {
  const keepRecent = options.keepRecent ?? 5;
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 10 * 60 * 1000;

  const activeJobs = jobs.filter(isBackgroundJobActive);
  const finishedJobs = jobs
    .filter((job) => !isBackgroundJobActive(job))
    .filter((job) => !job.completedAt || now - job.completedAt <= maxAgeMs)
    .slice(0, keepRecent);

  return [...activeJobs, ...finishedJobs];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && !!item.trim());
  return strings.length > 0 ? strings : undefined;
};

const readComfyInputContext = (value: unknown): 'props' | 'viewportTool' | undefined =>
  value === 'props' || value === 'viewportTool' ? value : undefined;

const readComfyViewportRect = (
  value: unknown,
): { x: number; y: number; width: number; height: number } | undefined => {
  if (!isRecord(value)) return undefined;
  const x = readFiniteNumber(value.x);
  const y = readFiniteNumber(value.y);
  const width = readFiniteNumber(value.width);
  const height = readFiniteNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
};

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const readJsonPayload = (value: unknown): unknown =>
  value === undefined || typeof value === 'function' ? undefined : value;

const readBackgroundJobType = (value: unknown): BackgroundJobType | undefined =>
  typeof value === 'string' && backgroundJobTypes.has(value as BackgroundJobType)
    ? (value as BackgroundJobType)
    : undefined;

const readBackgroundJobStatus = (value: unknown): BackgroundJobStatus | undefined =>
  typeof value === 'string' && backgroundJobStatuses.has(value as BackgroundJobStatus)
    ? (value as BackgroundJobStatus)
    : undefined;

const readBackgroundJobSource = (value: unknown): BackgroundJobSource | undefined => {
  if (!isRecord(value)) return undefined;

  const source: BackgroundJobSource = {};
  const projectId = readString(value.projectId);
  const branchId = readString(value.branchId);
  const nodeId = readString(value.nodeId);
  const workflowId = readString(value.workflowId);
  const historyId = readString(value.historyId);
  const promptId = readString(value.promptId);
  const comfyEndpoint = readString(value.comfyEndpoint);
  const comfyInputContext = readComfyInputContext(value.comfyInputContext);
  const comfyViewportRect = readComfyViewportRect(value.comfyViewportRect);
  const outputNodeIds = readStringArray(value.outputNodeIds);
  const restoredFromStorage = readBoolean(value.restoredFromStorage);
  const chatId = readString(value.chatId);
  const taskId = readString(value.taskId);
  const modelId = readString(value.modelId);
  const runIndex = readFiniteNumber(value.runIndex);
  const runCount = readFiniteNumber(value.runCount);
  const completedCount = readFiniteNumber(value.completedCount);
  const upstreamNodeIds = readStringArray(value.upstreamNodeIds);
  const downloadId = readString(value.downloadId);
  const repoName = readString(value.repoName);
  const variantId = readString(value.variantId);
  const url = readString(value.url);
  const filename = readString(value.filename);

  if (projectId) source.projectId = projectId;
  if (branchId) source.branchId = branchId;
  if (nodeId) source.nodeId = nodeId;
  if (workflowId) source.workflowId = workflowId;
  if (historyId) source.historyId = historyId;
  if (promptId) source.promptId = promptId;
  if (comfyEndpoint) source.comfyEndpoint = comfyEndpoint;
  if (comfyInputContext) source.comfyInputContext = comfyInputContext;
  if (comfyViewportRect) source.comfyViewportRect = comfyViewportRect;
  if (outputNodeIds) source.outputNodeIds = outputNodeIds;
  if (restoredFromStorage !== undefined) source.restoredFromStorage = restoredFromStorage;
  if (chatId) source.chatId = chatId;
  if (taskId) source.taskId = taskId;
  if (modelId) source.modelId = modelId;
  if (runIndex !== undefined) source.runIndex = runIndex;
  if (runCount !== undefined) source.runCount = runCount;
  if (completedCount !== undefined) source.completedCount = completedCount;
  if (upstreamNodeIds) source.upstreamNodeIds = upstreamNodeIds;
  if (downloadId) source.downloadId = downloadId;
  if (repoName) source.repoName = repoName;
  if (variantId) source.variantId = variantId;
  if (url) source.url = url;
  if (filename) source.filename = filename;

  return Object.keys(source).length > 0 ? source : undefined;
};

const readBackgroundJobProgressState = (value: unknown): BackgroundJobProgressState | undefined => {
  if (!isRecord(value)) return undefined;

  const progressState: BackgroundJobProgressState = {};
  const label = readString(value.label);
  const detail = readString(value.detail);
  const loaded = readFiniteNumber(value.loaded);
  const total = readFiniteNumber(value.total);
  const percent = clampBackgroundJobProgress(readFiniteNumber(value.percent));

  if (label) progressState.label = label;
  if (detail) progressState.detail = detail;
  if (loaded !== undefined) progressState.loaded = loaded;
  if (total !== undefined) progressState.total = total;
  if (percent !== undefined) progressState.percent = percent;

  if (isRecord(value.currentFile)) {
    const name = readString(value.currentFile.name);
    if (name) {
      progressState.currentFile = {
        name,
        ...(readFiniteNumber(value.currentFile.loaded) !== undefined
          ? { loaded: readFiniteNumber(value.currentFile.loaded) }
          : {}),
        ...(readFiniteNumber(value.currentFile.size) !== undefined
          ? { size: readFiniteNumber(value.currentFile.size) }
          : {}),
        ...(readFiniteNumber(value.currentFile.index) !== undefined
          ? { index: readFiniteNumber(value.currentFile.index) }
          : {}),
        ...(readFiniteNumber(value.currentFile.count) !== undefined
          ? { count: readFiniteNumber(value.currentFile.count) }
          : {}),
      };
    }
  }

  return Object.keys(progressState).length > 0 ? progressState : undefined;
};

const normalizePersistedBackgroundJob = (value: unknown, now: number): BackgroundJob | null => {
  if (!isRecord(value)) return null;

  const id = readString(value.id);
  const type = readBackgroundJobType(value.type);
  const title = readString(value.title);
  const status = readBackgroundJobStatus(value.status);
  if (!id || !type || !title || !status) return null;

  const definition = getBackgroundJobDefinition(type);
  const source = readBackgroundJobSource(value.source);
  const progressState = readBackgroundJobProgressState(value.progressState);
  const payload = readJsonPayload(value.payload);
  const hasRequiredRestartPayload =
    type !== 'onnx-download' && type !== 'model-download'
      ? true
      : isRecord(payload) && isRecord(payload.variant);
  const wasActive = isBackgroundJobActive({ status });
  const resumableJob =
    wasActive && hasRequiredRestartPayload && isBackgroundJobResumable({ type, source });
  const resumeUpdate = resumableJob
    ? createBackgroundJobResumeUpdate({
        type,
        source,
        progress: readFiniteNumber(value.progress),
      })
    : null;
  const nextStatus: BackgroundJobStatus = wasActive && !resumableJob ? 'error' : status;
  const startedAt = readFiniteNumber(value.startedAt) ?? now;
  const updatedAt =
    wasActive && !resumableJob ? now : (readFiniteNumber(value.updatedAt) ?? startedAt);
  const completedAt =
    wasActive && !resumableJob
      ? now
      : (readFiniteNumber(value.completedAt) ??
        (!isBackgroundJobActive({ status: nextStatus }) ? updatedAt : undefined));
  const subtitle = readString(value.subtitle);
  const detail = resumableJob
    ? resumeUpdate?.detail
    : wasActive
      ? 'Interrupted when the app was reloaded.'
      : readString(value.detail);
  const progress = clampBackgroundJobProgress(
    resumeUpdate?.progress ?? progressState?.percent ?? readFiniteNumber(value.progress),
  );
  const indeterminate = readBoolean(value.indeterminate);
  const cancellable = readBoolean(value.cancellable);
  const error = readString(value.error);
  const cancelRequestedAt = readFiniteNumber(value.cancelRequestedAt);
  const normalizedSource = resumableJob ? resumeUpdate?.source : source;
  const attempt = readFiniteNumber(value.attempt);
  const maxAttempts = readFiniteNumber(value.maxAttempts);
  const retryAt = readFiniteNumber(value.retryAt);
  const specVersion = readFiniteNumber(value.specVersion) ?? definition.version;

  return {
    id,
    type,
    specVersion,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(detail ? { detail } : {}),
    status: resumeUpdate?.status ?? nextStatus,
    ...(progress !== undefined ? { progress } : {}),
    ...(progressState && !resumableJob ? { progressState } : {}),
    ...(resumableJob
      ? {
          indeterminate: resumeUpdate?.indeterminate ?? definition.progress.initial.indeterminate,
          cancellable: false,
        }
      : {}),
    ...(wasActive && !resumableJob
      ? { indeterminate: false, cancellable: false, error: 'Interrupted by app reload' }
      : {}),
    ...(indeterminate !== undefined && !wasActive ? { indeterminate } : {}),
    ...(cancellable !== undefined && !wasActive ? { cancellable } : {}),
    ...(error && !wasActive ? { error } : {}),
    ...(normalizedSource ? { source: normalizedSource } : {}),
    ...(payload !== undefined ? { payload } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(retryAt !== undefined ? { retryAt } : {}),
    startedAt,
    updatedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(cancelRequestedAt !== undefined ? { cancelRequestedAt } : {}),
  };
};

export const loadPersistedBackgroundJobs = (): BackgroundJob[] => {
  if (typeof localStorage === 'undefined') return [];

  try {
    const stored = localStorage.getItem(BACKGROUND_JOBS_STORAGE_KEY);
    if (!stored) return [];

    const now = Date.now();
    const parsed = JSON.parse(stored);
    const jobs = Array.isArray(parsed)
      ? parsed
          .map((job) => normalizePersistedBackgroundJob(job, now))
          .filter((job): job is BackgroundJob => !!job)
      : [];
    const prunedJobs = pruneBackgroundJobs(jobs, {
      keepRecent: PERSISTED_JOB_LIMIT,
      maxAgeMs: PERSISTED_JOB_MAX_AGE_MS,
      now,
    });

    savePersistedBackgroundJobs(prunedJobs);
    return prunedJobs;
  } catch (error) {
    console.error('Could not load background jobs from localStorage', error);
    return [];
  }
};

export const savePersistedBackgroundJobs = (jobs: BackgroundJob[]): void => {
  if (typeof localStorage === 'undefined') return;

  try {
    const prunedJobs = pruneBackgroundJobs(jobs, {
      keepRecent: PERSISTED_JOB_LIMIT,
      maxAgeMs: PERSISTED_JOB_MAX_AGE_MS,
    });
    if (prunedJobs.length === 0) {
      localStorage.removeItem(BACKGROUND_JOBS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(BACKGROUND_JOBS_STORAGE_KEY, JSON.stringify(prunedJobs));
  } catch (error) {
    console.error('Could not save background jobs to localStorage', error);
  }
};
