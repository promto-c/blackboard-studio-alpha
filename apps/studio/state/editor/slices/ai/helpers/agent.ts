import {
  AiAgentModeSettings,
  AiAgentRun,
  AiAgentRunStatus,
  AiAgentRunStep,
} from '@blackboard/types';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type CreateAiAgentRunInput = {
  id?: string;
  prompt: string;
  title?: string;
  sourceChatId?: string | null;
  branchId?: string | null;
  settings: AiAgentModeSettings;
};

/* ------------------------------------------------------------------ */
/*  ID generators (non-exported)                                      */
/* ------------------------------------------------------------------ */

const createAiAgentRunId = () =>
  `agent_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createAiAgentRunStepId = () =>
  `agent_step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const getAiAgentRunTitle = (prompt: string, fallback = 'Agent Task') => {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 56 ? `${normalized.slice(0, 53).trim()}...` : normalized;
};

export const createAiAgentRunStep = (
  input: Omit<AiAgentRunStep, 'id' | 'agentGenerated'> &
    Partial<Pick<AiAgentRunStep, 'id' | 'agentGenerated'>>,
): AiAgentRunStep => ({
  ...input,
  id: input.id ?? createAiAgentRunStepId(),
  agentGenerated: input.agentGenerated ?? false,
});

export const createAiAgentRunRecord = (
  input: CreateAiAgentRunInput,
  projectId?: string | null,
): AiAgentRun => {
  const timestamp = Date.now();
  const runId = input.id ?? createAiAgentRunId();
  return {
    id: runId,
    title: input.title?.trim() || getAiAgentRunTitle(input.prompt),
    prompt: input.prompt,
    projectId: projectId ?? undefined,
    sourceChatId: input.sourceChatId ?? undefined,
    branchId: input.branchId ?? undefined,
    settings: input.settings,
    status: 'triaging',
    workingOwnerType: 'agent',
    workingOwnerId: runId,
    userAccess: input.branchId ? 'read-only' : 'review',
    planMode: input.settings.planMode === 'always' ? 'explicit' : 'implicit',
    recommendedNextAction: input.branchId ? 'manual-review' : 'continue',
    steps: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const updateAiAgentRunById = (
  runs: AiAgentRun[],
  runId: string,
  updater: (run: AiAgentRun) => AiAgentRun,
) => runs.map((run) => (run.id === runId ? updater(run) : run));

export const getAiAgentRunStatusEvent = (
  status: AiAgentRunStatus,
  branchId?: string | null,
): AiAgentRunStep | null => {
  if (status === 'running' && branchId) {
    return createAiAgentRunStep({
      title: 'Agent branch ready',
      kind: 'tool',
      status: 'complete',
    });
  }
  if (status === 'waiting-for-user') {
    return createAiAgentRunStep({
      title: branchId ? 'Waiting for user direction' : 'Waiting for branch approval',
      kind: 'question',
      status: 'pending',
      needsUserInput: true,
    });
  }
  if (status === 'reviewing') {
    return createAiAgentRunStep({
      title: 'Reviewing result',
      kind: 'review',
      status: 'running',
    });
  }
  if (status === 'ready') {
    return createAiAgentRunStep({
      title: 'Ready for user review',
      kind: 'handoff',
      status: 'complete',
    });
  }
  if (status === 'failed') {
    return createAiAgentRunStep({
      title: 'Agent task blocked',
      kind: 'handoff',
      status: 'blocked',
    });
  }
  return null;
};

export const appendAiAgentRunEvent = (steps: AiAgentRunStep[], event: AiAgentRunStep | null) => {
  if (!event) return steps;
  const existingIndex = steps.findIndex(
    (step) => step.kind === event.kind && step.title === event.title,
  );
  if (existingIndex === -1) return [...steps, event];
  return steps.map((step, index) =>
    index === existingIndex
      ? {
          ...step,
          ...event,
          id: step.id,
          toolCallIds: event.toolCallIds ?? step.toolCallIds,
          reviewAssetIds: event.reviewAssetIds ?? step.reviewAssetIds,
          questions: event.questions ?? step.questions,
        }
      : step,
  );
};

export const getAiAgentRunRecommendedNextAction = (
  status: AiAgentRunStatus,
  branchId?: string | null,
): AiAgentRun['recommendedNextAction'] | undefined => {
  if (status === 'ready' && branchId) return 'apply';
  if (status === 'waiting-for-user') return branchId ? 'continue' : 'manual-review';
  if (status === 'reviewing') return 'manual-review';
  if (status === 'discarded') return 'discard';
  if (status === 'applied' || status === 'merged') return 'manual-review';
  if (status === 'failed') return 'manual-review';
  if (status === 'running' || status === 'planning' || status === 'triaging') return 'continue';
  return undefined;
};
