import type { AiChatAttachment, AiChatGradePreviewArtifact } from '@blackboard/types';
import {
  getAiAttachmentImagePayloads,
  getAiAttachmentTextContext,
  readErrorResponse,
  readOllamaNdjsonStream,
} from './ai';
import type { AiNodeToolHandler } from './aiNodeTools';

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
  tools: AiNodeToolHandler[];
  maxSteps?: number;
  onStreamUpdate?: (update: OllamaToolAgentStreamUpdate) => void;
  signal?: AbortSignal;
  enableThinking?: boolean;
}

interface RunOllamaToolAgentResult {
  message: string;
  model: string;
  thinking?: string;
  artifact?: AiChatGradePreviewArtifact | null;
}

interface OllamaToolAgentStreamUpdate {
  stage: 'streaming' | 'tool' | 'complete';
  model: string;
  content: string;
  thinking: string;
  isThinking?: boolean;
  artifact?: AiChatGradePreviewArtifact | null;
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
  let latestArtifact: AiChatGradePreviewArtifact | null | undefined;
  let latestThinking = '';

  for (let step = 0; step < (options.maxSteps ?? 8); step += 1) {
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
      throw new Error(`Ollama request failed: ${await readErrorResponse(response)}`);
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

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name?.trim() || '';
      const handler = toolMap.get(toolName);
      const toolArgs = parseToolArguments(toolCall.function?.arguments);

      if (!handler) {
        messages.push({
          role: 'tool',
          tool_name: toolName || 'unknown_tool',
          content: JSON.stringify({
            status: 'error',
            message: `Unknown tool "${toolName}"`,
          }),
        });
        continue;
      }

      try {
        const toolResult = handler.run(toolArgs);
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
        messages.push({
          role: 'tool',
          tool_name: toolName,
          content: toolResult.content,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push({
          role: 'tool',
          tool_name: toolName,
          content: JSON.stringify({
            status: 'error',
            message,
          }),
        });
      }
    }
  }

  throw new Error('Ollama agent exceeded the maximum number of tool steps.');
}
