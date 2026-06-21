import type { AiChatMessage, AiChatPromptPreviewArtifact } from '@blackboard/types';
import type { SetState } from '@/state/editor/slices/types';
import { generatePromptEnhancementResult, type PromptEnhancementOptions } from '@/utils/ai';
import { isAbortError } from '@/utils/guards';
import { aiChatAbortControllers, getStoppedMessageContent, updateChatById } from './chat';

interface RunPromptEnhancementRequestOptions {
  set: SetState;
  debouncedSave: () => void;
  chatId: string;
  pendingMessageId: string;
  sourcePrompt: string;
  target: AiChatPromptPreviewArtifact['target'];
  generationOptions: PromptEnhancementOptions;
  branchPointId?: string;
}

const getPromptEnhancementErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Prompt enhancement chat failed unexpectedly.';

export async function runPromptEnhancementRequest({
  set,
  debouncedSave,
  chatId,
  pendingMessageId,
  sourcePrompt,
  target,
  generationOptions,
  branchPointId,
}: RunPromptEnhancementRequestOptions): Promise<string> {
  aiChatAbortControllers.get(chatId)?.abort();
  const abortController = new AbortController();
  aiChatAbortControllers.set(chatId, abortController);

  try {
    const result = await generatePromptEnhancementResult(sourcePrompt, {
      ...generationOptions,
      signal: abortController.signal,
    });

    if (abortController.signal.aborted) {
      return chatId;
    }

    const assistantMessage: AiChatMessage = {
      id: pendingMessageId,
      role: 'assistant',
      content: result.message,
      createdAt: Date.now(),
      status: 'complete',
      isThinking: false,
      provider: result.provider,
      model: result.model,
      ...(branchPointId ? { branchPointId } : {}),
      artifact: {
        type: 'prompt-preview',
        originalPrompt: sourcePrompt,
        options: result.options,
        draft: result.options[0] ?? '',
        suggestions: result.suggestions,
        summary: result.message,
        provider: result.provider,
        model: result.model,
        target,
      },
    };

    set((state) => ({
      aiChats: updateChatById(state.aiChats, chatId, (chat) => ({
        ...chat,
        status: 'idle',
        lastError: undefined,
        updatedAt: Date.now(),
        messages: chat.messages.map((message) =>
          message.id === pendingMessageId ? assistantMessage : message,
        ),
      })),
      activeAiChatId: chatId,
    }));
    debouncedSave();
    return chatId;
  } catch (error) {
    if (abortController.signal.aborted || isAbortError(error)) {
      if (aiChatAbortControllers.get(chatId) !== abortController) {
        return chatId;
      }

      set((state) => ({
        aiChats: updateChatById(state.aiChats, chatId, (chat) => ({
          ...chat,
          status: 'idle',
          lastError: undefined,
          updatedAt: Date.now(),
          messages: chat.messages.map((message) =>
            message.id === pendingMessageId
              ? {
                  ...message,
                  content: getStoppedMessageContent(message),
                  isThinking: false,
                  status: 'complete',
                }
              : message,
          ),
        })),
        activeAiChatId: chatId,
      }));
      debouncedSave();
      return chatId;
    }

    const message = getPromptEnhancementErrorMessage(error);
    set((state) => ({
      aiChats: updateChatById(state.aiChats, chatId, (chat) => ({
        ...chat,
        status: 'error',
        lastError: message,
        updatedAt: Date.now(),
        messages: chat.messages.map((entry) =>
          entry.id === pendingMessageId
            ? {
                ...entry,
                content: message,
                isThinking: false,
                status: 'error',
                ...(branchPointId ? { branchPointId } : {}),
              }
            : entry,
        ),
      })),
      activeAiChatId: chatId,
    }));
    debouncedSave();
    throw error;
  } finally {
    if (aiChatAbortControllers.get(chatId) === abortController) {
      aiChatAbortControllers.delete(chatId);
    }
  }
}
