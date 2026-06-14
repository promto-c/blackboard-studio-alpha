import type { RotoNode } from '@blackboard/types';
import type { SourcePixelSource } from '@/state/editor/services/sourcePixelData';
import type {
  BackgroundJobInput,
  BackgroundJobUpdate,
} from '@/state/editor/services/backgroundJobs';
import { registerBackgroundJobCancelHandler } from '@/state/editor/services/backgroundJobExecutor';

export type RotoTrackingJob = {
  id: string;
  finish: (updates: BackgroundJobUpdate) => void;
  update: (updates: BackgroundJobUpdate) => void;
  unregisterCancel?: () => void;
};

export const getRobustTrackingError = (trackedPoints: readonly { error: number }[]): number => {
  const finiteErrors = trackedPoints
    .map((trackedPoint) => trackedPoint.error)
    .filter((error) => Number.isFinite(error));
  if (finiteErrors.length === 0) return 0;

  const failedPointCount = finiteErrors.filter((error) => error >= 100).length;
  if (failedPointCount / finiteErrors.length >= 0.5) {
    return 100;
  }

  const sortedErrors = finiteErrors.filter((error) => error < 100).sort((a, b) => a - b);
  if (sortedErrors.length === 0) return 100;

  const trimCount = sortedErrors.length >= 5 ? Math.floor(sortedErrors.length * 0.2) : 0;
  const stableErrors =
    trimCount > 0 ? sortedErrors.slice(0, sortedErrors.length - trimCount) : sortedErrors;

  return stableErrors.reduce((sum, error) => sum + error, 0) / stableErrors.length;
};

export const createRotoTrackingJob = (
  startBackgroundJob: ((input: BackgroundJobInput) => string) | undefined,
  updateBackgroundJob: ((jobId: string, updates: BackgroundJobUpdate) => void) | undefined,
  finishBackgroundJob: ((jobId: string, updates?: BackgroundJobUpdate) => void) | undefined,
  title: string,
  rotoNode: RotoNode,
  trackingSource: SourcePixelSource,
  projectId: string | null,
): RotoTrackingJob | null => {
  if (!startBackgroundJob || !updateBackgroundJob || !finishBackgroundJob) {
    return null;
  }

  const upstreamNodeIds =
    trackingSource.kind === 'media-node'
      ? [trackingSource.node.id]
      : trackingSource.nodes.map((n) => n.id);

  const jobId = startBackgroundJob({
    type: 'tracking',
    title,
    subtitle: rotoNode.name,
    detail: 'Preparing tracking',
    status: 'running',
    progress: 0,
    indeterminate: false,
    cancellable: true,
    source: {
      ...(projectId ? { projectId } : {}),
      nodeId: rotoNode.id,
      upstreamNodeIds,
    },
  });

  return {
    id: jobId,
    update: (updates) => updateBackgroundJob(jobId, updates),
    finish: (updates) => finishBackgroundJob(jobId, updates),
  };
};

export const bindRotoTrackingJobCancel = (
  job: RotoTrackingJob | null,
  controller: AbortController,
): void => {
  if (!job) return;
  job.unregisterCancel = registerBackgroundJobCancelHandler(job.id, () => {
    controller.abort();
  });
};

export const formatTrackingProgressDetail = (
  frame: number,
  endFrame: number,
  drift: number | null,
): string =>
  drift === null
    ? `Frame ${frame} of ${endFrame}`
    : `Frame ${frame} of ${endFrame} · Drift ${drift.toFixed(1)}`;
