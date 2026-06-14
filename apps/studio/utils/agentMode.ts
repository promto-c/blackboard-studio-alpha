import type { AiAgentModeSettings } from '@blackboard/types';
import { getAvailableAgentToolCapabilities } from './agentToolRegistry';

export const DEFAULT_AGENT_MODE_SETTINGS: AiAgentModeSettings = {
  enabled: true,
  sandboxMode: 'project-branch',
  planMode: 'auto',
  reviewRender: true,
  selfReview: true,
  maxSubagentSpawns: 2,
  allowNodeCreation: true,
  allowInteractiveNodeEditing: true,
  reusableToolSurface: 'mcp-or-app-tool',
  ambiguity: {
    askUser: true,
    fallbackAction: 'use-recommended',
    fallbackTimeoutMs: 45000,
  },
};

export const getAgentModeCapabilitySummary = (settings: AiAgentModeSettings) => {
  const sandboxLabel =
    settings.sandboxMode === 'project-branch'
      ? 'work in an isolated project branch'
      : 'work in an isolated snapshot';
  const reviewLabel = settings.reviewRender
    ? 'review render previews before apply'
    : 'skip render preview review';
  const fallbackLabel =
    settings.ambiguity.fallbackAction === 'use-recommended'
      ? 'use the recommended action after timeout'
      : 'pause when the user does not respond';
  const subagentLabel =
    (settings.maxSubagentSpawns ?? 0) > 0
      ? `up to ${settings.maxSubagentSpawns} active sub-agent tasks`
      : 'no sub-agent delegation';

  return `${sandboxLabel}, ${reviewLabel}, ${fallbackLabel}, ${subagentLabel}`;
};

export const buildAgentModePromptSection = (settings: AiAgentModeSettings | false | undefined) => {
  if (!settings || !settings.enabled) {
    return '';
  }

  const fallbackInstruction =
    settings.ambiguity.fallbackAction === 'use-recommended'
      ? `If the user does not respond within ${Math.round(
          (settings.ambiguity.fallbackTimeoutMs ?? 0) / 1000,
        )} seconds, choose the safest recommended action and state that assumption.`
      : 'If the user does not respond, pause and state what input is needed.';
  const availableTools = getAvailableAgentToolCapabilities()
    .map((tool) => `- ${tool.name}: ${tool.description} Permission: ${tool.permission}.`)
    .join('\n');

  return `Agent Mode is enabled for this request.

Agent Mode contract:
- You decide the workflow shape. Answer directly for informational or tiny reversible requests; plan
  only when planning adds value for risk, ambiguity, multiple steps, tool orchestration, review, or
  branch operations.
- Ask concise questions when the next action is ambiguous, destructive, expensive, or likely to
  change creative direction. Ask multiple independent questions together when they can be answered
  concurrently.
- Treat the work as branch/snapshot scoped: ${
    settings.sandboxMode === 'project-branch'
      ? 'make changes only on an agent project branch after the app confirms one exists'
      : 'make changes only on a disposable snapshot when snapshot tools exist'
  }.
- Do not ask to create an empty branch just because Agent Mode is enabled. First explain the concrete edit you intend to make. Only request a branch when you are ready to execute specific node/graph/render changes.
- If no app/tool message confirms a branch, describe the plan and do not claim branch work started.
- When you genuinely need the app to create a branch before executing a concrete change, include the exact marker ${'`[agent-branch-request]`'} once in that assistant message. Do not include this marker for general planning or questions.
- Ask the user when the assignment is ambiguous and the choice could meaningfully change the result. ${fallbackInstruction}
- Prefer reusable app/MCP tool surfaces over one-off hidden capabilities.
- You may assign at most ${settings.maxSubagentSpawns ?? 0} concurrent sub-agent task${
    (settings.maxSubagentSpawns ?? 0) === 1 ? '' : 's'
  } for this run; 0 means do not delegate.
- You may propose creating nodes, editing node settings, or using interactive tools such as roto only when the app exposes those tools.
- Decide whether render review, snapshot compare, semantic review, or a bounded self-fix loop is warranted based on task risk and available artifacts.
- Review rendered or visual results when the app provides a snapshot/render preview and the change affects visual output. If the model has vision and preview imagery is attached, critique the result and self-correct before asking the user to apply it.
- Never claim that you created a branch, changed nodes, interacted with roto, rendered a preview, merged, or applied changes unless a tool or the app explicitly confirms it.
- When you believe the task is done, state what passed, any remaining risk, and recommend the next user action such as apply, cherry-pick, continue on branch, discard, or manual review. Present proposed branch changes as reviewable suggestions until the app provides explicit apply/merge confirmation.

Available reusable app/MCP-style tools:
${availableTools || '(none registered yet)'}`;
};
