export type BackgroundJobType =
  | 'comfy'
  | 'render'
  | 'tracking'
  | 'ai'
  | 'agent'
  | 'model-download'
  | 'download'
  | 'other';

export type BackgroundJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface BackgroundJobSource {
  projectId?: string;
  nodeId?: string;
  workflowId?: string;
  historyId?: string;
  promptId?: string;
  comfyEndpoint?: string;
  outputNodeIds?: string[];
  restoredFromStorage?: boolean;
  chatId?: string;
  taskId?: string;
  modelId?: string;
  runIndex?: number;
  runCount?: number;
  completedCount?: number;
}

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  title: string;
  subtitle?: string;
  detail?: string;
  status: BackgroundJobStatus;
  progress?: number;
  indeterminate?: boolean;
  cancellable?: boolean;
  error?: string;
  source?: BackgroundJobSource;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  cancelRequestedAt?: number;
}

const BACKGROUND_JOBS_STORAGE_KEY = 'blackboard-background-jobs-v1';
const PERSISTED_JOB_LIMIT = 8;
const PERSISTED_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const backgroundJobTypes = new Set<BackgroundJobType>([
  'comfy',
  'render',
  'tracking',
  'ai',
  'agent',
  'model-download',
  'download',
  'other',
]);

const backgroundJobStatuses = new Set<BackgroundJobStatus>([
  'queued',
  'running',
  'cancelling',
  'complete',
  'error',
  'cancelled',
]);

type BackgroundJobCancelHandler = () => void;
const backgroundJobCancelHandlers = new Map<string, BackgroundJobCancelHandler>();

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
    | 'indeterminate'
    | 'cancellable'
    | 'error'
    | 'source'
  >
>;

export const isBackgroundJobActive = (job: Pick<BackgroundJob, 'status'>): boolean =>
  job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';

export const createBackgroundJobId = (prefix = 'job'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const registerBackgroundJobCancelHandler = (
  jobId: string,
  handler: BackgroundJobCancelHandler,
): (() => void) => {
  backgroundJobCancelHandlers.set(jobId, handler);
  return () => {
    if (backgroundJobCancelHandlers.get(jobId) === handler) {
      backgroundJobCancelHandlers.delete(jobId);
    }
  };
};

export const requestRegisteredBackgroundJobCancel = (jobId: string): void => {
  backgroundJobCancelHandlers.get(jobId)?.();
};

export const createBackgroundJob = (input: BackgroundJobInput): BackgroundJob => {
  const now = input.startedAt ?? Date.now();
  return {
    ...input,
    id: input.id ?? createBackgroundJobId(input.type),
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

    return {
      ...job,
      ...updates,
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

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

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
  const nodeId = readString(value.nodeId);
  const workflowId = readString(value.workflowId);
  const historyId = readString(value.historyId);
  const promptId = readString(value.promptId);
  const comfyEndpoint = readString(value.comfyEndpoint);
  const outputNodeIds = readStringArray(value.outputNodeIds);
  const restoredFromStorage = readBoolean(value.restoredFromStorage);
  const chatId = readString(value.chatId);
  const taskId = readString(value.taskId);
  const modelId = readString(value.modelId);
  const runIndex = readFiniteNumber(value.runIndex);
  const runCount = readFiniteNumber(value.runCount);
  const completedCount = readFiniteNumber(value.completedCount);

  if (projectId) source.projectId = projectId;
  if (nodeId) source.nodeId = nodeId;
  if (workflowId) source.workflowId = workflowId;
  if (historyId) source.historyId = historyId;
  if (promptId) source.promptId = promptId;
  if (comfyEndpoint) source.comfyEndpoint = comfyEndpoint;
  if (outputNodeIds) source.outputNodeIds = outputNodeIds;
  if (restoredFromStorage !== undefined) source.restoredFromStorage = restoredFromStorage;
  if (chatId) source.chatId = chatId;
  if (taskId) source.taskId = taskId;
  if (modelId) source.modelId = modelId;
  if (runIndex !== undefined) source.runIndex = runIndex;
  if (runCount !== undefined) source.runCount = runCount;
  if (completedCount !== undefined) source.completedCount = completedCount;

  return Object.keys(source).length > 0 ? source : undefined;
};

const normalizePersistedBackgroundJob = (value: unknown, now: number): BackgroundJob | null => {
  if (!isRecord(value)) return null;

  const id = readString(value.id);
  const type = readBackgroundJobType(value.type);
  const title = readString(value.title);
  const status = readBackgroundJobStatus(value.status);
  if (!id || !type || !title || !status) return null;

  const source = readBackgroundJobSource(value.source);
  const wasActive = isBackgroundJobActive({ status });
  const isResumableComfyJob =
    (status === 'queued' || status === 'running') && type === 'comfy' && !!source?.promptId;
  const nextStatus: BackgroundJobStatus = wasActive && !isResumableComfyJob ? 'error' : status;
  const startedAt = readFiniteNumber(value.startedAt) ?? now;
  const updatedAt =
    wasActive && !isResumableComfyJob ? now : (readFiniteNumber(value.updatedAt) ?? startedAt);
  const completedAt =
    wasActive && !isResumableComfyJob
      ? now
      : (readFiniteNumber(value.completedAt) ??
        (!isBackgroundJobActive({ status: nextStatus }) ? updatedAt : undefined));
  const subtitle = readString(value.subtitle);
  const detail = isResumableComfyJob
    ? 'Reconnecting to ComfyUI...'
    : wasActive
      ? 'Interrupted when the app was reloaded.'
      : readString(value.detail);
  const progress = readFiniteNumber(value.progress);
  const indeterminate = readBoolean(value.indeterminate);
  const cancellable = readBoolean(value.cancellable);
  const error = readString(value.error);
  const cancelRequestedAt = readFiniteNumber(value.cancelRequestedAt);
  const normalizedSource = isResumableComfyJob
    ? { ...source, restoredFromStorage: true }
    : source;

  return {
    id,
    type,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(detail ? { detail } : {}),
    status: nextStatus,
    ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, progress)) } : {}),
    ...(isResumableComfyJob ? { indeterminate: true, cancellable: false } : {}),
    ...(wasActive && !isResumableComfyJob
      ? { indeterminate: false, cancellable: false, error: 'Interrupted by app reload' }
      : {}),
    ...(indeterminate !== undefined && !wasActive ? { indeterminate } : {}),
    ...(cancellable !== undefined && !wasActive ? { cancellable } : {}),
    ...(error && !wasActive ? { error } : {}),
    ...(normalizedSource ? { source: normalizedSource } : {}),
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
