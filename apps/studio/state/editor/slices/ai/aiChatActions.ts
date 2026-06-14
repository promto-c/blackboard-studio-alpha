import { AiChatArtifact, AiChatMessage, EditorTab } from '@blackboard/types';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  aiChatAbortControllers,
  createAssistantChatThread,
  createChatMessageId,
  ensureShaderChatThread,
  getAssistantChatTitle,
  getLastPendingAssistantMessageIndex,
  getStoppedMessageContent,
  updateChatById,
} from './helpers/chat';
import { isCustomShaderNode } from './helpers/shader';
import { updateChatGradePreview } from './helpers/grade';

export function createAiChatActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
  },
) {
  return {
    appendAiChatAssistantArtifactMessage: (
      chatId: string,
      input: {
        content: string;
        artifact?: AiChatArtifact;
      },
    ): string | null => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat) return null;

      const timestamp = Date.now();
      const message: AiChatMessage = {
        id: createChatMessageId('assistant'),
        role: 'assistant',
        content: input.content,
        createdAt: timestamp,
        status: 'complete',
        artifact: input.artifact,
      };

      deps.commitMutation(() => ({
        patch: {
          aiChats: updateChatById(state.aiChats, chatId, (currentChat) => ({
            ...currentChat,
            messages: [...currentChat.messages, message],
            status: 'idle',
            updatedAt: timestamp,
          })),
          activeAiChatId: chatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
      return message.id;
    },

    setActiveAiChat: (chatId: string | null) => {
      deps.commitMutation(() => ({
        patch: {
          activeAiChatId: chatId,
          activeTab: chatId ? EditorTab.Chats : get().activeTab,
          isSubPanelVisible: chatId ? true : get().isSubPanelVisible,
        },
        persist: 'debounced',
      }));
    },

    stopAiChat: (chatId: string) => {
      aiChatAbortControllers.get(chatId)?.abort();
      aiChatAbortControllers.delete(chatId);

      deps.commitMutation((state) => ({
        patch: {
          aiChats: updateChatById(state.aiChats, chatId, (chat) => {
            const pendingMessageIndex = getLastPendingAssistantMessageIndex(chat.messages);
            return {
              ...chat,
              status: 'idle',
              lastError: undefined,
              updatedAt: Date.now(),
              messages:
                pendingMessageIndex === -1
                  ? chat.messages
                  : chat.messages.map((message, index) =>
                      index === pendingMessageIndex
                        ? {
                            ...message,
                            content: getStoppedMessageContent(message),
                            isThinking: false,
                            status: 'complete',
                          }
                        : message,
                    ),
            };
          }),
          activeAiChatId: chatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
    },

    removeAiChat: (chatId: string) => {
      aiChatAbortControllers.get(chatId)?.abort();
      aiChatAbortControllers.delete(chatId);

      deps.commitMutation((state) => {
        const remainingChats = state.aiChats.filter((chat) => chat.id !== chatId);
        const activeAiChatId =
          state.activeAiChatId === chatId ? (remainingChats[0]?.id ?? null) : state.activeAiChatId;

        return {
          patch: {
            aiChats: remainingChats,
            activeAiChatId,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          },
          persist: 'debounced',
        };
      });
    },

    openShaderChat: (nodeId: string) => {
      const node = get().nodes.find((candidate) => candidate.id === nodeId);
      if (!isCustomShaderNode(node)) {
        return null;
      }

      const { chats, chat } = ensureShaderChatThread(get().aiChats, node);
      deps.commitMutation(() => ({
        patch: {
          aiChats: chats,
          activeAiChatId: chat.id,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
      return chat.id;
    },

    openAssistantChat: (nodeId?: string | null) => {
      const node = nodeId
        ? (get().nodes.find((candidate) => candidate.id === nodeId) ?? null)
        : null;
      const { chats, chat } = createAssistantChatThread(get().aiChats, node);

      deps.commitMutation(() => ({
        patch: {
          aiChats: chats,
          activeAiChatId: chat.id,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
      return chat.id;
    },

    setAiChatNodeContext: (chatId: string, nodeId: string | null) => {
      deps.commitMutation((state) => {
        const chat = state.aiChats.find((entry) => entry.id === chatId);
        if (!chat || chat.feature !== 'assistant') {
          return { patch: {} };
        }

        const node = nodeId
          ? (state.nodes.find((candidate) => candidate.id === nodeId) ?? null)
          : null;
        return {
          patch: {
            aiChats: updateChatById(state.aiChats, chatId, (currentChat) => ({
              ...updateChatGradePreview(currentChat, null),
              nodeId: node?.id,
              title: getAssistantChatTitle(node),
              updatedAt: Date.now(),
            })),
            activeAiChatId: chatId,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          },
          persist: 'debounced',
        };
      });
    },

    clearAiChatGradePreview: (chatId: string) => {
      deps.commitMutation((state) => {
        const chat = state.aiChats.find((entry) => entry.id === chatId);
        if (!chat?.toolState?.gradePreview) {
          return { patch: {} };
        }

        return {
          patch: {
            aiChats: updateChatById(state.aiChats, chatId, (currentChat) =>
              updateChatGradePreview(currentChat, null),
            ),
            activeAiChatId: chatId,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          },
          persist: 'debounced',
        };
      });
    },
  };
}
