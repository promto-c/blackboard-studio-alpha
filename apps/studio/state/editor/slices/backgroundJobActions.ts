import {
  createBackgroundJob,
  pruneBackgroundJobs,
  requestBackgroundJobCancelById,
  savePersistedBackgroundJobs,
  updateBackgroundJobById,
  upsertBackgroundJob,
  type BackgroundJob,
  type BackgroundJobInput,
  type BackgroundJobUpdate,
} from '@/state/editor/services/backgroundJobs';
import {
  defaultBackgroundJobExecutor,
  requestRegisteredBackgroundJobCancel,
  type BackgroundJobRunner,
} from '@/state/editor/services/backgroundJobExecutor';
import type { SetState } from '@/state/editor/slices/types';

const commitBackgroundJobs = (
  set: SetState,
  updater: (jobs: BackgroundJob[]) => BackgroundJob[],
) => {
  set((state) => {
    const backgroundJobs = updater(state.backgroundJobs);
    savePersistedBackgroundJobs(backgroundJobs);
    return { backgroundJobs };
  });
};

export function createBackgroundJobActions(set: SetState) {
  return {
    startBackgroundJob: (input: BackgroundJobInput): string => {
      const job = createBackgroundJob(input);
      commitBackgroundJobs(set, (jobs) => pruneBackgroundJobs(upsertBackgroundJob(jobs, job)));
      return job.id;
    },

    runBackgroundJob: (input: BackgroundJobInput, runner: BackgroundJobRunner): string => {
      const job = createBackgroundJob(input);
      commitBackgroundJobs(set, (jobs) => pruneBackgroundJobs(upsertBackgroundJob(jobs, job)));
      void defaultBackgroundJobExecutor.run(
        job,
        {
          update: (jobId, updates) => {
            commitBackgroundJobs(set, (jobs) =>
              pruneBackgroundJobs(updateBackgroundJobById(jobs, jobId, updates)),
            );
          },
          finish: (jobId, updates = {}) => {
            commitBackgroundJobs(set, (jobs) =>
              pruneBackgroundJobs(
                updateBackgroundJobById(jobs, jobId, {
                  status: updates.status ?? 'complete',
                  progress: updates.progress ?? 100,
                  indeterminate: false,
                  ...updates,
                }),
              ),
            );
          },
        },
        runner,
      );
      return job.id;
    },

    updateBackgroundJob: (jobId: string, updates: BackgroundJobUpdate) => {
      commitBackgroundJobs(set, (jobs) =>
        pruneBackgroundJobs(updateBackgroundJobById(jobs, jobId, updates)),
      );
    },

    finishBackgroundJob: (jobId: string, updates: BackgroundJobUpdate = {}) => {
      commitBackgroundJobs(set, (jobs) =>
        pruneBackgroundJobs(
          updateBackgroundJobById(jobs, jobId, {
            status: updates.status ?? 'complete',
            progress: updates.progress ?? 100,
            indeterminate: false,
            ...updates,
          }),
        ),
      );
    },

    requestBackgroundJobCancel: (jobId: string) => {
      requestRegisteredBackgroundJobCancel(jobId);
      commitBackgroundJobs(set, (jobs) => requestBackgroundJobCancelById(jobs, jobId));
    },

    dismissBackgroundJob: (jobId: string) => {
      commitBackgroundJobs(set, (jobs) => jobs.filter((job) => job.id !== jobId));
    },

    clearFinishedBackgroundJobs: (options?: { projectId?: string | null; jobIds?: string[] }) => {
      const jobIdsToClear = options?.jobIds ? new Set(options.jobIds) : null;

      commitBackgroundJobs(set, (jobs) =>
        jobs.filter((job) => {
          if (job.status === 'queued' || job.status === 'running' || job.status === 'cancelling') {
            return true;
          }
          if (jobIdsToClear) return !jobIdsToClear.has(job.id);
          if (options?.projectId) return job.source?.projectId !== options.projectId;
          return false;
        }),
      );
    },
  };
}
