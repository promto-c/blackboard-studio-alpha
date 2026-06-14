import type { SetState, GetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { createAiAgentActions } from './ai/aiAgentActions';
import { createAiChatActions } from './ai/aiChatActions';
import { createAiAssistantChatActions } from './ai/aiAssistantChatActions';
import { createAiShaderChatActions } from './ai/aiShaderChatActions';
import { createAiPromptEnhancementActions } from './ai/aiPromptEnhancementActions';
import { createAiBranchActions } from './ai/aiBranchActions';
import { createAiApplyActions } from './ai/aiApplyActions';

export function createAiActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation;
    debouncedSave: () => void;
  },
) {
  return {
    ...createAiAgentActions(set, get, deps),
    ...createAiChatActions(set, get, deps),
    ...createAiAssistantChatActions(set, get, deps),
    ...createAiShaderChatActions(set, get, deps),
    ...createAiPromptEnhancementActions(set, get, deps),
    ...createAiBranchActions(set, get, deps),
    ...createAiApplyActions(set, get, deps),
  };
}
