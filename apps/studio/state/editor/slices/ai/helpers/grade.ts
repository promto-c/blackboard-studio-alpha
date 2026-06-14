import {
  AiChatGradePreviewArtifact,
  AiChatThread,
  AnyNode,
  GradeNode,
  NodeType,
} from '@blackboard/types';
import { setKeyframeValue } from '@/nodes/animation';

export const isGradeNode = (node: AnyNode | undefined | null): node is GradeNode =>
  !!node && node.type === NodeType.GRADE;

export const applyGradePreviewToNodes = (
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

export const updateChatGradePreview = (
  chat: AiChatThread,
  preview: AiChatGradePreviewArtifact | null,
): AiChatThread => ({
  ...chat,
  toolState: {
    ...chat.toolState,
    gradePreview: preview ?? undefined,
  },
});
