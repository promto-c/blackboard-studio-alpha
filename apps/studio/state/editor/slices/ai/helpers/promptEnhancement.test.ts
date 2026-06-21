import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiChatThread } from '@blackboard/types';
import type { EditorState, SetState } from '@/state/editor/slices/types';
import { aiChatAbortControllers } from './chat';
import { runPromptEnhancementRequest } from './promptEnhancement';

const generatePromptEnhancementResult = vi.hoisted(() => vi.fn());

vi.mock('@/utils/ai', () => ({
  generatePromptEnhancementResult,
}));

const target = {
  kind: 'comfy-control' as const,
  nodeId: 'node-1',
  controlId: 'prompt',
  controlLabel: 'Prompt',
  inputName: 'text',
};

const createHarness = () => {
  const chat: AiChatThread = {
    id: 'chat-1',
    title: 'Prompt Assistant',
    feature: 'assistant',
    createdAt: 1,
    updatedAt: 1,
    status: 'generating',
    messages: [
      {
        id: 'assistant-pending',
        role: 'assistant',
        content: '',
        createdAt: 1,
        status: 'pending',
      },
    ],
  };
  let state = { aiChats: [chat], activeAiChatId: null } as EditorState;
  const set: SetState = (update) => {
    state = { ...state, ...update(state) };
  };

  return {
    getState: () => state,
    set,
    debouncedSave: vi.fn(),
  };
};

describe('runPromptEnhancementRequest', () => {
  beforeEach(() => {
    generatePromptEnhancementResult.mockReset();
    aiChatAbortControllers.clear();
  });

  afterEach(() => {
    aiChatAbortControllers.clear();
  });

  it('creates a prompt preview from a successful provider result', async () => {
    generatePromptEnhancementResult.mockResolvedValue({
      message: 'Choose a direction.',
      options: ['A cinematic rain-soaked street with reflected neon.'],
      suggestions: ['More contrast'],
      provider: 'ollama',
      model: 'image-local',
    });
    const harness = createHarness();

    await runPromptEnhancementRequest({
      ...harness,
      chatId: 'chat-1',
      pendingMessageId: 'assistant-pending',
      sourcePrompt: 'a rainy street',
      target,
      generationOptions: { provider: 'ollama', ollamaModel: 'image-local' },
    });

    const state = harness.getState();
    const message = state.aiChats[0]?.messages[0];
    expect(state.aiChats[0]?.status).toBe('idle');
    expect(message).toEqual(
      expect.objectContaining({
        status: 'complete',
        provider: 'ollama',
        model: 'image-local',
        artifact: expect.objectContaining({
          type: 'prompt-preview',
          originalPrompt: 'a rainy street',
          draft: 'A cinematic rain-soaked street with reflected neon.',
          target,
        }),
      }),
    );
    expect(harness.debouncedSave).toHaveBeenCalledOnce();
    expect(aiChatAbortControllers.has('chat-1')).toBe(false);
  });

  it('stores provider failures as chat errors without creating an artifact', async () => {
    const error = new Error("Ollama request failed: model 'missing-model' not found");
    generatePromptEnhancementResult.mockRejectedValue(error);
    const harness = createHarness();

    await expect(
      runPromptEnhancementRequest({
        ...harness,
        chatId: 'chat-1',
        pendingMessageId: 'assistant-pending',
        sourcePrompt: 'a rainy street',
        target,
        generationOptions: { provider: 'ollama', ollamaModel: 'missing-model' },
      }),
    ).rejects.toBe(error);

    const state = harness.getState();
    const message = state.aiChats[0]?.messages[0];
    expect(state.aiChats[0]?.status).toBe('error');
    expect(state.aiChats[0]?.lastError).toBe(error.message);
    expect(message).toEqual(
      expect.objectContaining({
        content: error.message,
        status: 'error',
      }),
    );
    expect(message?.artifact).toBeUndefined();
    expect(harness.debouncedSave).toHaveBeenCalledOnce();
    expect(aiChatAbortControllers.has('chat-1')).toBe(false);
  });

  it('does not let a replaced request overwrite the newer chat state', async () => {
    const replacementController = new AbortController();
    generatePromptEnhancementResult.mockImplementation(async () => {
      aiChatAbortControllers.set('chat-1', replacementController);
      throw new DOMException('Replaced', 'AbortError');
    });
    const harness = createHarness();

    await runPromptEnhancementRequest({
      ...harness,
      chatId: 'chat-1',
      pendingMessageId: 'assistant-pending',
      sourcePrompt: 'a rainy street',
      target,
      generationOptions: { provider: 'ollama', ollamaModel: 'image-local' },
    });

    const state = harness.getState();
    expect(state.aiChats[0]?.status).toBe('generating');
    expect(state.aiChats[0]?.messages[0]?.status).toBe('pending');
    expect(harness.debouncedSave).not.toHaveBeenCalled();
    expect(aiChatAbortControllers.get('chat-1')).toBe(replacementController);
  });
});
