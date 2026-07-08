import type { AiProvider } from '@blackboard/types';

export const resolveTextAiProvider = (provider: AiProvider | undefined): AiProvider =>
  provider === 'openai' ? 'openai' : 'ollama';

export const getAiProviderLabel = (provider: AiProvider): string =>
  provider === 'openai' ? 'OpenAI' : 'Ollama';
