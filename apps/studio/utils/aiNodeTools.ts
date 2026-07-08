import { AiChatGradePreviewArtifact, AnyNode, GradeNode, NodeType } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import type { AiToolPermission } from './aiToolPermissions';
import type { AiToolExecutionResult, AiToolHandler, AiToolSchema } from './agentToolRegistry';

interface AiNodeToolContext {
  node: AnyNode;
  currentFrame: number;
  setGradePreview: (
    preview: {
      values: {
        exposure: number;
        contrast: number;
        saturation: number;
      };
      summary?: string;
    } | null,
  ) => void;
  getGradePreview: () => {
    values: {
      exposure: number;
      contrast: number;
      saturation: number;
    };
    summary?: string;
  } | null;
}

interface AiNodeToolDefinition {
  schema: AiToolSchema;
  permission: AiToolPermission;
  execute: (
    args: Record<string, unknown>,
    context: AiNodeToolContext,
  ) => AiToolExecutionResult<AiChatGradePreviewArtifact | null>;
}

type AiNodeToolHandler = AiToolHandler<AiChatGradePreviewArtifact | null>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getGradePreviewSummary = (
  currentValues: { exposure: number; contrast: number; saturation: number },
  nextValues: { exposure: number; contrast: number; saturation: number },
  reason?: string,
) =>
  [
    `Preview staged for Grade.`,
    `Exposure ${currentValues.exposure} -> ${nextValues.exposure} stops.`,
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
          'Read the current Grade node values so the assistant can reason about exposure, contrast, and saturation.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    execute: (_args, context) => ({
      content: JSON.stringify({
        nodeId: node.id,
        nodeName: node.name,
        exposure: getValueAtFrame(node.grade.exposure, context.currentFrame),
        contrast: getValueAtFrame(node.grade.contrast, context.currentFrame),
        saturation: getValueAtFrame(node.grade.saturation, context.currentFrame),
        ranges: {
          exposure: { min: -10, max: 10 },
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
            exposure: {
              type: 'number',
              description: 'Preview exposure in stops between -10 and 10.',
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
        exposure: getValueAtFrame(node.grade.exposure, context.currentFrame),
        contrast: getValueAtFrame(node.grade.contrast, context.currentFrame),
        saturation: getValueAtFrame(node.grade.saturation, context.currentFrame),
      };
      const nextValues = {
        exposure: clamp(toFiniteNumber(args.exposure, currentValues.exposure), -10, 10),
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
      if (definition.permission !== 'safe') {
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
