import {
  AiChatBranch,
  AiChatGradePreviewArtifact,
  AiChatMessage,
  AiChatThread,
  ComfyNode,
  HistoryEntry,
  NodeType,
  ImageNode,
  BlendMode,
  ImageFitMode,
  EditorTab,
  AiGenerationTaskInput,
  CustomShaderNode,
  AnyNode,
  GradeNode,
} from '@blackboard/types';
import { saveAsset } from '@/state/assetStorage';
import {
  generateAssistantChatTurn,
  generateInpainting,
  base64ToFile,
  generateImageFromText,
  generatePromptEnhancementResult,
  generateShaderChatTurn,
  type AssistantChatStreamUpdate,
  type GenerateAssistantChatOptions,
  type GenerateShaderCodeOptions,
  type PromptEnhancementOptions,
  type ShaderGenerationStreamUpdate,
} from '@/utils/ai';
import { setKeyframeValue } from '@/effects/effectAnimation';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import { isAiActionCapableNode, summarizeNodeForAiChat } from '@/utils/aiChatScope';
import { createAiNodeToolHandlers, supportsAiNodeTools } from '@/utils/aiNodeTools';
import { runOllamaToolAgent } from '@/utils/ollamaAgentRunner';
import {
  buildQueuedAiTask,
  enqueueAiTask,
  markAiTaskGenerating,
  applyAiTaskSuccess,
  applyAiTaskError,
  completeAiQueueHead,
} from '@/state/editor/services/aiQueue';
import type { SetState, GetState } from '@/state/editor/slices/types';

const createChatId = () => `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createChatMessageId = (role: 'user' | 'assistant') =>
  `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createChatBranchId = () => `branch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createChatBranchPointId = () =>
  `branch_point_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createAiApplyNoticeId = () =>
  `ai_apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const aiChatAbortControllers = new Map<string, AbortController>();

const isCustomShaderNode = (node: AnyNode | undefined | null): node is CustomShaderNode =>
  !!node && node.type === NodeType.CUSTOM_SHADER;
const isGradeNode = (node: AnyNode | undefined | null): node is GradeNode =>
  !!node && node.type === NodeType.GRADE;
const isComfyNode = (node: AnyNode | undefined | null): node is ComfyNode =>
  !!node && node.type === NodeType.COMFY;
const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

const getStoppedMessageContent = (message: AiChatMessage) => {
  const trimmedContent = message.content.trim();
  if (!trimmedContent) {
    return 'Stopped.';
  }
  return trimmedContent;
};

const getResolvedAiProvider = (
  provider: GenerateAssistantChatOptions['provider'],
): 'gemini' | 'ollama' | 'openai' =>
  provider === 'ollama' ? 'ollama' : provider === 'openai' ? 'openai' : 'gemini';

const getResolvedAiModel = (
  options: Pick<
    GenerateAssistantChatOptions,
    'provider' | 'geminiModel' | 'openAiModel' | 'ollamaModel'
  >,
): string =>
  getResolvedAiProvider(options.provider) === 'ollama'
    ? options.ollamaModel?.trim() || ''
    : getResolvedAiProvider(options.provider) === 'openai'
      ? options.openAiModel?.trim() || ''
      : options.geminiModel?.trim() || 'gemini-2.5-flash';

const getLastPendingAssistantMessageIndex = (messages: AiChatMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.status === 'pending') {
      return index;
    }
  }
  return -1;
};

const getDefaultChatBranchId = (chat: AiChatThread) => `${chat.id}_branch_original`;

const createOriginalChatBranch = (chat: AiChatThread): AiChatBranch => ({
  id: getDefaultChatBranchId(chat),
  label: 'Original',
  source: 'original',
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
  messages: chat.messages,
});

const syncActiveChatBranch = (chat: AiChatThread): AiChatThread => {
  if (!chat.branches?.length || !chat.activeBranchId) {
    return chat;
  }

  return {
    ...chat,
    branches: chat.branches.map((branch) =>
      branch.id === chat.activeBranchId
        ? {
            ...branch,
            updatedAt: chat.updatedAt,
            messages: chat.messages,
          }
        : branch,
    ),
  };
};

const ensureChatBranchState = (chat: AiChatThread): AiChatThread => {
  if (chat.branches?.length && chat.activeBranchId) {
    return syncActiveChatBranch(chat);
  }

  const originalBranch = createOriginalChatBranch(chat);
  return {
    ...chat,
    activeBranchId: originalBranch.id,
    branches: [originalBranch],
  };
};

const setMessageBranchPoint = (
  messages: AiChatMessage[],
  messageId: string,
  branchPointId: string,
) =>
  messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          branchPointId,
        }
      : message,
  );

const addBranchVariantGroup = (branch: AiChatBranch, branchPointId: string): AiChatBranch => ({
  ...branch,
  variantOfBranchPointIds: Array.from(
    new Set([...(branch.variantOfBranchPointIds ?? []), branchPointId]),
  ),
});

const getMessageBranchPointIndex = (messages: AiChatMessage[], branchPointId: string) =>
  messages.findIndex((message) => message.branchPointId === branchPointId);

const getBranchLabel = (
  branches: AiChatBranch[],
  branchPointId: string,
  source: 'edit' | 'regenerate',
) => {
  const variantCount = branches.filter((branch) =>
    branch.messages.some((message) => message.branchPointId === branchPointId),
  ).length;
  return source === 'edit' ? `Edit ${variantCount + 1}` : `Try ${variantCount + 1}`;
};

type ChatPromptBranchPoints = {
  userBranchPointId?: string;
  assistantBranchPointId?: string;
};

type PreparedChatBranchPrompt = {
  prompt: string;
  attachments: AiChatMessage['attachments'];
  branchPoints: ChatPromptBranchPoints;
};

const getShaderChatTitle = (node: CustomShaderNode) => `${node.name} Chat`;
const getAssistantChatTitle = (node?: AnyNode | null) =>
  node ? `${node.name} Assistant` : 'Assistant Chat';
const createShaderNodeId = () =>
  `custom_shader_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const updateChatById = (
  chats: AiChatThread[],
  chatId: string,
  updater: (chat: AiChatThread) => AiChatThread,
): AiChatThread[] =>
  chats.map((chat) => (chat.id === chatId ? syncActiveChatBranch(updater(chat)) : chat));

const getPreferredShaderNodeName = (chat: AiChatThread) => {
  const titleWithoutSuffix = chat.title.replace(/\s+chat$/i, '').trim();
  return titleWithoutSuffix || 'Shader';
};

const createUniqueShaderNodeName = (nodes: AnyNode[], preferredName: string) => {
  const takenNames = new Set(nodes.map((node) => node.name));
  if (!takenNames.has(preferredName)) {
    return preferredName;
  }

  let nextIndex = 2;
  while (takenNames.has(`${preferredName} ${nextIndex}`)) {
    nextIndex += 1;
  }

  return `${preferredName} ${nextIndex}`;
};

const createCustomShaderNodeFromCode = (
  nodes: AnyNode[],
  chat: AiChatThread,
  shaderCode: string,
): CustomShaderNode => {
  const name = createUniqueShaderNodeName(nodes, getPreferredShaderNodeName(chat));

  return {
    id: createShaderNodeId(),
    type: NodeType.CUSTOM_SHADER,
    name,
    visible: true,
    fragmentShader: shaderCode,
    uniforms: parseUniformsFromGLSL(shaderCode),
  };
};

const applyShaderCodeToNodes = (nodes: AnyNode[], nodeId: string, shaderCode: string): AnyNode[] =>
  nodes.map((node) =>
    node.id === nodeId && node.type === NodeType.CUSTOM_SHADER
      ? ({
          ...node,
          fragmentShader: shaderCode,
          uniforms: parseUniformsFromGLSL(shaderCode),
        } as CustomShaderNode)
      : node,
  );

const applyGradePreviewToNodes = (
  nodes: AnyNode[],
  nodeId: string,
  values: AiChatGradePreviewArtifact['values'],
  frame: number,
) => {
  let nextNodes = setKeyframeValue(nodes, nodeId, 'grade.brightness', frame, values.brightness);
  nextNodes = setKeyframeValue(nextNodes, nodeId, 'grade.contrast', frame, values.contrast);
  nextNodes = setKeyframeValue(nextNodes, nodeId, 'grade.saturation', frame, values.saturation);
  return nextNodes;
};

const updateChatGradePreview = (
  chat: AiChatThread,
  preview: AiChatGradePreviewArtifact | null,
): AiChatThread => ({
  ...chat,
  toolState: {
    ...chat.toolState,
    gradePreview: preview ?? undefined,
  },
});

const buildShaderArtifactFromStream = (
  existingMessage: AiChatMessage,
  update: ShaderGenerationStreamUpdate,
) => {
  const existingArtifact =
    existingMessage.artifact?.type === 'shader' ? existingMessage.artifact : undefined;

  if (!update.shaderCode.trim() && !(update.suggestions.length > 0) && !existingArtifact) {
    return existingMessage.artifact;
  }

  return {
    type: 'shader' as const,
    code: update.shaderCode || existingArtifact?.code || '',
    provider: update.provider,
    model: update.model,
    suggestions: update.suggestions.length > 0 ? update.suggestions : existingArtifact?.suggestions,
    validationErrors: existingArtifact?.validationErrors,
  };
};

const ensureShaderChatThread = (
  chats: AiChatThread[],
  node: CustomShaderNode,
): { chats: AiChatThread[]; chat: AiChatThread } => {
  const existingChat = chats.find((chat) => chat.feature === 'shader' && chat.nodeId === node.id);
  if (existingChat) {
    const nextExistingChat = {
      ...existingChat,
      title: getShaderChatTitle(node),
    };
    return {
      chats: updateChatById(chats, existingChat.id, () => nextExistingChat),
      chat: nextExistingChat,
    };
  }

  const timestamp = Date.now();
  const nextChat: AiChatThread = {
    id: createChatId(),
    title: getShaderChatTitle(node),
    feature: 'shader',
    nodeId: node.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'idle',
    messages: [],
  };

  return {
    chats: [nextChat, ...chats],
    chat: nextChat,
  };
};

const createAssistantChatThread = (
  chats: AiChatThread[],
  node?: AnyNode | null,
): { chats: AiChatThread[]; chat: AiChatThread } => {
  const timestamp = Date.now();
  const nextChat: AiChatThread = {
    id: createChatId(),
    title: getAssistantChatTitle(node),
    feature: 'assistant',
    nodeId: node?.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'idle',
    messages: [],
  };

  return {
    chats: [nextChat, ...chats],
    chat: nextChat,
  };
};

const getLatestPromptPreviewMessage = (chat: AiChatThread) => {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.artifact?.type === 'prompt-preview') {
      return message;
    }
  }

  return null;
};

export function createAiActions(
  set: SetState,
  get: GetState,
  deps: {
    pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
    debouncedSave: () => void;
    getGeminiApiKey?: () => string;
  },
) {
  return {
    setActiveAiChat: (chatId: string | null) => {
      set(() => ({
        activeAiChatId: chatId,
        activeTab: chatId ? EditorTab.Chats : get().activeTab,
        isSubPanelVisible: chatId ? true : get().isSubPanelVisible,
      }));
      deps.debouncedSave();
    },

    stopAiChat: (chatId: string) => {
      aiChatAbortControllers.get(chatId)?.abort();
      aiChatAbortControllers.delete(chatId);

      set((state) => ({
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
      }));
      deps.debouncedSave();
    },

    removeAiChat: (chatId: string) => {
      aiChatAbortControllers.get(chatId)?.abort();
      aiChatAbortControllers.delete(chatId);

      set((state) => {
        const remainingChats = state.aiChats.filter((chat) => chat.id !== chatId);
        const activeAiChatId =
          state.activeAiChatId === chatId ? (remainingChats[0]?.id ?? null) : state.activeAiChatId;

        return {
          aiChats: remainingChats,
          activeAiChatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        };
      });
      deps.debouncedSave();
    },

    openShaderChat: (nodeId: string) => {
      const node = get().nodes.find((candidate) => candidate.id === nodeId);
      if (!isCustomShaderNode(node)) {
        return null;
      }

      const { chats, chat } = ensureShaderChatThread(get().aiChats, node);
      set(() => ({
        aiChats: chats,
        activeAiChatId: chat.id,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
      return chat.id;
    },

    openAssistantChat: (nodeId?: string | null) => {
      const node = nodeId
        ? (get().nodes.find((candidate) => candidate.id === nodeId) ?? null)
        : null;
      const { chats, chat } = createAssistantChatThread(get().aiChats, node);

      set(() => ({
        aiChats: chats,
        activeAiChatId: chat.id,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
      return chat.id;
    },

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

      try {
        const result = await generatePromptEnhancementResult(prompt, {
          ...generationOptions,
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) {
          return chat.id;
        }

        const options = result.options.length > 0 ? result.options : [prompt];
        const assistantMessage: AiChatMessage = {
          id: pendingMessageId,
          role: 'assistant',
          content: result.message,
          createdAt: Date.now(),
          status: 'complete',
          isThinking: false,
          provider: result.provider,
          model: result.model,
          artifact: {
            type: 'prompt-preview',
            originalPrompt: prompt,
            options,
            draft: options[0] ?? prompt,
            suggestions: result.suggestions,
            summary: result.message,
            provider: result.provider,
            model: result.model,
            target: {
              kind: 'comfy-control',
              nodeId: node.id,
              controlId: control.id,
              controlLabel: control.label,
              inputName: control.inputName,
            },
          },
        };

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, chat.id, (currentChat) => ({
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
        }));
        deps.debouncedSave();
        return chat.id;
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
          return chat.id;
        }

        const message =
          error instanceof Error ? error.message : 'Prompt enhancement chat failed unexpectedly.';

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
        throw error;
      } finally {
        if (aiChatAbortControllers.get(chat.id) === abortController) {
          aiChatAbortControllers.delete(chat.id);
        }
      }
    },

    setAiChatNodeContext: (chatId: string, nodeId: string | null) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat || chat.feature !== 'assistant') {
        return;
      }

      const node = nodeId
        ? (state.nodes.find((candidate) => candidate.id === nodeId) ?? null)
        : null;
      set(() => ({
        aiChats: updateChatById(state.aiChats, chatId, (currentChat) => ({
          ...updateChatGradePreview(currentChat, null),
          nodeId: node?.id,
          title: getAssistantChatTitle(node),
          updatedAt: Date.now(),
        })),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
    },

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

      set(() => ({
        aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
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

      set(() => ({
        aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
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

      set(() => ({
        aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      return {
        prompt: sourceUserMessage.content,
        attachments: sourceUserMessage.attachments,
        branchPoints: {
          userBranchPointId: sourceUserMessage.branchPointId,
          assistantBranchPointId: branchPointId,
        },
      };
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

      aiChatAbortControllers.get(chat.id)?.abort();
      const abortController = new AbortController();
      aiChatAbortControllers.set(chat.id, abortController);

      set(() => ({
        aiChats: state.aiChats.map((entry) => (entry.id === chatId ? nextChat : entry)),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();

      try {
        const result = await generatePromptEnhancementResult(prompt, {
          ...generationOptions,
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) {
          return chatId;
        }

        const options = result.options.length > 0 ? result.options : [prompt];
        const assistantMessage: AiChatMessage = {
          id: pendingMessageId,
          role: 'assistant',
          content: result.message,
          createdAt: Date.now(),
          status: 'complete',
          isThinking: false,
          provider: result.provider,
          model: result.model,
          branchPointId,
          artifact: {
            type: 'prompt-preview',
            originalPrompt: prompt,
            options,
            draft: options[0] ?? prompt,
            suggestions: result.suggestions,
            summary: result.message,
            provider: result.provider,
            model: result.model,
            target: promptPreviewArtifact.target,
          },
        };

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, chatId, (currentChat) => ({
            ...currentChat,
            status: 'idle',
            lastError: undefined,
            updatedAt: Date.now(),
            messages: currentChat.messages.map((message) =>
              message.id === pendingMessageId ? assistantMessage : message,
            ),
          })),
          activeAiChatId: chatId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        }));
        deps.debouncedSave();
        return chatId;
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          set((currentState) => ({
            aiChats: updateChatById(currentState.aiChats, chatId, (currentChat) => ({
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
            activeAiChatId: chatId,
            activeTab: EditorTab.Chats,
            isSubPanelVisible: true,
          }));
          deps.debouncedSave();
          return chatId;
        }

        const message =
          error instanceof Error ? error.message : 'Prompt enhancement chat failed unexpectedly.';

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, chatId, (currentChat) => ({
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
                    branchPointId,
                  }
                : entry,
            ),
          })),
          activeAiChatId: chatId,
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

      aiChatAbortControllers.get(chat.id)?.abort();
      const abortController = new AbortController();
      aiChatAbortControllers.set(chat.id, abortController);

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

      try {
        const result = await generatePromptEnhancementResult(sourcePrompt, {
          ...generationOptions,
          followUpInstruction,
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) {
          return chat.id;
        }

        const options = result.options.length > 0 ? result.options : [sourcePrompt];
        const assistantMessage: AiChatMessage = {
          id: pendingMessageId,
          role: 'assistant',
          content: result.message,
          createdAt: Date.now(),
          status: 'complete',
          isThinking: false,
          provider: result.provider,
          model: result.model,
          artifact: {
            type: 'prompt-preview',
            originalPrompt: sourcePrompt,
            options,
            draft: options[0] ?? sourcePrompt,
            suggestions: result.suggestions,
            summary: result.message,
            provider: result.provider,
            model: result.model,
            target: promptPreviewArtifact.target,
          },
        };

        set((currentState) => ({
          aiChats: updateChatById(currentState.aiChats, chat.id, (currentChat) => ({
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
        }));
        deps.debouncedSave();
        return chat.id;
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
          return chat.id;
        }

        const message =
          error instanceof Error ? error.message : 'Prompt enhancement chat failed unexpectedly.';

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

    startAssistantChat: async (
      prompt: string,
      generationOptions: GenerateAssistantChatOptions = {},
      chatId?: string | null,
      contextNodeId?: string | null,
      branchPoints?: ChatPromptBranchPoints,
    ) => {
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
        }));
      const nextChats = updateChatById(chats, chat.id, (currentChat) => ({
        ...currentChat,
        status: 'generating',
        lastError: undefined,
        updatedAt: Date.now(),
        messages: [...currentChat.messages, userMessage, pendingMessage],
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
                  }
                : message,
            ),
          })),
        }));
      };

      try {
        const shouldUseNodeTools =
          generationOptions.provider === 'ollama' &&
          supportsAiNodeTools(contextNode) &&
          Boolean(generationOptions.ollamaModel?.trim());

        const result = shouldUseNodeTools
          ? await runOllamaToolAgent({
              endpoint: generationOptions.ollamaEndpoint?.trim() || 'http://localhost:11434',
              model: generationOptions.ollamaModel!.trim(),
              prompt: requestPrompt,
              contextSummary: summarizeNodeForAiChat(contextNode),
              history,
              attachments,
              tools: createAiNodeToolHandlers(contextNode, {
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
                                model: generationOptions.ollamaModel?.trim(),
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
                                      model: generationOptions.ollamaModel?.trim(),
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
              }),
              onStreamUpdate: handleAssistantStreamUpdate,
              signal: abortController.signal,
              enableThinking: generationOptions.enableThinking,
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
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
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
          return;
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

    clearAiChatGradePreview: (chatId: string) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      if (!chat?.toolState?.gradePreview) {
        return;
      }

      set(() => ({
        aiChats: updateChatById(state.aiChats, chatId, (currentChat) =>
          updateChatGradePreview(currentChat, null),
        ),
        activeAiChatId: chatId,
        activeTab: EditorTab.Chats,
        isSubPanelVisible: true,
      }));
      deps.debouncedSave();
    },

    applyAiChatGradePreview: (chatId: string) => {
      const state = get();
      const chat = state.aiChats.find((entry) => entry.id === chatId);
      const preview = chat?.toolState?.gradePreview;
      const node = chat?.nodeId ? state.nodes.find((entry) => entry.id === chat.nodeId) : null;
      if (!preview || !isGradeNode(node) || !chat?.nodeId) {
        return;
      }

      const updatedNodes = applyGradePreviewToNodes(
        state.nodes,
        chat.nodeId,
        preview.values,
        state.currentFrame,
      );

      set(() => ({
        nodes: updatedNodes,
        aiChats: updateChatById(state.aiChats, chatId, (currentChat) =>
          updateChatGradePreview(currentChat, null),
        ),
        selectedNodeId: chat.nodeId,
        aiApplyNotice: {
          id: createAiApplyNoticeId(),
          nodeId: chat.nodeId,
          field: 'grade',
          label: `${node.name} grade updated`,
          createdAt: Date.now(),
        },
        activeAiChatId: chatId,
        activeTab: EditorTab.Flow,
        isSubPanelVisible: true,
      }));
      deps.pushHistory({
        label: `Apply ${node.name} AI Preview`,
        state: {
          nodes: updatedNodes,
          selectedNodeId: chat.nodeId,
          currentFrame: state.currentFrame,
        },
      });
      deps.debouncedSave();
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

      set(() => ({
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
          field: 'prompt',
          fieldId: target.controlId,
          label: `${target.controlLabel} updated`,
          createdAt: Date.now(),
        },
        activeAiChatId: chatId,
        activeTab: EditorTab.Flow,
        isSubPanelVisible: true,
      }));
      deps.pushHistory({
        label: `Apply ${target.controlLabel} Prompt`,
        state: {
          nodes: updatedNodes,
          selectedNodeId: node.id,
        },
      });
      deps.debouncedSave();
    },

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

        set((currentState) => ({
          nodes: updatedNodes,
          aiChats: updateChatById(currentState.aiChats, chat.id, (currentChat) => ({
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
        }));
        deps.pushHistory({
          label: `AI Update ${node.name} Shader`,
          state: { nodes: updatedNodes, selectedNodeId: get().selectedNodeId },
        });
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

        set(() => ({
          nodes: newNodes,
          aiChats: relinkedChats,
          selectedNodeId: newNode.id,
          aiApplyNotice: {
            id: createAiApplyNoticeId(),
            nodeId: newNode.id,
            field: 'shader',
            label: `${newNode.name} shader created`,
            createdAt: Date.now(),
          },
          activeAiChatId: chatId,
          activeTab: EditorTab.Flow,
          isSubPanelVisible: true,
        }));
        deps.pushHistory({
          label: `Create ${newNode.name} from Chat Shader`,
          state: { nodes: newNodes, selectedNodeId: newNode.id },
        });
        deps.debouncedSave();
        return;
      }

      const updatedNodes = applyShaderCodeToNodes(state.nodes, chat.nodeId, message.artifact.code);
      set(() => ({
        nodes: updatedNodes,
        selectedNodeId: chat.nodeId,
        aiApplyNotice: {
          id: createAiApplyNoticeId(),
          nodeId: chat.nodeId,
          field: 'shader',
          label: `${node.name} shader updated`,
          createdAt: Date.now(),
        },
        activeAiChatId: chatId,
        activeTab: EditorTab.Flow,
        isSubPanelVisible: true,
      }));
      deps.pushHistory({
        label: `Apply ${node.name} Chat Shader`,
        state: { nodes: updatedNodes, selectedNodeId: chat.nodeId },
      });
    },

    startAiEditing: (nodeId: string) => set(() => ({ aiEditingNodeId: nodeId })),
    stopAiEditing: () => set(() => ({ aiEditingNodeId: null })),

    createAiNode: async (sourceNodeId?: string) => {
      const { nodes } = get();
      const newNodeId = `ai_${Date.now()}`;

      const sourceNode = sourceNodeId
        ? (nodes.find((l) => l.id === sourceNodeId) as ImageNode)
        : undefined;

      const newNode: ImageNode = {
        id: newNodeId,
        type: NodeType.IMAGE,
        name: 'AI Generation',
        visible: true,
        src: '',
        width: sourceNode ? sourceNode.width : 1024,
        height: sourceNode ? sourceNode.height : 1024,
        opacity: 100,
        operator: BlendMode.OVER,
        colorSpace: 'sRGB',
        transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.FIT },
        aiMetadata: {
          sourceNodeId,
          prompt: '',
          variants: [],
          activeVariantIndex: -1,
        },
      };

      const newNodes = [...nodes];
      if (sourceNodeId) {
        const idx = newNodes.findIndex((l) => l.id === sourceNodeId);
        newNodes.splice(idx + 1, 0, newNode);
      } else {
        newNodes.push(newNode);
      }

      set(() => ({
        nodes: newNodes,
        selectedNodeId: newNodeId,
        aiEditingNodeId: newNodeId,
        activeTab: EditorTab.Flow,
      }));
      deps.pushHistory({
        label: 'New AI Node',
        state: { nodes: newNodes, selectedNodeId: newNodeId },
      });
    },

    addAiTaskToQueue: (taskDetails: AiGenerationTaskInput) => {
      const queuedTask = buildQueuedAiTask(taskDetails);
      set((s) => {
        const { nodes, queue } = enqueueAiTask(s.nodes, s.aiGenerationQueue, queuedTask);
        return { aiGenerationQueue: queue, nodes };
      });
    },

    _processAiQueue: async () => {
      const { isAiCurrentlyGenerating, aiGenerationQueue } = get();
      if (isAiCurrentlyGenerating || aiGenerationQueue.length === 0) return;

      set(() => ({ isAiCurrentlyGenerating: true }));
      const task = aiGenerationQueue[0];

      set((s) => ({ nodes: markAiTaskGenerating(s.nodes, task) }));

      try {
        let base64Image: string;
        const geminiApiKey = deps.getGeminiApiKey?.();
        if (task.isTextToImage) {
          base64Image = await generateImageFromText(task.prompt, task.aspectRatio || '1:1', {
            geminiApiKey,
          });
        } else if (task.maskedImageBase64) {
          base64Image = await generateInpainting(task.maskedImageBase64, task.prompt, {
            geminiApiKey,
          });
        } else {
          throw new Error('Invalid task configuration');
        }

        const file = base64ToFile(base64Image, `ai_gen_${Date.now()}.png`);
        const assetId = await saveAsset(file);
        const img = new Image();
        img.src = base64Image;
        await new Promise((r) => {
          img.onload = r;
        });

        set((s) => ({
          nodes: applyAiTaskSuccess(s.nodes, task, {
            assetId,
            width: img.naturalWidth,
            height: img.naturalHeight,
          }),
        }));
      } catch (error) {
        console.error('AI Task Failed', error);
        set((s) => ({
          nodes: applyAiTaskError(
            s.nodes,
            task,
            error instanceof Error ? error.message : 'Generation Failed',
          ),
        }));
      } finally {
        set((s) => {
          const { nodes, queue } = completeAiQueueHead(s.nodes, s.aiGenerationQueue);
          return { aiGenerationQueue: queue, isAiCurrentlyGenerating: false, nodes };
        });
      }
    },

    setAiNodeError: (nodeId: string, error: string | null) => {
      set((s) => ({
        nodes: s.nodes.map((l) =>
          l.id === nodeId && (l as ImageNode).aiMetadata
            ? {
                ...l,
                aiMetadata: {
                  ...(l as ImageNode).aiMetadata!,
                  lastError: error || undefined,
                },
              }
            : l,
        ),
      }));
    },

    setActiveVariant: (nodeId: string, variantIndex: number) => {
      set((s) => {
        const newNodes = s.nodes.map((l) => {
          if (l.id === nodeId && (l as ImageNode).aiMetadata) {
            const node = l as ImageNode;
            const variant = node.aiMetadata!.variants[variantIndex];
            if (!variant || variant.status) return node;
            return {
              ...node,
              src: variant.src,
              width: variant.width ?? node.width,
              height: variant.height ?? node.height,
              aiMetadata: {
                ...node.aiMetadata!,
                activeVariantIndex: variantIndex,
                prompt: variant.prompt,
              },
            };
          }
          return l;
        });
        return { nodes: newNodes };
      });
    },

    setAiSourceNode: (aiNodeId: string, sourceNodeId: string) => {
      set((s) => ({
        nodes: s.nodes.map((l) =>
          l.id === aiNodeId && (l as ImageNode).aiMetadata
            ? {
                ...l,
                aiMetadata: { ...(l as ImageNode).aiMetadata!, sourceNodeId },
              }
            : l,
        ),
      }));
    },
  };
}
