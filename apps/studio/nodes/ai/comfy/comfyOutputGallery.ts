import { isBackgroundJobActive, type BackgroundJob } from '@/state/editor/services/backgroundJobs';

export interface ComfyPendingOutputSlot {
  id: string;
  label: string;
  detail?: string;
  active: boolean;
}

export const getActiveComfyOutputJobs = ({
  jobs,
  nodeId,
  projectId,
  branchId,
}: {
  jobs: readonly BackgroundJob[];
  nodeId: string;
  projectId: string | null;
  branchId: string | null;
}): BackgroundJob[] =>
  jobs
    .filter(
      (job) =>
        job.type === 'comfy' &&
        job.source?.nodeId === nodeId &&
        (!job.source.projectId || job.source.projectId === projectId) &&
        (!job.source.branchId || job.source.branchId === branchId) &&
        isBackgroundJobActive(job),
    )
    .sort((a, b) => a.startedAt - b.startedAt);

export const getPendingComfyOutputSlots = (
  jobs: readonly BackgroundJob[],
  regionId?: string | null,
): ComfyPendingOutputSlot[] => {
  const scopedJobs = regionId ? jobs.filter((job) => job.source?.comfyRegionId === regionId) : jobs;

  return scopedJobs.flatMap((job, jobIndex) => {
    const source = job.source;
    const runCount = source?.runCount ?? 0;
    if (runCount <= 0) return [];

    const runIndex = Math.max(1, Math.min(runCount, source?.runIndex ?? 1));
    const completedCount = Math.max(0, Math.min(runCount, source?.completedCount ?? runIndex - 1));
    const remainingCount = Math.max(0, runCount - completedCount);
    const queuedJobNumber = jobIndex + 1;

    return Array.from({ length: remainingCount }, (_, index) => {
      const slot = completedCount + index + 1;
      const isActiveSlot = slot === runIndex && job.status !== 'queued';
      return {
        id: `${job.id}:${slot}`,
        label: isActiveSlot
          ? 'Generating'
          : queuedJobNumber > 1
            ? `Queued ${queuedJobNumber}`
            : `Queued ${slot}`,
        detail: runCount > 1 ? `Run ${slot}/${runCount}` : job.detail,
        active: isActiveSlot,
      };
    });
  });
};
