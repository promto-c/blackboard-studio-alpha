import { AiChatMessage, AiChatBranch, AiChatThread, EditorTab } from '@blackboard/types';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import type { PromptEnhancementOptions } from '@/utils/ai';
import { isComfyNode } from '@/nodes/helpers';
import {
  addBranchVariantGroup,
  createAiApplyNoticeId,
  createAssistantChatThread,
  createChatBranchId,
  createChatBranchPointId,
  createChatMessageId,
  ensureChatBranchState,
  getBranchLabel,
  getDefaultChatBranchId,
  getLatestPromptPreviewMessage,
  getResolvedAiModel,
  getResolvedAiProvider,
  setMessageBranchPoint,
  updateChatById,
} from './helpers/chat';
import { runPromptEnhancementRequest } from './helpers/promptEnhancement';

export function createAiPromptEnhancementActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
    debouncedSave: () => void;
  },
) {
  return {
    startComfyPromptEnhancementChat: async (
      nodeId: string,
      controlId: string,
      generationOptions: PromptEnhancementOptions = {},
    ) => {
      const state = get();
      const node = state.nodes.find((candidate) => candidate.id === nodeId);
      if (!isComfyNode(node)) {
        throw new Error('Prompt enhancement chat can only target Comfy nodes.');
      }

      const control = node.workflowControls?.find((entry) => entry.id === controlId);
      if (!control || typeof control.value !== 'string' || !control.value.trim()) {
        throw new Error('Prompt enhancement needs a non-empty text field.');
      }

      const prompt = control.value.trim();
      const { chats, chat } = createAssistantChatThread(state.aiChats, node);
      const userMessage: AiChatMessage = {
        id: createChatMessageId('user'),
        role: 'user',
        content: `Enhance the "${control.label}" prompt.\n\nCurrent prompt:\n${prompt}`,
        createdAt: Date.now(),
        status: 'complete',
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
      };
      const nextChats = updateChatById(chats, chat.id, (currentChat) => ({
        ...currentChat,
        status: 'generating',
        lastError: undefined,
        updatedAt: Date.now(),
        messages: [...currentChat.messages, userMessage, pendingMessage],
      }));

      set(() => ({
        aiChats: nextChats,
        activeAiChatId: chat.id,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      return runPromptEnhancementRequest({
        set,
        debouncedSave: deps.debouncedSave,
        chatId: chat.id,
        pendingMessageId,
        sourcePrompt: prompt,
        target: {
          kind: 'comfy-control',
          nodeId: node.id,
          controlId: control.id,
          controlLabel: control.label,
          inputName: control.inputName,
        },
        generationOptions,
      });
    },

    regenerateAiChatPromptPreview: async (
      chatId: string,
      messageId: string,
      generationOptions: PromptEnhancementOptions = {},
    ) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat || chat.status === 'generating') {
        return null;
      }

      const assistantIndex = chat.messages.findIndex(
        (message) => message.id === messageId && message.role === 'assistant',
      );
      const sourceAssistantMessage = assistantIndex === -1 ? null : chat.messages[assistantIndex];
      if (sourceAssistantMessage?.artifact?.type !== 'prompt-preview') {
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

      const sourceUserMessage = chat.messages[userIndex];
      if (!sourceUserMessage || sourceUserMessage.role !== 'user') {
        return null;
      }

      const promptPreviewArtifact = sourceAssistantMessage.artifact;
      const prompt = promptPreviewArtifact.originalPrompt.trim();
      if (!prompt) {
        return null;
      }

      const branchedChat = ensureChatBranchState(chat);
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
      const userMessage: AiChatMessage = {
        id: createChatMessageId('user'),
        role: 'user',
        content: sourceUserMessage.content,
        createdAt: timestamp,
        status: 'complete',
        attachments: sourceUserMessage.attachments,
        branchPointId: sourceUserMessage.branchPointId,
      };
      const pendingMessageId = createChatMessageId('assistant');
      const pendingMessage: AiChatMessage = {
        id: pendingMessageId,
        role: 'assistant',
        content: '',
        createdAt: timestamp,
        status: 'pending',
        isThinking: false,
        provider: getResolvedAiProvider(generationOptions.provider),
        model: getResolvedAiModel(generationOptions),
        branchPointId,
      };
      const nextMessages = [...prefixMessages, userMessage, pendingMessage];
      const newBranch: AiChatBranch = {
        id: createChatBranchId(),
        label: getBranchLabel(branchesWithActiveSnapshot, branchPointId, 'regenerate'),
        source: 'regenerate',
        parentBranchId: activeBranchId,
        createdAt: timestamp,
        updatedAt: timestamp,
        variantOfBranchPointIds: [branchPointId],
        messages: nextMessages,
      };
      const nextChat: AiChatThread = {
        ...branchedChat,
        status: 'generating',
        lastError: undefined,
        updatedAt: timestamp,
        messages: nextMessages,
        branches: [...branchesWithActiveSnapshot, newBranch],
        activeBranchId: newBranch.id,
      };

      set(() => ({
        aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      return runPromptEnhancementRequest({
        set,
        debouncedSave: deps.debouncedSave,
        chatId,
        pendingMessageId,
        sourcePrompt: prompt,
        target: promptPreviewArtifact.target,
        generationOptions,
        branchPointId,
      });
    },

    continueAiChatPromptPreview: async (
      chatId: string,
      prompt: string,
      generationOptions: PromptEnhancementOptions = {},
    ) => {
      const followUpInstruction = prompt.trim();
      if (!followUpInstruction) {
        return null;
      }

      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat || chat.status === 'generating') {
        return null;
      }

      const sourceMessage = getLatestPromptPreviewMessage(chat);
      const promptPreviewArtifact = sourceMessage?.artifact;
      if (promptPreviewArtifact?.type !== 'prompt-preview') {
        return null;
      }

      const sourcePrompt =
        promptPreviewArtifact.draft.trim() ||
        promptPreviewArtifact.options[0]?.trim() ||
        promptPreviewArtifact.originalPrompt.trim();
      if (!sourcePrompt) {
        return null;
      }

      const timestamp = Date.now();
      const userMessage: AiChatMessage = {
        id: createChatMessageId('user'),
        role: 'user',
        content: followUpInstruction,
        createdAt: timestamp,
        status: 'complete',
      };
      const pendingMessageId = createChatMessageId('assistant');
      const pendingMessage: AiChatMessage = {
        id: pendingMessageId,
        role: 'assistant',
        content: '',
        createdAt: timestamp,
        status: 'pending',
        isThinking: false,
        provider: getResolvedAiProvider(generationOptions.provider),
        model: getResolvedAiModel(generationOptions),
      };

      set(() => ({
        aiChats: updateChatById(state.aiChats, chat.id, (currentChat) => ({
          ...currentChat,
          status: 'generating',
          lastError: undefined,
          updatedAt: timestamp,
          messages: [...currentChat.messages, userMessage, pendingMessage],
        })),
        activeAiChatId: chat.id,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      return runPromptEnhancementRequest({
        set,
        debouncedSave: deps.debouncedSave,
        chatId: chat.id,
        pendingMessageId,
        sourcePrompt,
        target: promptPreviewArtifact.target,
        generationOptions: {
          ...generationOptions,
          followUpInstruction,
        },
      });
    },

    setAiChatPromptArtifactDraft: (chatId: string, messageId: string, draft: string) => {
      set((state) => ({
        aiChats: updateChatById(state.aiChats, chatId, (chat) => ({
          ...chat,
          updatedAt: Date.now(),
          messages: chat.messages.map((message) =>
            message.id === messageId && message.artifact?.type === 'prompt-preview'
              ? {
                  ...message,
                  artifact: {
                    ...message.artifact,
                    draft,
                  },
                }
              : message,
          ),
        })),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
    },

    applyAiChatPromptArtifact: (chatId: string, messageId: string, prompt?: string) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      const message = chat?.messages.find((entry) => entry.id === messageId);
      if (message?.artifact?.type !== 'prompt-preview') {
        return;
      }

      const { target } = message.artifact;
      const nextPrompt = (prompt ?? message.artifact.draft).trim();
      if (!nextPrompt) {
        return;
      }

      const node = state.nodes.find((entry) => entry.id === target.nodeId);
      if (!isComfyNode(node)) {
        return;
      }

      const targetControl = node.workflowControls?.find(
        (control) => control.id === target.controlId,
      );
      const updatedNodes = state.nodes.map((entry) =>
        entry.id === node.id && isComfyNode(entry)
          ? {
              ...entry,
              selectedWorkflowId: targetControl?.workflowId ?? entry.selectedWorkflowId,
              workflowControls: (entry.workflowControls ?? []).map((control) =>
                control.id === target.controlId
                  ? {
                      ...control,
                      value: nextPrompt,
                    }
                  : control,
              ),
            }
          : entry,
      );

      deps.commitMutation(() => ({
        patch: {
          nodes: updatedNodes,
          aiChats: updateChatById(state.aiChats, chatId, (currentChat) => ({
            ...currentChat,
            updatedAt: Date.now(),
            messages: currentChat.messages.map((entry) =>
              entry.id === messageId && entry.artifact?.type === 'prompt-preview'
                ? {
                    ...entry,
                    artifact: {
                      ...entry.artifact,
                      draft: nextPrompt,
                    },
                  }
                : entry,
            ),
          })),
          selectedNodeId: node.id,
          aiApplyNotice: {
            id: createAiApplyNoticeId(),
            nodeId: node.id,
            field: 'prompt' as const,
            fieldId: target.controlId,
            label: `${target.controlLabel} updated`,
            createdAt: Date.now(),
          },
          activeAiChatId: chatId,
          activeTab: EditorTab.Flow,
          isSubPanelVisible: true,
        },
        history: {
          label: `Apply ${target.controlLabel} Prompt`,
          state: {
            nodes: updatedNodes,
            selectedNodeId: node.id,
          },
        },
        persist: 'debounced',
      }));
    },
  };
}
