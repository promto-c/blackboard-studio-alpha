import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { usePreferences } from '@/state/preferencesContext';
import { usePreferencesNavigation } from '@/features/projects/preferencesNavigation';
import { formatHotkeyCombo, isMacPlatform } from '@/hotkeys/strings';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import { getAiProviderLabel } from '@/utils/aiProviders';
import {
  getAiChatCapabilityLabel,
  getAiChatComposerPlaceholder,
  getAiChatModeDescription,
  getAiChatScopeLabel,
  getAiChatScopeMode,
  isAiActionCapableNode,
} from '@/utils/aiChatScope';
import { supportsAiNodeTools } from '@/utils/aiNodeTools';
import { DEFAULT_AGENT_MODE_SETTINGS, getAgentModeCapabilitySummary } from '@/utils/agentMode';
import {
  DEFAULT_AGENT_SELF_REVIEW_POLICY,
  assessAgentSelfReviewContent,
  buildAgentSelfReviewMarkerInstruction,
  type AgentSelfReviewPolicy,
} from '@/utils/agentReviewPolicy';
import { summarizeAgentBranchDiff, type AgentBranchDiffSummary } from '@/utils/agentBranchDiff';
import { captureAgentRenderPreviewComparison } from '@/utils/agentRenderPreview';
import {
  MAIN_PROJECT_BRANCH_ID,
  createScopedProjectBranchName,
  getProjectBranchStorageId,
  type ProjectBranchRecord,
} from '@/state/projectBranches';
import { getOrderedNodesFromFlow } from '@/state/editor/flowModel';
import { loadProjectState } from '@/state/persist';
import { isComfyNode } from '@/nodes/helpers';
import { ComfyAdjustmentsPanel } from '@/nodes/ai/comfy/ComfyAdjustments';
import * as Icons from '@blackboard/icons';
import { NodeType } from '@blackboard/types';
import type {
  AiAgentRun,
  AiAgentQuestion,
  AiChatBranch,
  AiChatAttachment,
  AiChatMessage,
  AiChatRenderComparisonArtifact,
  AiChatThread,
  AnyNode,
  CustomShaderNode,
  FlowEdge,
  NodePositions,
  PersistedProjectState,
} from '@blackboard/types';
import {
  Badge,
  CodeBlock,
  ResizableScrollTextarea,
  ScrollArea,
  Spinner,
  TextInput,
} from '@blackboard/ui';
import { useDebugLog } from '@/utils/debugLogContext';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';
import SubPanelHeader from './SubPanelHeader';
import ChatMarkdown from './ChatMarkdown';
import { ComfyPromptOptionGallery } from './ComfyPromptOptionGallery';
import {
  ChatAttachmentLimits,
  createAttachmentId,
  createRenderComparisonAttachments,
  formatAttachmentSize,
  getAttachmentKind,
  getQueuedDraftPreview,
  readFileAsDataUrl,
  readFileAsText,
  type QueuedDraft,
} from './chatAttachments';

type ChatExecutionMode = 'chat' | 'agent';

const CHAT_EXECUTION_MODE_OPTIONS: SlidingSegmentedControlOption<ChatExecutionMode>[] = [
  {
    value: 'chat',
    label: 'Chat',
    Icon: Icons.ChatBubble,
    title: 'Chat mode',
  },
  {
    value: 'agent',
    label: 'Agent',
    Icon: Icons.Branch,
    title: 'Agent mode',
  },
];

function ScopeChip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
}) {
  return (
    <Badge variant={tone} size="sm" uppercase className="font-semibold">
      {children}
    </Badge>
  );
}

function IconButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-gray-200 transition hover:bg-white/[0.08]"
    >
      {icon}
    </button>
  );
}

function BubbleActionButton({
  label,
  onClick,
  icon,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.035] text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-gray-600"
    >
      {icon}
    </button>
  );
}

function KeyHint({ keys, label = 'Send with' }: { keys: string[]; label?: string }) {
  return (
    <span className="hidden shrink-0 items-center gap-1 text-[10px] text-gray-500 sm:inline-flex">
      <span>{label}</span>
      {keys.map((key) => (
        <React.Fragment key={key}>
          <Badge size="sm" noBorder className="!bg-white/[0.04] !text-gray-400 leading-none">
            {key}
          </Badge>
        </React.Fragment>
      ))}
    </span>
  );
}

function MessageMetaChip({
  children,
  mono = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  const title = typeof children === 'string' ? children : undefined;

  return (
    <Badge
      size="sm"
      truncate
      noBorder
      title={title}
      className={`!bg-white/[0.04] !text-gray-300 ${mono ? 'font-mono' : ''}`}
    >
      {children}
    </Badge>
  );
}

function BranchVariantControls({
  variants,
  activeBranchId,
  disabled = false,
  onSelect,
}: {
  variants: AiChatBranch[];
  activeBranchId?: string;
  disabled?: boolean;
  onSelect: (branchId: string) => void;
}) {
  if (variants.length <= 1) {
    return null;
  }

  const activeIndex = Math.max(
    0,
    variants.findIndex((branch) => branch.id === activeBranchId),
  );
  const activeVariant = variants[activeIndex];

  const selectOffset = (offset: number) => {
    const nextIndex = (activeIndex + offset + variants.length) % variants.length;
    onSelect(variants[nextIndex].id);
  };

  return (
    <div
      className="inline-flex h-6 shrink-0 items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.035] text-[10px] text-gray-300"
      title={activeVariant?.label}
    >
      <button
        type="button"
        onClick={() => selectOffset(-1)}
        disabled={disabled}
        aria-label="Previous chat variant"
        title="Previous variant"
        className="inline-flex h-6 w-6 items-center justify-center text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-not-allowed disabled:text-gray-600"
      >
        <Icons.ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="inline-flex h-6 min-w-12 items-center justify-center gap-1 border-x border-white/10 px-1.5 font-medium tabular-nums">
        <Icons.Branch className="h-3 w-3 text-gray-500" />
        {activeIndex + 1}/{variants.length}
      </span>
      <button
        type="button"
        onClick={() => selectOffset(1)}
        disabled={disabled}
        aria-label="Next chat variant"
        title="Next variant"
        className="inline-flex h-6 w-6 items-center justify-center text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-not-allowed disabled:text-gray-600"
      >
        <Icons.ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="mt-2 space-y-2" aria-hidden="true">
      <div className="h-2.5 w-11/12 animate-pulse rounded-full bg-white/10" />
      <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-white/10" />
    </div>
  );
}

function PreviewArtifactPanel({
  color = 'gray',
  children,
}: {
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ '--c': color } as React.CSSProperties}
      className="
        -mx-3 mt-3 space-y-3 border-y px-3 py-3 transition-colors
        border-[color:color-mix(in_srgb,var(--c)_15%,transparent)]
        bg-[color:color-mix(in_srgb,var(--c)_2.5%,transparent)]
        hover:bg-[color:color-mix(in_srgb,var(--c)_5.5%,transparent)]
      "
    >
      {children}
    </div>
  );
}

function CompactDisclosure({
  title,
  children,
  preview,
  indicator,
  className = '',
  contentClassName = 'mt-1',
  contentLineClassName,
  tone = 'neutral',
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  preview?: string;
  indicator?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  contentLineClassName?: string;
  tone?: 'neutral' | 'cyan';
}) {
  const toneClassName =
    tone === 'cyan'
      ? 'text-cyan-100/65 hover:bg-cyan-100/[0.06] hover:text-cyan-50 focus-visible:ring-cyan-200/25'
      : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200 focus-visible:ring-white/15';
  const iconClassName = tone === 'cyan' ? 'text-cyan-100/45' : 'text-gray-500';
  const previewClassName = tone === 'cyan' ? 'text-cyan-50/70' : 'text-gray-400';

  return (
    <details className={`group min-w-0 ${className}`}>
      <summary
        className={`flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-1 text-left transition focus:outline-none focus-visible:ring-1 [&::-webkit-details-marker]:hidden ${toneClassName}`}
      >
        <Icons.ChevronDown
          className={`h-3 w-3 shrink-0 -rotate-90 transition-transform group-open:rotate-0 ${iconClassName}`}
        />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em]">
          {title}
        </span>
        {indicator}
        {preview ? (
          <span
            className={`min-w-0 flex-1 truncate text-[12px] font-normal normal-case leading-5 tracking-normal group-open:hidden ${previewClassName}`}
            title={preview}
          >
            {preview}
          </span>
        ) : null}
      </summary>
      <div
        className={`${contentClassName} ${
          contentLineClassName ??
          (tone === 'cyan' ? 'border-l border-cyan-200/20' : 'border-l border-white/[0.08]')
        }`}
      >
        {children}
      </div>
    </details>
  );
}

const isCustomShaderNode = (node: unknown): node is CustomShaderNode =>
  !!node && typeof node === 'object' && 'type' in node && node.type === NodeType.CUSTOM_SHADER;

const formatChatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);

const getPendingMessagePhaseLabel = (
  message: AiChatMessage | null | undefined,
  now = Date.now(),
) => {
  if (!message) return 'Connecting';
  if (message.streamStage === 'tool') return 'Using tools';
  if (message.isThinking || message.thinking?.trim()) return 'Thinking';
  if (message.content.trim()) return 'Responding';
  const elapsedMs = now - message.createdAt;
  if (elapsedMs > 60000) return 'Still waiting';
  if (elapsedMs > 10000) return 'Waiting for model';
  return 'Connecting';
};

type ChatPromptBranchPoints = {
  userBranchPointId?: string;
  assistantBranchPointId?: string;
};

type PreparedChatBranchPrompt = {
  prompt: string;
  attachments?: AiChatAttachment[];
  branchPoints: ChatPromptBranchPoints;
};

type SubmitPromptOptions = {
  forceAgentMode?: boolean;
};

type AgentDiffState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; summary: AgentBranchDiffSummary }
  | { status: 'error'; message: string };

type AgentBranchInspectState =
  | { status: 'idle' | 'loading' }
  | {
      status: 'ready';
      parentBranchId: string;
      branchId: string;
      parentNodeCount: number;
      branchNodeCount: number;
      changedNodes: Array<{
        id: string;
        label: string;
        type: string;
        status: 'added' | 'removed' | 'updated';
      }>;
      branchGraph: {
        flowName: string;
        nodes: Array<{
          id: string;
          label: string;
          type: string;
          status?: 'added' | 'removed' | 'updated';
          x: number;
          y: number;
        }>;
        edges: FlowEdge[];
      };
      summary: AgentBranchDiffSummary;
    }
  | { status: 'error'; message: string };

type AgentReviewDialogAction = 'apply' | 'pick' | 'discard';

type AgentReviewDialogState =
  | {
      action: AgentReviewDialogAction;
      runId: string;
      status: 'loading';
    }
  | {
      action: AgentReviewDialogAction;
      runId: string;
      status: 'ready';
      summary?: AgentBranchDiffSummary;
    }
  | {
      action: AgentReviewDialogAction;
      runId: string;
      status: 'error';
      message: string;
      summary?: AgentBranchDiffSummary;
    }
  | {
      action: AgentReviewDialogAction;
      runId: string;
      status: 'working';
      summary?: AgentBranchDiffSummary;
    };

const REVIEW_PASS_OPTIONS = [1, 2, 3] as const;
const REVIEW_TOOL_STEP_OPTIONS = [1, 4, 8] as const;

const getAgentRunStatusLabel = (status: AiAgentRun['status']) =>
  status === 'waiting-for-user'
    ? 'Waiting'
    : status === 'triaging'
      ? 'Triaging'
      : status.charAt(0).toLocaleUpperCase() + status.slice(1);

const getAgentRunReviewStep = (run: AiAgentRun) =>
  run.steps.find((step) => step.kind === 'review') ?? null;

const getAgentRunNextActionLabel = (action: AiAgentRun['recommendedNextAction']) => {
  if (!action) return 'Agent decides';
  if (action === 'manual-review') return 'Manual review';
  if (action === 'cherry-pick') return 'Cherry-pick';
  return action.charAt(0).toLocaleUpperCase() + action.slice(1);
};

const getAgentRunUserAccessLabel = (run: AiAgentRun) => {
  const resolvedUserAccess = run.userAccess ?? (run.branchId ? 'read-only' : 'review');
  if (resolvedUserAccess === 'editor') return 'User editor';
  if (resolvedUserAccess === 'review') return 'User reviewer';
  return 'User read-only';
};

const getAgentRunOwnerLabel = (run: AiAgentRun) =>
  run.workingOwnerType === 'user'
    ? 'User-owned'
    : run.workingOwnerType === 'mixed'
      ? 'Shared ownership'
      : 'Agent-owned';

const getAgentRunReviewState = (run: AiAgentRun) => {
  const reviewStep = getAgentRunReviewStep(run);
  const requiresReview = run.settings.reviewRender && reviewStep?.status !== 'blocked';
  const hasReviewAsset = Boolean(reviewStep?.reviewAssetIds?.length);
  const isSatisfied =
    !requiresReview ||
    hasReviewAsset ||
    run.status === 'applied' ||
    run.status === 'merged' ||
    run.status === 'discarded' ||
    run.status === 'failed';

  return {
    requiresReview,
    hasReviewAsset,
    isSatisfied,
    label: requiresReview
      ? hasReviewAsset
        ? 'Preview captured'
        : 'Preview required'
      : 'Preview optional',
  };
};

const getAgentBranchName = (prompt: string) => createScopedProjectBranchName('agent', prompt);

const AGENT_BRANCH_REQUEST_MARKER = '[agent-branch-request]';
const stripAgentBranchRequestMarker = (content: string) =>
  content
    .replaceAll(AGENT_BRANCH_REQUEST_MARKER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const getAgentRunForChat = (runs: AiAgentRun[], chat: AiChatThread | null) => {
  if (!chat) return null;
  const directRun = runs.find((run) => run.sourceChatId === chat.id);
  if (directRun) return directRun;

  const chatCreatedAt = chat.createdAt ?? 0;
  return (
    [...runs]
      .filter((run) => !run.sourceChatId && !terminalAgentRunStatuses.has(run.status))
      .filter((run) => run.createdAt >= chatCreatedAt - 5000)
      .sort((first, second) => second.updatedAt - first.updatedAt)[0] ?? null
  );
};

const terminalAgentRunStatuses = new Set<AiAgentRun['status']>([
  'applied',
  'discarded',
  'failed',
  'merged',
]);

const agentBranchStartPattern =
  /\b(yes|yep|yeah|ok|okay|proceed|go ahead|start|do it|create (?:the )?branch|make (?:the )?branch|start (?:the )?work|begin|implement|apply|continue)\b/i;

const shouldStartAgentBranchForPrompt = (prompt: string) =>
  agentBranchStartPattern.test(prompt.trim());

const isReusableAgentBranch = (
  run: AiAgentRun | null | undefined,
  branchesById: Map<string, ProjectBranchRecord>,
) => {
  if (!run?.branchId || terminalAgentRunStatuses.has(run.status)) return false;
  const branch = branchesById.get(run.branchId);
  return branch?.kind === 'agent' && branch.status === 'active';
};

const getRelatedAgentRun = ({
  runs,
  chat,
  activeProjectBranchId,
}: {
  runs: AiAgentRun[];
  chat: AiChatThread | null;
  activeProjectBranchId: string;
}) =>
  [...runs]
    .filter((run) => !terminalAgentRunStatuses.has(run.status))
    .filter((run) =>
      chat
        ? run.sourceChatId === chat.id ||
          (!run.sourceChatId && run.createdAt >= (chat.createdAt ?? 0) - 5000)
        : run.branchId === activeProjectBranchId,
    )
    .sort((first, second) => second.updatedAt - first.updatedAt)[0] ?? null;

const getReusableAgentRun = ({
  runs,
  chat,
  branchesById,
  activeProjectBranchId,
}: {
  runs: AiAgentRun[];
  chat: AiChatThread | null;
  branchesById: Map<string, ProjectBranchRecord>;
  activeProjectBranchId: string;
}) => {
  const relatedRun = getRelatedAgentRun({ runs, chat, activeProjectBranchId });

  return isReusableAgentBranch(relatedRun, branchesById) ? relatedRun : null;
};

const hasOpenAgentBranchRequest = (chat: AiChatThread | null) => {
  if (!chat) return false;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.status === 'pending') {
      continue;
    }
    if (message.role === 'user') {
      return false;
    }
    return message.content.includes(AGENT_BRANCH_REQUEST_MARKER);
  }

  return false;
};

const getLatestAgentReviewMessage = (run: AiAgentRun, chat: AiChatThread | null) => {
  if (!chat) return null;
  const reviewAssetIds = new Set(run.steps.flatMap((step) => step.reviewAssetIds ?? []));
  if (reviewAssetIds.size === 0) return null;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (
      reviewAssetIds.has(message.id) &&
      (message.artifact?.type === 'render-comparison' ||
        message.artifact?.type === 'render-preview')
    ) {
      return message;
    }
  }

  return null;
};

const getSnapshotNodes = (state: PersistedProjectState | null | undefined): AnyNode[] => {
  if (!state?.flows) return [];
  const flow =
    (state.activeFlowId ? state.flows[state.activeFlowId] : null) ??
    (state.rootFlowId ? state.flows[state.rootFlowId] : null) ??
    Object.values(state.flows)[0];
  return flow ? getOrderedNodesFromFlow(flow) : [];
};

const getSnapshotFlow = (state: PersistedProjectState | null | undefined) => {
  if (!state?.flows) return null;
  return (
    (state.activeFlowId ? state.flows[state.activeFlowId] : null) ??
    (state.rootFlowId ? state.flows[state.rootFlowId] : null) ??
    Object.values(state.flows)[0] ??
    null
  );
};

const getSnapshotNodePositions = (
  state: PersistedProjectState | null | undefined,
): NodePositions => {
  const flow = getSnapshotFlow(state);
  if (!flow) return {};
  return state?.nodePositionsByFlow?.[flow.id] ?? {};
};

const getNodeDisplayLabel = (node: AnyNode | undefined, fallbackId: string) =>
  node?.name?.trim() || fallbackId;

const buildAgentBranchInspectState = ({
  parentBranchId,
  branchId,
  parentState,
  branchState,
}: {
  parentBranchId: string;
  branchId: string;
  parentState: PersistedProjectState | null | undefined;
  branchState: PersistedProjectState | null | undefined;
}): AgentBranchInspectState => {
  const parentNodes = getSnapshotNodes(parentState);
  const branchNodes = getSnapshotNodes(branchState);
  const parentNodesById = new Map(parentNodes.map((node) => [node.id, node]));
  const branchNodesById = new Map(branchNodes.map((node) => [node.id, node]));
  const branchNodePositions = getSnapshotNodePositions(branchState);
  const summary = summarizeAgentBranchDiff(parentState, branchState);
  const changedStatusByNodeId = new Map<string, 'added' | 'removed' | 'updated'>([
    ...summary.nodeChanges.added.map((id) => [id, 'added'] as const),
    ...summary.nodeChanges.removed.map((id) => [id, 'removed'] as const),
    ...summary.nodeChanges.changed.map((id) => [id, 'updated'] as const),
  ]);
  const changedNodes = [
    ...summary.nodeChanges.added.map((id) => ({
      id,
      label: getNodeDisplayLabel(branchNodesById.get(id), id),
      type: branchNodesById.get(id)?.type ?? 'unknown',
      status: 'added' as const,
    })),
    ...summary.nodeChanges.removed.map((id) => ({
      id,
      label: getNodeDisplayLabel(parentNodesById.get(id), id),
      type: parentNodesById.get(id)?.type ?? 'unknown',
      status: 'removed' as const,
    })),
    ...summary.nodeChanges.changed.map((id) => ({
      id,
      label: getNodeDisplayLabel(branchNodesById.get(id), id),
      type: branchNodesById.get(id)?.type ?? 'unknown',
      status: 'updated' as const,
    })),
  ];

  return {
    status: 'ready',
    parentBranchId,
    branchId,
    parentNodeCount: parentNodes.length,
    branchNodeCount: branchNodes.length,
    changedNodes,
    branchGraph: {
      flowName: getSnapshotFlow(branchState)?.name ?? 'Branch Flow',
      nodes: branchNodes.map((node, index) => {
        const position = branchNodePositions[node.id] ?? {
          x: 24 + (index % 4) * 180,
          y: 24 + Math.floor(index / 4) * 96,
        };
        return {
          id: node.id,
          label: getNodeDisplayLabel(node, node.id),
          type: node.type,
          status: changedStatusByNodeId.get(node.id),
          x: position.x,
          y: position.y,
        };
      }),
      edges: getSnapshotFlow(branchState)?.edges ?? [],
    },
    summary,
  };
};

function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: AiChatAttachment[];
  onRemove?: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[11px] text-gray-300"
          title={`${attachment.name} (${attachment.mimeType || 'unknown type'}, ${formatAttachmentSize(attachment.size)})`}
        >
          {attachment.kind === 'image' && attachment.dataUrl ? (
            <img
              src={attachment.dataUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded border border-white/10 object-cover"
            />
          ) : attachment.kind === 'image' ? (
            <Icons.Photo className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          ) : (
            <Icons.DocumentPlus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          )}
          <span className="min-w-0 max-w-36 truncate">{attachment.name}</span>
          <span className="shrink-0 text-gray-600">{formatAttachmentSize(attachment.size)}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
              title={`Remove ${attachment.name}`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-gray-400 transition hover:bg-white/[0.08] hover:text-gray-100"
            >
              <Icons.XMark className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AgentRunCard({
  run,
  branchName,
  isActiveBranch,
  diff,
  inspect,
  compact = false,
  onOpenBranch,
  onConfirmBranch,
  onInspectBranch,
  onCapturePreview,
  onSelfReview,
  reviewPolicy,
  onReviewPolicyChange,
  onApplyBranch,
  onPickNodeChanges,
  onDiscardBranch,
  onTakeOverBranch,
  onAnswerQuestion,
  isCapturingPreview = false,
  isSelfReviewing = false,
}: {
  run: AiAgentRun;
  branchName?: string;
  isActiveBranch: boolean;
  diff?: AgentDiffState;
  inspect?: AgentBranchInspectState;
  compact?: boolean;
  onOpenBranch?: () => void;
  onConfirmBranch?: () => void;
  onInspectBranch?: () => void;
  onCapturePreview?: () => void;
  onSelfReview?: () => void;
  reviewPolicy?: AgentSelfReviewPolicy;
  onReviewPolicyChange?: (policy: AgentSelfReviewPolicy) => void;
  onApplyBranch?: () => void;
  onPickNodeChanges?: () => void;
  onDiscardBranch?: () => void;
  onTakeOverBranch?: () => void;
  onAnswerQuestion?: (
    question: AiAgentQuestion,
    answer: { choiceId?: string; text: string },
  ) => void;
  isCapturingPreview?: boolean;
  isSelfReviewing?: boolean;
}) {
  const [selectedInspectNodeId, setSelectedInspectNodeId] = useState<string | null>(null);
  const [isBranchBrowserOpen, setIsBranchBrowserOpen] = useState(false);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const statusLabel = getAgentRunStatusLabel(run.status);
  const canReviewBranch = Boolean(run.branchId) && run.status !== 'discarded';
  const canConfirmBranch =
    !run.branchId && !terminalAgentRunStatuses.has(run.status) && Boolean(onConfirmBranch);
  const reviewState = getAgentRunReviewState(run);
  const canApplyBranch =
    canReviewBranch &&
    reviewState.isSatisfied &&
    !['applied', 'discarded', 'failed', 'merged'].includes(run.status);
  const isApplyBlockedByReview =
    canReviewBranch &&
    !reviewState.isSatisfied &&
    !['applied', 'discarded', 'failed', 'merged'].includes(run.status);
  const harnessStatusLabel =
    run.status === 'ready' && isApplyBlockedByReview ? 'Review Needed' : statusLabel;
  const statusTone =
    run.status === 'failed'
      ? 'border-red-400/25 bg-red-500/10 text-red-100'
      : run.status === 'discarded'
        ? 'border-white/10 bg-white/[0.04] text-gray-300'
        : run.status === 'ready' || run.status === 'applied' || run.status === 'merged'
          ? 'border-green-400/25 bg-green-500/10 text-green-100'
          : 'border-primary-400/25 bg-primary-500/10 text-primary-100';
  const readyInspect = inspect?.status === 'ready' ? inspect : null;
  const inspectNodeById = useMemo(
    () => new Map(readyInspect?.branchGraph.nodes.map((node) => [node.id, node]) ?? []),
    [readyInspect],
  );
  const selectedInspectNode =
    selectedInspectNodeId && inspectNodeById.has(selectedInspectNodeId)
      ? inspectNodeById.get(selectedInspectNodeId)
      : null;
  const visibleInspectEdges =
    readyInspect && selectedInspectNodeId
      ? readyInspect.branchGraph.edges.filter(
          (edge) =>
            edge.sourceNodeId === selectedInspectNodeId ||
            edge.targetNodeId === selectedInspectNodeId,
        )
      : (readyInspect?.branchGraph.edges ?? []);
  const inspectCanvas = useMemo(() => {
    if (!readyInspect?.branchGraph.nodes.length) {
      return null;
    }

    const width = 112;
    const height = 38;
    const padding = 10;
    const nodes = readyInspect.branchGraph.nodes;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY, 1);
    const offsetX = (width - spanX * scale) / 2;
    const offsetY = (height - spanY * scale) / 2;
    const project = (x: number, y: number) => ({
      x: offsetX + (x - minX) * scale,
      y: offsetY + (y - minY) * scale,
    });
    const projectedNodes = nodes.map((node) => ({
      ...node,
      ...project(node.x, node.y),
    }));
    const projectedNodeById = new Map(projectedNodes.map((node) => [node.id, node]));

    return {
      width,
      height,
      nodes: projectedNodes,
      edges: readyInspect.branchGraph.edges
        .map((edge) => {
          const source = projectedNodeById.get(edge.sourceNodeId);
          const target = projectedNodeById.get(edge.targetNodeId);
          return source && target ? { id: edge.id, source, target } : null;
        })
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge)),
    };
  }, [readyInspect]);
  const conflictWarnings =
    readyInspect?.summary.domainChanges.conflicts ??
    (diff?.status === 'ready' ? diff.summary.domainChanges.conflicts : []);
  const domainReviewDetails =
    readyInspect?.summary.domainChanges.details ??
    (diff?.status === 'ready' ? diff.summary.domainChanges.details : []);
  const hasConflictWarnings = conflictWarnings.length > 0;
  const resolvedUserAccess = run.userAccess ?? (run.branchId ? 'read-only' : 'review');
  const userAccessLabel = getAgentRunUserAccessLabel(run);
  const ownerLabel = getAgentRunOwnerLabel(run);
  const visibleSteps = run.steps.filter((step) => step.status !== 'skipped');
  const shouldInspectInsteadOfOpen =
    run.workingOwnerType !== 'user' && resolvedUserAccess === 'read-only';
  const canTakeOverBranch =
    canReviewBranch &&
    run.workingOwnerType !== 'user' &&
    resolvedUserAccess === 'read-only' &&
    Boolean(onTakeOverBranch);
  const canShowBranchAccessButton =
    canReviewBranch &&
    !isActiveBranch &&
    ((shouldInspectInsteadOfOpen && onInspectBranch) ||
      (!shouldInspectInsteadOfOpen && onOpenBranch));

  useEffect(() => {
    if (!readyInspect || !selectedInspectNodeId || inspectNodeById.has(selectedInspectNodeId)) {
      return;
    }
    setSelectedInspectNodeId(null);
  }, [inspectNodeById, readyInspect, selectedInspectNodeId]);

  useEffect(() => {
    if (!readyInspect && isBranchBrowserOpen) {
      setIsBranchBrowserOpen(false);
    }
  }, [isBranchBrowserOpen, readyInspect]);

  useEffect(() => {
    if (!isBranchBrowserOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBranchBrowserOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBranchBrowserOpen]);

  return (
    <>
      <div className="rounded-xl border border-green-300/15 bg-green-400/[0.045] p-2.5 text-xs text-gray-200">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-green-300/20 bg-green-400/10 text-green-100">
            <Icons.Branch className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-medium text-green-50">{run.title}</span>
              <Badge size="sm" uppercase shrink className={`font-semibold ${statusTone}`}>
                {harnessStatusLabel}
              </Badge>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-green-100/70">
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-green-200/10 bg-black/10 px-1.5 py-0.5">
                <Icons.Branch className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {branchName ?? run.branchId ?? 'No branch'}
                </span>
              </span>
              {isActiveBranch ? (
                <Badge size="sm" className="!bg-black/10 !text-green-100/70 border-green-200/10">
                  Current
                </Badge>
              ) : null}
              <Badge
                size="sm"
                className={
                  reviewState.isSatisfied
                    ? '!border-cyan-200/10 !bg-cyan-400/10 !text-cyan-50/75'
                    : '!border-amber-300/20 !bg-amber-500/10 !text-amber-50/85'
                }
              >
                {reviewState.label}
              </Badge>
            </div>
            {!compact ? (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-green-50/75">
                <Badge size="sm" className="!bg-black/10 !text-green-100/70 border-green-200/10">
                  {ownerLabel}
                </Badge>
                <Badge size="sm" className="!bg-cyan-400/10 !text-cyan-50/75 border-cyan-200/10">
                  {userAccessLabel}
                </Badge>
                <Badge
                  size="sm"
                  className="!bg-primary-400/10 !text-primary-50/75 border-primary-200/10"
                >
                  Next: {getAgentRunNextActionLabel(run.recommendedNextAction)}
                </Badge>
              </div>
            ) : null}
            {compact || visibleSteps.length === 0 ? null : (
              <div className="mt-2 space-y-1">
                {visibleSteps.map((step) => (
                  <div key={step.id} className="space-y-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          step.status === 'complete'
                            ? 'bg-green-300'
                            : step.status === 'blocked'
                              ? 'bg-red-300'
                              : step.status === 'running'
                                ? 'bg-primary-300'
                                : 'bg-white/25'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-green-50/85">{step.title}</span>
                      {step.kind ? (
                        <Badge
                          size="sm"
                          uppercase
                          shrink
                          className="!px-1 !bg-white/[0.04] !text-green-100/40 border-white/10 tracking-[0.1em]"
                        >
                          {step.kind}
                        </Badge>
                      ) : null}
                      {step.reviewAssetIds?.length ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan-200/10 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-50/75">
                          <Icons.Photo className="h-3 w-3" />
                          {step.reviewAssetIds.length}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-green-100/45">
                        {step.status}
                      </span>
                    </div>
                    {step.questions?.length ? (
                      <div className="ml-3 space-y-1 rounded-lg border border-primary-200/10 bg-primary-400/[0.04] p-2">
                        {step.questions.map((question) => {
                          const isAnswered = Boolean(question.answerText?.trim());
                          return (
                            <div key={question.id} className="space-y-1.5">
                              <div className="flex min-w-0 items-start justify-between gap-2">
                                <p className="min-w-0 text-[11px] leading-4 text-primary-50/85">
                                  {question.prompt}
                                </p>
                                {isAnswered ? (
                                  <Badge
                                    size="sm"
                                    uppercase
                                    shrink
                                    className="!bg-green-400/10 !text-green-50/70 border-green-200/10 tracking-[0.1em]"
                                  >
                                    Answered
                                  </Badge>
                                ) : null}
                              </div>
                              {isAnswered ? (
                                <p className="rounded border border-green-200/10 bg-green-400/10 px-2 py-1 text-[10px] text-green-50/75">
                                  {question.answerText}
                                </p>
                              ) : question.choices?.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {question.choices.map((choice) => (
                                    <button
                                      key={choice.id}
                                      type="button"
                                      onClick={() =>
                                        onAnswerQuestion?.(question, {
                                          choiceId: choice.id,
                                          text: choice.label,
                                        })
                                      }
                                      className="rounded border border-primary-200/15 bg-primary-400/10 px-1.5 py-1 text-[10px] text-primary-50 transition hover:bg-primary-400/20"
                                      title={choice.description}
                                    >
                                      {choice.label}
                                      {choice.recommended ? ' (recommended)' : ''}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {!isAnswered && question.freeformAllowed ? (
                                <div className="flex min-w-0 gap-1">
                                  <TextInput
                                    value={questionDrafts[question.id] ?? ''}
                                    onValueChange={(value) =>
                                      setQuestionDrafts((current) => ({
                                        ...current,
                                        [question.id]: value,
                                      }))
                                    }
                                    placeholder="Answer"
                                    className="min-w-0 flex-1 bg-black/20 px-1.5 py-1 text-[10px] text-primary-50 placeholder:text-primary-50/30 !min-h-0"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const text = questionDrafts[question.id]?.trim();
                                      if (!text) return;
                                      onAnswerQuestion?.(question, { text });
                                      setQuestionDrafts((current) => ({
                                        ...current,
                                        [question.id]: '',
                                      }));
                                    }}
                                    disabled={!questionDrafts[question.id]?.trim()}
                                    className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[10px] text-primary-50/70 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Send
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {step.reviewFindings?.length ? (
                      <div className="ml-3 space-y-1 rounded-lg border border-cyan-200/10 bg-cyan-400/[0.04] p-2">
                        {step.reviewFindings.map((finding) => (
                          <div
                            key={finding.id}
                            className={`rounded border px-2 py-1 text-[10px] leading-4 ${
                              finding.severity === 'blocking'
                                ? 'border-red-300/20 bg-red-500/10 text-red-50/85'
                                : finding.severity === 'warning'
                                  ? 'border-amber-300/20 bg-amber-500/10 text-amber-50/85'
                                  : 'border-cyan-200/10 bg-cyan-400/10 text-cyan-50/80'
                            }`}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="min-w-0 truncate font-medium">{finding.title}</span>
                              <span className="shrink-0 uppercase tracking-[0.1em] opacity-60">
                                {finding.severity}
                              </span>
                            </div>
                            {finding.description ? (
                              <p className="mt-0.5 opacity-75">{finding.description}</p>
                            ) : null}
                            {finding.recommendation ? (
                              <p className="mt-0.5 opacity-60">{finding.recommendation}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {step.delegation ? (
                      <div className="ml-3 rounded-lg border border-primary-200/10 bg-primary-400/[0.04] p-2 text-[10px] leading-4 text-primary-50/75">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">
                            {step.delegation.assignee}
                          </span>
                          <span className="shrink-0 uppercase tracking-[0.1em] text-primary-50/45">
                            {step.delegation.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-primary-50/70">{step.delegation.task}</p>
                        {step.delegation.result ? (
                          <p className="mt-0.5 text-primary-50/55">{step.delegation.result}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {run.error ? (
              <p className="mt-2 text-[11px] leading-4 text-red-100">{run.error}</p>
            ) : null}
            {!compact && hasConflictWarnings ? (
              <div className="mt-2 rounded-lg border border-red-300/20 bg-red-500/10 p-2 text-[11px] leading-4 text-red-50/85">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-100/70">
                  <Icons.ExclamationCircle className="h-3 w-3" />
                  Conflict Review
                </div>
                <ul className="space-y-1">
                  {conflictWarnings.slice(0, 3).map((item) => (
                    <li key={item} className="flex gap-1.5">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-red-200/70" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-red-50/60">
                  Full Apply replaces the parent snapshot. Pick Nodes keeps parent-only nodes.
                </p>
              </div>
            ) : null}
            {!compact && isApplyBlockedByReview ? (
              <div className="mt-2 rounded-lg border border-amber-300/20 bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-50/85">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                  <Icons.Photo className="h-3 w-3" />
                  Review Gate
                </div>
                Capture a before/after preview before applying this branch. The agent can still
                inspect, revise, or self-review the sandbox first.
              </div>
            ) : null}
            {!compact && canConfirmBranch ? (
              <div className="mt-2 rounded-lg border border-primary-300/15 bg-primary-400/10 p-2">
                <p className="text-[11px] leading-4 text-primary-50/85">
                  This task needs an isolated agent branch before it can change the project.
                </p>
                <button
                  type="button"
                  onClick={onConfirmBranch}
                  className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary-500/25 px-2 py-1 text-[11px] font-medium text-primary-50 transition hover:bg-primary-500/35"
                >
                  <Icons.Branch className="h-3 w-3" />
                  Create Branch & Start
                </button>
              </div>
            ) : null}
            {!compact && diff && diff.status !== 'idle' ? (
              <div className="mt-2 rounded-lg border border-green-200/10 bg-black/10 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-green-100/50">
                  Snapshot Compare
                </div>
                {diff.status === 'loading' ? (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-green-50/70">
                    <Spinner className="h-3 w-3 text-white" />
                    Loading saved branch diff
                  </div>
                ) : diff.status === 'error' ? (
                  <p className="mt-1 text-[11px] leading-4 text-red-100">{diff.message}</p>
                ) : diff.status === 'ready' && diff.summary.hasChanges ? (
                  <ul className="mt-1 space-y-1 text-[11px] leading-4 text-green-50/80">
                    {diff.summary.items.slice(0, 5).map((item) => (
                      <li key={item} className="flex gap-1.5">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-green-200/60" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] leading-4 text-green-50/70">
                    No saved snapshot differences found.
                  </p>
                )}
              </div>
            ) : null}
            {!compact && inspect && inspect.status !== 'idle' ? (
              <div className="mt-2 rounded-lg border border-cyan-200/10 bg-black/10 p-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/55">
                    Read-only Branch Inspect
                  </div>
                  {inspect.status === 'ready' ? (
                    <span className="shrink-0 text-[10px] text-cyan-50/50">
                      {inspect.parentNodeCount} {'->'} {inspect.branchNodeCount} nodes
                    </span>
                  ) : null}
                </div>
                {inspect.status === 'loading' ? (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-cyan-50/70">
                    <Spinner className="h-3 w-3 text-white" />
                    Loading branch snapshot
                  </div>
                ) : inspect.status === 'error' ? (
                  <p className="mt-1 text-[11px] leading-4 text-red-100">{inspect.message}</p>
                ) : (
                  <div className="mt-2 space-y-2 text-[11px] leading-4 text-cyan-50/80">
                    <div className="rounded-md border border-cyan-100/10 bg-cyan-100/[0.03] p-2">
                      <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
                        <span className="min-w-0 truncate">
                          {readyInspect!.branchGraph.flowName}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span>{readyInspect!.branchGraph.edges.length} edges</span>
                          {inspectCanvas ? (
                            <button
                              type="button"
                              onClick={() => setIsBranchBrowserOpen(true)}
                              className="rounded border border-cyan-200/15 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-50 transition hover:bg-cyan-400/15"
                            >
                              Expand
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {inspectCanvas ? (
                        <svg
                          viewBox={`0 0 ${inspectCanvas.width} ${inspectCanvas.height}`}
                          className="mb-2 h-24 w-full rounded border border-cyan-100/10 bg-black/20"
                          role="img"
                          aria-label="Read-only agent branch graph map"
                        >
                          {inspectCanvas.edges.map((edge) => {
                            const isFocused =
                              !selectedInspectNodeId ||
                              edge.source.id === selectedInspectNodeId ||
                              edge.target.id === selectedInspectNodeId;
                            return (
                              <line
                                key={edge.id}
                                x1={edge.source.x}
                                y1={edge.source.y}
                                x2={edge.target.x}
                                y2={edge.target.y}
                                stroke={
                                  isFocused ? 'rgb(125 211 252 / 0.55)' : 'rgb(148 163 184 / 0.18)'
                                }
                                strokeWidth={isFocused ? 0.9 : 0.5}
                              />
                            );
                          })}
                          {inspectCanvas.nodes.map((node) => {
                            const isSelected = selectedInspectNodeId === node.id;
                            const isDimmed =
                              selectedInspectNodeId &&
                              !isSelected &&
                              !visibleInspectEdges.some(
                                (edge) =>
                                  edge.sourceNodeId === node.id || edge.targetNodeId === node.id,
                              );
                            const fill =
                              node.status === 'added'
                                ? 'rgb(74 222 128)'
                                : node.status === 'updated'
                                  ? 'rgb(96 165 250)'
                                  : node.status === 'removed'
                                    ? 'rgb(248 113 113)'
                                    : 'rgb(103 232 249)';
                            return (
                              <g key={node.id}>
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r={isSelected ? 2.9 : 2.2}
                                  fill={fill}
                                  opacity={isDimmed ? 0.28 : 0.9}
                                  stroke={isSelected ? 'white' : 'rgb(8 47 73 / 0.8)'}
                                  strokeWidth={isSelected ? 0.9 : 0.45}
                                />
                                {isSelected ? (
                                  <text
                                    x={Math.min(inspectCanvas.width - 24, node.x + 3.8)}
                                    y={Math.max(5, node.y - 3)}
                                    fill="rgb(224 242 254)"
                                    fontSize="3.8"
                                  >
                                    {node.label.slice(0, 18)}
                                  </text>
                                ) : null}
                              </g>
                            );
                          })}
                        </svg>
                      ) : null}
                      <div className="flex gap-1.5 overflow-auto pb-1">
                        {readyInspect!.branchGraph.nodes.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setSelectedInspectNodeId(null)}
                            aria-pressed={!selectedInspectNodeId}
                            className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-1 text-left transition ${
                              selectedInspectNodeId
                                ? 'border-cyan-100/10 bg-black/10 text-cyan-50/55 hover:bg-cyan-100/[0.06]'
                                : 'border-cyan-200/25 bg-cyan-400/10 text-cyan-50'
                            }`}
                          >
                            All
                          </button>
                        ) : null}
                        {readyInspect!.branchGraph.nodes.slice(0, 20).map((node) => {
                          const statusClassName =
                            node.status === 'added'
                              ? 'border-green-300/25 bg-green-400/10 text-green-50'
                              : node.status === 'updated'
                                ? 'border-primary-300/25 bg-primary-400/10 text-primary-50'
                                : node.status === 'removed'
                                  ? 'border-red-300/25 bg-red-400/10 text-red-50'
                                  : 'border-cyan-100/10 bg-black/10 text-cyan-50/70';
                          const isSelected = selectedInspectNodeId === node.id;
                          return (
                            <button
                              type="button"
                              key={node.id}
                              onClick={() =>
                                setSelectedInspectNodeId((current) =>
                                  current === node.id ? null : node.id,
                                )
                              }
                              aria-pressed={isSelected}
                              title={`${node.label} (${node.type})`}
                              className={`inline-flex max-w-32 shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-left transition hover:bg-white/[0.08] ${
                                isSelected ? 'ring-1 ring-cyan-200/45' : ''
                              } ${statusClassName}`}
                            >
                              <span className="min-w-0 truncate">{node.label}</span>
                              <span className="shrink-0 text-cyan-100/35">{node.type}</span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedInspectNode ? (
                        <div className="mt-1 rounded border border-cyan-100/10 bg-black/10 px-1.5 py-1 text-cyan-50/70">
                          <span className="text-cyan-100/45">Selected:</span>{' '}
                          {selectedInspectNode.label}
                          <span className="text-cyan-100/35"> / {selectedInspectNode.type}</span>
                        </div>
                      ) : null}
                      {visibleInspectEdges.length > 0 ? (
                        <div className="mt-1 max-h-16 space-y-0.5 overflow-auto border-t border-cyan-100/10 pt-1 text-cyan-50/55">
                          {visibleInspectEdges.slice(0, 8).map((edge) => {
                            const sourceLabel =
                              inspectNodeById.get(edge.sourceNodeId)?.label ?? edge.sourceNodeId;
                            const targetLabel =
                              inspectNodeById.get(edge.targetNodeId)?.label ?? edge.targetNodeId;
                            return (
                              <div key={edge.id} className="truncate">
                                {sourceLabel}:{edge.sourcePort} -&gt; {targetLabel}:
                                {edge.targetPort}
                              </div>
                            );
                          })}
                        </div>
                      ) : selectedInspectNode ? (
                        <p className="mt-1 border-t border-cyan-100/10 pt-1 text-cyan-50/50">
                          No saved edges touch this node.
                        </p>
                      ) : null}
                    </div>
                    {readyInspect!.changedNodes.length > 0 ? (
                      <div className="max-h-28 space-y-1 overflow-auto pr-1">
                        {readyInspect!.changedNodes.slice(0, 12).map((node) => (
                          <div key={`${node.status}:${node.id}`} className="flex min-w-0 gap-1.5">
                            <span className="w-12 shrink-0 text-cyan-100/45">{node.status}</span>
                            <span className="min-w-0 flex-1 truncate">{node.label}</span>
                            <span className="shrink-0 text-cyan-100/40">{node.type}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-cyan-50/65">
                        No node-level changes in the saved snapshot.
                      </p>
                    )}
                    {readyInspect!.summary.domainChanges.roto.length > 0 ||
                    readyInspect!.summary.domainChanges.paint.length > 0 ||
                    readyInspect!.summary.domainChanges.assets.added.length > 0 ||
                    readyInspect!.summary.domainChanges.assets.removed.length > 0 ||
                    readyInspect!.summary.domainChanges.conflicts.length > 0 ||
                    readyInspect!.summary.domainChanges.details.length > 0 ? (
                      <div className="space-y-1.5 border-t border-cyan-100/10 pt-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
                          Domain Review
                        </div>
                        {readyInspect!.summary.domainChanges.details.slice(0, 4).map((detail) => (
                          <div
                            key={`${detail.domain}:${detail.title}`}
                            className={`rounded border px-2 py-1 ${
                              detail.severity === 'warning'
                                ? 'border-red-300/15 bg-red-500/10 text-red-50/85'
                                : 'border-cyan-100/10 bg-black/10 text-cyan-50/75'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{detail.title}</span>
                              <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] opacity-60">
                                {detail.domain}
                              </span>
                            </div>
                            <p className="mt-0.5 text-cyan-50/60">{detail.description}</p>
                            <p className="mt-0.5 text-cyan-50/50">{detail.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
            {!compact && canReviewBranch ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(canApplyBranch || isApplyBlockedByReview) && onApplyBranch ? (
                  <button
                    type="button"
                    onClick={onApplyBranch}
                    disabled={isApplyBlockedByReview}
                    title={
                      isApplyBlockedByReview
                        ? 'Capture a before/after preview before applying this agent branch.'
                        : hasConflictWarnings
                          ? 'This branch has conflict warnings. Inspect before applying the full snapshot.'
                          : 'Apply the full agent branch snapshot'
                    }
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                      isApplyBlockedByReview
                        ? 'cursor-not-allowed border border-amber-300/20 bg-amber-500/10 text-amber-50/60'
                        : hasConflictWarnings
                          ? 'border border-red-300/20 bg-red-500/10 text-red-50 hover:bg-red-500/15'
                          : 'bg-green-500/20 text-green-50 hover:bg-green-500/30'
                    }`}
                  >
                    {isApplyBlockedByReview
                      ? 'Preview Required'
                      : hasConflictWarnings
                        ? 'Apply Snapshot'
                        : 'Apply'}
                  </button>
                ) : null}
                {canApplyBranch && onPickNodeChanges ? (
                  <button
                    type="button"
                    onClick={onPickNodeChanges}
                    className="rounded-md border border-green-300/15 bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-50 transition hover:bg-green-500/15"
                  >
                    Pick Nodes
                  </button>
                ) : null}
                {onInspectBranch ? (
                  <button
                    type="button"
                    onClick={onInspectBranch}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan-200/15 bg-cyan-400/10 px-2 py-1 text-[11px] font-medium text-cyan-50 transition hover:bg-cyan-400/15"
                  >
                    <Icons.Bars4 className="h-3 w-3" />
                    Inspect
                  </button>
                ) : null}
                {onCapturePreview ? (
                  <button
                    type="button"
                    onClick={onCapturePreview}
                    disabled={isCapturingPreview}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan-200/15 bg-cyan-400/10 px-2 py-1 text-[11px] font-medium text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isCapturingPreview ? (
                      <Spinner className="h-3 w-3 text-white" />
                    ) : (
                      <Icons.Photo className="h-3 w-3" />
                    )}
                    Preview
                  </button>
                ) : null}
                {onSelfReview ? (
                  <button
                    type="button"
                    onClick={onSelfReview}
                    disabled={isSelfReviewing}
                    className="inline-flex items-center gap-1 rounded-md border border-primary-200/15 bg-primary-400/10 px-2 py-1 text-[11px] font-medium text-primary-50 transition hover:bg-primary-400/15 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isSelfReviewing ? (
                      <Spinner className="h-3 w-3 text-white" />
                    ) : (
                      <Icons.Sparkles className="h-3 w-3" />
                    )}
                    Self Review
                  </button>
                ) : null}
                {onSelfReview && reviewPolicy && onReviewPolicyChange ? (
                  <div className="flex min-w-full flex-wrap items-center gap-1.5 rounded-md border border-primary-200/10 bg-primary-400/[0.04] px-2 py-1.5 text-[10px] text-primary-50/75">
                    <span className="shrink-0 font-medium text-primary-50/85">Review</span>
                    <div className="inline-flex shrink-0 overflow-hidden rounded border border-primary-100/10">
                      {REVIEW_PASS_OPTIONS.map((passCount) => (
                        <button
                          key={passCount}
                          type="button"
                          disabled={isSelfReviewing}
                          onClick={() =>
                            onReviewPolicyChange({
                              ...reviewPolicy,
                              maxPasses: passCount,
                            })
                          }
                          className={`px-1.5 py-0.5 transition disabled:cursor-wait disabled:opacity-60 ${
                            reviewPolicy.maxPasses === passCount
                              ? 'bg-primary-300/20 text-primary-50'
                              : 'bg-black/10 text-primary-50/55 hover:bg-primary-300/10'
                          }`}
                          title={`${passCount} review pass${passCount === 1 ? '' : 'es'}`}
                        >
                          {passCount}x
                        </button>
                      ))}
                    </div>
                    <span className="shrink-0 text-primary-50/35">tools</span>
                    <div className="inline-flex shrink-0 overflow-hidden rounded border border-primary-100/10">
                      {REVIEW_TOOL_STEP_OPTIONS.map((stepCount) => (
                        <button
                          key={stepCount}
                          type="button"
                          disabled={isSelfReviewing}
                          onClick={() =>
                            onReviewPolicyChange({
                              ...reviewPolicy,
                              maxToolStepsPerPass: stepCount,
                            })
                          }
                          className={`px-1.5 py-0.5 transition disabled:cursor-wait disabled:opacity-60 ${
                            reviewPolicy.maxToolStepsPerPass === stepCount
                              ? 'bg-primary-300/20 text-primary-50'
                              : 'bg-black/10 text-primary-50/55 hover:bg-primary-300/10'
                          }`}
                          title={`${stepCount} max tool step${stepCount === 1 ? '' : 's'} per pass`}
                        >
                          {stepCount}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {onDiscardBranch ? (
                  <button
                    type="button"
                    onClick={onDiscardBranch}
                    className="rounded-md border border-red-300/15 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-100 transition hover:bg-red-500/15"
                  >
                    Discard
                  </button>
                ) : null}
                {canTakeOverBranch ? (
                  <button
                    type="button"
                    onClick={onTakeOverBranch}
                    className="rounded-md border border-amber-300/20 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-50 transition hover:bg-amber-500/15"
                  >
                    Take Over
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {canShowBranchAccessButton ? (
            <button
              type="button"
              onClick={shouldInspectInsteadOfOpen ? onInspectBranch : onOpenBranch}
              className="shrink-0 rounded-md border border-green-200/15 bg-green-200/10 px-2 py-1 text-[11px] font-medium text-green-50 transition hover:bg-green-200/15"
            >
              {shouldInspectInsteadOfOpen ? 'Inspect' : 'Open'}
            </button>
          ) : null}
        </div>
      </div>
      {!compact && isBranchBrowserOpen && readyInspect && inspectCanvas ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Read-only agent branch browser"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsBranchBrowserOpen(false);
            }
          }}
        >
          <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-cyan-200/15 bg-gray-950 shadow-2xl">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/50">
                  Read-only Branch Browser
                </div>
                <div className="truncate text-sm font-medium text-cyan-50">
                  {readyInspect.branchGraph.flowName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBranchBrowserOpen(false)}
                aria-label="Close branch browser"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                <Icons.XMark className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-h-72 overflow-hidden rounded-lg border border-cyan-100/10 bg-black/25">
                <svg
                  viewBox={`0 0 ${inspectCanvas.width} ${inspectCanvas.height}`}
                  className="h-full min-h-72 w-full"
                  role="img"
                  aria-label="Expanded read-only agent branch graph"
                >
                  {inspectCanvas.edges.map((edge) => {
                    const isFocused =
                      !selectedInspectNodeId ||
                      edge.source.id === selectedInspectNodeId ||
                      edge.target.id === selectedInspectNodeId;
                    return (
                      <line
                        key={edge.id}
                        x1={edge.source.x}
                        y1={edge.source.y}
                        x2={edge.target.x}
                        y2={edge.target.y}
                        stroke={isFocused ? 'rgb(125 211 252 / 0.62)' : 'rgb(148 163 184 / 0.18)'}
                        strokeWidth={isFocused ? 1.1 : 0.55}
                      />
                    );
                  })}
                  {inspectCanvas.nodes.map((node) => {
                    const isSelected = selectedInspectNodeId === node.id;
                    const isDimmed =
                      selectedInspectNodeId &&
                      !isSelected &&
                      !visibleInspectEdges.some(
                        (edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id,
                      );
                    const fill =
                      node.status === 'added'
                        ? 'rgb(74 222 128)'
                        : node.status === 'updated'
                          ? 'rgb(96 165 250)'
                          : node.status === 'removed'
                            ? 'rgb(248 113 113)'
                            : 'rgb(103 232 249)';
                    return (
                      <g key={node.id}>
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={isSelected ? 3.2 : 2.4}
                          fill={fill}
                          opacity={isDimmed ? 0.25 : 0.92}
                          stroke={isSelected ? 'white' : 'rgb(8 47 73 / 0.8)'}
                          strokeWidth={isSelected ? 1 : 0.5}
                        />
                        {isSelected ? (
                          <text
                            x={Math.min(inspectCanvas.width - 28, node.x + 4)}
                            y={Math.max(5, node.y - 3)}
                            fill="rgb(224 242 254)"
                            fontSize="4"
                          >
                            {node.label.slice(0, 22)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
                <div className="rounded-lg border border-cyan-100/10 bg-cyan-100/[0.03] p-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
                    Nodes
                  </div>
                  <div className="max-h-52 space-y-1 overflow-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setSelectedInspectNodeId(null)}
                      className={`w-full rounded px-2 py-1 text-left text-[11px] transition ${
                        selectedInspectNodeId
                          ? 'text-cyan-50/60 hover:bg-cyan-100/[0.06]'
                          : 'bg-cyan-400/10 text-cyan-50'
                      }`}
                    >
                      All nodes
                    </button>
                    {readyInspect.branchGraph.nodes.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedInspectNodeId(node.id)}
                        className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition ${
                          selectedInspectNodeId === node.id
                            ? 'bg-cyan-400/10 text-cyan-50'
                            : 'text-cyan-50/65 hover:bg-cyan-100/[0.06]'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{node.label}</span>
                        <span className="shrink-0 text-cyan-100/35">{node.type}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 flex-1 rounded-lg border border-cyan-100/10 bg-cyan-100/[0.03] p-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
                    Edges
                  </div>
                  <div className="max-h-52 space-y-1 overflow-auto pr-1 text-[11px] text-cyan-50/65">
                    {visibleInspectEdges.length > 0 ? (
                      visibleInspectEdges.map((edge) => (
                        <div key={edge.id} className="truncate rounded bg-black/15 px-2 py-1">
                          {inspectNodeById.get(edge.sourceNodeId)?.label ?? edge.sourceNodeId}:
                          {edge.sourcePort} -&gt;{' '}
                          {inspectNodeById.get(edge.targetNodeId)?.label ?? edge.targetNodeId}:
                          {edge.targetPort}
                        </div>
                      ))
                    ) : (
                      <p className="text-cyan-50/45">No saved edges for this selection.</p>
                    )}
                  </div>
                </div>
              </div>
              {domainReviewDetails.length > 0 ? (
                <div className="rounded-lg border border-cyan-100/10 bg-cyan-100/[0.03] p-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
                    Domain Review
                  </div>
                  <div className="max-h-44 space-y-1.5 overflow-auto pr-1">
                    {domainReviewDetails.map((detail) => (
                      <div
                        key={`${detail.domain}:${detail.title}`}
                        className={`rounded border px-2 py-1 text-[11px] ${
                          detail.severity === 'warning'
                            ? 'border-red-300/15 bg-red-500/10 text-red-50/85'
                            : 'border-cyan-100/10 bg-black/15 text-cyan-50/70'
                        }`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">{detail.title}</span>
                          <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] opacity-60">
                            {detail.domain}
                          </span>
                        </div>
                        <p className="mt-0.5">{detail.description}</p>
                        <p className="mt-0.5 opacity-70">{detail.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AgentReviewDialog({
  state,
  run,
  branchName,
  onClose,
  onConfirm,
}: {
  state: AgentReviewDialogState;
  run: AiAgentRun | null;
  branchName?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state.status !== 'working') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, state.status]);

  if (!run) return null;

  const reviewState = getAgentRunReviewState(run);
  const summary =
    state.status === 'ready' || state.status === 'error' || state.status === 'working'
      ? state.summary
      : undefined;
  const conflictCount = summary?.domainChanges.conflicts.length ?? 0;
  const actionCopy =
    state.action === 'apply'
      ? {
          eyebrow: 'Apply Snapshot',
          title: `Apply "${run.title}"`,
          description:
            'Replace the parent branch snapshot with the saved agent branch snapshot. This is the broadest handoff.',
          confirm: 'Apply Snapshot',
          tone: 'green',
        }
      : state.action === 'pick'
        ? {
            eyebrow: 'Pick Nodes',
            title: `Pick node changes from "${run.title}"`,
            description:
              'Copy added and updated nodes into the parent branch while keeping parent-only nodes in place.',
            confirm: 'Pick Nodes',
            tone: 'cyan',
          }
        : {
            eyebrow: 'Discard Branch',
            title: `Discard "${run.title}"`,
            description: 'Delete the agent branch and keep the parent branch unchanged.',
            confirm: 'Discard',
            tone: 'red',
          };
  const isConfirmDisabled =
    state.status === 'loading' ||
    state.status === 'working' ||
    (state.action === 'apply' && !reviewState.isSatisfied);
  const confirmClassName =
    actionCopy.tone === 'red'
      ? 'border-red-300/20 bg-red-500/15 text-red-50 hover:bg-red-500/25'
      : actionCopy.tone === 'cyan'
        ? 'border-cyan-300/20 bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25'
        : 'border-green-300/20 bg-green-500/20 text-green-50 hover:bg-green-500/30';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={actionCopy.title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && state.status !== 'working') {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-gray-950 shadow-2xl">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              {actionCopy.eyebrow}
            </div>
            <h2 className="mt-1 truncate text-sm font-semibold text-white">{actionCopy.title}</h2>
            <p className="mt-1 text-xs leading-5 text-gray-400">{actionCopy.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state.status === 'working'}
            aria-label="Close review dialog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-gray-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            <Icons.XMark className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] text-[11px]">
            {[
              ['Branch', branchName ?? run.branchId ?? 'No branch'],
              ['Access', getAgentRunUserAccessLabel(run)],
              ['Next', getAgentRunNextActionLabel(run.recommendedNextAction)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 border-r border-white/10 p-2.5 last:border-r-0">
                <div className="uppercase tracking-[0.12em] text-gray-500">{label}</div>
                <div className="mt-0.5 truncate font-medium text-gray-100" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {state.action === 'apply' && !reviewState.isSatisfied ? (
            <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-50/85">
              Capture a before/after preview before applying the full snapshot.
            </div>
          ) : null}

          {state.status === 'loading' ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-gray-300">
              <Spinner className="h-3.5 w-3.5 text-white" />
              Loading saved branch review
            </div>
          ) : state.status === 'error' ? (
            <div className="mt-3 rounded-lg border border-red-300/20 bg-red-500/10 p-3 text-xs leading-5 text-red-50">
              {state.message}
            </div>
          ) : null}

          {summary ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                  <span>Saved Snapshot Diff</span>
                  <span>{summary.hasChanges ? 'Changes found' : 'No changes'}</span>
                </div>
                {summary.items.length > 0 ? (
                  <ul className="space-y-1.5 text-xs leading-5 text-gray-200">
                    {summary.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400">No saved snapshot differences found.</p>
                )}
              </div>

              {conflictCount > 0 ? (
                <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-3 text-xs leading-5 text-red-50/85">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-100/75">
                    <Icons.ExclamationCircle className="h-3 w-3" />
                    Conflict Review
                  </div>
                  <ul className="space-y-1">
                    {summary.domainChanges.conflicts.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {summary.domainChanges.details.length > 0 ? (
                <div className="grid gap-2">
                  {summary.domainChanges.details.map((detail) => (
                    <div
                      key={`${detail.domain}:${detail.title}`}
                      className={`rounded-lg border p-2.5 text-xs leading-5 ${
                        detail.severity === 'warning'
                          ? 'border-amber-300/20 bg-amber-500/10 text-amber-50/85'
                          : 'border-cyan-300/15 bg-cyan-500/10 text-cyan-50/80'
                      }`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{detail.title}</span>
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] opacity-60">
                          {detail.domain}
                        </span>
                      </div>
                      <p className="mt-0.5 opacity-80">{detail.description}</p>
                      <p className="mt-0.5 opacity-65">{detail.recommendation}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={state.status === 'working'}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-gray-500 ${confirmClassName}`}
          >
            {state.status === 'working' ? <Spinner className="h-3 w-3 text-white" /> : null}
            {state.status === 'working' ? 'Working' : actionCopy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

const getLatestShaderArtifactMessage = (chat: AiChatThread | null) => {
  if (!chat) return null;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.artifact?.type === 'shader' && message.artifact.code.trim()) {
      return message;
    }
  }

  return null;
};

const getLatestPromptPreviewMessage = (chat: AiChatThread | null) => {
  if (!chat) return null;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.artifact?.type === 'prompt-preview') {
      return message;
    }
  }

  return null;
};

const getChatNode = (chat: AiChatThread | null, nodes: AnyNode[]) => {
  if (!chat?.nodeId) return null;
  return nodes.find((entry) => entry.id === chat.nodeId) ?? null;
};

const getChatBranchVariants = (chat: AiChatThread, branchPointId?: string) => {
  if (!branchPointId || !chat.branches?.length) {
    return [];
  }

  const groupedVariants = chat.branches.filter((branch) =>
    branch.variantOfBranchPointIds?.includes(branchPointId),
  );
  const variants =
    groupedVariants.length > 0
      ? groupedVariants
      : chat.branches.filter((branch) =>
          branch.messages.some((message) => message.branchPointId === branchPointId),
        );

  return variants.sort((first, second) => first.createdAt - second.createdAt);
};

const getActiveChatBranchVariantId = (
  chat: AiChatThread,
  variants: AiChatBranch[],
  branchPointId?: string,
) => {
  if (!branchPointId || variants.length === 0) {
    return chat.activeBranchId;
  }

  const variantIds = new Set(variants.map((branch) => branch.id));
  let branchCursor = chat.activeBranchId
    ? chat.branches?.find((branch) => branch.id === chat.activeBranchId)
    : undefined;
  const visitedBranchIds = new Set<string>();
  while (branchCursor && !visitedBranchIds.has(branchCursor.id)) {
    if (variantIds.has(branchCursor.id)) {
      return branchCursor.id;
    }

    visitedBranchIds.add(branchCursor.id);
    branchCursor = branchCursor.parentBranchId
      ? chat.branches?.find((branch) => branch.id === branchCursor?.parentBranchId)
      : undefined;
  }

  const activeBranchPointMessage = chat.messages.find(
    (message) => message.branchPointId === branchPointId,
  );
  if (!activeBranchPointMessage) {
    return chat.activeBranchId;
  }

  const activeVariant = variants.find((branch) =>
    branch.messages.some((message) => message.id === activeBranchPointMessage.id),
  );
  return activeVariant?.id ?? chat.activeBranchId;
};

function ChatsTab() {
  const aiChats = useEditorSelector((state) => state.aiChats);
  const aiAgentRuns = useEditorSelector((state) => state.aiAgentRuns);
  const activeAiChatId = useEditorSelector((state) => state.activeAiChatId);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const nodes = useEditorSelector((state) => state.nodes);
  const projectId = useEditorSelector((state) => state.projectId);
  const projectBranches = useEditorSelector((state) => state.projectBranches);
  const selectedNode = useSelectedEditorNode();
  const { aiTaskRoutes, integrationConnections, agentMaxSubagentSpawns, debugMode } =
    usePreferences();
  const { openPreferences } = usePreferencesNavigation();
  const { entries: debugLogEntries } = useDebugLog();

  const latestAiRequestEvents = useMemo(
    () =>
      debugLogEntries
        .filter((e) => e.type === 'ai_request' || e.type === 'ai_response')
        .slice(-4)
        .reverse(),
    [debugLogEntries],
  );

  const {
    applyAiChatGradePreview,
    applyAiChatPromptArtifact,
    applyAiChatShaderArtifact,
    applyProjectBranchNodeChangesToParent,
    applyProjectBranchToParent,
    appendAiChatAssistantArtifactMessage,
    appendAiAgentRunReviewAsset,
    answerAiAgentRunQuestion,
    clearAiChatGradePreview,
    continueAiChatPromptPreview,
    createAiAgentRun,
    createAiChatRegenerationBranch,
    createAiChatUserEditBranch,
    createProjectBranch,
    deleteProjectBranch,
    regenerateAiChatPromptPreview,
    removeAiChat,
    selectNode,
    selectAiChatBranch,
    setActiveAiChat,
    setAiChatPromptArtifactDraft,
    setAiChatNodeContext,
    startAssistantChat,
    startShaderChat,
    stopAiChat,
    switchProjectBranch,
    transferProjectBranchOwnership,
    updateAiAgentRun,
  } = useEditorActions();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [queuedDrafts, setQueuedDrafts] = useState<Record<string, QueuedDraft>>({});
  const [composerAttachments, setComposerAttachments] = useState<
    Record<string, AiChatAttachment[]>
  >({});
  const [isThinkingModeEnabled, setIsThinkingModeEnabled] = useState(true);
  const [isAgentModeEnabled, setIsAgentModeEnabled] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [pendingContextNodeId, setPendingContextNodeId] = useState<string | null | undefined>(
    undefined,
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [agentDiffs, setAgentDiffs] = useState<Record<string, AgentDiffState>>({});
  const [agentBranchInspections, setAgentBranchInspections] = useState<
    Record<string, AgentBranchInspectState>
  >({});
  const [agentReviewDialog, setAgentReviewDialog] = useState<AgentReviewDialogState | null>(null);
  const [capturingPreviewRunId, setCapturingPreviewRunId] = useState<string | null>(null);
  const [selfReviewingRunId, setSelfReviewingRunId] = useState<string | null>(null);
  const [agentSelfReviewPolicy, setAgentSelfReviewPolicy] = useState<AgentSelfReviewPolicy>(
    DEFAULT_AGENT_SELF_REVIEW_POLICY,
  );
  const [chatStatusClock, setChatStatusClock] = useState(() => Date.now());
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingQueuedChatIdsRef = useRef<Set<string>>(new Set());

  const activeChat = useMemo(
    () => aiChats.find((chat) => chat.id === activeAiChatId) ?? null,
    [activeAiChatId, aiChats],
  );
  useEffect(() => {
    if (activeChat?.status !== 'generating') {
      return;
    }
    const interval = window.setInterval(() => setChatStatusClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeChat?.status]);
  const sortedAiChats = useMemo(
    () => [...aiChats].sort((first, second) => second.updatedAt - first.updatedAt),
    [aiChats],
  );
  const activeChatNode = useMemo(() => getChatNode(activeChat, nodes), [activeChat, nodes]);
  const activeAgentRun = useMemo(
    () => getAgentRunForChat(aiAgentRuns, activeChat),
    [activeChat, aiAgentRuns],
  );
  const activeAgentReviewMessage = useMemo(
    () => (activeAgentRun ? getLatestAgentReviewMessage(activeAgentRun, activeChat) : null),
    [activeAgentRun, activeChat],
  );
  const activeAgentBranchRequest = useMemo(
    () => hasOpenAgentBranchRequest(activeChat),
    [activeChat],
  );
  const sortedAgentRuns = useMemo(
    () => [...aiAgentRuns].sort((first, second) => second.updatedAt - first.updatedAt),
    [aiAgentRuns],
  );
  const projectBranchNameById = useMemo(
    () => new Map(projectBranches.map((branch) => [branch.id, branch.name])),
    [projectBranches],
  );
  const projectBranchById = useMemo(
    () => new Map(projectBranches.map((branch) => [branch.id, branch])),
    [projectBranches],
  );
  const agentReviewDialogRun = useMemo(
    () =>
      agentReviewDialog
        ? (aiAgentRuns.find((run) => run.id === agentReviewDialog.runId) ?? null)
        : null,
    [agentReviewDialog, aiAgentRuns],
  );
  const pendingContextNode = useMemo(() => {
    if (activeChat) {
      return null;
    }

    const resolvedNodeId =
      pendingContextNodeId === undefined ? (selectedNode?.id ?? null) : pendingContextNodeId;
    return resolvedNodeId ? (nodes.find((node) => node.id === resolvedNodeId) ?? null) : null;
  }, [activeChat, nodes, pendingContextNodeId, selectedNode]);
  const currentScopeNode = activeChat ? activeChatNode : pendingContextNode;
  const rawMode = getAiChatScopeMode(activeChat?.feature, currentScopeNode);
  const currentMode =
    rawMode === 'action' &&
    currentScopeNode?.type === NodeType.GRADE &&
    aiTaskRoutes.assistantChat.provider !== 'ollama'
      ? 'context'
      : rawMode;
  const latestActiveChatShaderMessage = getLatestShaderArtifactMessage(activeChat);
  const latestActiveChatPromptPreviewMessage = getLatestPromptPreviewMessage(activeChat);
  const activeGradePreview =
    activeChat?.feature === 'assistant' ? (activeChat.toolState?.gradePreview ?? null) : null;
  const activeDraftKey = activeChat?.id ?? `draft:${pendingContextNode?.id ?? 'general'}`;
  const activeDraft = drafts[activeDraftKey] ?? '';
  const activeAttachments = composerAttachments[activeDraftKey] ?? [];
  const activeQueuedDraft = activeChat ? (queuedDrafts[activeChat.id] ?? null) : null;
  const usesShaderRoute = Boolean(
    (activeChat?.feature === 'shader' && isCustomShaderNode(activeChatNode)) ||
    (!activeChat &&
      isCustomShaderNode(pendingContextNode) &&
      isAiActionCapableNode(pendingContextNode)),
  );
  const usesPromptPreviewRoute = Boolean(activeChat && latestActiveChatPromptPreviewMessage);
  const activeRouteTask = usesShaderRoute
    ? 'shaderGeneration'
    : usesPromptPreviewRoute
      ? 'imagePromptTools'
      : 'assistantChat';
  const isAgentModeEffective = isAgentModeEnabled && activeRouteTask === 'assistantChat';
  const activeRouteError = getAiTaskRouteError(activeRouteTask, {
    aiTaskRoutes,
    integrationConnections,
  });
  const activeRoute = activeRouteError
    ? null
    : resolveAiTaskRoute(activeRouteTask, {
        aiTaskRoutes,
        integrationConnections,
      });
  const canToggleThinkingMode = activeRoute?.provider === 'ollama';
  const canCreateNodeFromActiveChat = Boolean(
    activeChat?.feature === 'shader' &&
    activeChat &&
    !activeChatNode &&
    latestActiveChatShaderMessage,
  );
  const canClearContext = activeChat
    ? activeChat.feature === 'assistant' && Boolean(activeChat.nodeId)
    : Boolean(pendingContextNode);
  const canUseSelectedNodeAsContext = Boolean(
    selectedNode &&
    (activeChat?.feature === 'assistant'
      ? !isCustomShaderNode(selectedNode) && selectedNode.id !== activeChat.nodeId
      : !activeChat && selectedNode.id !== pendingContextNode?.id),
  );
  const activeChatScrollKey = activeChat
    ? `${activeChat.updatedAt}:${activeChat.messages.length}:${
        activeChat.messages[activeChat.messages.length - 1]?.status ?? ''
      }`
    : null;

  const submitPrompt = useCallback(
    async (
      prompt: string,
      chatForPrompt: AiChatThread | null = activeChat,
      attachments: AiChatAttachment[] = [],
      branchPoints?: ChatPromptBranchPoints,
      options: SubmitPromptOptions = {},
    ) => {
      const nextPrompt = prompt.trim();
      if (!nextPrompt && attachments.length === 0) return;

      setComposerError(null);
      let agentRunId: string | null = null;
      let agentRunBranchId: string | null = null;
      let agentBranchNotice: string | null = null;

      try {
        const chatNode = getChatNode(chatForPrompt, nodes);
        if (
          (chatForPrompt?.feature === 'shader' && isCustomShaderNode(chatNode)) ||
          (!chatForPrompt &&
            isCustomShaderNode(pendingContextNode) &&
            isAiActionCapableNode(pendingContextNode))
        ) {
          const targetNode = isCustomShaderNode(chatNode)
            ? chatNode
            : isCustomShaderNode(pendingContextNode)
              ? pendingContextNode
              : null;

          if (!targetNode) {
            throw new Error('Action mode requires a linked Shader node.');
          }

          const route = resolveAiTaskRoute('shaderGeneration', {
            aiTaskRoutes,
            integrationConnections,
          });
          await startShaderChat(
            targetNode.id,
            nextPrompt,
            {
              provider: route.provider,
              openAiApiKey: route.openAiApiKey,
              openAiBaseUrl: route.openAiBaseUrl,
              openAiModel: route.openAiModel,
              ollamaEndpoint: route.ollamaEndpoint,
              ollamaModel: route.ollamaModel,
              attachments,
              enableThinking: canToggleThinkingMode ? isThinkingModeEnabled : false,
            },
            branchPoints,
          );
          return;
        }

        const latestPromptPreviewMessage = getLatestPromptPreviewMessage(chatForPrompt);
        if (chatForPrompt && latestPromptPreviewMessage && attachments.length === 0) {
          const route = resolveAiTaskRoute('imagePromptTools', {
            aiTaskRoutes,
            integrationConnections,
          });

          await continueAiChatPromptPreview(chatForPrompt.id, nextPrompt, {
            provider: route.provider,
            openAiApiKey: route.openAiApiKey,
            openAiBaseUrl: route.openAiBaseUrl,
            openAiModel: route.openAiModel,
            ollamaEndpoint: route.ollamaEndpoint,
            ollamaModel: route.ollamaModel,
          });
          return;
        }

        const route = resolveAiTaskRoute('assistantChat', {
          aiTaskRoutes,
          integrationConnections,
        });
        const agentSettings =
          isAgentModeEnabled || options.forceAgentMode
            ? {
                ...DEFAULT_AGENT_MODE_SETTINGS,
                maxSubagentSpawns: agentMaxSubagentSpawns,
              }
            : false;

        if (agentSettings) {
          const relatedRun = getRelatedAgentRun({
            runs: aiAgentRuns,
            chat: chatForPrompt,
            activeProjectBranchId,
          });
          const reusableRun = getReusableAgentRun({
            runs: aiAgentRuns,
            chat: chatForPrompt,
            branchesById: projectBranchById,
            activeProjectBranchId,
          });

          agentRunId =
            relatedRun?.id ??
            createAiAgentRun({
              prompt: nextPrompt,
              sourceChatId: chatForPrompt?.id ?? null,
              settings: agentSettings,
            });

          let branchId = reusableRun?.branchId ?? null;
          const hasBranchStartSignal =
            hasOpenAgentBranchRequest(chatForPrompt) ||
            (relatedRun?.status === 'waiting-for-user' && !relatedRun.branchId);
          if (
            !branchId &&
            relatedRun &&
            hasBranchStartSignal &&
            shouldStartAgentBranchForPrompt(nextPrompt)
          ) {
            const branchName = getAgentBranchName(relatedRun.prompt || nextPrompt);
            branchId = await createProjectBranch(branchName, {
              kind: 'agent',
              agentRunId,
            });
            if (branchId) {
              agentBranchNotice = `Created agent branch \`${branchName}\` for this task and switched to it. I will keep changes isolated there until you apply or discard them.`;
            }
          }

          if (branchId && branchId !== activeProjectBranchId) {
            await switchProjectBranch(branchId);
          }
          agentRunBranchId = branchId;

          updateAiAgentRun(agentRunId, {
            ...(branchId ? { branchId } : {}),
            status: branchId ? 'running' : 'planning',
          });
        }

        const assistantChatResult = await startAssistantChat(
          nextPrompt,
          {
            provider: route.provider,
            openAiApiKey: route.openAiApiKey,
            openAiBaseUrl: route.openAiBaseUrl,
            openAiModel: route.openAiModel,
            ollamaEndpoint: route.ollamaEndpoint,
            ollamaModel: route.ollamaModel,
            attachments,
            enableThinking: canToggleThinkingMode ? isThinkingModeEnabled : false,
            agentMode: agentSettings,
            maxAgentSubagentSpawns: agentMaxSubagentSpawns,
          },
          chatForPrompt?.feature === 'assistant' ? chatForPrompt.id : null,
          chatForPrompt ? null : (pendingContextNode?.id ?? null),
          branchPoints,
          agentBranchNotice,
        );
        const resolvedChatId = assistantChatResult?.chatId;
        if (agentRunId) {
          updateAiAgentRun(agentRunId, {
            sourceChatId: resolvedChatId,
            status: agentRunBranchId ? 'ready' : 'waiting-for-user',
          });
        }
      } catch (error) {
        if (agentRunId) {
          updateAiAgentRun(agentRunId, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Chat failed unexpectedly.',
          });
        }
        setComposerError(error instanceof Error ? error.message : 'Chat failed unexpectedly.');
      }
    },
    [
      activeChat,
      activeProjectBranchId,
      aiAgentRuns,
      aiTaskRoutes,
      integrationConnections,
      agentMaxSubagentSpawns,
      nodes,
      pendingContextNode,
      canToggleThinkingMode,
      isThinkingModeEnabled,
      isAgentModeEnabled,
      continueAiChatPromptPreview,
      createAiAgentRun,
      createProjectBranch,
      projectBranchById,
      startAssistantChat,
      startShaderChat,
      switchProjectBranch,
      updateAiAgentRun,
    ],
  );

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [activeChat?.id, activeChatScrollKey]);

  const handleConfirmAgentBranch = (run: AiAgentRun) => {
    if (!activeChat || activeChat.status === 'generating' || run.branchId) {
      return;
    }

    setIsAgentModeEnabled(true);
    void submitPrompt(
      'Proceed with creating the branch and start the task.',
      activeChat,
      [],
      undefined,
      { forceAgentMode: true },
    );
  };

  const handleAnswerAgentQuestion = (
    run: AiAgentRun,
    question: AiAgentQuestion,
    answer: { choiceId?: string; text: string },
  ) => {
    const chat = activeChat?.id === run.sourceChatId ? activeChat : null;
    if (!chat || chat.status === 'generating') {
      return;
    }

    answerAiAgentRunQuestion(run.id, question.id, answer);
    void submitPrompt(`Answer to "${question.prompt}": ${answer.text}`, chat, [], undefined, {
      forceAgentMode: true,
    });
  };

  useEffect(() => {
    if (!activeAiChatId) {
      return;
    }

    setPendingContextNodeId(undefined);
    setEditingMessageId(null);
    setEditingDraft('');
  }, [activeAiChatId]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!activeChat || activeChat.status === 'generating') {
      return;
    }

    if (!activeQueuedDraft || processingQueuedChatIdsRef.current.has(activeChat.id)) {
      return;
    }

    const queuedPrompt = activeQueuedDraft.prompt.trim();
    const queuedAttachments = activeQueuedDraft.attachments;
    if (!queuedPrompt && queuedAttachments.length === 0) {
      return;
    }

    processingQueuedChatIdsRef.current.add(activeChat.id);
    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[activeChat.id];
      return next;
    });

    void submitPrompt(queuedPrompt, activeChat, queuedAttachments).finally(() => {
      processingQueuedChatIdsRef.current.delete(activeChat.id);
    });
  }, [activeChat, activeQueuedDraft, submitPrompt]);

  useEffect(() => {
    if (!projectId || !activeAgentRun?.branchId || activeAgentRun.status === 'discarded') {
      return;
    }

    const branch = projectBranchById.get(activeAgentRun.branchId);
    if (!branch) {
      return;
    }

    const parentBranchId =
      branch.parentBranchId && projectBranchById.has(branch.parentBranchId)
        ? branch.parentBranchId
        : 'main';
    let isCancelled = false;

    setAgentDiffs((current) => ({
      ...current,
      [activeAgentRun.id]: { status: 'loading' },
    }));

    Promise.all([
      loadProjectState(getProjectBranchStorageId(projectId, parentBranchId)),
      loadProjectState(getProjectBranchStorageId(projectId, activeAgentRun.branchId)),
    ])
      .then(([parentState, branchState]) => {
        if (isCancelled) return;
        setAgentDiffs((current) => ({
          ...current,
          [activeAgentRun.id]: {
            status: 'ready',
            summary: summarizeAgentBranchDiff(parentState, branchState),
          },
        }));
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error('Could not compare agent branch snapshots:', error);
        setAgentDiffs((current) => ({
          ...current,
          [activeAgentRun.id]: {
            status: 'error',
            message: 'Could not load saved branch diff.',
          },
        }));
      });

    return () => {
      isCancelled = true;
    };
  }, [
    activeAgentRun?.branchId,
    activeAgentRun?.id,
    activeAgentRun?.status,
    projectBranchById,
    projectId,
  ]);

  const handleSelectChat = (chat: AiChatThread) => {
    const linkedNode = getChatNode(chat, nodes);

    setComposerError(null);
    if (linkedNode) {
      selectNode(linkedNode.id);
    }
    setActiveAiChat(chat.id);
  };

  const handleNewChat = () => {
    setComposerError(null);
    setPendingContextNodeId(undefined);
    setActiveAiChat(null);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
  };

  const handleBackToChats = () => {
    setComposerError(null);
    setActiveAiChat(null);
  };

  const handleRemoveChat = (chat: AiChatThread) => {
    const shouldRemove = window.confirm(`Remove "${chat.title}" from Chats?`);
    if (!shouldRemove) {
      return;
    }

    setComposerError(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    setComposerAttachments((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    processingQueuedChatIdsRef.current.delete(chat.id);
    removeAiChat(chat.id);
  };

  const handleOpenAgentRunBranch = (run: AiAgentRun) => {
    if (!run.branchId || run.branchId === activeProjectBranchId) {
      return;
    }

    void switchProjectBranch(run.branchId).catch((error) => {
      console.error('Could not open agent branch:', error);
      setComposerError('Could not open agent branch.');
    });
  };

  const handleTakeOverAgentRunBranch = (run: AiAgentRun) => {
    if (!run.branchId) {
      return;
    }

    void (async () => {
      const transferred = await transferProjectBranchOwnership(run.branchId, {
        workingOwnerType: 'user',
        defaultUserAccess: 'editor',
      });
      if (!transferred) {
        throw new Error('Could not transfer branch ownership.');
      }
      updateAiAgentRun(run.id, {
        workingOwnerType: 'user',
        userAccess: 'editor',
        recommendedNextAction: 'continue',
      });
      if (run.branchId !== activeProjectBranchId) {
        await switchProjectBranch(run.branchId);
      }
    })().catch((error) => {
      console.error('Could not take over agent branch:', error);
      setComposerError('Could not take over agent branch.');
    });
  };

  const loadAgentRunDiffSummary = async (run: AiAgentRun): Promise<AgentBranchDiffSummary> => {
    if (!projectId || !run.branchId) {
      throw new Error('Agent run is missing a saved branch.');
    }

    const agentBranch = projectBranchById.get(run.branchId);
    const parentBranchId =
      agentBranch?.parentBranchId && projectBranchById.has(agentBranch.parentBranchId)
        ? agentBranch.parentBranchId
        : MAIN_PROJECT_BRANCH_ID;
    const [parentState, branchState] = await Promise.all([
      loadProjectState(getProjectBranchStorageId(projectId, parentBranchId)),
      loadProjectState(getProjectBranchStorageId(projectId, run.branchId)),
    ]);
    return summarizeAgentBranchDiff(parentState, branchState);
  };

  const openAgentReviewDialog = (run: AiAgentRun, action: AgentReviewDialogAction) => {
    setComposerError(null);

    const existingDiff = agentDiffs[run.id];
    const existingSummary = existingDiff?.status === 'ready' ? existingDiff.summary : undefined;
    if (action === 'discard' || existingSummary) {
      setAgentReviewDialog({
        action,
        runId: run.id,
        status: 'ready',
        summary: existingSummary,
      });
      return;
    }

    setAgentReviewDialog({ action, runId: run.id, status: 'loading' });
    void loadAgentRunDiffSummary(run)
      .then((summary) => {
        setAgentDiffs((current) => ({
          ...current,
          [run.id]: { status: 'ready', summary },
        }));
        setAgentReviewDialog({ action, runId: run.id, status: 'ready', summary });
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Could not load saved branch review.';
        console.error('Could not load agent branch review:', error);
        setAgentReviewDialog({
          action,
          runId: run.id,
          status: 'error',
          message,
        });
      });
  };

  const handleInspectAgentRunBranch = (run: AiAgentRun) => {
    if (!projectId || !run.branchId) {
      return;
    }

    const agentBranch = projectBranchById.get(run.branchId);
    const parentBranchId =
      agentBranch?.parentBranchId && projectBranchById.has(agentBranch.parentBranchId)
        ? agentBranch.parentBranchId
        : MAIN_PROJECT_BRANCH_ID;

    setComposerError(null);
    setAgentBranchInspections((current) => ({
      ...current,
      [run.id]: { status: 'loading' },
    }));

    Promise.all([
      loadProjectState(getProjectBranchStorageId(projectId, parentBranchId)),
      loadProjectState(getProjectBranchStorageId(projectId, run.branchId)),
    ])
      .then(([parentState, branchState]) => {
        if (!branchState) {
          throw new Error('Could not load the saved agent branch snapshot.');
        }

        setAgentBranchInspections((current) => ({
          ...current,
          [run.id]: buildAgentBranchInspectState({
            parentBranchId,
            branchId: run.branchId!,
            parentState,
            branchState,
          }),
        }));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Could not inspect agent branch.';
        console.error('Could not inspect agent branch:', error);
        setComposerError(message);
        setAgentBranchInspections((current) => ({
          ...current,
          [run.id]: {
            status: 'error',
            message,
          },
        }));
      });
  };

  const captureAgentPreviewForRun = async (
    run: AiAgentRun,
  ): Promise<{ artifact: AiChatRenderComparisonArtifact; messageId: string | null }> => {
    if (!projectId || !run.branchId || !run.sourceChatId) {
      throw new Error('Agent run is missing a project branch or source chat.');
    }
    const agentBranch = projectBranchById.get(run.branchId);
    const parentBranchId =
      agentBranch?.parentBranchId && projectBranchById.has(agentBranch.parentBranchId)
        ? agentBranch.parentBranchId
        : MAIN_PROJECT_BRANCH_ID;

    const [parentState, branchState] = await Promise.all([
      loadProjectState(getProjectBranchStorageId(projectId, parentBranchId)),
      loadProjectState(getProjectBranchStorageId(projectId, run.branchId)),
    ]);

    if (!parentState || !branchState) {
      throw new Error('Could not load the agent branch snapshot.');
    }

    const result = await captureAgentRenderPreviewComparison(parentState, branchState, {
      beforeBranchId: parentBranchId,
      afterBranchId: run.branchId,
    });

    const artifact = result.artifact;
    if (!artifact) {
      throw new Error(result.content || 'Could not capture render comparison.');
    }

    const messageId = appendAiChatAssistantArtifactMessage(run.sourceChatId, {
      content: result.content,
      artifact,
    });
    if (messageId) {
      appendAiAgentRunReviewAsset(run.id, messageId);
    }

    return { artifact, messageId };
  };

  const handleCaptureAgentPreview = (run: AiAgentRun) => {
    if (!projectId || !run.branchId || !run.sourceChatId || capturingPreviewRunId) {
      return;
    }

    setComposerError(null);
    setCapturingPreviewRunId(run.id);
    updateAiAgentRun(run.id, { status: 'reviewing' });

    captureAgentPreviewForRun(run)
      .then(() => {
        updateAiAgentRun(run.id, { status: 'ready' });
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Could not capture render preview.';
        console.error('Could not capture agent render preview:', error);
        setComposerError(message);
        updateAiAgentRun(run.id, { status: 'ready', error: message });
      })
      .finally(() => {
        setCapturingPreviewRunId(null);
      });
  };

  const handleSelfReviewAgentPreview = (run: AiAgentRun, reviewMessage: AiChatMessage | null) => {
    if (!run.sourceChatId || selfReviewingRunId) {
      return;
    }

    if (reviewMessage?.artifact?.type !== 'render-comparison') {
      setComposerError('Capture a before/after render comparison before running self-review.');
      return;
    }
    const initialReviewArtifact = reviewMessage.artifact;

    const routeError = getAiTaskRouteError('assistantChat', {
      aiTaskRoutes,
      integrationConnections,
    });
    if (routeError) {
      setComposerError(routeError);
      return;
    }

    const route = resolveAiTaskRoute('assistantChat', {
      aiTaskRoutes,
      integrationConnections,
    });
    const canRunSelfFix = route.provider === 'ollama' && Boolean(run.branchId);
    const reviewPolicy = agentSelfReviewPolicy;
    const maxReviewPasses = canRunSelfFix ? reviewPolicy.maxPasses : 1;
    const buildSelfReviewPrompt = (passIndex: number) =>
      [
        `Self-review the before/after render comparison for agent task "${run.title}".`,
        `Review pass ${passIndex + 1} of ${maxReviewPasses}.`,
        'The first attached image is the parent branch before state. The second attached image is the agent branch after state.',
        'Critique whether the after image appears to satisfy the task. Call out visible regressions, missing changes, or timing/composition concerns.',
        buildAgentSelfReviewMarkerInstruction(reviewPolicy),
        canRunSelfFix
          ? 'If it passes, say it is ready for user review and do not call tools. If it fails and a safe available tool can make one bounded correction on the active agent branch, use the tool once and summarize the correction. Stop after that one correction. Do not merge or apply.'
          : 'If it passes, say it is ready for user review. If it fails, recommend the smallest next correction. Do not claim you changed anything.',
      ].join('\n');

    setComposerError(null);
    setSelfReviewingRunId(run.id);
    updateAiAgentRun(run.id, { status: 'reviewing' });

    Promise.resolve()
      .then(async () => {
        if (canRunSelfFix && run.branchId && activeProjectBranchId !== run.branchId) {
          await switchProjectBranch(run.branchId);
        }
      })
      .then(async () => {
        let currentArtifact: AiChatRenderComparisonArtifact = initialReviewArtifact;

        for (let passIndex = 0; passIndex < maxReviewPasses; passIndex += 1) {
          const reviewResult = await startAssistantChat(
            buildSelfReviewPrompt(passIndex),
            {
              provider: route.provider,
              openAiApiKey: route.openAiApiKey,
              openAiBaseUrl: route.openAiBaseUrl,
              openAiModel: route.openAiModel,
              ollamaEndpoint: route.ollamaEndpoint,
              ollamaModel: route.ollamaModel,
              attachments: createRenderComparisonAttachments(currentArtifact),
              enableThinking: canToggleThinkingMode ? isThinkingModeEnabled : false,
              agentMode: canRunSelfFix ? DEFAULT_AGENT_MODE_SETTINGS : false,
              maxAgentToolSteps: canRunSelfFix ? reviewPolicy.maxToolStepsPerPass : undefined,
            },
            run.sourceChatId,
          );
          const reviewOutcome = assessAgentSelfReviewContent(
            reviewResult?.assistantContent,
            reviewPolicy,
          );

          if (!canRunSelfFix || reviewOutcome === 'pass') {
            break;
          }

          const nextPreview = await captureAgentPreviewForRun(run);
          currentArtifact = nextPreview.artifact;
        }

        updateAiAgentRun(run.id, { status: 'ready' });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Self-review failed unexpectedly.';
        console.error('Could not run agent render self-review:', error);
        setComposerError(message);
        updateAiAgentRun(run.id, { status: 'ready', error: message });
      })
      .finally(() => {
        setSelfReviewingRunId(null);
      });
  };

  const applyAgentRunBranch = async (run: AiAgentRun) => {
    if (!run.branchId) {
      return;
    }

    setComposerError(null);
    await applyProjectBranchToParent(run.branchId);
    updateAiAgentRun(run.id, { status: 'applied' });
  };

  const pickAgentRunNodeChanges = async (run: AiAgentRun) => {
    if (!run.branchId) {
      return;
    }

    setComposerError(null);
    await applyProjectBranchNodeChangesToParent(run.branchId);
    updateAiAgentRun(run.id, { status: 'ready' });
  };

  const discardAgentRunBranch = async (run: AiAgentRun) => {
    if (!run.branchId) {
      return;
    }

    setComposerError(null);
    await deleteProjectBranch(run.branchId);
    updateAiAgentRun(run.id, { status: 'discarded' });
  };

  const handleConfirmAgentReviewDialog = () => {
    if (!agentReviewDialog || !agentReviewDialogRun) {
      return;
    }

    const { action } = agentReviewDialog;
    const summary = agentReviewDialog.status !== 'loading' ? agentReviewDialog.summary : undefined;
    const run = agentReviewDialogRun;
    setAgentReviewDialog({ action, runId: run.id, status: 'working', summary });

    const work =
      action === 'apply'
        ? applyAgentRunBranch(run)
        : action === 'pick'
          ? pickAgentRunNodeChanges(run)
          : discardAgentRunBranch(run);

    void work
      .then(() => {
        setAgentReviewDialog(null);
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : action === 'apply'
              ? 'Could not apply agent branch.'
              : action === 'pick'
                ? 'Could not pick agent node changes.'
                : 'Could not discard agent branch.';
        console.error('Could not complete agent review action:', error);
        setComposerError(message);
        setAgentReviewDialog({
          action,
          runId: run.id,
          status: 'error',
          message,
          summary,
        });
      });
  };

  const handleClearContext = () => {
    setComposerError(null);

    if (activeChat?.feature === 'assistant') {
      setAiChatNodeContext(activeChat.id, null);
      return;
    }

    setPendingContextNodeId(null);
  };

  const handleCopyMessage = async (message: AiChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const handleUseSelectedNodeAsContext = () => {
    if (!selectedNode) {
      return;
    }

    setComposerError(null);

    if (activeChat?.feature === 'assistant') {
      setAiChatNodeContext(activeChat.id, selectedNode.id);
      return;
    }

    setPendingContextNodeId(selectedNode.id);
  };

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    const existingAttachments = composerAttachments[activeDraftKey] ?? [];
    const remainingSlots = ChatAttachmentLimits.MAX_ATTACHMENTS - existingAttachments.length;
    if (remainingSlots <= 0) {
      setComposerError(`Attach up to ${ChatAttachmentLimits.MAX_ATTACHMENTS} files per message.`);
      return;
    }

    const selectedFiles = files.slice(0, remainingSlots);
    const errors: string[] = [];
    if (files.length > remainingSlots) {
      errors.push(
        `Only ${remainingSlots} more file${remainingSlots === 1 ? '' : 's'} can be attached.`,
      );
    }

    const nextAttachments: AiChatAttachment[] = [];
    for (const file of selectedFiles) {
      const kind = getAttachmentKind(file);

      if (kind === 'image' && file.size > ChatAttachmentLimits.MAX_IMAGE_BYTES) {
        errors.push(
          `${file.name} is larger than ${formatAttachmentSize(ChatAttachmentLimits.MAX_IMAGE_BYTES)}.`,
        );
        continue;
      }

      if (kind === 'text' && file.size > ChatAttachmentLimits.MAX_TEXT_BYTES) {
        errors.push(
          `${file.name} is larger than ${formatAttachmentSize(ChatAttachmentLimits.MAX_TEXT_BYTES)} for text preview.`,
        );
        continue;
      }

      try {
        const baseAttachment = {
          id: createAttachmentId(),
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          kind,
        } satisfies AiChatAttachment;

        if (kind === 'image') {
          nextAttachments.push({
            ...baseAttachment,
            dataUrl: await readFileAsDataUrl(file),
          });
        } else if (kind === 'text') {
          nextAttachments.push({
            ...baseAttachment,
            text: await readFileAsText(file),
          });
        } else {
          nextAttachments.push(baseAttachment);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Failed to attach ${file.name}.`);
      }
    }

    if (nextAttachments.length > 0) {
      setComposerAttachments((current) => ({
        ...current,
        [activeDraftKey]: [...(current[activeDraftKey] ?? []), ...nextAttachments],
      }));
    }

    setComposerError(errors.length > 0 ? errors.join(' ') : null);
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setComposerAttachments((current) => ({
      ...current,
      [activeDraftKey]: (current[activeDraftKey] ?? []).filter(
        (attachment) => attachment.id !== attachmentId,
      ),
    }));
  };

  const clearActiveComposer = () => {
    setDrafts((current) => ({ ...current, [activeDraftKey]: '' }));
    setComposerAttachments((current) => {
      const next = { ...current };
      delete next[activeDraftKey];
      return next;
    });
  };

  const handleSend = async () => {
    const nextPrompt = activeDraft.trim();
    if (!nextPrompt && activeAttachments.length === 0) return;

    setComposerError(null);
    clearActiveComposer();

    if (activeChat?.status === 'generating') {
      setQueuedDrafts((current) => ({
        ...current,
        [activeChat.id]: {
          prompt: nextPrompt,
          attachments: activeAttachments,
        },
      }));
      return;
    }

    await submitPrompt(nextPrompt, activeChat, activeAttachments);
  };

  const handleStopActiveChat = () => {
    if (!activeChat) return;
    setComposerError(null);
    stopAiChat(activeChat.id);
  };

  const handleSendQueuedNow = () => {
    if (!activeChat || !activeQueuedDraft) return;

    const queuedPrompt = activeQueuedDraft.prompt.trim();
    const queuedAttachments = activeQueuedDraft.attachments;
    if (!queuedPrompt && queuedAttachments.length === 0) return;

    setComposerError(null);
    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[activeChat.id];
      return next;
    });
    stopAiChat(activeChat.id);
    void submitPrompt(queuedPrompt, activeChat, queuedAttachments);
  };

  const handleDiscardQueuedDraft = () => {
    if (!activeChat) return;

    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[activeChat.id];
      return next;
    });
  };

  const handleCreateNodeFromActiveChat = () => {
    if (!activeChat || !latestActiveChatShaderMessage) return;
    setComposerError(null);
    applyAiChatShaderArtifact(activeChat.id, latestActiveChatShaderMessage.id);
  };

  const handleStartEditingMessage = (message: AiChatMessage) => {
    setComposerError(null);
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  };

  const handleCancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingDraft('');
  };

  const handleSaveEditedMessage = async (chat: AiChatThread, message: AiChatMessage) => {
    const nextPrompt = editingDraft.trim();
    if (!nextPrompt || chat.status === 'generating' || activeRouteError) {
      return;
    }

    const branchPointId = createAiChatUserEditBranch(chat.id, message.id) as string | null;
    if (!branchPointId) {
      return;
    }

    setEditingMessageId(null);
    setEditingDraft('');
    await submitPrompt(nextPrompt, chat, message.attachments ?? [], {
      userBranchPointId: branchPointId,
    });
  };

  const handleRegenerateMessage = async (chat: AiChatThread, message: AiChatMessage) => {
    if (chat.status === 'generating') {
      return;
    }

    if (message.artifact?.type === 'prompt-preview') {
      const promptRouteError = getAiTaskRouteError('imagePromptTools', {
        aiTaskRoutes,
        integrationConnections,
      });
      if (promptRouteError) {
        setComposerError(promptRouteError);
        return;
      }

      const route = resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        integrationConnections,
      });

      setComposerError(null);
      await regenerateAiChatPromptPreview(chat.id, message.id, {
        provider: route.provider,
        openAiApiKey: route.openAiApiKey,
        openAiBaseUrl: route.openAiBaseUrl,
        openAiModel: route.openAiModel,
        ollamaEndpoint: route.ollamaEndpoint,
        ollamaModel: route.ollamaModel,
      });
      return;
    }

    if (activeRouteError) {
      return;
    }

    const prepared = createAiChatRegenerationBranch(
      chat.id,
      message.id,
    ) as PreparedChatBranchPrompt | null;
    if (!prepared) {
      return;
    }

    setComposerError(null);
    await submitPrompt(prepared.prompt, chat, prepared.attachments ?? [], prepared.branchPoints);
  };

  const handleSelectBranchVariant = (
    chat: AiChatThread,
    branchId: string,
    branchPointId?: string,
  ) => {
    if (chat.status === 'generating' || !branchPointId) {
      return;
    }

    setComposerError(null);
    setEditingMessageId(null);
    setEditingDraft('');
    selectAiChatBranch(chat.id, branchId, branchPointId);
  };

  const renderMessage = (chat: AiChatThread, message: AiChatMessage) => {
    const isAssistant = message.role === 'assistant';
    const isEditingMessage = editingMessageId === message.id;
    const artifact = message.artifact?.type === 'shader' ? message.artifact : null;
    const gradePreviewArtifact =
      message.artifact?.type === 'grade-preview' ? message.artifact : null;
    const promptPreviewArtifact =
      message.artifact?.type === 'prompt-preview' ? message.artifact : null;
    const renderPreviewArtifact =
      message.artifact?.type === 'render-preview' ? message.artifact : null;
    const renderComparisonArtifact =
      message.artifact?.type === 'render-comparison' ? message.artifact : null;
    const thinking = message.thinking?.trim() ?? '';
    const hasThinking = Boolean(thinking);
    const linkedShaderNode = isCustomShaderNode(activeChatNode)
      ? activeChatNode
      : isCustomShaderNode(getChatNode(chat, nodes))
        ? (getChatNode(chat, nodes) as CustomShaderNode)
        : null;
    const canApplyArtifact = Boolean(artifact?.code.trim()) && message.status !== 'pending';
    const shaderSuggestions = message.status === 'complete' ? (artifact?.suggestions ?? []) : [];
    const promptPreviewSuggestions =
      message.status === 'complete' ? (promptPreviewArtifact?.suggestions ?? []) : [];
    const chatSuggestions =
      shaderSuggestions.length > 0 ? shaderSuggestions : promptPreviewSuggestions;
    const canApplyPromptArtifact =
      Boolean(promptPreviewArtifact?.draft.trim()) && message.status !== 'pending';
    const hasVisibleContent = Boolean(message.content.trim());
    const displayContent = stripAgentBranchRequestMarker(message.content);
    const messageAttachments = message.attachments ?? [];
    const shouldRenderStandaloneContent =
      !isEditingMessage &&
      hasVisibleContent &&
      !gradePreviewArtifact &&
      !promptPreviewArtifact &&
      !renderPreviewArtifact &&
      !renderComparisonArtifact;
    const shouldShowSkeleton =
      !isEditingMessage && isAssistant && message.status === 'pending' && !hasVisibleContent;
    const messageProvider =
      message.provider ??
      artifact?.provider ??
      gradePreviewArtifact?.provider ??
      (isAssistant ? aiTaskRoutes.assistantChat.provider : aiTaskRoutes.shaderGeneration.provider);
    const providerLabel = isAssistant ? getAiProviderLabel(messageProvider) : null;
    const modelLabel = isAssistant
      ? (message.model ??
        artifact?.model ??
        gradePreviewArtifact?.model ??
        (isAssistant ? aiTaskRoutes.assistantChat.model : aiTaskRoutes.shaderGeneration.model))
      : null;
    const pendingPhaseLabel =
      message.status === 'pending' ? getPendingMessagePhaseLabel(message, chatStatusClock) : null;
    const messageIndex = chat.messages.findIndex((entry) => entry.id === message.id);
    const hasPreviousUserMessage =
      messageIndex > 0 &&
      chat.messages.slice(0, messageIndex).some((entry) => entry.role === 'user');
    const canEditMessage =
      !isAssistant &&
      message.status !== 'pending' &&
      chat.status !== 'generating' &&
      !activeRouteError;
    const messageRegenerateRouteError =
      message.artifact?.type === 'prompt-preview'
        ? getAiTaskRouteError('imagePromptTools', {
            aiTaskRoutes,
            integrationConnections,
          })
        : activeRouteError;
    const canRegenerateMessage =
      isAssistant &&
      message.status !== 'pending' &&
      chat.status !== 'generating' &&
      !messageRegenerateRouteError &&
      hasPreviousUserMessage;
    const branchVariants = getChatBranchVariants(chat, message.branchPointId);
    const activeBranchVariantId = getActiveChatBranchVariantId(
      chat,
      branchVariants,
      message.branchPointId,
    );
    const hasMessageActions =
      !isEditingMessage && (canEditMessage || canRegenerateMessage || branchVariants.length > 1);
    const messageActionControls = hasMessageActions ? (
      <div className="mt-2 flex items-center justify-end gap-1.5 opacity-50 transition-opacity group-hover/message:opacity-100">
        <BranchVariantControls
          variants={branchVariants}
          activeBranchId={activeBranchVariantId}
          disabled={chat.status === 'generating'}
          onSelect={(branchId) => handleSelectBranchVariant(chat, branchId, message.branchPointId)}
        />
        {canEditMessage ? (
          <BubbleActionButton
            label="Edit prompt"
            onClick={() => handleStartEditingMessage(message)}
            icon={<Icons.Pencil className="h-3.5 w-3.5" />}
          />
        ) : null}
        {canRegenerateMessage ? (
          <BubbleActionButton
            label="Regenerate response"
            onClick={() => {
              void handleRegenerateMessage(chat, message);
            }}
            icon={<Icons.RotateLoop className="h-3.5 w-3.5" />}
          />
        ) : null}
      </div>
    ) : null;

    return (
      <div
        key={message.id}
        className={`group/message overflow-hidden rounded-lg border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-colors ${
          isAssistant
            ? 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.035]'
            : 'border-primary-300/20 bg-primary-400/[0.08] hover:bg-primary-400/[0.1]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${isAssistant ? 'bg-primary-500/15 text-primary-300' : 'bg-white/10 text-gray-300'}`}
          >
            {isAssistant ? (
              <Icons.Sparkles className="h-3 w-3" />
            ) : (
              <Icons.UserCircle className="h-3 w-3" />
            )}
          </div>
          <span className="shrink-0">{isAssistant ? 'Assistant' : 'You'}</span>
          {providerLabel ? <MessageMetaChip>{providerLabel}</MessageMetaChip> : null}
          {modelLabel ? (
            <span className="min-w-0 flex-1">
              <MessageMetaChip mono>{modelLabel}</MessageMetaChip>
            </span>
          ) : null}
          {pendingPhaseLabel ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-gray-500">
              <Spinner className="h-3 w-3 shrink-0 text-white" />
              <span>{pendingPhaseLabel}</span>
            </span>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover/message:opacity-100">
            <button
              type="button"
              onClick={() => handleCopyMessage(message)}
              aria-label="Copy message"
              title="Copy message"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.07] hover:text-gray-200"
            >
              {copiedMessageId === message.id ? (
                <Icons.Check className="h-3 w-3 text-green-400" />
              ) : (
                <Icons.Copy className="h-3 w-3" />
              )}
            </button>
            <span className="text-gray-600">{formatChatTime(message.createdAt)}</span>
          </div>
        </div>

        {hasThinking ? (
          <CompactDisclosure
            title={message.isThinking ? 'Thinking' : 'Thought'}
            preview={thinking}
            className="mt-2"
            contentClassName="ml-[11px] mt-1 pl-4"
            indicator={
              message.isThinking ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary-300/80 shadow-[0_0_8px_rgba(var(--color-primary-300),0.45)] animate-pulse" />
              ) : null
            }
          >
            <ScrollArea axis="y" viewportClassName="max-h-40">
              <ChatMarkdown content={thinking} className="text-gray-400" />
            </ScrollArea>
          </CompactDisclosure>
        ) : null}

        {debugMode && isAssistant ? (
          <CompactDisclosure
            title="Debug"
            preview={`${messageProvider ?? '?'} · ${message.streamStage ?? 'idle'} · ${typeof message.model === 'string' ? message.model : 'no model'}`}
            className="mt-2"
            contentClassName="ml-[11px] mt-1 pl-4"
            tone="cyan"
          >
            <div className="space-y-1 font-mono text-[10px] leading-5">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-gray-500">Provider:</span>
                <span className="text-cyan-100">{messageProvider ?? 'none'}</span>
                <span className="text-gray-500">Model:</span>
                <span className="text-cyan-100">{message.model ?? 'default'}</span>
                <span className="text-gray-500">Stage:</span>
                <span className="text-cyan-100">{message.streamStage ?? 'idle'}</span>
                <span className="text-gray-500">Status:</span>
                <span className="text-cyan-100">{message.status ?? 'complete'}</span>
                <span className="text-gray-500">ID:</span>
                <span className="text-cyan-100">{message.id.slice(0, 16)}</span>
              </div>
              {activeAgentRun ? (
                <div className="mt-2 space-y-1 border-t border-cyan-200/15 pt-2">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-100/55">
                    Agent Run: {activeAgentRun.title}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="text-gray-500">Status:</span>
                    <span className="text-cyan-100">{activeAgentRun.status}</span>
                    <span className="text-gray-500">Steps:</span>
                    <span className="text-cyan-100">{activeAgentRun.steps.length}</span>
                  </div>
                  {activeAgentRun.steps
                    .filter((s) => s.status !== 'skipped')
                    .map((step) => (
                      <div key={step.id} className="flex min-w-0 gap-2 py-0.5">
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            step.status === 'complete'
                              ? 'bg-green-300'
                              : step.status === 'blocked'
                                ? 'bg-red-300'
                                : step.status === 'running'
                                  ? 'bg-primary-300'
                                  : 'bg-white/25'
                          }`}
                        />
                        <span className="shrink-0 w-12 text-[9px] uppercase tracking-[0.1em] text-gray-500">
                          {step.kind ?? 'task'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-gray-200" title={step.title}>
                          {step.title}
                        </span>
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.1em] text-gray-600">
                          {step.status}
                        </span>
                      </div>
                    ))}
                  {activeAgentRun.steps.length === 0 ? (
                    <span className="text-gray-500">No steps recorded yet.</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CompactDisclosure>
        ) : null}

        {debugMode && isAssistant && latestAiRequestEvents.length > 0 ? (
          <div className="mt-2 space-y-1 rounded border border-cyan-200/15 bg-cyan-400/[0.03] p-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-100/55">
              Recent AI Request / Response
            </div>
            {latestAiRequestEvents.map((event) => (
              <details key={event.id} className="group min-w-0">
                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-cyan-50/70 transition hover:bg-cyan-100/[0.06] [&::-webkit-details-marker]:hidden">
                  <Icons.ChevronDown className="h-2.5 w-2.5 shrink-0 -rotate-90 transition-transform group-open:rotate-0 text-cyan-100/45" />
                  <span className="font-mono font-semibold uppercase tracking-[0.08em]">
                    {event.type === 'ai_request' ? '→ Request' : '← Response'}
                  </span>
                  <span className="truncate text-gray-500">{event.detail.slice(0, 60)}</span>
                </summary>
                <div className="ml-3 mt-1 rounded border border-cyan-200/15 bg-black/20 p-2 font-mono text-[9px] leading-4">
                  <div className="mb-1 text-[8px] uppercase tracking-[0.1em] text-gray-500">
                    {event.source} · {new Date(event.timestamp).toLocaleTimeString()}
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-cyan-50/70">
                    {JSON.stringify(event.data?.body ?? event.data, null, 2).slice(0, 3000)}
                  </pre>
                  {JSON.stringify(event.data?.body ?? event.data).length > 3000 ? (
                    <p className="mt-1 text-cyan-100/40">[truncated]</p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        ) : null}

        {messageAttachments.length > 0 ? (
          <div className="mt-2">
            <AttachmentList attachments={messageAttachments} />
          </div>
        ) : null}

        {isEditingMessage ? (
          <div className="mt-2 space-y-2">
            <ResizableScrollTextarea
              value={editingDraft}
              onChange={(event) => setEditingDraft(event.currentTarget.value)}
              resizeLabel="Resize edited message"
            />
            <div className="flex items-center justify-end gap-1.5">
              <BubbleActionButton
                label="Cancel edit"
                onClick={handleCancelEditingMessage}
                icon={<Icons.XMark className="h-3.5 w-3.5" />}
              />
              <BubbleActionButton
                label="Save and regenerate"
                onClick={() => {
                  void handleSaveEditedMessage(chat, message);
                }}
                disabled={
                  !editingDraft.trim() || chat.status === 'generating' || Boolean(activeRouteError)
                }
                icon={<Icons.Check className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        ) : null}

        {shouldRenderStandaloneContent ? (
          <ChatMarkdown content={displayContent} />
        ) : shouldShowSkeleton ? (
          <MessageSkeleton />
        ) : null}

        {artifact ? (
          <div className="mt-3 space-y-2.5 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
            <CodeBlock code={artifact.code} language="glsl" className="max-h-72 overflow-auto" />

            <div className="flex flex-wrap gap-2">
              {canApplyArtifact && (
                <button
                  type="button"
                  onClick={() => applyAiChatShaderArtifact(chat.id, message.id)}
                  className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-500"
                >
                  {linkedShaderNode ? 'Apply Shader' : 'Create Shader Node'}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {gradePreviewArtifact ? (
          <PreviewArtifactPanel color="yellow">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-100">
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-amber-300/20 !bg-amber-200/10 !text-amber-100"
              >
                Grade Preview
              </Badge>
              {activeChat?.id === chat.id && activeGradePreview ? (
                <Badge
                  size="sm"
                  uppercase
                  noBorder
                  className="!px-2 !py-1 text-[10px] !border-amber-300/20 !bg-amber-200/10 !text-amber-50"
                >
                  Staged
                </Badge>
              ) : null}
            </div>
            <p className="text-[13px] leading-5 text-amber-50">
              {gradePreviewArtifact.summary || 'A staged Grade preview is ready for review.'}
            </p>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-amber-50/90">
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-amber-300/15 !bg-black/10 !text-amber-50/90"
              >
                Exposure {gradePreviewArtifact.values.exposure} stops
              </Badge>
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-amber-300/15 !bg-black/10 !text-amber-50/90"
              >
                Contrast {gradePreviewArtifact.values.contrast}
              </Badge>
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-amber-300/15 !bg-black/10 !text-amber-50/90"
              >
                Saturation {gradePreviewArtifact.values.saturation}
              </Badge>
            </div>
            {activeChat?.id === chat.id && activeGradePreview ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyAiChatGradePreview(chat.id)}
                  className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-500"
                >
                  Apply to Node
                </button>
                <button
                  type="button"
                  onClick={() => clearAiChatGradePreview(chat.id)}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/10"
                >
                  Clear Preview
                </button>
              </div>
            ) : null}
          </PreviewArtifactPanel>
        ) : null}
        {promptPreviewArtifact ? (
          <PreviewArtifactPanel color="cyan">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-50">
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-cyan-200/20 !bg-cyan-100/[0.08] !text-cyan-50"
              >
                Prompt Draft
              </Badge>
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-cyan-200/10 !bg-black/10 !text-cyan-100/85"
              >
                {promptPreviewArtifact.target.controlLabel}
              </Badge>
            </div>
            <p className="text-[13px] leading-5 text-cyan-50">
              {promptPreviewArtifact.summary ||
                'Review the refined prompt, edit it if needed, then apply it to the field.'}
            </p>
            <CompactDisclosure
              title="Original"
              preview={promptPreviewArtifact.originalPrompt}
              contentClassName="ml-[11px] mt-1 pl-4"
              tone="cyan"
            >
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-cyan-50/85">
                {promptPreviewArtifact.originalPrompt}
              </p>
            </CompactDisclosure>
            {promptPreviewArtifact.options.length > 0 ? (
              <ComfyPromptOptionGallery
                messageId={message.id}
                artifact={promptPreviewArtifact}
                onSelectOption={(option) =>
                  setAiChatPromptArtifactDraft(chat.id, message.id, option)
                }
              />
            ) : null}
            <ResizableScrollTextarea
              value={promptPreviewArtifact.draft}
              onChange={(event) =>
                setAiChatPromptArtifactDraft(chat.id, message.id, event.currentTarget.value)
              }
              resizeLabel="Resize prompt draft"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyAiChatPromptArtifact(chat.id, message.id)}
                disabled={!canApplyPromptArtifact}
                className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply to Field
              </button>
              <button
                type="button"
                onClick={() =>
                  setAiChatPromptArtifactDraft(
                    chat.id,
                    message.id,
                    promptPreviewArtifact.options[0] ?? promptPreviewArtifact.originalPrompt,
                  )
                }
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/[0.07]"
              >
                Reset Draft
              </button>
            </div>
          </PreviewArtifactPanel>
        ) : null}
        {renderPreviewArtifact ? (
          <PreviewArtifactPanel color="skyblue">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-50">
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-cyan-200/20 !bg-cyan-100/[0.08] !text-cyan-50"
              >
                Render Preview
              </Badge>
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-cyan-200/10 !bg-black/10 !text-cyan-100/85"
              >
                Frame {renderPreviewArtifact.frame}
              </Badge>
              {renderPreviewArtifact.nodeName ? (
                <Badge
                  size="sm"
                  noBorder
                  className="!px-2 !py-1 !border-cyan-200/10 !bg-black/10 !text-cyan-100/85"
                >
                  {renderPreviewArtifact.nodeName}
                </Badge>
              ) : null}
            </div>
            <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-black/20">
              <img
                src={renderPreviewArtifact.dataUrl}
                alt={renderPreviewArtifact.summary ?? 'Agent render preview'}
                className="max-h-72 w-full object-contain"
              />
            </div>
            <p className="text-[12px] leading-5 text-cyan-50/80">
              {renderPreviewArtifact.summary ??
                `${renderPreviewArtifact.width} x ${renderPreviewArtifact.height} render preview`}
            </p>
          </PreviewArtifactPanel>
        ) : null}
        {renderComparisonArtifact ? (
          <PreviewArtifactPanel color="skyblue">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-50">
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-cyan-200/20 !bg-cyan-100/[0.08] !text-cyan-50"
              >
                Render Comparison
              </Badge>
              <Badge
                size="sm"
                noBorder
                className="!px-2 !py-1 !border-cyan-200/10 !bg-black/10 !text-cyan-100/85"
              >
                Frame {renderComparisonArtifact.after.frame}
              </Badge>
              {renderComparisonArtifact.after.nodeName ? (
                <Badge
                  size="sm"
                  noBorder
                  className="!px-2 !py-1 !border-cyan-200/10 !bg-black/10 !text-cyan-100/85"
                >
                  {renderComparisonArtifact.after.nodeName}
                </Badge>
              ) : null}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {[
                ['Before', renderComparisonArtifact.before],
                ['After', renderComparisonArtifact.after],
              ].map(([label, preview]) => (
                <div
                  key={label as string}
                  className="overflow-hidden rounded-lg border border-white/[0.08] bg-black/20"
                >
                  <div className="border-b border-white/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/65">
                    {label as string}
                  </div>
                  <img
                    src={(preview as typeof renderComparisonArtifact.before).dataUrl}
                    alt={`${label as string} render preview`}
                    className="max-h-64 w-full object-contain"
                  />
                </div>
              ))}
            </div>
            <p className="text-[12px] leading-5 text-cyan-50/80">
              {renderComparisonArtifact.summary ??
                `${renderComparisonArtifact.after.width} x ${renderComparisonArtifact.after.height} render comparison`}
            </p>
          </PreviewArtifactPanel>
        ) : null}
        {chatSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {chatSuggestions.map((suggestion) => (
              <button
                key={`${message.id}-${suggestion}`}
                type="button"
                onClick={() =>
                  setDrafts((current) => ({
                    ...current,
                    [chat.id]: suggestion,
                  }))
                }
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-xs text-gray-200 transition-all hover:bg-white/10 hover:border-white/15 hover:shadow-sm"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {messageActionControls}
      </div>
    );
  };

  const scopeLabel = getAiChatScopeLabel(currentScopeNode);
  const capabilityLabel = getAiChatCapabilityLabel(currentMode);
  const modeDescription = getAiChatModeDescription(currentMode);
  const agentCapabilitySummary = getAgentModeCapabilitySummary(DEFAULT_AGENT_MODE_SETTINGS);
  const scopeTone = currentMode === 'action' ? 'accent' : 'neutral';
  const capabilityTone = currentMode === 'action' ? 'success' : 'neutral';
  const title = activeChat ? (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={handleBackToChats}
        className="text-gray-400 transition hover:text-gray-100"
      >
        Chats
      </button>
      <span className="text-gray-600">/</span>
      <span className="min-w-0 truncate text-gray-200">{activeChat.title}</span>
    </div>
  ) : (
    <div className="flex items-center gap-1.5">
      <span>Chats</span>
    </div>
  );
  const headerMeta = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <ScopeChip tone={scopeTone}>{scopeLabel}</ScopeChip>
      {capabilityLabel && <ScopeChip tone={capabilityTone}>{capabilityLabel}</ScopeChip>}
      {isAgentModeEffective ? <ScopeChip tone="success">Agent</ScopeChip> : null}
    </div>
  );
  const headerActions = (
    <div className="flex items-center gap-1.5">
      {activeChat ? (
        <IconButton
          label="Remove Chat"
          onClick={() => handleRemoveChat(activeChat)}
          icon={<Icons.Trash className="h-3.5 w-3.5" />}
        />
      ) : null}
      <IconButton
        label="New Chat"
        onClick={handleNewChat}
        icon={<Icons.Plus className="h-3.5 w-3.5" />}
      />
    </div>
  );

  const composerStatusText = activeChat
    ? activeChat.feature === 'shader'
      ? activeChatNode
        ? `Linked to ${activeChatNode.name}. This thread can assist and apply shader-specific actions.`
        : 'This action thread is detached from its shader node.'
      : currentScopeNode
        ? supportsAiNodeTools(currentScopeNode) && aiTaskRoutes.assistantChat.provider === 'ollama'
          ? `${currentScopeNode.name} is attached with tool-backed actions. Changes stay staged until you apply the preview.`
          : `${currentScopeNode.name} is attached as visible context. The assistant can advise but will not change the node directly.`
        : 'This is a generic assistant thread without attached node context.'
    : currentMode === 'action' && currentScopeNode
      ? `${currentScopeNode.name} is selected. Sending will start a tool-backed action thread for this node.`
      : currentScopeNode
        ? `${currentScopeNode.name} is selected as optional context. You can clear it before sending.`
        : 'No node context is attached. Start a general assistant chat or select a node first.';
  const resolvedComposerStatusText = isAgentModeEffective
    ? `Agent Mode: ${agentCapabilitySummary}. ${composerStatusText}`
    : composerStatusText;

  const isActiveChatGenerating = activeChat?.status === 'generating';
  const isSendDisabled =
    (!activeDraft.trim() && activeAttachments.length === 0) ||
    (activeChat?.feature === 'shader' && !isCustomShaderNode(activeChatNode)) ||
    Boolean(activeRouteError);
  const visibleComposerError = composerError === activeRouteError ? null : composerError;
  const sendButtonLabel = isActiveChatGenerating ? 'Queue Message' : 'Send';
  const sendHotkeyLabel = isActiveChatGenerating ? 'Queue with' : 'Send with';
  const contextButtonNodeName = canClearContext
    ? (currentScopeNode?.name ?? 'Missing Context')
    : canUseSelectedNodeAsContext
      ? (selectedNode?.name ?? null)
      : null;
  const contextButtonLabel = canClearContext
    ? `Remove ${contextButtonNodeName ?? 'Context'}`
    : `Add ${contextButtonNodeName ?? 'Context'}`;
  const handleContextButtonClick = canClearContext
    ? handleClearContext
    : handleUseSelectedNodeAsContext;
  const sendHotkeyKeys = formatHotkeyCombo('Mod+Enter');
  const isMac = isMacPlatform();

  return (
    <div data-text-selection-scope className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {isComfyNode(activeChatNode) ? (
        <ComfyAdjustmentsPanel node={activeChatNode} headless />
      ) : null}
      <SubPanelHeader title={title} meta={headerMeta} actions={headerActions} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeChat ? (
          <ScrollArea ref={messagesRef} fill axis="y" contentClassName="space-y-2.5 px-2 py-2">
            <>
              {activeAgentRun ? (
                <AgentRunCard
                  run={activeAgentRun}
                  branchName={
                    activeAgentRun.branchId
                      ? projectBranchNameById.get(activeAgentRun.branchId)
                      : undefined
                  }
                  isActiveBranch={activeAgentRun.branchId === activeProjectBranchId}
                  diff={agentDiffs[activeAgentRun.id]}
                  inspect={agentBranchInspections[activeAgentRun.id]}
                  onOpenBranch={() => handleOpenAgentRunBranch(activeAgentRun)}
                  onConfirmBranch={
                    activeAgentBranchRequest ||
                    (activeAgentRun.status === 'waiting-for-user' && !activeAgentRun.branchId)
                      ? () => handleConfirmAgentBranch(activeAgentRun)
                      : undefined
                  }
                  onInspectBranch={() => handleInspectAgentRunBranch(activeAgentRun)}
                  onCapturePreview={() => handleCaptureAgentPreview(activeAgentRun)}
                  onSelfReview={
                    activeAgentReviewMessage
                      ? () => handleSelfReviewAgentPreview(activeAgentRun, activeAgentReviewMessage)
                      : undefined
                  }
                  reviewPolicy={agentSelfReviewPolicy}
                  onReviewPolicyChange={setAgentSelfReviewPolicy}
                  onApplyBranch={() => openAgentReviewDialog(activeAgentRun, 'apply')}
                  onPickNodeChanges={() => openAgentReviewDialog(activeAgentRun, 'pick')}
                  onDiscardBranch={() => openAgentReviewDialog(activeAgentRun, 'discard')}
                  onTakeOverBranch={() => handleTakeOverAgentRunBranch(activeAgentRun)}
                  onAnswerQuestion={(question, answer) =>
                    handleAnswerAgentQuestion(activeAgentRun, question, answer)
                  }
                  isCapturingPreview={capturingPreviewRunId === activeAgentRun.id}
                  isSelfReviewing={selfReviewingRunId === activeAgentRun.id}
                />
              ) : null}
              {activeChat.lastError ? (
                <div
                  data-selectable-text
                  className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200"
                >
                  {activeChat.lastError}
                </div>
              ) : null}
              {activeChat.messages.map((message) => renderMessage(activeChat, message))}
            </>
          </ScrollArea>
        ) : (
          <ScrollArea fill axis="y" contentClassName="space-y-1.5 px-2 py-2">
            <>
              {sortedAgentRuns.length > 0 ? (
                <div className="space-y-1.5 pb-1.5">
                  <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                    Agent Harness
                  </div>
                  {sortedAgentRuns.slice(0, 4).map((run) => (
                    <AgentRunCard
                      key={run.id}
                      run={run}
                      branchName={
                        run.branchId ? projectBranchNameById.get(run.branchId) : undefined
                      }
                      isActiveBranch={run.branchId === activeProjectBranchId}
                      compact
                      onOpenBranch={() => handleOpenAgentRunBranch(run)}
                      onInspectBranch={() => handleInspectAgentRunBranch(run)}
                      onCapturePreview={() => handleCaptureAgentPreview(run)}
                      isCapturingPreview={capturingPreviewRunId === run.id}
                    />
                  ))}
                </div>
              ) : null}
              {sortedAiChats.length > 0 ? (
                sortedAiChats.map((chat) => {
                  const chatNode = getChatNode(chat, nodes);
                  const chatMode = getAiChatScopeMode(chat.feature, chatNode);
                  const latestMessage = chat.messages[chat.messages.length - 1];
                  const chatPreview =
                    chat.status === 'generating'
                      ? 'Generating...'
                      : chat.lastError
                        ? 'Needs attention'
                        : latestMessage?.content || 'Ready';

                  return (
                    <div
                      key={chat.id}
                      className="group flex w-full min-w-0 items-stretch gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-1.5 text-left text-gray-300 transition-all hover:border-white/[0.12] hover:bg-white/[0.055] hover:shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectChat(chat)}
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/[0.035]"
                      >
                        <div
                          className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                            chat.status === 'generating'
                              ? 'border-primary-400/30 bg-primary-500/15 text-primary-200'
                              : chat.lastError
                                ? 'border-red-400/30 bg-red-500/15 text-red-200'
                                : 'border-white/[0.07] bg-white/[0.035] text-gray-300'
                          }`}
                        >
                          {chat.feature === 'shader' ? (
                            <Icons.CodeBracket className="h-3.5 w-3.5" />
                          ) : (
                            <Icons.Sparkles className="h-3.5 w-3.5" />
                          )}
                          {chat.status === 'generating' && (
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-400 animate-pulse" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-100">
                              {chat.title}
                            </span>
                            <ScopeChip tone={chatMode === 'action' ? 'accent' : 'neutral'}>
                              {chatMode === 'action' ? 'Action' : chatNode ? 'Context' : 'General'}
                            </ScopeChip>
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-gray-500">
                            <span className="shrink-0">{formatChatTime(chat.updatedAt)}</span>
                            <span className="text-gray-700">/</span>
                            <span
                              className={`min-w-0 truncate ${
                                chat.lastError ? 'text-red-300/70' : 'text-gray-500'
                              }`}
                              title={chatPreview}
                            >
                              {chatPreview}
                            </span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveChat(chat)}
                        aria-label={`Remove ${chat.title}`}
                        title="Remove chat"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-gray-500 opacity-0 transition-all hover:border-red-300/20 hover:bg-red-500/10 hover:text-red-100 group-hover:opacity-100"
                      >
                        <Icons.Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="flex min-h-40 items-center justify-center px-3 py-3 text-center">
                  <div className="max-w-xs">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-primary-500/30 bg-gradient-to-br from-primary-500/15 to-primary-600/5 text-primary-200 shadow-lg shadow-primary-500/10">
                      <Icons.Sparkles className="h-4 w-4" />
                    </div>
                    <h3 className="mt-3 text-sm font-medium text-white">
                      {isAgentModeEffective ? 'Start an agent task' : 'Start a chat'}
                    </h3>
                    <p className="mt-1.5 text-xs leading-5 text-gray-400">{modeDescription}</p>
                  </div>
                </div>
              )}
            </>
          </ScrollArea>
        )}

        {/* Composer */}
        <div className="shrink-0 border-t border-white/[0.07] bg-black/[0.08] p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
            <div className="flex shrink-0 items-center gap-1.5">
              {contextButtonNodeName ? (
                <button
                  type="button"
                  onClick={handleContextButtonClick}
                  aria-label={contextButtonLabel}
                  title={contextButtonLabel}
                  className="inline-flex max-w-36 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-gray-200 transition-all hover:bg-white/[0.07] hover:border-white/[0.12]"
                >
                  {canClearContext ? (
                    <Icons.XMark className="h-3 w-3 shrink-0" />
                  ) : (
                    <Icons.Plus className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{contextButtonNodeName}</span>
                </button>
              ) : null}
              {activeChat?.feature === 'shader' && !activeChatNode ? (
                <button
                  type="button"
                  onClick={handleCreateNodeFromActiveChat}
                  disabled={!canCreateNodeFromActiveChat}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-gray-200 transition-all hover:bg-white/[0.07] hover:border-white/[0.12] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-gray-500"
                >
                  Create Node
                </button>
              ) : null}
            </div>
            <span className="min-w-0 flex-1 truncate text-[10px]">
              {resolvedComposerStatusText}
            </span>
          </div>

          {visibleComposerError ? (
            <div
              data-selectable-text
              className="mb-2 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200"
            >
              {visibleComposerError}
            </div>
          ) : null}

          {activeRouteError ? (
            <button
              type="button"
              onClick={() => openPreferences({ section: 'integrations' })}
              className="group mb-2 flex w-full items-center gap-2 rounded-lg bg-amber-400/[0.08] px-2.5 py-2 text-left text-xs text-amber-100 transition hover:bg-amber-400/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50"
              aria-label={`${activeRouteError} Open Integrations preferences`}
              title="Open Preferences > Integrations"
            >
              <Icons.ExclamationCircle className="h-4 w-4 shrink-0 text-amber-300/80" />
              <span className="min-w-0 flex-1 truncate">{activeRouteError}</span>
              <span className="shrink-0 font-medium text-amber-200">Open integrations</span>
              <Icons.ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
            </button>
          ) : null}

          {isActiveChatGenerating || activeQueuedDraft ? (
            <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-[11px] text-gray-400">
              {isActiveChatGenerating ? <Spinner className="h-3 w-3 shrink-0 text-white" /> : null}
              {activeQueuedDraft ? (
                <span
                  className="min-w-0 flex-1 truncate text-gray-300"
                  title={getQueuedDraftPreview(activeQueuedDraft)}
                >
                  Queued: {getQueuedDraftPreview(activeQueuedDraft)}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate">New messages will queue.</span>
              )}
              {activeQueuedDraft ? (
                <button
                  type="button"
                  onClick={handleSendQueuedNow}
                  className="shrink-0 rounded-md border border-primary-400/25 bg-primary-500/10 px-2 py-1 text-primary-100 transition hover:bg-primary-500/15"
                >
                  Send now
                </button>
              ) : null}
              {isActiveChatGenerating ? (
                <button
                  type="button"
                  onClick={handleStopActiveChat}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-gray-200 transition hover:bg-white/[0.07]"
                >
                  <Icons.Pause className="h-3 w-3" />
                  Stop
                </button>
              ) : null}
              {activeQueuedDraft ? (
                <button
                  type="button"
                  onClick={handleDiscardQueuedDraft}
                  aria-label="Discard queued message"
                  title="Discard queued message"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-gray-300 transition hover:bg-white/[0.07]"
                >
                  <Icons.XMark className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-white/[0.12] focus-within:bg-white/[0.035]">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(event) => {
                void handleAttachFiles(event);
              }}
              className="hidden"
            />
            {activeAttachments.length > 0 ? (
              <div className="mb-1.5">
                <AttachmentList attachments={activeAttachments} onRemove={handleRemoveAttachment} />
              </div>
            ) : null}
            <textarea
              ref={composerInputRef}
              value={activeDraft}
              onChange={(event) => {
                setComposerError(null);
                setDrafts((current) => ({
                  ...current,
                  [activeDraftKey]: event.target.value,
                }));
              }}
              onKeyDown={(event) => {
                const isSendHotkey =
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.altKey &&
                  (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

                if (!isSendHotkey) {
                  return;
                }

                event.preventDefault();
                if (!isSendDisabled) {
                  void handleSend();
                }
              }}
              rows={2}
              placeholder={getAiChatComposerPlaceholder(currentMode)}
              className="w-full resize-none bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
            />
            <div className="mt-1 flex min-h-6 items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={activeAttachments.length >= ChatAttachmentLimits.MAX_ATTACHMENTS}
                aria-label="Attach images or files"
                title="Attach images or files"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-gray-400 transition hover:bg-white/[0.06] hover:text-gray-200 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-gray-600"
              >
                <Icons.DocumentPlus className="h-3.5 w-3.5" />
              </button>
              {canToggleThinkingMode && (
                <button
                  type="button"
                  onClick={() => setIsThinkingModeEnabled((enabled) => !enabled)}
                  aria-pressed={isThinkingModeEnabled}
                  aria-label={
                    isThinkingModeEnabled
                      ? 'Disable thinking mode'
                      : 'Enable thinking mode for supported models'
                  }
                  title={
                    isThinkingModeEnabled
                      ? 'Thinking on'
                      : 'Thinking off - enable for supported models'
                  }
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition ${
                    isThinkingModeEnabled
                      ? 'border-primary-400/30 bg-primary-500/10 text-primary-100 hover:bg-primary-500/15'
                      : 'border-white/[0.08] bg-white/[0.03] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300'
                  }`}
                >
                  <Icons.LightBulb className="h-3.5 w-3.5" />
                </button>
              )}
              <SlidingSegmentedControl
                options={CHAT_EXECUTION_MODE_OPTIONS.map((option) =>
                  option.value === 'agent'
                    ? {
                        ...option,
                        disabled: activeRouteTask !== 'assistantChat',
                        title:
                          activeRouteTask === 'assistantChat'
                            ? `Agent mode: ${agentCapabilitySummary}`
                            : 'Agent mode applies to assistant chats',
                      }
                    : option,
                )}
                value={isAgentModeEffective ? 'agent' : 'chat'}
                onChange={(mode) => setIsAgentModeEnabled(mode === 'agent')}
                activeWidth={64}
                inactiveWidth={28}
                height={28}
                iconClassName="h-3.5 w-3.5"
                labelMaxWidthClassName="max-w-10"
              />
              {activeRouteError ? (
                <span className="min-w-0 flex-1" />
              ) : (
                <p className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
                  {activeRoute
                    ? `Using ${getAiProviderLabel(activeRoute.provider)}${activeRoute.model ? ` (${activeRoute.model})` : ''}.`
                    : 'Choose an AI route in Preferences > Integrations.'}
                </p>
              )}
              {!isSendDisabled ? <KeyHint keys={sendHotkeyKeys} label={sendHotkeyLabel} /> : null}
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSendDisabled}
                aria-label={sendButtonLabel}
                title={sendButtonLabel}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-500/30 text-primary-100 transition hover:bg-primary-500/50 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-gray-500"
              >
                <Icons.ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      {agentReviewDialog ? (
        <AgentReviewDialog
          state={agentReviewDialog}
          run={agentReviewDialogRun}
          branchName={
            agentReviewDialogRun?.branchId
              ? projectBranchNameById.get(agentReviewDialogRun.branchId)
              : undefined
          }
          onClose={() => setAgentReviewDialog(null)}
          onConfirm={handleConfirmAgentReviewDialog}
        />
      ) : null}
    </div>
  );
}

export default ChatsTab;
