import { EditorTab } from '@blackboard/types';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { createAiApplyNoticeId, updateChatById } from './helpers/chat';
import { applyGradePreviewToNodes, isGradeNode, updateChatGradePreview } from './helpers/grade';

export function createAiApplyActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
  },
) {
  return {
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

      deps.commitMutation({
        patch: {
          nodes: updatedNodes,
          aiChats: updateChatById(state.aiChats, chatId, (currentChat) =>
            updateChatGradePreview(currentChat, null),
          ),
          selectedNodeId: chat.nodeId,
          aiApplyNotice: {
            id: createAiApplyNoticeId(),
            nodeId: chat.nodeId,
            field: 'grade' as const,
            label: `${node.name} grade updated`,
            createdAt: Date.now(),
          },
          activeAiChatId: chatId,
          activeTab: EditorTab.Flow,
          isSubPanelVisible: true,
        },
        history: {
          label: `Apply ${node.name} AI Preview`,
          state: {
            nodes: updatedNodes,
            selectedNodeId: chat.nodeId,
            currentFrame: state.currentFrame,
          },
        },
        persist: 'debounced',
      });
    },
  };
}
