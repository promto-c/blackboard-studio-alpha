import { AnyNode, GradeNode, NodeType } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { canExecuteAiTool, type AiToolPermission } from './aiToolPermissions';

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

export interface AiToolExecutionResult {
  content: string;
  artifact?: {
    type: 'grade-preview';
    values: {
      brightness: number;
      contrast: number;
      saturation: number;
    };
    summary?: string;
  } | null;
}

export interface AiNodeToolContext {
  node: AnyNode;
  currentFrame: number;
  setGradePreview: (
    preview: {
      values: {
        brightness: number;
        contrast: number;
        saturation: number;
      };
      summary?: string;
    } | null,
  ) => void;
  getGradePreview: () => {
    values: {
      brightness: number;
      contrast: number;
      saturation: number;
    };
    summary?: string;
  } | null;
}

export interface AiNodeToolDefinition {
  schema: AiToolSchema;
  permission: AiToolPermission;
  execute: (args: Record<string, unknown>, context: AiNodeToolContext) => AiToolExecutionResult;
}

export interface AiNodeToolHandler {
  schema: AiToolSchema;
  permission: AiToolPermission;
  run: (args: Record<string, unknown>) => AiToolExecutionResult;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getGradePreviewSummary = (
  currentValues: { brightness: number; contrast: number; saturation: number },
  nextValues: { brightness: number; contrast: number; saturation: number },
  reason?: string,
) =>
  [
    `Preview staged for Grade.`,
    `Brightness ${currentValues.brightness} -> ${nextValues.brightness}.`,
    `Contrast ${currentValues.contrast} -> ${nextValues.contrast}.`,
    `Saturation ${currentValues.saturation} -> ${nextValues.saturation}.`,
    reason?.trim() ? `Reason: ${reason.trim()}` : null,
  ]
    .filter(Boolean)
    .join(' ');

const createGradeTools = (node: GradeNode): AiNodeToolDefinition[] => [
  {
    permission: 'safe',
    schema: {
      type: 'function',
      function: {
        name: 'get_grade_state',
        description:
          'Read the current Grade node values so the assistant can reason about brightness, contrast, and saturation.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    execute: (_args, _context) => ({
      content: JSON.stringify({
        nodeId: node.id,
        nodeName: node.name,
        brightness: getValueAtFrame(node.grade.brightness, _context.currentFrame),
        contrast: getValueAtFrame(node.grade.contrast, _context.currentFrame),
        saturation: getValueAtFrame(node.grade.saturation, _context.currentFrame),
        ranges: {
          brightness: { min: -1, max: 1 },
          contrast: { min: 0, max: 2 },
          saturation: { min: 0, max: 2 },
        },
      }),
    }),
  },
  {
    permission: 'safe',
    schema: {
      type: 'function',
      function: {
        name: 'preview_grade_adjustment',
        description:
          'Stage a Grade node candidate adjustment for user review before anything is applied to the project.',
        parameters: {
          type: 'object',
          properties: {
            brightness: {
              type: 'number',
              description: 'Preview brightness value between -1 and 1.',
            },
            contrast: {
              type: 'number',
              description: 'Preview contrast value between 0 and 2.',
            },
            saturation: {
              type: 'number',
              description: 'Preview saturation value between 0 and 2.',
            },
            reason: {
              type: 'string',
              description: 'Short explanation of why this candidate was chosen.',
            },
          },
        },
      },
    },
    execute: (args, context) => {
      const currentValues = {
        brightness: getValueAtFrame(node.grade.brightness, context.currentFrame),
        contrast: getValueAtFrame(node.grade.contrast, context.currentFrame),
        saturation: getValueAtFrame(node.grade.saturation, context.currentFrame),
      };
      const nextValues = {
        brightness: clamp(toFiniteNumber(args.brightness, currentValues.brightness), -1, 1),
        contrast: clamp(toFiniteNumber(args.contrast, currentValues.contrast), 0, 2),
        saturation: clamp(toFiniteNumber(args.saturation, currentValues.saturation), 0, 2),
      };
      const summary = getGradePreviewSummary(
        currentValues,
        nextValues,
        typeof args.reason === 'string' ? args.reason : undefined,
      );

      context.setGradePreview({
        values: nextValues,
        summary,
      });

      return {
        content: JSON.stringify({
          status: 'preview_staged',
          ...nextValues,
          summary,
        }),
        artifact: {
          type: 'grade-preview',
          values: nextValues,
          summary,
        },
      };
    },
  },
  {
    permission: 'safe',
    schema: {
      type: 'function',
      function: {
        name: 'clear_grade_preview',
        description: 'Clear the staged Grade node preview without applying it.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    execute: (_args, context) => {
      context.setGradePreview(null);
      return {
        content: JSON.stringify({
          status: 'preview_cleared',
        }),
        artifact: null,
      };
    },
  },
  {
    permission: 'confirm',
    schema: {
      type: 'function',
      function: {
        name: 'commit_grade_adjustment',
        description: 'Commit the staged Grade node preview after the user explicitly confirms it.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    execute: (_args, context) => {
      const preview = context.getGradePreview();
      return {
        content: JSON.stringify({
          status: preview ? 'confirmation_required' : 'no_preview_available',
          message: preview
            ? 'A staged preview exists, but committing it requires explicit user confirmation.'
            : 'No staged Grade preview is available to commit.',
        }),
      };
    },
  },
];

export const supportsAiNodeTools = (node: AnyNode | null | undefined) =>
  Boolean(node && node.type === NodeType.GRADE);

export const createAiNodeToolHandlers = (
  node: AnyNode | null | undefined,
  context: AiNodeToolContext,
): AiNodeToolHandler[] => {
  if (!node) {
    return [];
  }

  const definitions = node.type === NodeType.GRADE ? createGradeTools(node as GradeNode) : [];

  return definitions.map((definition) => ({
    schema: definition.schema,
    permission: definition.permission,
    run: (args) => {
      if (!canExecuteAiTool(definition.permission)) {
        return {
          content: JSON.stringify({
            status: definition.permission === 'confirm' ? 'confirmation_required' : 'blocked',
            tool: definition.schema.function.name,
          }),
        };
      }

      return definition.execute(args, context);
    },
  }));
};
