import { AiChatBranch, AiChatThread, EditorTab } from '@blackboard/types';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  addBranchVariantGroup,
  createChatBranchId,
  createChatBranchPointId,
  ensureChatBranchState,
  getBranchLabel,
  getDefaultChatBranchId,
  getMessageBranchPointIndex,
  setMessageBranchPoint,
  type PreparedChatBranchPrompt,
} from './helpers/chat';

export function createAiBranchActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
  },
) {
  return {
    selectAiChatBranch: (chatId: string, branchId: string, branchPointId?: string) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat || chat.status === 'generating') {
        return;
      }

      const branchedChat = ensureChatBranchState(chat);
      const targetBranch = branchedChat.branches?.find((branch) => branch.id === branchId);
      if (!targetBranch || targetBranch.id === branchedChat.activeBranchId) {
        return;
      }

      const currentBranchPointIndex = branchPointId
        ? getMessageBranchPointIndex(branchedChat.messages, branchPointId)
        : -1;
      const targetBranchPointIndex = branchPointId
        ? getMessageBranchPointIndex(targetBranch.messages, branchPointId)
        : -1;
      const nextMessages =
        currentBranchPointIndex !== -1 && targetBranchPointIndex !== -1
          ? [
              ...branchedChat.messages.slice(0, currentBranchPointIndex),
              ...targetBranch.messages.slice(targetBranchPointIndex),
            ]
          : targetBranch.messages;
      const hasErrorMessage = nextMessages.some((message) => message.status === 'error');
      const timestamp = Date.now();
      const nextChat: AiChatThread = {
        ...branchedChat,
        activeBranchId: targetBranch.id,
        messages: nextMessages,
        status: hasErrorMessage ? 'error' : 'idle',
        lastError: undefined,
        updatedAt: timestamp,
      };

      deps.commitMutation(() => ({
        patch: {
          aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
          activeAiChatId: chatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
    },

    createAiChatUserEditBranch: (chatId: string, messageId: string): string | null => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat || chat.status === 'generating') {
        return null;
      }

      const messageIndex = chat.messages.findIndex(
        (message) => message.id === messageId && message.role === 'user',
      );
      if (messageIndex === -1) {
        return null;
      }

      const branchedChat = ensureChatBranchState(chat);
      const sourceMessage = branchedChat.messages[messageIndex];
      if (!sourceMessage || sourceMessage.role !== 'user') {
        return null;
      }

      const timestamp = Date.now();
      const branchPointId = sourceMessage.branchPointId ?? createChatBranchPointId();
      const messagesWithBranchPoint = setMessageBranchPoint(
        branchedChat.messages,
        messageId,
        branchPointId,
      );
      const activeBranchId = branchedChat.activeBranchId ?? getDefaultChatBranchId(branchedChat);
      const branchesWithActiveSnapshot = (branchedChat.branches ?? []).map((branch) =>
        branch.id === activeBranchId
          ? addBranchVariantGroup(
              {
                ...branch,
                updatedAt: timestamp,
                messages: messagesWithBranchPoint,
              },
              branchPointId,
            )
          : branch,
      );
      const prefixMessages = messagesWithBranchPoint.slice(0, messageIndex);
      const newBranch: AiChatBranch = {
        id: createChatBranchId(),
        label: getBranchLabel(branchesWithActiveSnapshot, branchPointId, 'edit'),
        source: 'edit',
        parentBranchId: activeBranchId,
        createdAt: timestamp,
        updatedAt: timestamp,
        variantOfBranchPointIds: [branchPointId],
        messages: prefixMessages,
      };
      const nextChat: AiChatThread = {
        ...branchedChat,
        status: 'idle',
        lastError: undefined,
        updatedAt: timestamp,
        messages: prefixMessages,
        branches: [...branchesWithActiveSnapshot, newBranch],
        activeBranchId: newBranch.id,
      };

      deps.commitMutation(() => ({
        patch: {
          aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
          activeAiChatId: chatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
      return branchPointId;
    },

    createAiChatRegenerationBranch: (
      chatId: string,
      messageId: string,
    ): PreparedChatBranchPrompt | null => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat || chat.status === 'generating') {
        return null;
      }

      const assistantIndex = chat.messages.findIndex(
        (message) => message.id === messageId && message.role === 'assistant',
      );
      if (assistantIndex === -1) {
        return null;
      }

      let userIndex = -1;
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        if (chat.messages[index]?.role === 'user') {
          userIndex = index;
          break;
        }
      }
      if (userIndex === -1) {
        return null;
      }

      const branchedChat = ensureChatBranchState(chat);
      const sourceAssistantMessage = branchedChat.messages[assistantIndex];
      const sourceUserMessage = branchedChat.messages[userIndex];
      if (
        !sourceAssistantMessage ||
        sourceAssistantMessage.role !== 'assistant' ||
        !sourceUserMessage ||
        sourceUserMessage.role !== 'user'
      ) {
        return null;
      }

      const timestamp = Date.now();
      const branchPointId = sourceAssistantMessage.branchPointId ?? createChatBranchPointId();
      const messagesWithBranchPoint = setMessageBranchPoint(
        branchedChat.messages,
        messageId,
        branchPointId,
      );
      const activeBranchId = branchedChat.activeBranchId ?? getDefaultChatBranchId(branchedChat);
      const branchesWithActiveSnapshot = (branchedChat.branches ?? []).map((branch) =>
        branch.id === activeBranchId
          ? addBranchVariantGroup(
              {
                ...branch,
                updatedAt: timestamp,
                messages: messagesWithBranchPoint,
              },
              branchPointId,
            )
          : branch,
      );
      const prefixMessages = messagesWithBranchPoint.slice(0, userIndex);
      const newBranch: AiChatBranch = {
        id: createChatBranchId(),
        label: getBranchLabel(branchesWithActiveSnapshot, branchPointId, 'regenerate'),
        source: 'regenerate',
        parentBranchId: activeBranchId,
        createdAt: timestamp,
        updatedAt: timestamp,
        variantOfBranchPointIds: [branchPointId],
        messages: prefixMessages,
      };
      const nextChat: AiChatThread = {
        ...branchedChat,
        status: 'idle',
        lastError: undefined,
        updatedAt: timestamp,
        messages: prefixMessages,
        branches: [...branchesWithActiveSnapshot, newBranch],
        activeBranchId: newBranch.id,
      };

      deps.commitMutation(() => ({
        patch: {
          aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
          activeAiChatId: chatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));

      return {
        prompt: sourceUserMessage.content,
        attachments: sourceUserMessage.attachments,
        branchPoints: {
          userBranchPointId: sourceUserMessage.branchPointId,
          assistantBranchPointId: branchPointId,
        },
      };
    },
  };
}
