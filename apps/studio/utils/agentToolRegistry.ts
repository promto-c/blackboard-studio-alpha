import type { AiChatArtifact } from '@blackboard/types';
import type { AiToolPermission } from './aiToolPermissions';

export interface AiToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      required?: string[];
      properties: Record<string, unknown>;
    };
  };
}

export interface AiToolExecutionResult<TArtifact = AiChatArtifact | null> {
  content: string;
  artifact?: TArtifact;
}

type AiToolExecutionMaybePromise<TArtifact = AiChatArtifact | null> =
  | AiToolExecutionResult<TArtifact>
  | Promise<AiToolExecutionResult<TArtifact>>;

export interface AiToolHandler<TArtifact = AiChatArtifact | null> {
  schema: AiToolSchema;
  permission: AiToolPermission;
  run: (args: Record<string, unknown>) => AiToolExecutionMaybePromise<TArtifact>;
}

type AgentToolCategory = 'branch' | 'node' | 'render' | 'review' | 'run';
type AgentToolAvailability = 'available' | 'planned';

interface AgentToolCapability {
  name: string;
  title: string;
  category: AgentToolCategory;
  permission: AiToolPermission;
  availability: AgentToolAvailability;
  description: string;
  parameters?: AiToolSchema['function']['parameters'];
}

const EMPTY_PARAMETERS: AiToolSchema['function']['parameters'] = {
  type: 'object',
  properties: {},
};

export const AGENT_TOOL_CAPABILITIES: AgentToolCapability[] = [
  {
    name: 'record_agent_plan',
    title: 'Record Agent Plan',
    category: 'run',
    permission: 'safe',
    availability: 'available',
    description:
      'Record an agent-authored plan only when the agent decides explicit planning is useful.',
    parameters: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          description: 'Agent-authored plan items to show as adaptive run events.',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'ask_user_questions',
    title: 'Ask User Questions',
    category: 'run',
    permission: 'safe',
    availability: 'available',
    description:
      'Ask one or more independent structured questions with choices and optional freeform input.',
    parameters: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          description: 'Independent questions to present together.',
          items: { type: 'object' },
        },
      },
    },
  },
  {
    name: 'create_project_branch',
    title: 'Create Project Branch',
    category: 'branch',
    permission: 'safe',
    availability: 'available',
    description: 'Create an isolated agent branch from the active project branch.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'Readable branch name such as agent/roto-cleanup.',
        },
      },
    },
  },
  {
    name: 'compare_agent_branch_snapshot',
    title: 'Compare Agent Branch Snapshot',
    category: 'review',
    permission: 'safe',
    availability: 'available',
    description: 'Compare the saved agent branch snapshot against its parent branch snapshot.',
    parameters: {
      type: 'object',
      required: ['branchId'],
      properties: {
        branchId: {
          type: 'string',
          description: 'Agent project branch ID to compare.',
        },
      },
    },
  },
  {
    name: 'apply_agent_branch_snapshot',
    title: 'Apply Agent Branch Snapshot',
    category: 'branch',
    permission: 'confirm',
    availability: 'available',
    description:
      'Promote the saved agent branch snapshot to its parent branch after explicit user confirmation.',
    parameters: {
      type: 'object',
      required: ['branchId'],
      properties: {
        branchId: {
          type: 'string',
          description: 'Agent project branch ID to apply.',
        },
      },
    },
  },
  {
    name: 'discard_agent_branch',
    title: 'Discard Agent Branch',
    category: 'branch',
    permission: 'confirm',
    availability: 'available',
    description: 'Delete an agent branch after explicit user confirmation.',
    parameters: {
      type: 'object',
      required: ['branchId'],
      properties: {
        branchId: {
          type: 'string',
          description: 'Agent project branch ID to discard.',
        },
      },
    },
  },
  {
    name: 'capture_render_preview',
    title: 'Capture Render Preview',
    category: 'render',
    permission: 'safe',
    availability: 'available',
    description: 'Capture a render preview asset from an agent branch or snapshot.',
    parameters: {
      type: 'object',
      properties: {
        branchId: {
          type: 'string',
          description: 'Optional agent project branch ID the preview belongs to.',
        },
        flowId: {
          type: 'string',
          description: 'Optional flow ID to render. Defaults to the active/root flow.',
        },
        nodeId: {
          type: 'string',
          description: 'Optional node ID whose canonical upstream graph branch should be rendered.',
        },
        frame: {
          type: 'number',
          description: 'Frame to capture. Defaults to the snapshot current frame.',
        },
      },
    },
  },
  {
    name: 'assign_subagent_task',
    title: 'Assign Sub-Agent Task',
    category: 'run',
    permission: 'safe',
    availability: 'available',
    description: 'Run or record a bounded independent sub-agent assignment and returned finding.',
    parameters: {
      type: 'object',
      required: ['task'],
      properties: {
        assignee: {
          type: 'string',
          description: 'Optional sub-agent or reviewer label.',
        },
        task: {
          type: 'string',
          description: 'Bounded independent task to assign or record.',
        },
        status: {
          type: 'string',
          description: 'assigned, complete, or blocked.',
        },
        result: {
          type: 'string',
          description: 'Optional returned result or finding summary.',
        },
      },
    },
  },
  {
    name: 'run_agent_review',
    title: 'Run Agent Review',
    category: 'review',
    permission: 'safe',
    availability: 'available',
    description: 'Run an agent-selected review pass and store findings as adaptive review events.',
    parameters: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: {
          type: 'string',
          description: 'Review result summary.',
        },
        findings: {
          type: 'array',
          description: 'Structured findings with severity, title, description, and recommendation.',
          items: { type: 'object' },
        },
        passed: {
          type: 'boolean',
          description: 'Whether the review passed without blocking findings.',
        },
      },
    },
  },
  {
    name: 'record_agent_handoff',
    title: 'Record Agent Handoff',
    category: 'run',
    permission: 'safe',
    availability: 'available',
    description: 'Record the final recommendation and remaining risks for user handoff.',
    parameters: {
      type: 'object',
      required: ['summary', 'recommendedNextAction'],
      properties: {
        summary: {
          type: 'string',
          description: 'What is done and why the agent is ready to hand off.',
        },
        recommendedNextAction: {
          type: 'string',
          description: 'apply, merge, cherry-pick, discard, continue, or manual-review.',
        },
        risks: {
          type: 'array',
          description: 'Remaining risks or caveats to show with the handoff.',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'get_available_node_types',
    title: 'Get Available Node Types',
    category: 'node',
    permission: 'safe',
    availability: 'available',
    description:
      'List every registered node type that the agent can create, with name, description, category, and render mode.',
  },
  {
    name: 'create_node',
    title: 'Create Node',
    category: 'node',
    permission: 'safe',
    availability: 'available',
    description: 'Create a registry-backed node in the active isolated agent branch.',
    parameters: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          description: 'Registered node type, such as grade, blur, custom_shader, or text.',
        },
        name: {
          type: 'string',
          description: 'Optional node name. Defaults to the effect registry display name.',
        },
        props: {
          type: 'object',
          description:
            'Optional JSON-compatible node props. id, type, kind, inputs, and inputSourcePorts are ignored.',
        },
        afterNodeId: {
          type: 'string',
          description: 'Optional node ID to insert after. Defaults to the selected node or end.',
        },
      },
    },
  },
  {
    name: 'update_node_props',
    title: 'Update Node Props',
    category: 'node',
    permission: 'safe',
    availability: 'available',
    description: 'Update JSON-compatible props on an existing node in the active agent branch.',
    parameters: {
      type: 'object',
      required: ['nodeId', 'props'],
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID to update.',
        },
        props: {
          type: 'object',
          description:
            'JSON-compatible props to merge into the node. id, type, kind, inputs, and inputSourcePorts are ignored.',
        },
      },
    },
  },
  {
    name: 'connect_nodes',
    title: 'Connect Nodes',
    category: 'node',
    permission: 'safe',
    availability: 'available',
    description:
      'Connect one node output to another node input using the canonical persisted flow graph.',
    parameters: {
      type: 'object',
      required: ['sourceNodeId', 'targetNodeId', 'targetPort'],
      properties: {
        sourceNodeId: {
          type: 'string',
          description: 'Source node ID.',
        },
        sourcePort: {
          type: 'string',
          description: 'Source output port. Defaults to output.',
        },
        targetNodeId: {
          type: 'string',
          description: 'Target node ID.',
        },
        targetPort: {
          type: 'string',
          description: 'Target input port, such as pipe, mask, source, or a workflow input ID.',
        },
      },
    },
  },
  {
    name: 'run_roto_command',
    title: 'Run Roto Command',
    category: 'node',
    permission: 'safe',
    availability: 'available',
    description: 'Run deterministic roto edit commands against an isolated branch or snapshot.',
    parameters: {
      type: 'object',
      required: ['nodeId', 'command'],
      properties: {
        nodeId: {
          type: 'string',
          description: 'Roto node ID to edit.',
        },
        command: {
          type: 'object',
          description:
            'Command object: create-path, move-point, set-feather, set-opacity, or set-blend.',
        },
      },
    },
  },
];

export const getAvailableAgentToolCapabilities = () =>
  AGENT_TOOL_CAPABILITIES.filter((capability) => capability.availability === 'available');

export const createAgentToolSchema = (capability: AgentToolCapability): AiToolSchema => ({
  type: 'function',
  function: {
    name: capability.name,
    description: capability.description,
    parameters: capability.parameters ?? EMPTY_PARAMETERS,
  },
});

export const createAgentMcpToolManifest = () =>
  AGENT_TOOL_CAPABILITIES.map((capability) => ({
    name: capability.name,
    title: capability.title,
    description: capability.description,
    inputSchema: capability.parameters ?? EMPTY_PARAMETERS,
    annotations: {
      category: capability.category,
      permission: capability.permission,
      availability: capability.availability,
    },
  }));
