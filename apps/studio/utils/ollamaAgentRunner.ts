import type { AiChatArtifact, AiChatAttachment } from '@blackboard/types';
import {
  getAiAttachmentImagePayloads,
  getAiAttachmentTextContext,
  readErrorResponse,
  readOllamaNdjsonStream,
} from './ai';
import type { AiToolHandler } from './agentToolRegistry';
import { publishDebugEvent } from './debugEventBus';

type OllamaMessageRole = 'user' | 'assistant' | 'tool';

interface OllamaMessage {
  role: OllamaMessageRole;
  content?: string;
  images?: string[];
  tool_name?: string;
  tool_calls?: Array<{
    function?: {
      name?: string;
      arguments?: Record<string, unknown> | string;
    };
  }>;
}

interface OllamaChatResponse {
  model?: string;
  message?: OllamaMessage & {
    thinking?: string;
  };
}

interface OllamaRunnerHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

interface RunOllamaToolAgentOptions {
  endpoint: string;
  model: string;
  prompt: string;
  contextSummary?: string;
  history?: OllamaRunnerHistoryEntry[];
  attachments?: AiChatAttachment[];
  tools: AiToolHandler[];
  maxSteps?: number;
  onStreamUpdate?: (update: OllamaToolAgentStreamUpdate) => void;
  signal?: AbortSignal;
  enableThinking?: boolean;
}

interface RunOllamaToolAgentResult {
  message: string;
  model: string;
  thinking?: string;
  artifact?: AiChatArtifact | null;
}

interface OllamaToolAgentStreamUpdate {
  stage: 'streaming' | 'tool' | 'complete';
  model: string;
  content: string;
  thinking: string;
  isThinking?: boolean;
  artifact?: AiChatArtifact | null;
}

const getOllamaApiBase = (endpoint: string): string => {
  const normalizedEndpoint = endpoint.trim().replace(/\/+$/, '');

  if (!normalizedEndpoint) {
    throw new Error('Missing Ollama endpoint. Configure it in Preferences > AI.');
  }
  if (
    normalizedEndpoint.endsWith('/api/chat') ||
    normalizedEndpoint.endsWith('/api/tags') ||
    normalizedEndpoint.endsWith('/api/show')
  ) {
    return normalizedEndpoint.replace(/\/[^/]+$/, '');
  }
  if (normalizedEndpoint.endsWith('/api')) {
    return normalizedEndpoint;
  }
  return `${normalizedEndpoint}/api`;
};

const getOllamaChatEndpoint = (endpoint: string) => `${getOllamaApiBase(endpoint)}/chat`;

const buildToolAgentPrompt = (
  prompt: string,
  options: Pick<RunOllamaToolAgentOptions, 'contextSummary' | 'history' | 'attachments'>,
) => {
  const attachmentContext = getAiAttachmentTextContext(options.attachments);
  const serializedHistory = (options.history ?? [])
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n\n');

  return `You are Blackboard Studio's assistant for safe node operations.
Use tools when you need exact node state or when you want to stage a preview for user review.

Rules:
- Never claim that you changed the project unless a tool explicitly confirms it.
- Prefer staging a preview before suggesting that anything should be applied.
- If a commit tool reports confirmation is required, ask the user to confirm instead of pretending it succeeded.
- Keep the final reply concise and practical.

Current context:
${options.contextSummary?.trim() || '(no node context attached)'}

${
  attachmentContext
    ? `Attached files:
${attachmentContext}`
    : 'Attached files: (none)'
}

${
  serializedHistory
    ? `Previous conversation:
${serializedHistory}`
    : 'Previous conversation: (none yet)'
}

Latest user request: "${prompt}"`;
};

const parseToolArguments = (value: Record<string, unknown> | string | undefined) => {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  return value;
};

type OllamaStreamToolCall = NonNullable<OllamaMessage['tool_calls']>[number];

const mergeToolArguments = (
  current: Record<string, unknown> | string | undefined,
  incoming: Record<string, unknown> | string | undefined,
): Record<string, unknown> | string | undefined => {
  if (incoming === undefined) {
    return current;
  }

  if (typeof current === 'string' || typeof incoming === 'string') {
    const currentString =
      typeof current === 'string' ? current : current ? JSON.stringify(current) : '';
    const incomingString =
      typeof incoming === 'string' ? incoming : incoming ? JSON.stringify(incoming) : '';
    return `${currentString}${incomingString}` || undefined;
  }

  return {
    ...(current ?? {}),
    ...(incoming ?? {}),
  };
};

const mergeToolCalls = (
  current: OllamaStreamToolCall[],
  incoming: OllamaStreamToolCall[] | undefined,
): OllamaStreamToolCall[] => {
  if (!incoming?.length) {
    return current;
  }

  const next = [...current];
  incoming.forEach((toolCall, index) => {
    const existing = next[index];
    if (!existing) {
      next[index] = toolCall;
      return;
    }

    next[index] = {
      ...existing,
      ...toolCall,
      function: {
        ...existing.function,
        ...toolCall.function,
        name: toolCall.function?.name || existing.function?.name,
        arguments: mergeToolArguments(existing.function?.arguments, toolCall.function?.arguments),
      },
    };
  });

  return next;
};

export async function runOllamaToolAgent(
  options: RunOllamaToolAgentOptions,
): Promise<RunOllamaToolAgentResult> {
  const toolMap = new Map(options.tools.map((tool) => [tool.schema.function.name, tool]));
  const attachedImages = getAiAttachmentImagePayloads(options.attachments);
  const messages: OllamaMessage[] = [
    {
      role: 'user',
      content: buildToolAgentPrompt(options.prompt, options),
      ...(attachedImages.length > 0 ? { images: attachedImages } : {}),
    },
  ];
  let latestArtifact: AiChatArtifact | null | undefined;
  let latestThinking = '';

  for (let step = 0; step < (options.maxSteps ?? 8); step += 1) {
    const requestBody = {
      model: options.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
        ...(msg.tool_name ? { tool_name: msg.tool_name } : {}),
        ...(msg.images ? { images: `[${msg.images.length} image(s)]` } : {}),
      })),
      tools: options.tools.map((tool) => ({ name: tool.schema.function.name })),
      stream: true,
      think: options.enableThinking ?? true,
    };

    publishDebugEvent({
      type: 'ai_request',
      source: 'runOllamaToolAgent',
      detail: `Ollama tool agent step ${step + 1} model=${options.model}`,
      data: {
        provider: 'ollama',
        model: options.model,
        step: step + 1,
        body: requestBody,
      },
    });

    const response = await fetch(getOllamaChatEndpoint(options.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        tools: options.tools.map((tool) => tool.schema),
        stream: true,
        think: options.enableThinking ?? true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorDetail = await readErrorResponse(response);
      publishDebugEvent({
        type: 'ai_response',
        source: 'runOllamaToolAgent',
        detail: `Ollama tool agent step ${step + 1} failed: ${errorDetail}`,
        data: { provider: 'ollama', status: response.status, error: errorDetail, step: step + 1 },
      });
      throw new Error(`Ollama request failed: ${errorDetail}`);
    }

    let responseModel = options.model;
    let streamedContent = '';
    let streamedThinking = '';
    let streamedToolCalls: OllamaStreamToolCall[] = [];
    let isThinking = false;

    await readOllamaNdjsonStream(response, (chunk) => {
      if (chunk.error) {
        throw new Error(chunk.error);
      }

      responseModel = chunk.model?.trim() || responseModel;
      const thinkingChunk = chunk.message?.thinking ?? '';
      const contentChunk = chunk.message?.content ?? '';
      streamedContent += contentChunk;
      streamedThinking += thinkingChunk;
      streamedToolCalls = mergeToolCalls(streamedToolCalls, chunk.message?.tool_calls);
      if (thinkingChunk) {
        isThinking = true;
      } else if (contentChunk || chunk.message?.tool_calls?.length) {
        isThinking = false;
      }

      latestThinking = streamedThinking.trim() || latestThinking;
      options.onStreamUpdate?.({
        stage: 'streaming',
        model: responseModel,
        content: streamedContent.trim(),
        thinking: streamedThinking,
        isThinking,
        artifact: latestArtifact,
      });
    });

    const assistantMessage: OllamaChatResponse['message'] = {
      role: 'assistant',
      content: streamedContent,
      thinking: streamedThinking,
      tool_calls: streamedToolCalls,
    };

    messages.push({
      role: 'assistant',
      content: assistantMessage.content ?? '',
      tool_calls: assistantMessage.tool_calls,
    });

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      publishDebugEvent({
        type: 'ai_response',
        source: 'runOllamaToolAgent',
        detail: `Ollama tool agent complete after ${step + 1} step(s) model=${responseModel}`,
        data: {
          provider: 'ollama',
          model: responseModel,
          steps: step + 1,
          hasArtifact: latestArtifact !== undefined,
        },
      });
      options.onStreamUpdate?.({
        stage: 'complete',
        model: responseModel,
        content: assistantMessage.content?.trim() || '',
        thinking: latestThinking,
        isThinking: false,
        artifact: latestArtifact,
      });
      return {
        message: assistantMessage.content?.trim() || '',
        model: responseModel,
        thinking: latestThinking || undefined,
        artifact: latestArtifact,
      };
    }

    const runToolCall = async (toolCall: OllamaStreamToolCall): Promise<OllamaMessage> => {
      const toolName = toolCall.function?.name?.trim() || '';
      const handler = toolMap.get(toolName);
      const toolArgs = parseToolArguments(toolCall.function?.arguments);

      publishDebugEvent({
        type: 'tool_call',
        source: 'runOllamaToolAgent',
        detail: `Tool call: ${toolName}`,
        data: {
          tool: toolName,
          args: toolArgs,
          step: step + 1,
        },
      });

      if (!handler) {
        const result = {
          role: 'tool' as const,
          tool_name: toolName || 'unknown_tool',
          content: JSON.stringify({
            status: 'error',
            message: `Unknown tool "${toolName}"`,
          }),
        };
        publishDebugEvent({
          type: 'tool_result',
          source: 'runOllamaToolAgent',
          detail: `Tool result: ${toolName} — unknown handler`,
          data: { tool: toolName, status: 'error', message: `Unknown tool "${toolName}"` },
        });
        return result;
      }

      try {
        const toolResult = await handler.run(toolArgs);
        if (toolResult.artifact !== undefined) {
          latestArtifact = toolResult.artifact;
        }
        options.onStreamUpdate?.({
          stage: 'tool',
          model: responseModel,
          content: streamedContent.trim(),
          thinking: latestThinking,
          isThinking: false,
          artifact: latestArtifact,
        });
        publishDebugEvent({
          type: 'tool_result',
          source: 'runOllamaToolAgent',
          detail: `Tool result: ${toolName} — success`,
          data: {
            tool: toolName,
            status: 'success',
            resultPreview: toolResult.content.slice(0, 500),
            hasArtifact: toolResult.artifact !== undefined,
          },
        });
        return {
          role: 'tool',
          tool_name: toolName,
          content: toolResult.content,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishDebugEvent({
          type: 'tool_result',
          source: 'runOllamaToolAgent',
          detail: `Tool result: ${toolName} — error: ${message.slice(0, 200)}`,
          data: { tool: toolName, status: 'error', message },
        });
        return {
          role: 'tool',
          tool_name: toolName,
          content: JSON.stringify({
            status: 'error',
            message,
          }),
        };
      }
    };

    const isDelegationBatch =
      toolCalls.length > 1 &&
      toolCalls.every((toolCall) => toolCall.function?.name?.trim() === 'assign_subagent_task');
    if (isDelegationBatch) {
      messages.push(...(await Promise.all(toolCalls.map(runToolCall))));
    } else {
      for (const toolCall of toolCalls) {
        messages.push(await runToolCall(toolCall));
      }
    }
  }

  throw new Error('Ollama agent exceeded the maximum number of tool steps.');
}
