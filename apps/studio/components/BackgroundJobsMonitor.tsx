import React, { useEffect, useMemo, useState } from 'react';
import {
  EditorTab,
  type AiChatThread,
  type AnyNode,
  type QueuedAiGenerationTask,
} from '@blackboard/types';
import { Popover } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  isBackgroundJobActive,
  type BackgroundJob,
  type BackgroundJobStatus,
  type BackgroundJobType,
} from '@/state/editor/services/backgroundJobs';
import * as Icons from '@blackboard/icons';

type IconComponent = React.ComponentType<{ className?: string }>;

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

const batchSlotTone: Record<'complete' | 'running' | 'queued', string> = {
  complete: 'border-emerald-300/25 bg-emerald-300/12 text-emerald-50',
  running: 'border-cyan-300/35 bg-cyan-300/15 text-cyan-50',
  queued: 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100/70',
};

const clampProgress = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? (value ?? 0) : 0));

const getBatchSlots = (source: BackgroundJob['source'], status: BackgroundJobStatus) => {
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

const buildAiQueueJobs = (
  queue: QueuedAiGenerationTask[],
  isGenerating: boolean,
  nodes: AnyNode[],
  projectId: string | null,
): MonitorJob[] =>
  queue.map((task, index) => {
    const isActive = index === 0 && isGenerating;
    return {
      id: `ai-task:${task.taskId}`,
      type: 'ai',
      title: task.isTextToImage ? 'Text to image' : 'Image generation',
      subtitle: getNodeLabel(nodes, task.nodeId) ?? (task.nodeId ? 'AI node' : undefined),
      detail: task.prompt,
      status: isActive ? 'running' : 'queued',
      progress: isActive ? 35 : 0,
      indeterminate: isActive,
      cancellable: false,
      startedAt: Number(task.taskId.split('_')[1]) || Date.now(),
      updatedAt: Number(task.taskId.split('_')[1]) || Date.now(),
      source: {
        ...(projectId ? { projectId } : {}),
        taskId: task.taskId,
        nodeId: task.nodeId,
      },
      isDerived: true,
    };
  });

const sortJobs = (jobs: MonitorJob[]): MonitorJob[] =>
  [...jobs].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status);
    const bActive = ACTIVE_STATUSES.has(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

const isJobInProject = (
  job: MonitorJob,
  projectId: string | null,
  projectNodeIds: Set<string>,
): boolean => {
  if (!projectId) return true;
  if (job.source?.projectId) return job.source.projectId === projectId;

  // Legacy jobs created before project scoping only know their node. Keep them visible
  // when that node exists in the currently loaded project.
  return !!job.source?.nodeId && projectNodeIds.has(job.source.nodeId);
};

const getJobContextLabel = (job: MonitorJob): string | undefined => {
  if (job.source?.chatId) return 'Open chat';
  if (job.source?.nodeId) return 'Select node';
  if (job.source?.projectId) return 'Open project';
  return undefined;
};

const JobIcon: React.FC<{ type: BackgroundJobType; className?: string }> = ({
  type,
  className = 'h-4 w-4',
}) => {
  const Icon = typeIcon[type] ?? Icons.Cog;
  return <Icon className={className} />;
};

const BackgroundJobsMonitor: React.FC = () => {
  const explicitJobs = useEditorSelector((state) => state.backgroundJobs);
  const aiChats = useEditorSelector((state) => state.aiChats);
  const aiGenerationQueue = useEditorSelector((state) => state.aiGenerationQueue);
  const isAiCurrentlyGenerating = useEditorSelector((state) => state.isAiCurrentlyGenerating);
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
        ...explicitJobs,
        ...buildAiChatJobs(aiChats, nodes, projectId),
        ...buildAiQueueJobs(aiGenerationQueue, isAiCurrentlyGenerating, nodes, projectId),
      ]),
    [aiChats, aiGenerationQueue, explicitJobs, isAiCurrentlyGenerating, nodes, projectId],
  );

  const projectJobs = useMemo(
    () => allJobs.filter((job) => isJobInProject(job, projectId, projectNodeIds)),
    [allJobs, projectId, projectNodeIds],
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
    requestBackgroundJobCancel(job.id);
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
        selectNode(source.nodeId);
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
    <div className="pointer-events-auto fixed right-16 top-4 z-[60]">
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        align="end"
        widthClass="w-96 max-w-[calc(100vw-2rem)]"
        trigger={
          <button
            type="button"
            className={`group relative flex h-10 items-center gap-2 overflow-hidden rounded-full border px-3 text-left shadow-2xl backdrop-blur-xl transition hover:border-white/20 ${
              showActiveIndicator
                ? 'border-primary-300/25 bg-gray-950/70 text-primary-50'
                : 'border-white/10 bg-gray-950/55 text-gray-200'
            }`}
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
            <span className="relative min-w-0 flex-1 truncate whitespace-nowrap text-xs font-medium">
              {title}
            </span>
            {showActiveIndicator && (
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
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                        jobScope === 'all'
                          ? 'border-primary-300/35 bg-primary-300/20 text-primary-50'
                          : 'border-transparent text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                      }`}
                      title="Show every background job"
                    >
                      All
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
                                .map((job) => job.id),
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
                const batchSlots = getBatchSlots(job.source, job.status);
                const contextLabel = getJobContextLabel(job);

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
                          <span className="shrink-0 rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] uppercase text-current/70">
                            {statusLabel[job.status]}
                          </span>
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
                            {batchSlots.map((slot) => (
                              <span
                                key={slot.slot}
                                className={`inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 text-[10px] font-semibold ${batchSlotTone[slot.status]}`}
                                title={`Run ${slot.slot} ${slot.status}`}
                              >
                                {slot.status === 'complete'
                                  ? 'OK'
                                  : slot.status === 'running'
                                    ? '...'
                                    : slot.slot}
                              </span>
                            ))}
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
                              dismissBackgroundJob(job.id);
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
};

export default BackgroundJobsMonitor;
