import React, { useEffect, useMemo, useState } from 'react';
import { EditorTab, type AiChatThread, type AnyNode } from '@blackboard/types';
import { Badge, Popover } from '@blackboard/ui';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  isBackgroundJobActive,
  type BackgroundJob,
  type BackgroundJobStatus,
  type BackgroundJobType,
} from '@/state/editor/services/backgroundJobs';
import * as Icons from '@blackboard/icons';

type IconComponent = React.ComponentType<{ className?: string }>;

interface BackgroundJobsMonitorProps {
  className?: string;
  compact?: boolean;
}

interface MonitorJob {
  id: string;
  type: BackgroundJobType;
  title: string;
  subtitle?: string;
  detail?: string;
  status: BackgroundJobStatus;
  progress?: number;
  indeterminate?: boolean;
  cancellable?: boolean;
  startedAt: number;
  updatedAt: number;
  source?: BackgroundJob['source'];
  isDerived?: boolean;
  childJobIds?: string[];
  batchSlots?: MonitorBatchSlot[];
}

interface MonitorBatchSlot {
  slot: number;
  status: BackgroundJobStatus;
  jobId?: string;
  cancellable?: boolean;
}

const ACTIVE_STATUSES = new Set<BackgroundJobStatus>(['queued', 'running', 'cancelling']);

const JOB_LIMIT = 8;

type JobScope = 'project' | 'all';

const statusLabel: Record<BackgroundJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  cancelling: 'Cancelling',
  complete: 'Complete',
  error: 'Error',
  cancelled: 'Cancelled',
};

const typeIcon: Record<BackgroundJobType, IconComponent> = {
  comfy: Icons.CubeTransparent,
  render: Icons.Photo,
  tracking: Icons.Curve,
  ai: Icons.Sparkles,
  agent: Icons.LightBulb,
  'onnx-download': Icons.ArrowDownTray,
  'onnx-inference': Icons.Cog,
  'model-download': Icons.ArrowDownTray,
  download: Icons.ArrowDownTray,
  other: Icons.Cog,
};

const statusTone: Record<BackgroundJobStatus, string> = {
  queued: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  running: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100',
  cancelling: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  complete: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
  error: 'border-red-300/25 bg-red-500/10 text-red-100',
  cancelled: 'border-gray-400/20 bg-gray-500/10 text-gray-200',
};

const statusHoverTone: Record<BackgroundJobStatus, string> = {
  queued:
    'hover:border-amber-200/45 hover:bg-amber-300/18 hover:shadow-[inset_0_0_0_1px_rgba(252,211,77,0.12)]',
  running:
    'hover:border-cyan-200/45 hover:bg-cyan-300/18 hover:shadow-[inset_0_0_0_1px_rgba(103,232,249,0.12)]',
  cancelling:
    'hover:border-amber-200/45 hover:bg-amber-300/18 hover:shadow-[inset_0_0_0_1px_rgba(252,211,77,0.12)]',
  complete:
    'hover:border-emerald-200/45 hover:bg-emerald-300/18 hover:shadow-[inset_0_0_0_1px_rgba(110,231,183,0.12)]',
  error:
    'hover:border-red-200/50 hover:bg-red-400/18 hover:shadow-[inset_0_0_0_1px_rgba(248,113,113,0.14)]',
  cancelled:
    'hover:border-gray-300/40 hover:bg-gray-400/16 hover:shadow-[inset_0_0_0_1px_rgba(209,213,219,0.1)]',
};

const statusActionTone: Record<BackgroundJobStatus, string> = {
  queued:
    'border-amber-300/25 text-amber-100/80 hover:border-amber-200/45 hover:bg-amber-300/10 hover:text-amber-50',
  running:
    'border-cyan-300/25 text-cyan-100/80 hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-cyan-50',
  cancelling:
    'border-amber-300/25 text-amber-100/80 hover:border-amber-200/45 hover:bg-amber-300/10 hover:text-amber-50',
  complete:
    'border-emerald-300/25 text-emerald-100/80 hover:border-emerald-200/45 hover:bg-emerald-300/10 hover:text-emerald-50',
  error:
    'border-red-300/30 text-red-100/80 hover:border-red-200/50 hover:bg-red-400/10 hover:text-red-50',
  cancelled:
    'border-gray-400/20 text-gray-200/70 hover:border-gray-300/35 hover:bg-gray-300/10 hover:text-gray-100',
};

const batchSlotTone: Record<BackgroundJobStatus, string> = {
  complete: 'border-emerald-300/25 bg-emerald-300/12 text-emerald-50',
  running: 'border-cyan-300/35 bg-cyan-300/15 text-cyan-50',
  cancelling: 'border-amber-300/35 bg-amber-300/15 text-amber-50',
  queued: 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100/70',
  error: 'border-red-300/30 bg-red-400/15 text-red-50',
  cancelled: 'border-gray-400/20 bg-gray-300/10 text-gray-200/70',
};

const clampProgress = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? (value ?? 0) : 0));

const getBatchSlots = (
  source: BackgroundJob['source'],
  status: BackgroundJobStatus,
): MonitorBatchSlot[] => {
  const runCount = source?.runCount ?? 0;
  if (runCount <= 1) return [];

  const runIndex = Math.max(1, Math.min(runCount, source?.runIndex ?? 1));
  const completedCount = Math.max(0, Math.min(runCount, source?.completedCount ?? runIndex - 1));

  return Array.from({ length: runCount }, (_, index) => {
    const slot = index + 1;
    if (slot <= completedCount) return { slot, status: 'complete' as const };
    if (slot === runIndex && isBackgroundJobActive({ status })) {
      return { slot, status: status === 'queued' ? ('queued' as const) : ('running' as const) };
    }
    return { slot, status: 'queued' as const };
  });
};

const getBatchSlotLabel = (slot: MonitorBatchSlot): string | number => {
  switch (slot.status) {
    case 'complete':
      return 'OK';
    case 'running':
    case 'cancelling':
      return '...';
    case 'error':
      return '!';
    case 'cancelled':
      return 'X';
    case 'queued':
      return slot.slot;
  }
};

const getNodeLabel = (nodes: AnyNode[], nodeId: string | undefined): string | undefined =>
  nodeId ? nodes.find((node) => node.id === nodeId)?.name : undefined;

const buildAiChatJobs = (
  chats: AiChatThread[],
  nodes: AnyNode[],
  projectId: string | null,
): MonitorJob[] =>
  chats
    .filter((chat) => chat.status === 'generating')
    .map((chat) => ({
      id: `chat:${chat.id}`,
      type: 'agent',
      title: chat.feature === 'shader' ? 'Shader chat' : 'Assistant chat',
      subtitle: getNodeLabel(nodes, chat.nodeId) ?? chat.title,
      detail: chat.messages.at(-1)?.content.trim() || 'Generating response',
      status: 'running',
      progress: 35,
      indeterminate: true,
      cancellable: true,
      startedAt: chat.updatedAt,
      updatedAt: chat.updatedAt,
      source: {
        ...(projectId ? { projectId } : {}),
        chatId: chat.id,
        nodeId: chat.nodeId,
      },
      isDerived: true,
    }));

const getComfyBatchTitle = (title: string): string =>
  title.replace(/\s+·\s+Run\s+\d+\/\d+$/i, '').replace(/\s+x\d+$/i, '');

const getMonitorBatchStatus = (jobs: BackgroundJob[]): BackgroundJobStatus => {
  if (jobs.some((job) => job.status === 'running')) return 'running';
  if (jobs.some((job) => job.status === 'cancelling')) return 'cancelling';
  if (jobs.some((job) => job.status === 'queued')) return 'queued';
  if (jobs.some((job) => job.status === 'error')) return 'error';
  if (jobs.every((job) => job.status === 'cancelled')) return 'cancelled';
  if (jobs.every((job) => job.status === 'complete')) return 'complete';
  return 'complete';
};

const getJobRunIndex = (job: Pick<MonitorJob, 'source'>, fallback: number): number =>
  Math.max(1, job.source?.runIndex ?? fallback);

const getMonitorBatchProgress = (jobs: BackgroundJob[], runCount: number): number => {
  if (runCount <= 0) return 0;

  const progressByRun = new Map<number, number>();
  jobs.forEach((job, index) => {
    const runIndex = getJobRunIndex(job, index + 1);
    progressByRun.set(runIndex, job.status === 'complete' ? 100 : clampProgress(job.progress));
  });

  const total = Array.from(
    { length: runCount },
    (_, index) => progressByRun.get(index + 1) ?? 0,
  ).reduce((sum, progress) => sum + progress, 0);
  return total / runCount;
};

const createComfyBatchMonitorJob = (batchId: string, jobs: BackgroundJob[]): MonitorJob => {
  const sortedJobs = [...jobs].sort(
    (a, b) => getJobRunIndex(a, 1) - getJobRunIndex(b, 1) || a.startedAt - b.startedAt,
  );
  const firstJob = sortedJobs[0];
  const activeJob = sortedJobs.find(isBackgroundJobActive);
  const detailJob = activeJob ?? sortedJobs.find((job) => job.detail) ?? firstJob;
  const runCount = Math.max(
    sortedJobs.length,
    ...sortedJobs.map((job) => job.source?.runCount ?? 1),
  );
  const activeRunIndex = detailJob ? getJobRunIndex(detailJob, 1) : 1;
  const status = getMonitorBatchStatus(sortedJobs);
  const completedCount = sortedJobs.filter((job) => job.status === 'complete').length;
  const source = {
    ...(detailJob?.source ?? firstJob.source ?? {}),
    batchId,
    runCount,
    runIndex: activeRunIndex,
    completedCount,
  };

  return {
    id: `comfy-batch:${batchId}`,
    type: 'comfy',
    title: getComfyBatchTitle(firstJob.title),
    subtitle: firstJob.subtitle,
    detail: detailJob?.detail
      ? `Run ${activeRunIndex}/${runCount}: ${detailJob.detail}`
      : undefined,
    status,
    progress: getMonitorBatchProgress(sortedJobs, runCount),
    indeterminate: sortedJobs.some((job) => isBackgroundJobActive(job) && job.indeterminate),
    cancellable: sortedJobs.some((job) => isBackgroundJobActive(job) && job.cancellable),
    startedAt: Math.min(...sortedJobs.map((job) => job.startedAt)),
    updatedAt: Math.max(...sortedJobs.map((job) => job.updatedAt)),
    source,
    childJobIds: sortedJobs.map((job) => job.id),
    batchSlots: sortedJobs.map((job, index) => ({
      slot: getJobRunIndex(job, index + 1),
      status: job.status,
      jobId: job.id,
      cancellable: isBackgroundJobActive(job) && job.cancellable,
    })),
  };
};

const buildExplicitMonitorJobs = (jobs: BackgroundJob[]): MonitorJob[] => {
  const ungroupedJobs: MonitorJob[] = [];
  const comfyBatchJobs = new Map<string, BackgroundJob[]>();

  jobs.forEach((job) => {
    const batchId =
      job.type === 'comfy' && (job.source?.runCount ?? 1) > 1 ? job.source?.batchId : undefined;
    if (!batchId) {
      ungroupedJobs.push(job);
      return;
    }
    comfyBatchJobs.set(batchId, [...(comfyBatchJobs.get(batchId) ?? []), job]);
  });

  return [
    ...ungroupedJobs,
    ...Array.from(comfyBatchJobs.entries()).map(([batchId, batchJobs]) =>
      createComfyBatchMonitorJob(batchId, batchJobs),
    ),
  ];
};

const sortJobs = (jobs: MonitorJob[]): MonitorJob[] =>
  [...jobs].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status);
    const bActive = ACTIVE_STATUSES.has(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

const isJobInProject = (job: MonitorJob, projectId: string | null): boolean => {
  if (!projectId) return true;
  return job.source?.projectId === projectId;
};

const isTrackingJobInvalidated = (job: MonitorJob, projectNodeIds: Set<string>): boolean => {
  if (job.type !== 'tracking') return false;
  const upstreamNodeIds = job.source?.upstreamNodeIds;
  if (!upstreamNodeIds || upstreamNodeIds.length === 0) return false;
  // A tracking job is invalidated when one or more upstream nodes no longer exist
  // in the pipeline. This can happen if a media node is deleted or a pipeline node
  // is removed/replaced.
  return upstreamNodeIds.some((nodeId) => !projectNodeIds.has(nodeId));
};

const getJobContextLabel = (job: MonitorJob): string | undefined => {
  if (job.source?.chatId) return 'Open chat';
  if (job.source?.nodeId) return 'Select node';
  if (job.source?.projectId) return 'Open project';
  return undefined;
};

const getJobScopeLabel = (job: MonitorJob, projectId: string | null): string => {
  if (!projectId) return 'App';
  if (!job.source?.projectId) return 'App';
  return job.source.projectId === projectId ? 'This project' : 'Elsewhere';
};

function JobIcon({ type, className = 'h-4 w-4' }: { type: BackgroundJobType; className?: string }) {
  const Icon = typeIcon[type] ?? Icons.Cog;
  return <Icon className={className} />;
}

export function BackgroundJobsMonitor({
  className = 'pointer-events-auto fixed right-16 top-4 z-[60]',
  compact = false,
}: BackgroundJobsMonitorProps) {
  const explicitJobs = useEditorSelector((state) => state.backgroundJobs);
  const aiChats = useEditorSelector((state) => state.aiChats);
  const nodes = useEditorSelector((state) => state.nodes);
  const projectId = useEditorSelector((state) => state.projectId);
  const {
    requestBackgroundJobCancel,
    dismissBackgroundJob,
    clearFinishedBackgroundJobs,
    stopAiChat,
    loadProject,
    selectNode,
    setActiveAiChat,
    setActiveTab,
  } = useEditorActions();
  const [isOpen, setIsOpen] = useState(false);
  const [jobScope, setJobScope] = useState<JobScope>(projectId ? 'project' : 'all');

  useEffect(() => {
    setJobScope(projectId ? 'project' : 'all');
  }, [projectId]);

  const projectNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);

  const allJobs = useMemo(
    () =>
      sortJobs([
        ...buildExplicitMonitorJobs(explicitJobs),
        ...buildAiChatJobs(aiChats, nodes, projectId),
      ]),
    [aiChats, explicitJobs, nodes, projectId],
  );

  const projectJobs = useMemo(
    () => allJobs.filter((job) => isJobInProject(job, projectId)),
    [allJobs, projectId],
  );

  const canFilterByProject = !!projectId;
  const filteredJobs = canFilterByProject && jobScope === 'project' ? projectJobs : allJobs;
  const jobs = filteredJobs.slice(0, JOB_LIMIT);
  const filteredActiveJobs = filteredJobs.filter(isBackgroundJobActive);
  const activeJobs = jobs.filter(isBackgroundJobActive);
  const hasFinishedJobs = filteredJobs.some((job) => !isBackgroundJobActive(job));
  const hiddenJobCount = canFilterByProject ? Math.max(0, allJobs.length - projectJobs.length) : 0;
  const allActiveJobCount = allJobs.filter(isBackgroundJobActive).length;
  const projectActiveJobCount = projectJobs.filter(isBackgroundJobActive).length;
  const hiddenActiveJobCount = canFilterByProject
    ? Math.max(0, allActiveJobCount - projectActiveJobCount)
    : 0;
  const allScopeActiveCue =
    canFilterByProject && hiddenActiveJobCount > 0
      ? `${hiddenActiveJobCount} running elsewhere`
      : allActiveJobCount > 0
        ? `${allActiveJobCount} running`
        : undefined;

  if (allJobs.length === 0) return null;

  const leadingJob =
    activeJobs[0] ??
    (hiddenActiveJobCount > 0 ? allJobs.find(isBackgroundJobActive) : undefined) ??
    jobs[0] ??
    allJobs[0];
  const leadingProgress = clampProgress(leadingJob.progress);
  const leadingProgressWidth = leadingJob.indeterminate
    ? Math.max(leadingProgress, 35)
    : leadingProgress;
  const showActiveIndicator = isBackgroundJobActive(leadingJob);
  const title =
    filteredActiveJobs.length > 0
      ? `${filteredActiveJobs.length} running`
      : canFilterByProject && jobScope === 'project' && hiddenActiveJobCount > 0
        ? `${hiddenActiveJobCount} elsewhere`
        : 'Background jobs';
  const scopeSubtitle =
    canFilterByProject && jobScope === 'project'
      ? hiddenJobCount > 0
        ? `${filteredJobs.length} in this project, ${hiddenJobCount} elsewhere`
        : 'This project'
      : 'All projects and app jobs';

  const handleCancel = (job: MonitorJob) => {
    if (!job.cancellable || !isBackgroundJobActive(job)) return;
    if (job.isDerived && job.source?.chatId) {
      stopAiChat(job.source.chatId);
      return;
    }
    const jobIds =
      job.batchSlots
        ?.filter((slot) => slot.cancellable && slot.jobId)
        .map((slot) => slot.jobId as string) ?? [];
    if (jobIds.length > 0) {
      jobIds.forEach((jobId) => requestBackgroundJobCancel(jobId));
      return;
    }
    requestBackgroundJobCancel(job.id);
  };

  const dismissJob = (job: MonitorJob) => {
    (job.childJobIds ?? [job.id]).forEach((jobId) => dismissBackgroundJob(jobId));
  };

  const handleOpenContext = async (job: MonitorJob) => {
    const { source } = job;
    if (!source) return;

    try {
      if (source.projectId && source.projectId !== projectId) {
        await loadProject(source.projectId);
      }

      if (source.chatId) {
        if (source.nodeId) {
          selectNode(source.nodeId);
        }
        setActiveAiChat(source.chatId);
      } else if (source.nodeId) {
        setActiveTab(EditorTab.Flow);
        // Don't select the roto node for invalidated tracking jobs — the upstream
        // pipeline may have changed, so selecting would steal focus from the node
        // the user was editing.
        const invalidated =
          job.type === 'tracking' && isTrackingJobInvalidated(job, projectNodeIds);
        if (!invalidated) {
          selectNode(source.nodeId);
        }
      } else if (source.projectId) {
        setActiveTab(EditorTab.Flow);
      } else {
        return;
      }

      setIsOpen(false);
    } catch (error) {
      console.error('Could not open background job context', error);
      window.alert('Could not open this job context.');
    }
  };

  const handleJobKeyDown = (event: React.KeyboardEvent, job: MonitorJob) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void handleOpenContext(job);
  };

  return (
    <div className={className}>
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        align="end"
        widthClass="w-96 max-w-[calc(100vw-2rem)]"
        trigger={
          <button
            type="button"
            className={`group relative flex h-10 items-center overflow-hidden rounded-full border text-left shadow-2xl backdrop-blur-xl transition hover:border-white/20 ${
              showActiveIndicator
                ? 'border-primary-300/25 bg-gray-950/70 text-primary-50'
                : 'border-white/10 bg-gray-950/55 text-gray-200'
            } ${compact ? 'w-10 justify-center px-0' : 'gap-2 px-3'}`}
            title="Background jobs"
            aria-label="Background jobs"
          >
            {showActiveIndicator && (
              <span
                className={`pointer-events-none absolute inset-y-0 left-0 transition-all duration-300 ${
                  leadingJob.indeterminate ? 'animate-pulse' : ''
                }`}
                style={{
                  background:
                    'linear-gradient(90deg, rgb(var(--color-primary-600) / 0.24), rgb(var(--color-primary-500) / 0.16), rgb(var(--color-primary-200) / 0.08))',
                  width: `${leadingProgressWidth}%`,
                }}
              />
            )}
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10">
              <JobIcon type={leadingJob.type} className="h-3.5 w-3.5" />
              {showActiveIndicator && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-300 shadow-[0_0_10px_rgb(var(--color-primary-300)_/_0.8)]" />
              )}
            </span>
            {!compact && (
              <span className="relative min-w-0 flex-1 truncate whitespace-nowrap text-xs font-medium">
                {title}
              </span>
            )}
            {showActiveIndicator && !compact && (
              <span className="relative w-10 shrink-0 text-right font-mono text-[11px] text-primary-100/80">
                {leadingJob.indeterminate ? '...' : `${Math.round(leadingProgress)}%`}
              </span>
            )}
          </button>
        }
      >
        {() => (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-gray-100">Background Jobs</p>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">{scopeSubtitle}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canFilterByProject && (
                  <div className="inline-flex rounded-md border border-white/10 bg-black/30 p-0.5">
                    <button
                      type="button"
                      onClick={() => setJobScope('project')}
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                        jobScope === 'project'
                          ? 'border-primary-300/35 bg-primary-300/20 text-primary-50'
                          : 'border-transparent text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                      }`}
                      title="Show jobs for this project"
                    >
                      Project
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobScope('all')}
                      className={`relative inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                        jobScope === 'all'
                          ? 'border-primary-300/35 bg-primary-300/20 text-primary-50'
                          : 'border-transparent text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                      }`}
                      title={
                        allScopeActiveCue
                          ? `Show every background job. ${allScopeActiveCue}.`
                          : 'Show every background job'
                      }
                    >
                      <span>All</span>
                      {hiddenActiveJobCount > 0 && (
                        <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary-300/20 px-1 font-mono text-[9px] leading-none text-amber-50 shadow-[0_0_10px_rgba(252,211,77,0.18)]">
                          {hiddenActiveJobCount}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {hasFinishedJobs && (
                  <button
                    type="button"
                    onClick={() =>
                      clearFinishedBackgroundJobs(
                        canFilterByProject && jobScope === 'project'
                          ? {
                              projectId,
                              jobIds: filteredJobs
                                .filter((job) => !isBackgroundJobActive(job) && !job.isDerived)
                                .flatMap((job) => job.childJobIds ?? [job.id]),
                            }
                          : undefined,
                      )
                    }
                    className="rounded-md border border-white/10 px-1.5 py-1 text-[10px] font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-gray-100"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {jobs.length === 0 && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center">
                  <p className="text-xs font-medium text-gray-200">No jobs in this project</p>
                  {hiddenJobCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setJobScope('all')}
                      className="mt-2 rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-gray-100"
                    >
                      Show all jobs
                    </button>
                  )}
                </div>
              )}
              {jobs.map((job) => {
                const isActive = isBackgroundJobActive(job);
                const progress = clampProgress(job.progress);
                const canDismiss = !isActive && !job.isDerived;
                const canCancel = isActive && job.cancellable;
                const batchSlots = job.batchSlots ?? getBatchSlots(job.source, job.status);
                const contextLabel = getJobContextLabel(job);
                const jobScopeLabel = getJobScopeLabel(job, projectId);
                const showJobScopeCue = canFilterByProject && jobScope === 'all';

                return (
                  <div
                    key={job.id}
                    role={contextLabel ? 'button' : undefined}
                    tabIndex={contextLabel ? 0 : undefined}
                    title={contextLabel}
                    aria-label={contextLabel ? `${contextLabel}: ${job.title}` : undefined}
                    onClick={contextLabel ? () => void handleOpenContext(job) : undefined}
                    onKeyDown={contextLabel ? (event) => handleJobKeyDown(event, job) : undefined}
                    className={`rounded-lg border p-2.5 outline-none transition ${
                      contextLabel
                        ? `cursor-pointer ${statusHoverTone[job.status]} focus-visible:ring-2 focus-visible:ring-primary-300/40`
                        : ''
                    } ${statusTone[job.status]}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/20">
                        <JobIcon type={job.type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-xs font-medium text-current">
                            {job.title}
                          </span>
                          <Badge
                            size="sm"
                            uppercase
                            className="bg-black/20 text-current/70 border-0"
                          >
                            {statusLabel[job.status]}
                          </Badge>
                          {showJobScopeCue && (
                            <Badge
                              size="sm"
                              uppercase
                              className={`font-semibold ${
                                jobScopeLabel === 'Elsewhere'
                                  ? isActive
                                    ? '!border-amber-200/30 !bg-amber-300/15 !text-amber-50'
                                    : '!border-white/10 !bg-black/15 !text-current/55'
                                  : '!border-white/10 !bg-black/15 !text-current/55'
                              }`}
                              title={
                                jobScopeLabel === 'Elsewhere'
                                  ? 'This job belongs to another project'
                                  : jobScopeLabel
                              }
                            >
                              {jobScopeLabel}
                            </Badge>
                          )}
                          {job.type === 'tracking' &&
                            isTrackingJobInvalidated(job, projectNodeIds) && (
                              <Badge
                                size="sm"
                                variant="warning"
                                uppercase
                                className="font-semibold"
                              >
                                Stale
                              </Badge>
                            )}
                        </div>
                        {job.subtitle && (
                          <p className="mt-0.5 truncate text-[11px] text-current/65">
                            {job.subtitle}
                          </p>
                        )}
                        {job.detail && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-current/70">
                            {job.detail}
                          </p>
                        )}
                        {batchSlots.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {batchSlots.map((slot) => {
                              const slotLabel = getBatchSlotLabel(slot);
                              const slotClassName = `inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 text-[10px] font-semibold ${batchSlotTone[slot.status]}`;
                              if (slot.cancellable && slot.jobId) {
                                return (
                                  <button
                                    key={slot.slot}
                                    type="button"
                                    className={`${slotClassName} transition hover:border-red-200/50 hover:bg-red-400/15 hover:text-red-50`}
                                    title={`Cancel run ${slot.slot}`}
                                    aria-label={`Cancel run ${slot.slot}`}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      requestBackgroundJobCancel(slot.jobId as string);
                                    }}
                                  >
                                    {slotLabel}
                                  </button>
                                );
                              }
                              return (
                                <span
                                  key={slot.slot}
                                  className={slotClassName}
                                  title={`Run ${slot.slot} ${slot.status}`}
                                >
                                  {slotLabel}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {(canCancel || canDismiss) && (
                        <button
                          type="button"
                          onKeyDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canCancel) {
                              handleCancel(job);
                            } else {
                              dismissJob(job);
                            }
                          }}
                          className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition ${statusActionTone[job.status]}`}
                        >
                          {canCancel ? 'Cancel' : 'Dismiss'}
                        </button>
                      )}
                    </div>

                    {isActive && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25">
                        <div
                          className={`h-full rounded-full bg-current transition-all duration-300 ${
                            job.indeterminate ? 'animate-pulse' : ''
                          }`}
                          style={{
                            width: `${job.indeterminate ? Math.max(progress, 35) : progress}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
