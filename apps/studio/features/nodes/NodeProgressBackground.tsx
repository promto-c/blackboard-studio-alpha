import React from 'react';
import { isBackgroundJobActive, type BackgroundJob } from '@/state/editor/services/backgroundJobs';

export const getActiveNodeJobMap = (jobs: BackgroundJob[]): Map<string, BackgroundJob> => {
  const jobByNodeId = new Map<string, BackgroundJob>();

  jobs.forEach((job) => {
    const nodeId = job.source?.nodeId;
    if (!nodeId || !isBackgroundJobActive(job) || jobByNodeId.has(nodeId)) return;
    jobByNodeId.set(nodeId, job);
  });

  return jobByNodeId;
};

const clampProgress = (value: number | undefined): number => Math.min(100, Math.max(0, value ?? 0));

export const NodeProgressBackground: React.FC<{ job?: BackgroundJob | null }> = ({ job }) => {
  if (!job) return null;

  const progress = clampProgress(job.progress);
  const progressWidth = job.indeterminate ? Math.max(progress, 35) : progress;

  return (
    <div
      className={`pointer-events-none absolute inset-y-0 left-0 bg-[linear-gradient(90deg,rgb(var(--color-primary-600)/0.22),rgb(var(--color-primary-500)/0.14),rgb(var(--color-primary-200)/0.06))] transition-all duration-300 ${
        job.indeterminate ? 'animate-pulse' : ''
      }`}
      style={{ width: `${progressWidth}%` }}
      aria-hidden="true"
    />
  );
};
