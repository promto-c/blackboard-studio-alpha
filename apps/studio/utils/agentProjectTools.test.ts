import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Type: {
    ARRAY: 'array',
    BOOLEAN: 'boolean',
    INTEGER: 'integer',
    NUMBER: 'number',
    OBJECT: 'object',
    STRING: 'string',
  },
}));

import {
  EditorTab,
  NodeType,
  type AnyNode,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import type { EditorState } from '@/state/editor/slices/types';
import { MAIN_PROJECT_BRANCH_ID, type ProjectBranchRecord } from '@/state/projectBranches';
import { createAgentProjectToolHandlers } from './agentProjectTools';
import type { AiToolExecutionResult, AiToolHandler } from './agentToolRegistry';

type SyncTestTool = Omit<AiToolHandler<null>, 'run'> & {
  run: (args: Record<string, unknown>) => AiToolExecutionResult<null>;
};

const createAgentBranch = (): ProjectBranchRecord => ({
  id: 'agent-branch-1',
  projectId: 'project-1',
  name: 'agent/test',
  kind: 'agent',
  status: 'active',
  parentBranchId: MAIN_PROJECT_BRANCH_ID,
  createdAt: 1,
  updatedAt: 1,
});

const sceneNode: SceneNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 120,
  fps: 24,
};

const imageNode = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.MEDIA_SOURCE,
    name: id,
    enabled: true,
    mediaKind: 'image',
    src: '',
  }) as AnyNode;

const rotoNode: RotoNode = {
  id: 'roto',
  type: NodeType.ROTO,
  name: 'Roto',
  enabled: true,
  paths: [],
  layers: [],
  invert: false,
};

const createState = (branch: ProjectBranchRecord | null = createAgentBranch()): EditorState => {
  const nodes = [sceneNode, imageNode('plate'), rotoNode];
  return {
    projectId: 'project-1',
    activeProjectBranchId: branch?.id ?? MAIN_PROJECT_BRANCH_ID,
    projectBranches: branch
      ? [
          {
            id: MAIN_PROJECT_BRANCH_ID,
            projectId: 'project-1',
            name: 'main',
            kind: 'main',
            status: 'active',
            createdAt: 0,
            updatedAt: 0,
          },
          branch,
        ]
      : [],
    flows: { [ROOT_FLOW_ID]: buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow') },
    rootFlowId: ROOT_FLOW_ID,
    activeFlowId: ROOT_FLOW_ID,
    nodes,
    selectedNodeId: 'plate',
    selectedNodeIds: ['plate'],
    activeTab: EditorTab.Flow,
    aiAgentRuns: [
      {
        id: 'agent-run-1',
        title: 'Agent task',
        prompt: 'Do the task',
        status: 'triaging',
        settings: {
          enabled: true,
          sandboxMode: 'project-branch',
          planMode: 'auto',
          reviewRender: true,
          selfReview: true,
          allowNodeCreation: true,
          allowInteractiveNodeEditing: true,
          reusableToolSurface: 'mcp-or-app-tool',
          ambiguity: {
            askUser: true,
            fallbackAction: 'pause',
          },
        },
        steps: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeAiAgentRunId: 'agent-run-1',
    history: [],
    historyIndex: 0,
    maxFrames: 120,
  } as unknown as EditorState;
};

const createHarness = (
  initialState = createState(),
  options: {
    maxSubagentSpawns?: number;
    runSubagentTask?: Parameters<typeof createAgentProjectToolHandlers>[0]['runSubagentTask'];
  } = {},
) => {
  let state = initialState;
  const pushHistory = vi.fn();
  const debouncedSave = vi.fn();
  const commitMutation: (...args: unknown[]) => void = (input) => {
    const mutation =
      typeof input === 'function'
        ? input(state)
        : (input as {
            patch: Record<string, unknown>;
            history?: { label: string; state: Record<string, unknown> };
            persist?: string;
          });
    const patch = mutation.patch;
    state = { ...state, ...patch };
    if ('nodes' in patch) {
      const flowId = state.activeFlowId ?? state.rootFlowId ?? ROOT_FLOW_ID;
      state = {
        ...state,
        flows: {
          ...state.flows,
          [flowId]: buildFlowFromNodes(state.nodes, flowId, 'Root Flow'),
        },
      };
    }
    if (mutation.history) {
      pushHistory({
        label: mutation.history.label,
        state: mutation.history.state,
      });
    }
    if (mutation.persist === 'debounced') {
      debouncedSave();
    }
  };
  const handlers = createAgentProjectToolHandlers({
    commitMutation,
    getState: () => state,
    setState: (updater) => {
      const patch = updater(state);
      state = { ...state, ...patch };
      if ('nodes' in patch) {
        const flowId = state.activeFlowId ?? state.rootFlowId ?? ROOT_FLOW_ID;
        state = {
          ...state,
          flows: {
            ...state.flows,
            [flowId]: buildFlowFromNodes(state.nodes, flowId, 'Root Flow'),
          },
        };
      }
    },
    debouncedSave,
    maxSubagentSpawns: options.maxSubagentSpawns,
    runSubagentTask: options.runSubagentTask,
  });
  const getTool = (name: string) => {
    const tool = handlers.find((handler) => handler.schema.function.name === name);
    if (!tool) throw new Error(`Missing ${name}`);
    return tool as SyncTestTool;
  };
  return { getState: () => state, getTool, pushHistory, debouncedSave };
};

describe('agentProjectTools', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
  });

  it('creates and updates nodes only on an active agent branch', () => {
    const harness = createHarness();
    const createResult = harness.getTool('create_node').run({
      type: NodeType.GRADE,
      name: 'Agent Look',
      props: { id: 'ignored', grade: { brightness: 0.2, contrast: 1.1, saturation: 1 } },
    });

    expect(JSON.parse(createResult.content).status).toBe('created');
    const createdNode = harness.getState().nodes.find((node) => node.name === 'Agent Look');
    expect(createdNode?.type).toBe(NodeType.GRADE);
    expect(createdNode?.id).not.toBe('ignored');

    const updateResult = harness.getTool('update_node_props').run({
      nodeId: createdNode!.id,
      props: { name: 'Agent Look Updated', type: NodeType.SCENE },
    });

    expect(JSON.parse(updateResult.content).status).toBe('updated');
    const updatedNode = harness.getState().nodes.find((node) => node.id === createdNode!.id);
    expect(updatedNode?.name).toBe('Agent Look Updated');
    expect(updatedNode?.type).toBe(NodeType.GRADE);
    expect(harness.pushHistory).toHaveBeenCalledTimes(2);
  });

  it('connects nodes through the persisted flow graph', () => {
    const harness = createHarness();
    const createResult = harness.getTool('create_node').run({ type: NodeType.GRADE });
    const createdNodeId = JSON.parse(createResult.content).nodeId;

    const connectResult = harness.getTool('connect_nodes').run({
      sourceNodeId: 'plate',
      targetNodeId: createdNodeId,
      targetPort: 'pipe',
    });

    expect(JSON.parse(connectResult.content).status).toBe('connected');
    expect(harness.getState().flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'plate',
        targetNodeId: createdNodeId,
        targetPort: 'pipe',
      }),
    );
  });

  it('lists available node types sorted by name, excluding non-creatable types', () => {
    const harness = createHarness();
    const result = harness.getTool('get_available_node_types').run({});

    const payload = JSON.parse(result.content);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBeGreaterThan(0);

    const types = new Set(payload.map((entry: { type: string }) => entry.type));
    expect(types.has(NodeType.SCENE)).toBe(false);
    expect(types.has(NodeType.OUTPUT)).toBe(false);
    expect(types.has(NodeType.INPUT)).toBe(false);
    expect(types.has(NodeType.GROUP)).toBe(false);
    expect(types.has(NodeType.GRADE)).toBe(true);

    for (const entry of payload) {
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('category');
      expect(entry).toHaveProperty('renderMode');
    }

    const names = payload.map((entry: { name: string }) => entry.name);
    const sorted = [...names].sort((a: string, b: string) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('records adaptive plan and question events on the active agent run', () => {
    const harness = createHarness();
    const planResult = harness.getTool('record_agent_plan').run({
      items: ['Inspect current stack', 'Create grade node'],
    });
    const questionResult = harness.getTool('ask_user_questions').run({
      questions: [
        {
          prompt: 'Which branch should receive the final change?',
          choices: [{ id: 'parent', label: 'Parent branch', recommended: true }],
          blocks: 'merge',
        },
      ],
    });

    expect(JSON.parse(planResult.content).status).toBe('recorded');
    expect(JSON.parse(questionResult.content).status).toBe('asked');
    const run = harness.getState().aiAgentRuns[0];
    expect(run.planMode).toBe('explicit');
    expect(run.status).toBe('asking');
    expect(run.steps.map((step) => step.kind)).toEqual(['plan', 'plan', 'question']);
    expect(run.steps[2].questions?.[0]).toMatchObject({
      prompt: 'Which branch should receive the final change?',
      blocks: 'merge',
    });
  });

  it('records delegation and review events on the active agent run', () => {
    const harness = createHarness();
    const delegationResult = harness.getTool('assign_subagent_task').run({
      assignee: 'visual-review',
      task: 'Check the before/after preview for obvious regressions.',
      status: 'complete',
      result: 'No obvious regressions.',
    });
    const reviewResult = harness.getTool('run_agent_review').run({
      summary: 'Preview is acceptable.',
      passed: true,
      findings: [
        {
          severity: 'info',
          title: 'Preview checked',
          description: 'The grade node is visible and the stack remains connected.',
        },
      ],
    });

    expect(JSON.parse(delegationResult.content).status).toBe('complete');
    expect(JSON.parse(reviewResult.content).status).toBe('passed');
    const run = harness.getState().aiAgentRuns[0];
    expect(run.status).toBe('ready');
    expect(run.recommendedNextAction).toBe('manual-review');
    expect(run.steps.map((step) => step.kind)).toEqual(['delegation', 'review']);
    expect(run.steps[0].delegation).toMatchObject({
      assignee: 'visual-review',
      status: 'complete',
    });
    expect(run.steps[1].reviewFindings?.[0]).toMatchObject({
      severity: 'info',
      title: 'Preview checked',
    });
  });

  it('enforces the configured sub-agent spawn limit per active run', () => {
    const harness = createHarness(createState(), { maxSubagentSpawns: 1 });
    const firstResult = harness.getTool('assign_subagent_task').run({
      id: 'review-pass',
      assignee: 'visual-review',
      task: 'Check the preview.',
      status: 'assigned',
    });
    const blockedResult = harness.getTool('assign_subagent_task').run({
      id: 'code-review',
      assignee: 'code-review',
      task: 'Inspect node graph changes.',
      status: 'assigned',
    });
    const completeResult = harness.getTool('assign_subagent_task').run({
      id: 'review-pass',
      assignee: 'visual-review',
      task: 'Check the preview.',
      status: 'complete',
      result: 'Preview passed.',
    });
    const nextResult = harness.getTool('assign_subagent_task').run({
      id: 'code-review',
      assignee: 'code-review',
      task: 'Inspect node graph changes.',
      status: 'assigned',
    });

    expect(JSON.parse(firstResult.content).status).toBe('assigned');
    expect(JSON.parse(blockedResult.content)).toMatchObject({
      status: 'blocked',
      maxSubagentSpawns: 1,
    });
    expect(JSON.parse(completeResult.content).status).toBe('complete');
    expect(JSON.parse(nextResult.content).status).toBe('assigned');
    expect(harness.getState().aiAgentRuns[0].steps.map((step) => step.delegation?.id)).toEqual([
      'review-pass',
      'review-pass',
      'code-review',
    ]);
  });

  it('allows preferences to disable sub-agent delegation', () => {
    const harness = createHarness(createState(), { maxSubagentSpawns: 0 });
    const result = harness.getTool('assign_subagent_task').run({
      assignee: 'visual-review',
      task: 'Check the preview.',
      status: 'assigned',
    });

    expect(JSON.parse(result.content)).toMatchObject({
      status: 'blocked',
      message: 'Sub-agent delegation is disabled by preferences.',
      maxSubagentSpawns: 0,
    });
    expect(harness.getState().aiAgentRuns[0].steps).toHaveLength(0);
  });

  it('runs an assigned sub-agent task when an executor is available', async () => {
    const runSubagentTask = vi.fn(async () => ({
      status: 'complete' as const,
      result: 'The delegated review passed.',
    }));
    const harness = createHarness(createState(), {
      maxSubagentSpawns: 1,
      runSubagentTask,
    });
    const result = await Promise.resolve(
      harness.getTool('assign_subagent_task').run({
        id: 'visual-review',
        assignee: 'visual-review',
        task: 'Check the preview.',
        status: 'assigned',
      }),
    );

    expect(runSubagentTask).toHaveBeenCalledWith({
      runId: 'agent-run-1',
      delegation: expect.objectContaining({
        id: 'visual-review',
        assignee: 'visual-review',
        task: 'Check the preview.',
        status: 'assigned',
      }),
    });
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'complete',
      result: 'The delegated review passed.',
    });
    expect(harness.getState().aiAgentRuns[0].steps.map((step) => step.delegation?.status)).toEqual([
      'assigned',
      'complete',
    ]);
  });

  it('records final handoff recommendations with remaining risks', () => {
    const harness = createHarness();
    const result = harness.getTool('record_agent_handoff').run({
      summary: 'Ready to apply the agent branch.',
      recommendedNextAction: 'apply',
      risks: ['Preview was not checked on mobile viewport.'],
    });

    expect(JSON.parse(result.content)).toMatchObject({
      status: 'recorded',
      recommendedNextAction: 'apply',
      riskCount: 1,
    });
    const run = harness.getState().aiAgentRuns[0];
    expect(run.status).toBe('ready');
    expect(run.recommendedNextAction).toBe('apply');
    expect(run.steps[0]).toMatchObject({
      kind: 'handoff',
      title: 'Ready to apply the agent branch.',
      status: 'complete',
    });
    expect(run.steps[0].reviewFindings?.[0]).toMatchObject({
      severity: 'warning',
      title: 'Preview was not checked on mobile viewport.',
    });
  });

  it('blocks mutation when the active branch is not an agent branch', () => {
    const harness = createHarness(createState(null));
    const result = harness.getTool('create_node').run({ type: NodeType.GRADE });

    expect(JSON.parse(result.content).status).toBe('blocked');
    expect(harness.getState().nodes).toHaveLength(3);
  });

  it('blocks mutation after the user takes ownership of an agent branch', () => {
    const harness = createHarness(
      createState({
        ...createAgentBranch(),
        workingOwnerType: 'user',
        defaultUserAccess: 'editor',
      }),
    );
    const result = harness.getTool('create_node').run({ type: NodeType.GRADE });

    expect(JSON.parse(result.content).status).toBe('blocked');
    expect(harness.getState().nodes).toHaveLength(3);
  });

  it('runs deterministic roto commands on the agent branch', () => {
    const harness = createHarness();
    const createResult = harness.getTool('run_roto_command').run({
      nodeId: 'roto',
      command: {
        type: 'create-path',
        name: 'Agent Mask',
        points: [
          { x: 10, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 90 },
        ],
      },
    });
    const createPayload = JSON.parse(createResult.content);

    expect(createPayload.status).toBe('created_path');
    const createdPathId = createPayload.pathId;
    const afterCreate = harness.getState().nodes.find((node) => node.id === 'roto') as RotoNode;
    expect(afterCreate.paths[0].name).toBe('Agent Mask');
    expect(harness.getState().hierarchySelections['roto']?.itemIds).toEqual([createdPathId]);

    const moveResult = harness.getTool('run_roto_command').run({
      nodeId: 'roto',
      command: {
        type: 'move-point',
        pathId: createdPathId,
        pointIndex: 1,
        point: { x: 100, y: 50 },
      },
    });

    expect(JSON.parse(moveResult.content).status).toBe('moved_point');
    const afterMove = harness.getState().nodes.find((node) => node.id === 'roto') as RotoNode;
    expect(afterMove.paths[0].points[1].x).toEqual([
      expect.objectContaining({ frame: 0, value: 100 }),
    ]);
    expect(afterMove.paths[0].points[1].y).toEqual([
      expect.objectContaining({ frame: 0, value: 50 }),
    ]);
  });
});
