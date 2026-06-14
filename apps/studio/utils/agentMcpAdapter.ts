import type { AiChatArtifact } from '@blackboard/types';
import {
  createAgentMcpToolManifest,
  type AiToolExecutionResult,
  type AiToolHandler,
} from './agentToolRegistry';

export interface AgentMcpToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  artifact?: AiChatArtifact | null;
  isError?: boolean;
}

interface AgentMcpAdapter {
  listTools: () => ReturnType<typeof createAgentMcpToolManifest>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<AgentMcpToolResult>;
}

const toMcpToolResult = (
  result: AiToolExecutionResult<AiChatArtifact | null>,
): AgentMcpToolResult => ({
  content: [
    {
      type: 'text',
      text: result.content,
    },
  ],
  artifact: result.artifact,
});

export const createAgentMcpAdapter = (
  handlers: AiToolHandler<AiChatArtifact | null>[],
  toolManifest = createAgentMcpToolManifest(),
): AgentMcpAdapter => {
  const handlersByName = new Map(
    handlers.map((handler) => [handler.schema.function.name, handler]),
  );

  return {
    listTools: () => toolManifest,
    callTool: async (name, args = {}) => {
      const handler = handlersByName.get(name);
      if (!handler) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: `Unknown agent tool "${name}".`,
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        return toMcpToolResult(await handler.run(args));
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  };
};
