import {
  EditorTab,
  NodeKind,
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  validateRootFlow,
  type AiAgentDelegation,
  type AiAgentQuestion,
  type AiAgentQuestionChoice,
  type AiAgentReviewFinding,
  type AiAgentRunStep,
  type AnyNode,
  type FlowId,
  type RotoNode,
  type RotoPath,
} from '@blackboard/types';
import { setKeyframeOnValue } from '@blackboard/renderer';
import { nodeRegistry } from '@/nodes/registry';
import { getRootFlow, replaceFlowNodeInput, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import type { ProjectBranchRecord } from '@/state/projectBranches';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { wouldCreateCycle } from './connectionGraph';
import type { AiToolExecutionResult, AiToolHandler } from './agentToolRegistry';

const PROTECTED_NODE_PROP_KEYS = new Set(['id', 'type', 'kind', 'inputs', 'inputSourcePorts']);
const NON_AGENT_CREATABLE_NODE_TYPES = new Set<string>([
  NodeType.SCENE,
  NodeType.OUTPUT,
  NodeType.INPUT,
  NodeType.GROUP,
]);
const DEFAULT_MAX_SUBAGENT_SPAWNS = 2;
const MAX_SUBAGENT_SPAWNS_LIMIT = 8;

type AgentProjectToolDeps = {
  commitMutation: CommitEditorMutation;
  getState: GetState;
  setState: SetState;
  debouncedSave: () => void;
  maxSubagentSpawns?: number;
  runSubagentTask?: (input: { runId: string; delegation: AiAgentDelegation }) => Promise<{
    status: 'complete' | 'blocked';
    result: string;
  }>;
};

type AgentEditorState = EditorState & {
  activeProjectBranchId?: string | null;
  projectBranches?: ProjectBranchRecord[];
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const toStringValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeMaxSubagentSpawns = (value: unknown): number =>
  clamp(
    Math.round(toFiniteNumber(value, DEFAULT_MAX_SUBAGENT_SPAWNS)),
    0,
    MAX_SUBAGENT_SPAWNS_LIMIT,
  );

const sanitizeJsonValue = (value: unknown): unknown => {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  if (typeof value !== 'object') {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, sanitizeJsonValue(entry)] as const)
      .filter(([, entry]) => entry !== undefined),
  );
};

const sanitizeNodeProps = (props: unknown): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(toRecord(props))
      .filter(([key]) => !PROTECTED_NODE_PROP_KEYS.has(key))
      .map(([key, value]) => [key, sanitizeJsonValue(value)] as const)
      .filter(([, value]) => value !== undefined),
  );

const getActiveAgentBranch = (state: AgentEditorState): ProjectBranchRecord | null => {
  const activeBranchId = state.activeProjectBranchId;
  const branch = state.projectBranches?.find((entry) => entry.id === activeBranchId);
  return branch?.kind === 'agent' &&
    branch.status === 'active' &&
    branch.workingOwnerType !== 'user'
    ? branch
    : null;
};

const blockedOutsideAgentBranch = (): AiToolExecutionResult<null> => ({
  content: JSON.stringify({
    status: 'blocked',
    message: 'Agent node tools can only mutate an active isolated agent branch.',
  }),
  artifact: null,
});

const getUniqueNodeName = (nodes: AnyNode[], nodeType: string, fallbackName: string) => {
  const existingTypeCount = nodes.filter((node) => node.type === nodeType).length;
  if (existingTypeCount === 0 && !nodes.some((node) => node.name === fallbackName)) {
    return fallbackName;
  }

  let index = existingTypeCount + 1;
  let nextName = `${fallbackName} ${index}`;
  while (nodes.some((node) => node.name === nextName)) {
    index += 1;
    nextName = `${fallbackName} ${index}`;
  }
  return nextName;
};

const createNodeId = (nodeType: string, nodes: AnyNode[]) => {
  const baseId = `${nodeType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!nodes.some((node) => node.id === baseId)) {
    return baseId;
  }

  let index = 2;
  while (nodes.some((node) => node.id === `${baseId}_${index}`)) {
    index += 1;
  }
  return `${baseId}_${index}`;
};

const createRotoPathId = (paths: RotoPath[]) => {
  const baseId = `roto_path_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!paths.some((path) => path.id === baseId)) {
    return baseId;
  }

  let index = 2;
  while (paths.some((path) => path.id === `${baseId}_${index}`)) {
    index += 1;
  }
  return `${baseId}_${index}`;
};

const createAgentRunEventId = () =>
  `agent_step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createAgentReviewFindingId = () =>
  `agent_finding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createAgentDelegationId = () =>
  `agent_delegation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createAgentQuestionId = () =>
  `agent_question_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getInsertIndex = (
  nodes: AnyNode[],
  afterNodeId?: string | null,
  selectedNodeId?: string | null,
) => {
  const anchorId = afterNodeId ?? selectedNodeId ?? null;
  if (!anchorId) return nodes.length;
  const anchorIndex = nodes.findIndex((node) => node.id === anchorId);
  return anchorIndex === -1 ? nodes.length : anchorIndex + 1;
};

const getAgentRunIdForTool = (state: AgentEditorState, requestedRunId?: unknown) => {
  const runId = toStringValue(requestedRunId);
  if (runId && state.aiAgentRuns?.some((run) => run.id === runId)) return runId;
  return state.activeAiAgentRunId ?? state.aiAgentRuns?.[0]?.id ?? null;
};

const recordAgentPlanTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'record_agent_plan',
      description:
        'Record an agent-authored plan only when explicit planning is useful for this run.',
      parameters: {
        type: 'object',
        required: ['items'],
        properties: {
          runId: { type: 'string' },
          items: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    const runId = getAgentRunIdForTool(state, args.runId);
    const items = Array.isArray(args.items)
      ? args.items.map(toStringValue).filter((item): item is string => Boolean(item))
      : [];
    if (!runId || items.length === 0) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'record_agent_plan requires an active agent run and at least one plan item.',
        }),
        artifact: null,
      };
    }

    const steps: AiAgentRunStep[] = items.map((title) => ({
      id: createAgentRunEventId(),
      title,
      kind: 'plan',
      status: 'pending',
      agentGenerated: true,
    }));
    deps.setState((currentState) => ({
      aiAgentRuns: currentState.aiAgentRuns.map((run) =>
        run.id === runId
          ? {
              ...run,
              status: run.status === 'triaging' ? 'planning' : run.status,
              planMode: 'explicit',
              steps: [
                ...run.steps.filter((step) => step.kind !== 'plan' || !step.agentGenerated),
                ...steps,
              ],
              updatedAt: Date.now(),
            }
          : run,
      ),
      activeAiAgentRunId: runId,
      activeTab: EditorTab.Chats,
      isSubPanelVisible: true,
    }));
    deps.debouncedSave();

    return {
      content: JSON.stringify({
        status: 'recorded',
        runId,
        itemCount: steps.length,
      }),
      artifact: null,
    };
  },
});

const normalizeAgentQuestionChoice = (value: unknown): AiAgentQuestionChoice | null => {
  const entry = toRecord(value);
  const label = toStringValue(entry.label);
  if (!label) return null;
  return {
    id: toStringValue(entry.id) ?? label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    description: toStringValue(entry.description) ?? undefined,
    recommended: entry.recommended === true,
  };
};

const normalizeAgentQuestion = (value: unknown): AiAgentQuestion | null => {
  const entry = toRecord(value);
  const prompt = toStringValue(entry.prompt);
  if (!prompt) return null;
  const choices = Array.isArray(entry.choices)
    ? entry.choices
        .map(normalizeAgentQuestionChoice)
        .filter((choice): choice is NonNullable<typeof choice> => Boolean(choice))
    : undefined;
  const blocks = toStringValue(entry.blocks);
  return {
    id: toStringValue(entry.id) ?? createAgentQuestionId(),
    prompt,
    choices: choices?.length ? choices : undefined,
    freeformAllowed: entry.freeformAllowed !== false,
    required: entry.required !== false,
    blocks:
      blocks === 'none' ||
      blocks === 'planning' ||
      blocks === 'implementation' ||
      blocks === 'merge'
        ? blocks
        : 'implementation',
  };
};

const askUserQuestionsTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'ask_user_questions',
      description:
        'Ask one or more independent structured questions with choices and optional freeform input.',
      parameters: {
        type: 'object',
        required: ['questions'],
        properties: {
          runId: { type: 'string' },
          questions: {
            type: 'array',
            items: { type: 'object' },
          },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    const runId = getAgentRunIdForTool(state, args.runId);
    const questions = Array.isArray(args.questions)
      ? args.questions
          .map(normalizeAgentQuestion)
          .filter((question): question is AiAgentQuestion => Boolean(question))
      : [];
    if (!runId || questions.length === 0) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'ask_user_questions requires an active agent run and at least one question.',
        }),
        artifact: null,
      };
    }

    const step: AiAgentRunStep = {
      id: createAgentRunEventId(),
      title: questions.length === 1 ? questions[0].prompt : `${questions.length} questions`,
      kind: 'question',
      status: 'pending',
      needsUserInput: true,
      questions,
      agentGenerated: true,
    };
    deps.setState((currentState) => ({
      aiAgentRuns: currentState.aiAgentRuns.map((run) =>
        run.id === runId
          ? {
              ...run,
              status: 'asking',
              steps: [...run.steps, step],
              recommendedNextAction: 'continue',
              updatedAt: Date.now(),
            }
          : run,
      ),
      activeAiAgentRunId: runId,
      activeTab: EditorTab.Chats,
      isSubPanelVisible: true,
    }));
    deps.debouncedSave();

    return {
      content: JSON.stringify({
        status: 'asked',
        runId,
        questionCount: questions.length,
      }),
      artifact: null,
    };
  },
});

const normalizeReviewFinding = (value: unknown): AiAgentReviewFinding | null => {
  const entry = toRecord(value);
  const title = toStringValue(entry.title);
  if (!title) return null;
  const severity = toStringValue(entry.severity);
  return {
    id: toStringValue(entry.id) ?? createAgentReviewFindingId(),
    severity:
      severity === 'blocking' || severity === 'warning' || severity === 'info' ? severity : 'info',
    title,
    description: toStringValue(entry.description) ?? undefined,
    recommendation: toStringValue(entry.recommendation) ?? undefined,
  };
};

const runAgentReviewTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'run_agent_review',
      description: 'Record an agent-selected review pass and structured findings.',
      parameters: {
        type: 'object',
        required: ['summary'],
        properties: {
          runId: { type: 'string' },
          summary: { type: 'string' },
          findings: {
            type: 'array',
            items: { type: 'object' },
          },
          passed: { type: 'boolean' },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    const runId = getAgentRunIdForTool(state, args.runId);
    const summary = toStringValue(args.summary);
    const findings = Array.isArray(args.findings)
      ? args.findings
          .map(normalizeReviewFinding)
          .filter((finding): finding is AiAgentReviewFinding => Boolean(finding))
      : [];
    if (!runId || !summary) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'run_agent_review requires an active agent run and summary.',
        }),
        artifact: null,
      };
    }

    const hasBlockingFinding = findings.some((finding) => finding.severity === 'blocking');
    const passed = args.passed === true && !hasBlockingFinding;
    const step: AiAgentRunStep = {
      id: createAgentRunEventId(),
      title: passed ? 'Review passed' : 'Review needs attention',
      kind: 'review',
      status: passed ? 'complete' : 'blocked',
      reviewFindings:
        findings.length > 0
          ? findings
          : [
              {
                id: createAgentReviewFindingId(),
                severity: passed ? 'info' : 'warning',
                title: summary,
              },
            ],
      agentGenerated: true,
    };
    deps.setState((currentState) => ({
      aiAgentRuns: currentState.aiAgentRuns.map((run) =>
        run.id === runId
          ? {
              ...run,
              status: passed ? 'ready' : 'reviewing',
              steps: [...run.steps, step],
              recommendedNextAction: passed
                ? run.branchId
                  ? 'apply'
                  : 'manual-review'
                : 'continue',
              updatedAt: Date.now(),
            }
          : run,
      ),
      activeAiAgentRunId: runId,
      activeTab: EditorTab.Chats,
      isSubPanelVisible: true,
    }));
    deps.debouncedSave();

    return {
      content: JSON.stringify({
        status: passed ? 'passed' : 'needs_attention',
        runId,
        findingCount: step.reviewFindings?.length ?? 0,
      }),
      artifact: null,
    };
  },
});

const normalizeAgentDelegation = (args: Record<string, unknown>): AiAgentDelegation | null => {
  const task = toStringValue(args.task);
  if (!task) return null;
  const status = toStringValue(args.status);
  return {
    id: toStringValue(args.id) ?? createAgentDelegationId(),
    assignee: toStringValue(args.assignee) ?? 'sub-agent',
    task,
    status: status === 'complete' || status === 'blocked' ? status : 'assigned',
    result: toStringValue(args.result) ?? undefined,
  };
};

const getOpenDelegationCount = (steps: AiAgentRunStep[]): number => {
  const delegationStatusById = new Map<string, AiAgentDelegation['status']>();
  steps.forEach((step) => {
    if (step.kind === 'delegation' && step.delegation) {
      delegationStatusById.set(step.delegation.id, step.delegation.status);
    }
  });
  return [...delegationStatusById.values()].filter((status) => status === 'assigned').length;
};

const appendDelegationEvent = (
  deps: AgentProjectToolDeps,
  runId: string,
  delegation: AiAgentDelegation,
) => {
  const step: AiAgentRunStep = {
    id: createAgentRunEventId(),
    title: delegation.task,
    kind: 'delegation',
    status:
      delegation.status === 'complete'
        ? 'complete'
        : delegation.status === 'blocked'
          ? 'blocked'
          : 'running',
    delegation,
    agentGenerated: true,
  };
  deps.setState((currentState) => ({
    aiAgentRuns: currentState.aiAgentRuns.map((run) =>
      run.id === runId
        ? {
            ...run,
            status:
              delegation.status === 'complete'
                ? run.status === 'delegating'
                  ? 'running'
                  : run.status
                : delegation.status === 'blocked'
                  ? 'waiting-for-user'
                  : 'delegating',
            steps: [...run.steps, step],
            recommendedNextAction:
              delegation.status === 'blocked' ? 'manual-review' : run.recommendedNextAction,
            updatedAt: Date.now(),
          }
        : run,
    ),
    activeAiAgentRunId: runId,
    activeTab: EditorTab.Chats,
    isSubPanelVisible: true,
  }));
  deps.debouncedSave();
};

const assignSubagentTaskTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'assign_subagent_task',
      description: 'Run or record a bounded independent sub-agent assignment and result.',
      parameters: {
        type: 'object',
        required: ['task'],
        properties: {
          runId: { type: 'string' },
          assignee: { type: 'string' },
          task: { type: 'string' },
          status: { type: 'string' },
          result: { type: 'string' },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    const runId = getAgentRunIdForTool(state, args.runId);
    const delegation = normalizeAgentDelegation(args);
    if (!runId || !delegation) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'assign_subagent_task requires an active agent run and task.',
        }),
        artifact: null,
      };
    }
    const run = state.aiAgentRuns?.find((entry) => entry.id === runId);
    const maxSubagentSpawns = normalizeMaxSubagentSpawns(deps.maxSubagentSpawns);
    if (
      delegation.status === 'assigned' &&
      (!run || getOpenDelegationCount(run.steps) >= maxSubagentSpawns)
    ) {
      return {
        content: JSON.stringify({
          status: 'blocked',
          message:
            maxSubagentSpawns === 0
              ? 'Sub-agent delegation is disabled by preferences.'
              : 'Sub-agent spawn limit reached for this agent run.',
          runId,
          maxSubagentSpawns,
        }),
        artifact: null,
      };
    }

    appendDelegationEvent(deps, runId, delegation);

    if (delegation.status === 'assigned' && deps.runSubagentTask) {
      return deps
        .runSubagentTask({ runId, delegation })
        .then((subagentResult) => {
          const completedDelegation: AiAgentDelegation = {
            ...delegation,
            status: subagentResult.status,
            result: subagentResult.result,
          };
          appendDelegationEvent(deps, runId, completedDelegation);
          return {
            content: JSON.stringify({
              status: completedDelegation.status,
              runId,
              delegationId: completedDelegation.id,
              maxSubagentSpawns,
              result: completedDelegation.result,
            }),
            artifact: null,
          };
        })
        .catch((error) => {
          const completedDelegation: AiAgentDelegation = {
            ...delegation,
            status: 'blocked',
            result: error instanceof Error ? error.message : String(error),
          };
          appendDelegationEvent(deps, runId, completedDelegation);
          return {
            content: JSON.stringify({
              status: 'blocked',
              runId,
              delegationId: completedDelegation.id,
              maxSubagentSpawns,
              result: completedDelegation.result,
            }),
            artifact: null,
          };
        });
    }

    return {
      content: JSON.stringify({
        status: delegation.status,
        runId,
        delegationId: delegation.id,
        maxSubagentSpawns,
      }),
      artifact: null,
    };
  },
});

const HANDOFF_ACTIONS = new Set([
  'apply',
  'merge',
  'cherry-pick',
  'discard',
  'continue',
  'manual-review',
]);

const recordAgentHandoffTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'record_agent_handoff',
      description: 'Record the final agent handoff recommendation and remaining risks.',
      parameters: {
        type: 'object',
        required: ['summary', 'recommendedNextAction'],
        properties: {
          runId: { type: 'string' },
          summary: { type: 'string' },
          recommendedNextAction: { type: 'string' },
          risks: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    const runId = getAgentRunIdForTool(state, args.runId);
    const summary = toStringValue(args.summary);
    const requestedAction = toStringValue(args.recommendedNextAction);
    const recommendedNextAction =
      requestedAction && HANDOFF_ACTIONS.has(requestedAction) ? requestedAction : null;
    const risks = Array.isArray(args.risks)
      ? args.risks.map(toStringValue).filter((risk): risk is string => Boolean(risk))
      : [];
    if (!runId || !summary || !recommendedNextAction) {
      return {
        content: JSON.stringify({
          status: 'error',
          message:
            'record_agent_handoff requires an active agent run, summary, and valid next action.',
        }),
        artifact: null,
      };
    }

    const riskFindings: AiAgentReviewFinding[] = risks.map((risk) => ({
      id: createAgentReviewFindingId(),
      severity: 'warning',
      title: risk,
    }));
    const step: AiAgentRunStep = {
      id: createAgentRunEventId(),
      title: summary,
      kind: 'handoff',
      status: 'complete',
      reviewFindings: riskFindings.length > 0 ? riskFindings : undefined,
      agentGenerated: true,
    };
    deps.setState((currentState) => ({
      aiAgentRuns: currentState.aiAgentRuns.map((run) =>
        run.id === runId
          ? {
              ...run,
              status: 'ready',
              steps: [...run.steps, step],
              recommendedNextAction: recommendedNextAction as NonNullable<
                typeof run.recommendedNextAction
              >,
              updatedAt: Date.now(),
            }
          : run,
      ),
      activeAiAgentRunId: runId,
      activeTab: EditorTab.Chats,
      isSubPanelVisible: true,
    }));
    deps.debouncedSave();

    return {
      content: JSON.stringify({
        status: 'recorded',
        runId,
        recommendedNextAction,
        riskCount: risks.length,
      }),
      artifact: null,
    };
  },
});

const createNodeTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'create_node',
      description: 'Create a registry-backed node in the active isolated agent branch.',
      parameters: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string' },
          name: { type: 'string' },
          props: { type: 'object' },
          afterNodeId: { type: 'string' },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    if (!getActiveAgentBranch(state)) {
      return blockedOutsideAgentBranch();
    }

    const nodeType = toStringValue(args.type);
    if (!nodeType || NON_AGENT_CREATABLE_NODE_TYPES.has(nodeType)) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: `Node type "${nodeType ?? ''}" cannot be created by the agent.`,
        }),
        artifact: null,
      };
    }

    const definition = nodeRegistry.get(nodeType);
    if (!definition) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: `Unknown node type "${nodeType}".`,
        }),
        artifact: null,
      };
    }

    const nodes = state.nodes ?? [];
    const requestedName = toStringValue(args.name);
    const name = requestedName ?? getUniqueNodeName(nodes, nodeType, definition.name);
    const node = {
      ...definition.getInitialNodeProps(),
      ...sanitizeNodeProps(args.props),
      id: createNodeId(nodeType, nodes),
      kind: NodeKind.EFFECT,
      type: nodeType,
      name,
      enabled: true,
    } as AnyNode;
    const insertIndex = getInsertIndex(
      nodes,
      toStringValue(args.afterNodeId),
      state.selectedNodeId,
    );
    const nextNodes = [...nodes];
    nextNodes.splice(insertIndex, 0, node);

    deps.commitMutation({
      patch: {
        nodes: nextNodes,
        selectedNodeId: node.id,
        activeTab: EditorTab.Flow,
      },
      history: {
        label: `Agent Create ${name} Node`,
        state: { nodes: nextNodes, selectedNodeId: node.id },
      },
    });

    return {
      content: JSON.stringify({
        status: 'created',
        nodeId: node.id,
        type: node.type,
        name: node.name,
      }),
      artifact: null,
    };
  },
});

const updateNodePropsTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'update_node_props',
      description: 'Update JSON-compatible props on an existing node in the active agent branch.',
      parameters: {
        type: 'object',
        required: ['nodeId', 'props'],
        properties: {
          nodeId: { type: 'string' },
          props: { type: 'object' },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    if (!getActiveAgentBranch(state)) {
      return blockedOutsideAgentBranch();
    }

    const nodeId = toStringValue(args.nodeId);
    const props = sanitizeNodeProps(args.props);
    if (!nodeId || Object.keys(props).length === 0) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'update_node_props requires nodeId and at least one editable prop.',
        }),
        artifact: null,
      };
    }

    const targetNode = state.nodes.find((node) => node.id === nodeId);
    if (!targetNode) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: `Node "${nodeId}" was not found.`,
        }),
        artifact: null,
      };
    }

    const nextNodes = state.nodes.map((node) =>
      node.id === nodeId ? ({ ...node, ...props } as AnyNode) : node,
    );
    deps.commitMutation({
      patch: {
        nodes: nextNodes,
        selectedNodeId: nodeId,
        activeTab: EditorTab.Flow,
      },
      history: {
        label: `Agent Update ${targetNode.name}`,
        state: { nodes: nextNodes, selectedNodeId: nodeId },
      },
    });

    return {
      content: JSON.stringify({
        status: 'updated',
        nodeId,
        changedProps: Object.keys(props),
      }),
      artifact: null,
    };
  },
});

const connectNodesTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'connect_nodes',
      description:
        'Connect one node output to another node input using the canonical persisted flow graph.',
      parameters: {
        type: 'object',
        required: ['sourceNodeId', 'targetNodeId', 'targetPort'],
        properties: {
          sourceNodeId: { type: 'string' },
          sourcePort: { type: 'string' },
          targetNodeId: { type: 'string' },
          targetPort: { type: 'string' },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    if (!getActiveAgentBranch(state)) {
      return blockedOutsideAgentBranch();
    }

    const sourceNodeId = toStringValue(args.sourceNodeId);
    const targetNodeId = toStringValue(args.targetNodeId);
    const targetPort = toStringValue(args.targetPort);
    const sourcePort = toStringValue(args.sourcePort) ?? 'output';
    if (!sourceNodeId || !targetNodeId || !targetPort) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'connect_nodes requires sourceNodeId, targetNodeId, and targetPort.',
        }),
        artifact: null,
      };
    }
    if (sourceNodeId === targetNodeId) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'A node cannot be connected to itself.',
        }),
        artifact: null,
      };
    }

    const flowId = (state.activeFlowId ?? state.rootFlowId ?? ROOT_FLOW_ID) as FlowId;
    const activeFlow = getRootFlow(state.flows, flowId);
    if (!activeFlow) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'No active flow is available for connection.',
        }),
        artifact: null,
      };
    }

    const nodeIds = new Set(activeFlow.nodes.map((node) => node.id));
    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'Both source and target nodes must exist in the active flow.',
        }),
        artifact: null,
      };
    }

    const nextFlows = replaceFlowNodeInput(
      state.flows,
      flowId,
      targetNodeId,
      targetPort,
      sourceNodeId,
      sourcePort,
    );
    const nextFlow = nextFlows?.[flowId];
    if (!nextFlows || !nextFlow) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'Could not create the requested connection.',
        }),
        artifact: null,
      };
    }
    if (
      validateRootFlow(nextFlow).some((issue) => issue.code === 'connection_cycle') ||
      wouldCreateCycle(state.nodes, targetNodeId, sourceNodeId, targetPort)
    ) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'Connection rejected because it would create a cycle.',
        }),
        artifact: null,
      };
    }

    deps.commitMutation({
      patch: {
        flows: nextFlows,
        selectedNodeId: targetNodeId,
        activeTab: EditorTab.Flow,
      },
      history: {
        label: `Agent Connect ${targetPort} input`,
        state: { flows: nextFlows, selectedNodeId: targetNodeId },
      },
      persist: 'debounced',
    });

    return {
      content: JSON.stringify({
        status: 'connected',
        sourceNodeId,
        sourcePort,
        targetNodeId,
        targetPort,
      }),
      artifact: null,
    };
  },
});

type RotoCommandType = 'create-path' | 'move-point' | 'set-feather' | 'set-opacity' | 'set-blend';

type RotoPointInput = { x: unknown; y: unknown };

const isRotoNode = (node: AnyNode | undefined): node is RotoNode => node?.type === NodeType.ROTO;

const normalizeRotoPoints = (points: unknown, frame: number): RotoPath['points'] | null => {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  return points.map((point) => {
    const entry = toRecord(point) as RotoPointInput;
    return {
      x: [{ frame, value: toFiniteNumber(entry.x, 0) }],
      y: [{ frame, value: toFiniteNumber(entry.y, 0) }],
    };
  });
};

const normalizeRotoShapeType = (value: unknown): RotoShapeType =>
  value === RotoShapeType.POLYGON ? RotoShapeType.POLYGON : RotoShapeType.BSPLINE;

const normalizeRotoBlend = (value: unknown): RotoPathBlend =>
  value === RotoPathBlend.SUBTRACT ? RotoPathBlend.SUBTRACT : RotoPathBlend.ADD;

const applyRotoCommand = (
  node: RotoNode,
  command: Record<string, unknown>,
  frame: number,
): { node: RotoNode; summary: Record<string, unknown> } | null => {
  const commandType = toStringValue(command.type) as RotoCommandType | null;
  if (commandType === 'create-path') {
    const points = normalizeRotoPoints(command.points, frame);
    if (!points) {
      return null;
    }

    const pathId = toStringValue(command.pathId) ?? createRotoPathId(node.paths);
    if (node.paths.some((path) => path.id === pathId)) {
      return null;
    }

    const path: RotoPath = {
      id: pathId,
      name: toStringValue(command.name) ?? `Shape ${node.paths.length + 1}`,
      parentLayerId: toStringValue(command.parentLayerId),
      shapeType: normalizeRotoShapeType(command.shapeType),
      points,
      pointTypes: points.map(() => 'corner'),
      closed: typeof command.closed === 'boolean' ? command.closed : true,
      feather: clamp(toFiniteNumber(command.feather, 0), 0, 500),
      opacity: clamp(toFiniteNumber(command.opacity, 100), 0, 100),
      blend: normalizeRotoBlend(command.blend),
      style: {
        mode: RotoDrawMode.FILL,
        strokeWidth: clamp(toFiniteNumber(command.strokeWidth, 2), 0, 500),
      },
    };

    return {
      node: {
        ...node,
        paths: [path, ...node.paths],
      },
      summary: {
        status: 'created_path',
        pathId,
        pointCount: points.length,
      },
    };
  }

  const pathId = toStringValue(command.pathId);
  const pathIndex = pathId ? node.paths.findIndex((path) => path.id === pathId) : -1;
  if (pathIndex === -1) {
    return null;
  }

  const path = node.paths[pathIndex];
  const nextPaths = [...node.paths];

  if (commandType === 'move-point') {
    const pointIndex = Math.floor(toFiniteNumber(command.pointIndex, -1));
    const point = path.points[pointIndex];
    if (!point) {
      return null;
    }
    const nextPoint = toRecord(command.point);
    const nextX = toFiniteNumber(nextPoint.x, NaN);
    const nextY = toFiniteNumber(nextPoint.y, NaN);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
      return null;
    }

    const nextPoints = [...path.points];
    nextPoints[pointIndex] = {
      x: setKeyframeOnValue(point.x, frame, nextX),
      y: setKeyframeOnValue(point.y, frame, nextY),
    };
    nextPaths[pathIndex] = { ...path, points: nextPoints };
    return {
      node: { ...node, paths: nextPaths },
      summary: { status: 'moved_point', pathId, pointIndex, frame },
    };
  }

  if (commandType === 'set-feather') {
    const feather = clamp(toFiniteNumber(command.feather, NaN), 0, 500);
    if (!Number.isFinite(feather)) {
      return null;
    }
    nextPaths[pathIndex] = {
      ...path,
      feather: setKeyframeOnValue(path.feather, frame, feather),
    };
    return {
      node: { ...node, paths: nextPaths },
      summary: { status: 'set_feather', pathId, feather, frame },
    };
  }

  if (commandType === 'set-opacity') {
    const opacity = clamp(toFiniteNumber(command.opacity, NaN), 0, 100);
    if (!Number.isFinite(opacity)) {
      return null;
    }
    nextPaths[pathIndex] = {
      ...path,
      opacity: setKeyframeOnValue(path.opacity, frame, opacity),
    };
    return {
      node: { ...node, paths: nextPaths },
      summary: { status: 'set_opacity', pathId, opacity, frame },
    };
  }

  if (commandType === 'set-blend') {
    const blend = normalizeRotoBlend(command.blend);
    nextPaths[pathIndex] = { ...path, blend };
    return {
      node: { ...node, paths: nextPaths },
      summary: { status: 'set_blend', pathId, blend },
    };
  }

  return null;
};

const runRotoCommandTool = (deps: AgentProjectToolDeps): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'run_roto_command',
      description: 'Run deterministic roto edit commands against the active isolated agent branch.',
      parameters: {
        type: 'object',
        required: ['nodeId', 'command'],
        properties: {
          nodeId: { type: 'string' },
          command: { type: 'object' },
        },
      },
    },
  },
  run: (args) => {
    const state = deps.getState() as AgentEditorState;
    if (!getActiveAgentBranch(state)) {
      return blockedOutsideAgentBranch();
    }

    const nodeId = toStringValue(args.nodeId);
    const node = nodeId ? state.nodes.find((entry) => entry.id === nodeId) : undefined;
    if (!nodeId || !isRotoNode(node)) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'run_roto_command requires a valid Roto nodeId.',
        }),
        artifact: null,
      };
    }

    const result = applyRotoCommand(node, toRecord(args.command), state.currentFrame ?? 0);
    if (!result) {
      return {
        content: JSON.stringify({
          status: 'error',
          message: 'Invalid or unsupported roto command.',
        }),
        artifact: null,
      };
    }

    const nextNodes = state.nodes.map((entry) => (entry.id === nodeId ? result.node : entry));
    const nextHierarchySelections = {
      ...state.hierarchySelections,
      [nodeId]: {
        layerIds: [],
        itemIds:
          typeof result.summary.pathId === 'string'
            ? [result.summary.pathId]
            : (state.hierarchySelections[nodeId]?.itemIds ?? []),
      },
    };
    deps.commitMutation({
      patch: {
        nodes: nextNodes,
        selectedNodeId: nodeId,
        hierarchySelections: nextHierarchySelections,
        activeTab: EditorTab.Flow,
      },
      history: {
        label: `Agent Roto ${String(result.summary.status ?? 'Command')}`,
        state: {
          nodes: nextNodes,
          selectedNodeId: nodeId,
          hierarchySelections: nextHierarchySelections,
        },
      },
    });

    return {
      content: JSON.stringify({
        ...result.summary,
        nodeId,
      }),
      artifact: null,
    };
  },
});

const getAvailableNodeTypesTool = (): AiToolHandler<null> => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'get_available_node_types',
      description:
        'List every registered node type that the agent can create, with name, description, category, and render mode.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  run: () => {
    const entries: Array<{
      type: string;
      name: string;
      description?: string;
      category: string;
      renderMode: string;
    }> = [];

    for (const [type, definition] of nodeRegistry) {
      if (NON_AGENT_CREATABLE_NODE_TYPES.has(type)) continue;
      entries.push({
        type,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        renderMode: definition.renderMode,
      });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    return {
      content: JSON.stringify(entries),
      artifact: null,
    };
  },
});

export const createAgentProjectToolHandlers = (
  deps: AgentProjectToolDeps,
): AiToolHandler<null>[] => [
  assignSubagentTaskTool(deps),
  runAgentReviewTool(deps),
  recordAgentHandoffTool(deps),
  recordAgentPlanTool(deps),
  askUserQuestionsTool(deps),
  getAvailableNodeTypesTool(),
  createNodeTool(deps),
  updateNodePropsTool(deps),
  connectNodesTool(deps),
  runRotoCommandTool(deps),
];
