import {
  getBackgroundJobDefinition,
  type BackgroundJobProgressState,
  type BackgroundJobSource,
  type BackgroundJobType,
} from '@/state/editor/services/backgroundJobDefinitions';

export type BackgroundJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface ExecutableBackgroundJob {
  id: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  title: string;
  progress?: number;
  indeterminate?: boolean;
  source?: BackgroundJobSource;
  attempt?: number;
  maxAttempts?: number;
}

export type BackgroundJobCancelHandler = () => void;

export interface BackgroundJobUpdateLike {
  title?: string;
  subtitle?: string;
  detail?: string;
  status?: BackgroundJobStatus;
  progress?: number;
  progressState?: BackgroundJobProgressState;
  indeterminate?: boolean;
  cancellable?: boolean;
  error?: string;
  source?: BackgroundJobSource;
  attempt?: number;
  maxAttempts?: number;
  retryAt?: number;
  payload?: unknown;
}

export interface BackgroundJobRunContext {
  jobId: string;
  signal: AbortSignal;
  update: (updates: BackgroundJobUpdateLike) => void;
  progress: (progress: BackgroundJobProgressState) => void;
  isCancellationRequested: () => boolean;
}

export type BackgroundJobRunner = (
  context: BackgroundJobRunContext,
) => Promise<BackgroundJobUpdateLike | void>;

export interface BackgroundJobRunBridge {
  update: (jobId: string, updates: BackgroundJobUpdateLike) => void;
  finish: (jobId: string, updates?: BackgroundJobUpdateLike) => void;
}

export interface BackgroundJobFailureContext {
  phase?: string;
  message?: string;
}

const backgroundJobCancelHandlers = new Map<string, BackgroundJobCancelHandler>();

const isAbortLikeError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : !!error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError';

const getErrorMessage = (error: unknown, fallback = 'Background job failed.'): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;

const waitForRetryDelay = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Job cancelled', 'AbortError'));
      return;
    }

    const timeoutId = setTimeout(resolve, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Job cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });

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

export const clampBackgroundJobProgress = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined;

export const createBackgroundJobProgressUpdate = (
  progress: BackgroundJobProgressState,
): BackgroundJobUpdateLike => {
  const progressPercent =
    clampBackgroundJobProgress(progress.percent) ??
    (progress.loaded !== undefined && progress.total
      ? clampBackgroundJobProgress((progress.loaded / progress.total) * 100)
      : undefined);

  return {
    ...(progress.label ? { detail: progress.label } : {}),
    ...(progress.detail ? { detail: progress.detail } : {}),
    ...(progressPercent !== undefined ? { progress: progressPercent } : {}),
    indeterminate: progressPercent === undefined,
    progressState: {
      ...progress,
      ...(progressPercent !== undefined ? { percent: progressPercent } : {}),
    },
  };
};

export const getBackgroundJobRetryDelay = (job: ExecutableBackgroundJob): number => {
  const definition = getBackgroundJobDefinition(job.type);
  const retryPolicy = definition.retryPolicy;
  if (!retryPolicy) return 0;

  const retryIndex = Math.max(0, job.attempt ?? 0);
  const multiplier = retryPolicy.backoffMultiplier ?? 1;
  return Math.round(retryPolicy.retryDelayMs * multiplier ** retryIndex);
};

export const shouldRetryBackgroundJobFailure = (
  job: ExecutableBackgroundJob,
  context: BackgroundJobFailureContext = {},
): boolean => {
  const definition = getBackgroundJobDefinition(job.type);
  const retryPolicy = definition.retryPolicy;
  if (!retryPolicy) return false;

  if (
    context.phase &&
    retryPolicy.retryablePhases &&
    !retryPolicy.retryablePhases.includes(context.phase)
  ) {
    return false;
  }

  return (job.attempt ?? 0) < retryPolicy.maxAttempts;
};

export const createBackgroundJobRetryUpdate = (
  job: ExecutableBackgroundJob,
  context: BackgroundJobFailureContext = {},
): BackgroundJobUpdateLike => {
  const delayMs = getBackgroundJobRetryDelay(job);
  const message = context.message ?? 'Job failed.';
  return {
    status: 'running',
    detail: `${message} Will retry.`,
    indeterminate: true,
    cancellable: false,
    attempt: (job.attempt ?? 0) + 1,
    retryAt: Date.now() + delayMs,
  };
};

export const isBackgroundJobResumable = (
  job: Pick<ExecutableBackgroundJob, 'type' | 'source'>,
): boolean => {
  const definition = getBackgroundJobDefinition(job.type);
  const { resumability } = definition;
  if (resumability.mode === 'none') return false;
  return resumability.canResume ? resumability.canResume(job.source) : true;
};

export const createBackgroundJobResumeUpdate = (
  job: Pick<ExecutableBackgroundJob, 'type' | 'source' | 'progress'>,
): BackgroundJobUpdateLike => {
  const definition = getBackgroundJobDefinition(job.type);
  const resumability = definition.resumability;
  const initialProgress = definition.progress.initial.progress;
  return {
    status: resumability.mode === 'restart' ? 'queued' : 'running',
    detail: resumability.detail ?? 'Resuming job...',
    progress: resumability.mode === 'restart' ? (initialProgress ?? 0) : job.progress,
    indeterminate: definition.progress.initial.indeterminate ?? true,
    cancellable: false,
    source: { ...(job.source ?? {}), restoredFromStorage: true },
  };
};

export class BackgroundJobExecutor {
  async run(
    job: ExecutableBackgroundJob,
    bridge: BackgroundJobRunBridge,
    runner: BackgroundJobRunner,
  ): Promise<void> {
    let nextJob = { ...job };

    while (true) {
      const controller = new AbortController();
      let cancelRequested = false;
      const unregisterCancel = registerBackgroundJobCancelHandler(nextJob.id, () => {
        cancelRequested = true;
        controller.abort();
      });

      try {
        nextJob = {
          ...nextJob,
          attempt: (nextJob.attempt ?? 0) + 1,
          status: 'running',
        };
        const startedUpdate: BackgroundJobUpdateLike = {
          status: 'running',
          attempt: nextJob.attempt,
          cancellable: true,
          error: undefined,
          retryAt: undefined,
        };
        nextJob = { ...nextJob, ...startedUpdate };
        bridge.update(nextJob.id, startedUpdate);

        const updateJob = (updates: BackgroundJobUpdateLike) => {
          nextJob = { ...nextJob, ...updates };
          bridge.update(nextJob.id, updates);
        };

        const context: BackgroundJobRunContext = {
          jobId: nextJob.id,
          signal: controller.signal,
          update: updateJob,
          progress: (progress) => updateJob(createBackgroundJobProgressUpdate(progress)),
          isCancellationRequested: () => cancelRequested || controller.signal.aborted,
        };

        const result = await runner(context);
        if (cancelRequested || controller.signal.aborted) {
          bridge.finish(nextJob.id, {
            status: 'cancelled',
            detail: 'Cancelled',
            progress: nextJob.progress ?? 0,
            indeterminate: false,
          });
          return;
        }

        const finishUpdates =
          result && typeof result === 'object' && !Array.isArray(result)
            ? (result as BackgroundJobUpdateLike)
            : {};
        bridge.finish(nextJob.id, {
          status: finishUpdates.status ?? 'complete',
          progress: finishUpdates.progress ?? 100,
          indeterminate: false,
          error: undefined,
          retryAt: undefined,
          ...finishUpdates,
        });
        return;
      } catch (error) {
        const message = getErrorMessage(error);
        if (cancelRequested || isAbortLikeError(error)) {
          bridge.finish(nextJob.id, {
            status: 'cancelled',
            detail: 'Cancelled',
            progress: nextJob.progress ?? 0,
            indeterminate: false,
          });
          return;
        }

        if (!shouldRetryBackgroundJobFailure(nextJob, { message })) {
          bridge.finish(nextJob.id, {
            status: 'error',
            detail: message,
            error: message,
            progress: 100,
            indeterminate: false,
          });
          return;
        }

        const delayMs = getBackgroundJobRetryDelay(nextJob);
        const retryUpdate: BackgroundJobUpdateLike = {
          status: 'queued',
          detail: `${message} Retrying in ${Math.max(1, Math.round(delayMs / 1000))}s.`,
          error: message,
          retryAt: Date.now() + delayMs,
          cancellable: true,
          indeterminate: true,
        };
        nextJob = { ...nextJob, ...retryUpdate };
        bridge.update(nextJob.id, retryUpdate);

        try {
          await waitForRetryDelay(delayMs, controller.signal);
        } catch (retryError) {
          if (isAbortLikeError(retryError)) {
            bridge.finish(nextJob.id, {
              status: 'cancelled',
              detail: 'Cancelled',
              progress: nextJob.progress ?? 0,
              indeterminate: false,
            });
            return;
          }
          throw retryError;
        }
      } finally {
        unregisterCancel();
      }
    }
  }
}

export const defaultBackgroundJobExecutor = new BackgroundJobExecutor();
