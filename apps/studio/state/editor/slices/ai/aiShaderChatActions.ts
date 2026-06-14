import { AiChatMessage, EditorTab } from '@blackboard/types';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  generateShaderChatTurn,
  type GenerateShaderCodeOptions,
  type ShaderGenerationStreamUpdate,
} from '@/utils/ai';
import { isAbortError } from '@/utils/guards';
import {
  aiChatAbortControllers,
  createAiApplyNoticeId,
  createChatMessageId,
  ensureShaderChatThread,
  getResolvedAiModel,
  getResolvedAiProvider,
  getShaderChatTitle,
  getStoppedMessageContent,
  updateChatById,
  type ChatPromptBranchPoints,
} from './helpers/chat';
import {
  applyShaderCodeToNodes,
  buildShaderArtifactFromStream,
  createCustomShaderNodeFromCode,
  isCustomShaderNode,
} from './helpers/shader';

export function createAiShaderChatActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
    debouncedSave: () => void;
  },
) {
  return {
    startShaderChat: async (
      nodeId: string,
      prompt: string,
      generationOptions: GenerateShaderCodeOptions = {},
      branchPoints?: ChatPromptBranchPoints,
    ) => {
      const trimmedPrompt = prompt.trim();
      const attachments = generationOptions.attachments?.length
        ? generationOptions.attachments
        : undefined;
      if (!trimmedPrompt && !attachments?.length) return;
      const requestPrompt = trimmedPrompt || 'Please review the attached file(s).';

      const state = get();
      const node = state.nodes.find((candidate) => candidate.id === nodeId);
      if (!isCustomShaderNode(node)) {
        throw new Error('Shader chat can only target Shader nodes.');
      }

      const { chats, chat } = ensureShaderChatThread(state.aiChats, node);
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
      const pendingMessage: AiChatMessage = {
        id: pendingMessageId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'pending',
        isThinking: false,
        provider: getResolvedAiProvider(generationOptions.provider),
        model: getResolvedAiModel(generationOptions),
        branchPointId: branchPoints?.assistantBranchPointId,
      };
      const history = chat.messages
        .filter((message) => message.status !== 'pending')
        .map((message) => ({
          role: message.role,
          content: message.content,
          shaderCode: message.artifact?.type === 'shader' ? message.artifact.code : undefined,
        }));
      const nextChats = updateChatById(chats, chat.id, (currentChat) => ({
        ...currentChat,
        status: 'generating',
        lastError: undefined,
        updatedAt: Date.now(),
        messages: [...currentChat.messages, userMessage, pendingMessage],
      }));
      aiChatAbortControllers.get(chat.id)?.abort();
      const abortController = new AbortController();
      aiChatAbortControllers.set(chat.id, abortController);

      set(() => ({
        aiChats: nextChats,
        activeAiChatId: chat.id,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      const handleStreamUpdate = (update: ShaderGenerationStreamUpdate) => {
        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, chat.id, (currentChat) => ({
            ...currentChat,
            updatedAt: Date.now(),
            messages: currentChat.messages.map((message) =>
              message.id === pendingMessageId
                ? {
                    ...message,
                    content: update.content || message.content,
                    thinking: update.thinking || message.thinking,
                    isThinking: update.isThinking ?? message.isThinking,
                    artifact: buildShaderArtifactFromStream(message, update),
                  }
                : message,
            ),
          })),
        }));
      };

      try {
        const result = await generateShaderChatTurn(requestPrompt, {
          ...generationOptions,
          signal: abortController.signal,
          currentShader: node.fragmentShader,
          history,
          nodeName: node.name,
          onStreamUpdate:
            generationOptions.provider === 'ollama'
              ? handleStreamUpdate
              : generationOptions.onStreamUpdate,
        });

        if (abortController.signal.aborted) {
          return;
        }

        const assistantMessage: AiChatMessage = {
          id: pendingMessageId,
          role: 'assistant',
          content: result.message,
          thinking: result.thinking,
          createdAt: Date.now(),
          status: 'complete',
          isThinking: false,
          provider: result.provider,
          model: result.model,
          branchPointId: branchPoints?.assistantBranchPointId,
          artifact: {
            type: 'shader',
            code: result.shaderCode,
            provider: result.provider,
            model: result.model,
            suggestions: result.suggestions,
            validationErrors: result.validationErrors,
          },
        };
        const updatedNodes = applyShaderCodeToNodes(get().nodes, nodeId, result.shaderCode);

        deps.commitMutation(() => ({
          patch: {
            nodes: updatedNodes,
            aiChats: updateChatById(get().aiChats, chat.id, (currentChat) => ({
              ...currentChat,
              status: 'idle',
              lastError: undefined,
              updatedAt: Date.now(),
              messages: currentChat.messages.map((message) =>
                message.id === pendingMessageId ? assistantMessage : message,
              ),
            })),
            activeAiChatId: chat.id,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          },
          history: {
            label: `AI Update ${node.name} Shader`,
            state: { nodes: updatedNodes, selectedNodeId: get().selectedNodeId },
          },
          persist: 'debounced',
        }));
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          set((currentState) => ({
            aiChats: updateChatById(currentState.aiChats, chat.id, (currentChat) => ({
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
            activeAiChatId: chat.id,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          }));
          deps.debouncedSave();
          return;
        }

        const message =
          error instanceof Error ? error.message : 'AI shader generation failed unexpectedly.';

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, chat.id, (currentChat) => ({
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
          activeAiChatId: chat.id,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        }));
        deps.debouncedSave();
        throw error;
      } finally {
        if (aiChatAbortControllers.get(chat.id) === abortController) {
          aiChatAbortControllers.delete(chat.id);
        }
      }
    },

    applyAiChatShaderArtifact: (chatId: string, messageId: string) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat) return;

      const message = chat.messages.find((entry) => entry.id === messageId);
      if (message?.artifact?.type !== 'shader') return;

      const node = chat.nodeId
        ? state.nodes.find((candidate) => candidate.id === chat.nodeId)
        : undefined;

      if (!isCustomShaderNode(node)) {
        const newNode = createCustomShaderNodeFromCode(state.nodes, chat, message.artifact.code);
        const newNodes = [...state.nodes, newNode];
        const relinkedChats = updateChatById(state.aiChats, chatId, (currentChat) => ({
          ...currentChat,
          nodeId: newNode.id,
          title: getShaderChatTitle(newNode),
          updatedAt: Date.now(),
        }));

        deps.commitMutation(() => ({
          patch: {
            nodes: newNodes,
            aiChats: relinkedChats,
            selectedNodeId: newNode.id,
            aiApplyNotice: {
              id: createAiApplyNoticeId(),
              nodeId: newNode.id,
              field: 'shader' as const,
              label: `${newNode.name} shader created`,
              createdAt: Date.now(),
            },
            activeAiChatId: chatId,
            activeTab: EditorTab.Flow,
            isSubPanelVisible: true,
          },
          history: {
            label: `Create ${newNode.name} from Chat Shader`,
            state: { nodes: newNodes, selectedNodeId: newNode.id },
          },
          persist: 'debounced',
        }));
        return;
      }

      const updatedNodes = applyShaderCodeToNodes(state.nodes, chat.nodeId, message.artifact.code);
      deps.commitMutation(() => ({
        patch: {
          nodes: updatedNodes,
          selectedNodeId: chat.nodeId,
          aiApplyNotice: {
            id: createAiApplyNoticeId(),
            nodeId: chat.nodeId,
            field: 'shader' as const,
            label: `${node.name} shader updated`,
            createdAt: Date.now(),
          },
          activeAiChatId: chatId,
          activeTab: EditorTab.Flow,
          isSubPanelVisible: true,
        },
        history: {
          label: `Apply ${node.name} Chat Shader`,
          state: { nodes: updatedNodes, selectedNodeId: chat.nodeId },
        },
        persist: 'debounced',
      }));
    },
  };
}
