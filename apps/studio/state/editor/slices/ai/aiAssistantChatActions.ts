import { AiChatMessage, EditorTab } from '@blackboard/types';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  generateAssistantChatTurn,
  type AssistantChatStreamUpdate,
  type GenerateAssistantChatOptions,
} from '@/utils/ai';
import { isAiActionCapableNode, summarizeNodeForAiChat } from '@/utils/aiChatScope';
import { createAiNodeToolHandlers, supportsAiNodeTools } from '@/utils/aiNodeTools';
import { createAgentProjectToolHandlers } from '@/utils/agentProjectTools';
import { runOllamaToolAgent } from '@/utils/ollamaAgentRunner';
import { isAbortError } from '@/utils/guards';
import {
  aiChatAbortControllers,
  createAssistantChatThread,
  createChatMessageId,
  getResolvedAiModel,
  getResolvedAiProvider,
  getStoppedMessageContent,
  updateChatById,
  type ChatPromptBranchPoints,
  type StartAssistantChatResult,
} from './helpers/chat';
import { updateChatGradePreview } from './helpers/grade';

export function createAiAssistantChatActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
    debouncedSave: () => void;
  },
) {
  return {
    startAssistantChat: async (
      prompt: string,
      generationOptions: GenerateAssistantChatOptions = {},
      chatId?: string | null,
      contextNodeId?: string | null,
      branchPoints?: ChatPromptBranchPoints,
      assistantNotice?: string | null,
    ): Promise<StartAssistantChatResult | undefined> => {
      const trimmedPrompt = prompt.trim();
      const attachments = generationOptions.attachments?.length
        ? generationOptions.attachments
        : undefined;
      if (!trimmedPrompt && !attachments?.length) return;
      const requestPrompt = trimmedPrompt || 'Please review the attached file(s).';

      const state = get();
      const existingChat =
        chatId != null ? state.aiChats.find((entry) => entry.id === chatId) : undefined;
      if (existingChat && existingChat.feature !== 'assistant') {
        throw new Error('Assistant chat can only continue assistant threads.');
      }

      const contextNode = existingChat?.nodeId
        ? (state.nodes.find((candidate) => candidate.id === existingChat.nodeId) ?? null)
        : contextNodeId
          ? (state.nodes.find((candidate) => candidate.id === contextNodeId) ?? null)
          : null;

      let chats = state.aiChats;
      let chat = existingChat;

      if (!chat) {
        const createdChat = createAssistantChatThread(chats, contextNode);
        chats = createdChat.chats;
        chat = createdChat.chat;
      }

      const resolvedChat = chat;
      if (!resolvedChat) {
        throw new Error('Assistant chat could not be created.');
      }

      const userMessage: AiChatMessage = {
        id: createChatMessageId('user'),
        role: 'user',
        content: trimmedPrompt,
        createdAt: Date.now(),
        status: 'complete',
        attachments,
        branchPointId: branchPoints?.userBranchPointId,
      };
      const pendingMessageId = createChatMessageId('assistant');
      const noticeMessage: AiChatMessage | null = assistantNotice?.trim()
        ? {
            id: createChatMessageId('assistant'),
            role: 'assistant',
            content: assistantNotice.trim(),
            createdAt: Date.now(),
            status: 'complete',
          }
        : null;
      const pendingMessage: AiChatMessage = {
        id: pendingMessageId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'pending',
        isThinking: false,
        streamStage: 'connecting',
        provider: getResolvedAiProvider(generationOptions.provider),
        model: getResolvedAiModel(generationOptions),
        branchPointId: branchPoints?.assistantBranchPointId,
      };
      const history = chat.messages
        .filter((message) => message.status !== 'pending')
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));
      const nextChats = updateChatById(chats, chat.id, (currentChat) => ({
        ...currentChat,
        status: 'generating',
        lastError: undefined,
        updatedAt: Date.now(),
        messages: [
          ...currentChat.messages,
          userMessage,
          ...(noticeMessage ? [noticeMessage] : []),
          pendingMessage,
        ],
      }));
      aiChatAbortControllers.get(resolvedChat.id)?.abort();
      const abortController = new AbortController();
      aiChatAbortControllers.set(resolvedChat.id, abortController);

      set(() => ({
        aiChats: nextChats,
        activeAiChatId: resolvedChat.id,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      const handleAssistantStreamUpdate = (
        update:
          | AssistantChatStreamUpdate
          | {
              stage?: 'streaming' | 'tool' | 'complete';
              content: string;
              thinking: string;
              isThinking?: boolean;
            },
      ) => {
        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, resolvedChat.id, (currentChat) => ({
            ...currentChat,
            updatedAt: Date.now(),
            messages: currentChat.messages.map((message) =>
              message.id === pendingMessageId
                ? {
                    ...message,
                    content: update.content || message.content,
                    thinking: update.thinking || message.thinking,
                    isThinking: update.isThinking ?? message.isThinking,
                    streamStage: update.stage ?? message.streamStage,
                  }
                : message,
            ),
          })),
        }));
      };

      try {
        const ollamaModel = generationOptions.ollamaModel?.trim();
        const canUseOllamaTools = generationOptions.provider === 'ollama' && Boolean(ollamaModel);
        const runReadOnlySubagentTask = async (input: {
          delegation: { assignee: string; task: string };
        }) => {
          const subagentPrompt = `You are a read-only sub-agent for Blackboard Studio.
Do not mutate project state. Do not claim app tool execution. Complete this bounded assignment and return concise findings for the main agent.

Main user request:
${requestPrompt}

Assignment for ${input.delegation.assignee}:
${input.delegation.task}`;
          const subagentResult = await generateAssistantChatTurn(subagentPrompt, {
            provider: generationOptions.provider,
            geminiApiKey: generationOptions.geminiApiKey,
            geminiModel: generationOptions.geminiModel,
            openAiApiKey: generationOptions.openAiApiKey,
            openAiBaseUrl: generationOptions.openAiBaseUrl,
            openAiModel: generationOptions.openAiModel,
            ollamaEndpoint: generationOptions.ollamaEndpoint,
            ollamaModel: generationOptions.ollamaModel,
            attachments,
            contextSummary: summarizeNodeForAiChat(contextNode),
            mode: contextNode ? 'context' : 'generic',
            agentMode: false,
            signal: abortController.signal,
            enableThinking: false,
          });
          return {
            status: 'complete' as const,
            result: subagentResult.message,
          };
        };
        const projectAgentTools =
          canUseOllamaTools && generationOptions.agentMode
            ? createAgentProjectToolHandlers({
                commitMutation: deps.commitMutation,
                getState: get,
                setState: set,
                debouncedSave: deps.debouncedSave,
                maxSubagentSpawns: generationOptions.maxAgentSubagentSpawns,
                runSubagentTask: runReadOnlySubagentTask,
              })
            : [];
        const nodeTools =
          canUseOllamaTools && supportsAiNodeTools(contextNode)
            ? createAiNodeToolHandlers(contextNode, {
                node: contextNode!,
                currentFrame: state.currentFrame,
                setGradePreview: (preview) => {
                  set((currentState) => ({
                    aiChats: updateChatById(
                      currentState.aiChats,
                      resolvedChat.id,
                      (currentChat) => ({
                        ...updateChatGradePreview(
                          currentChat,
                          preview
                            ? {
                                type: 'grade-preview',
                                values: preview.values,
                                summary: preview.summary,
                                provider: 'ollama',
                                model: ollamaModel,
                              }
                            : null,
                        ),
                        updatedAt: Date.now(),
                        messages: currentChat.messages.map((message) =>
                          message.id === pendingMessageId
                            ? {
                                ...message,
                                artifact: preview
                                  ? {
                                      type: 'grade-preview' as const,
                                      values: preview.values,
                                      summary: preview.summary,
                                      provider: 'ollama',
                                      model: ollamaModel,
                                    }
                                  : undefined,
                              }
                            : message,
                        ),
                      }),
                    ),
                  }));
                },
                getGradePreview: () => {
                  const liveChat = get().aiChats.find((entry) => entry.id === resolvedChat.id);
                  const preview = liveChat?.toolState?.gradePreview;
                  return preview
                    ? {
                        values: preview.values,
                        summary: preview.summary,
                      }
                    : null;
                },
              })
            : [];
        const toolHandlers = [...projectAgentTools, ...nodeTools];

        const result =
          toolHandlers.length > 0
            ? await runOllamaToolAgent({
                endpoint: generationOptions.ollamaEndpoint?.trim() || 'http://localhost:11434',
                model: ollamaModel!,
                prompt: requestPrompt,
                contextSummary: summarizeNodeForAiChat(contextNode),
                history,
                attachments,
                tools: toolHandlers,
                onStreamUpdate: handleAssistantStreamUpdate,
                signal: abortController.signal,
                enableThinking: generationOptions.enableThinking,
                maxSteps: generationOptions.maxAgentToolSteps,
              })
            : await generateAssistantChatTurn(requestPrompt, {
                ...generationOptions,
                signal: abortController.signal,
                history,
                contextSummary: summarizeNodeForAiChat(contextNode),
                mode: contextNode
                  ? isAiActionCapableNode(contextNode)
                    ? 'action'
                    : 'context'
                  : 'generic',
                onStreamUpdate:
                  generationOptions.provider === 'ollama' ? handleAssistantStreamUpdate : undefined,
              });

        if (abortController.signal.aborted) {
          return {
            chatId: resolvedChat.id,
            assistantMessageId: pendingMessageId,
            stopped: true,
          };
        }

        const assistantMessage: AiChatMessage = {
          id: pendingMessageId,
          role: 'assistant',
          content: result.message,
          thinking: result.thinking,
          createdAt: Date.now(),
          status: 'complete',
          isThinking: false,
          streamStage: 'complete',
          provider:
            'provider' in result && result.provider
              ? result.provider
              : getResolvedAiProvider(generationOptions.provider),
          model: result.model,
          artifact: 'artifact' in result ? (result.artifact ?? undefined) : undefined,
          branchPointId: branchPoints?.assistantBranchPointId,
        };

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, resolvedChat.id, (currentChat) => ({
            ...currentChat,
            status: 'idle',
            lastError: undefined,
            updatedAt: Date.now(),
            messages: currentChat.messages.map((message) =>
              message.id === pendingMessageId ? assistantMessage : message,
            ),
          })),
          activeAiChatId: resolvedChat.id,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        }));
        deps.debouncedSave();
        return {
          chatId: resolvedChat.id,
          assistantMessageId: assistantMessage.id,
          assistantContent: assistantMessage.content,
        };
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          const stoppedContent = getStoppedMessageContent(pendingMessage);
          set((currentState) => ({
            aiChats: updateChatById(currentState.aiChats, resolvedChat.id, (currentChat) => ({
              ...currentChat,
              status: 'idle',
              lastError: undefined,
              updatedAt: Date.now(),
              messages: currentChat.messages.map((entry) =>
                entry.id === pendingMessageId
                  ? {
                      ...entry,
                      content: getStoppedMessageContent(entry),
                      isThinking: false,
                      status: 'complete',
                    }
                  : entry,
              ),
            })),
            activeAiChatId: resolvedChat.id,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          }));
          deps.debouncedSave();
          return {
            chatId: resolvedChat.id,
            assistantMessageId: pendingMessageId,
            assistantContent: stoppedContent,
            stopped: true,
          };
        }

        const message =
          error instanceof Error ? error.message : 'AI assistant chat failed unexpectedly.';

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, resolvedChat.id, (currentChat) => ({
            ...currentChat,
            status: 'error',
            lastError: message,
            updatedAt: Date.now(),
            messages: currentChat.messages.map((entry) =>
              entry.id === pendingMessageId
                ? {
                    ...entry,
                    content: message,
                    isThinking: false,
                    status: 'error',
                  }
                : entry,
            ),
          })),
          activeAiChatId: resolvedChat.id,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        }));
        deps.debouncedSave();
        throw error;
      } finally {
        if (aiChatAbortControllers.get(resolvedChat.id) === abortController) {
          aiChatAbortControllers.delete(resolvedChat.id);
        }
      }
    },
  };
}
