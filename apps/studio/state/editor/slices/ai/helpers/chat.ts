import {
  AiChatBranch,
  AiChatMessage,
  AiChatThread,
  AnyNode,
  CustomShaderNode,
} from '@blackboard/types';
import type { GenerateAssistantChatOptions } from '@/utils/ai';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type ChatPromptBranchPoints = {
  userBranchPointId?: string;
  assistantBranchPointId?: string;
};

export type PreparedChatBranchPrompt = {
  prompt: string;
  attachments: AiChatMessage['attachments'];
  branchPoints: ChatPromptBranchPoints;
};

export type StartAssistantChatResult = {
  chatId: string;
  assistantMessageId?: string;
  assistantContent?: string;
  stopped?: boolean;
};

/* ------------------------------------------------------------------ */
/*  ID generators                                                     */
/* ------------------------------------------------------------------ */

export const createChatId = () => `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const createChatMessageId = (role: 'user' | 'assistant') =>
  `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const createChatBranchId = () =>
  `branch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const createChatBranchPointId = () =>
  `branch_point_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const createAiApplyNoticeId = () =>
  `ai_apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/*  Abort controller map                                              */
/* ------------------------------------------------------------------ */

export const aiChatAbortControllers = new Map<string, AbortController>();

/* ------------------------------------------------------------------ */
/*  Message helpers                                                   */
/* ------------------------------------------------------------------ */

export const getStoppedMessageContent = (message: AiChatMessage) => {
  const trimmedContent = message.content.trim();
  if (!trimmedContent) {
    return 'Stopped.';
  }
  return trimmedContent;
};

export const getLastPendingAssistantMessageIndex = (messages: AiChatMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.status === 'pending') {
      return index;
    }
  }
  return -1;
};

/* ------------------------------------------------------------------ */
/*  Provider resolution helpers                                       */
/* ------------------------------------------------------------------ */

export const getResolvedAiProvider = (
  provider: GenerateAssistantChatOptions['provider'],
): 'gemini' | 'ollama' | 'openai' =>
  provider === 'ollama' ? 'ollama' : provider === 'openai' ? 'openai' : 'gemini';

export const getResolvedAiModel = (
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

/* ------------------------------------------------------------------ */
/*  Chat title helpers                                                */
/* ------------------------------------------------------------------ */

export const getShaderChatTitle = (node: CustomShaderNode) => `${node.name} Chat`;
export const getAssistantChatTitle = (node?: AnyNode | null) =>
  node ? `${node.name} Assistant` : 'Assistant Chat';

/* ------------------------------------------------------------------ */
/*  Branch helpers                                                    */
/* ------------------------------------------------------------------ */

export const getDefaultChatBranchId = (chat: AiChatThread) => `${chat.id}_branch_original`;

const createOriginalChatBranch = (chat: AiChatThread): AiChatBranch => ({
  id: getDefaultChatBranchId(chat),
  label: 'Original',
  source: 'original',
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
  messages: chat.messages,
});

export const syncActiveChatBranch = (chat: AiChatThread): AiChatThread => {
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

export const ensureChatBranchState = (chat: AiChatThread): AiChatThread => {
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

export const setMessageBranchPoint = (
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

export const addBranchVariantGroup = (
  branch: AiChatBranch,
  branchPointId: string,
): AiChatBranch => ({
  ...branch,
  variantOfBranchPointIds: Array.from(
    new Set([...(branch.variantOfBranchPointIds ?? []), branchPointId]),
  ),
});

export const getMessageBranchPointIndex = (messages: AiChatMessage[], branchPointId: string) =>
  messages.findIndex((message) => message.branchPointId === branchPointId);

export const getBranchLabel = (
  branches: AiChatBranch[],
  branchPointId: string,
  source: 'edit' | 'regenerate',
) => {
  const variantCount = branches.filter((branch) =>
    branch.messages.some((message) => message.branchPointId === branchPointId),
  ).length;
  return source === 'edit' ? `Edit ${variantCount + 1}` : `Try ${variantCount + 1}`;
};

/* ------------------------------------------------------------------ */
/*  Chat thread helpers                                               */
/* ------------------------------------------------------------------ */

export const updateChatById = (
  chats: AiChatThread[],
  chatId: string,
  updater: (chat: AiChatThread) => AiChatThread,
): AiChatThread[] =>
  chats.map((chat) => (chat.id === chatId ? syncActiveChatBranch(updater(chat)) : chat));

export const ensureShaderChatThread = (
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

export const createAssistantChatThread = (
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

export const getLatestPromptPreviewMessage = (chat: AiChatThread) => {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.artifact?.type === 'prompt-preview') {
      return message;
    }
  }

  return null;
};
