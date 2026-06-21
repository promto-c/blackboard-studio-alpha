import type { AiProvider } from '@blackboard/types';

export const resolveTextAiProvider = (provider: AiProvider | undefined): AiProvider =>
  provider === 'ollama' ? 'ollama' : provider === 'openai' ? 'openai' : 'gemini';

export const getAiProviderLabel = (provider: AiProvider): string =>
  provider === 'ollama' ? 'Ollama' : provider === 'openai' ? 'OpenAI' : 'Gemini';
