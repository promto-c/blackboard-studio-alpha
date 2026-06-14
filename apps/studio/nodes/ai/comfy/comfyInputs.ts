import type { ComfyWorkflow, ComfyWorkflowInputCandidate } from '@blackboard/types';
import { isJsonObject } from '@/utils/guards';
import { normalizeComfyType } from '@/utils/comfyUtils';

const mediaInputNames = new Set(['image', 'images', 'video', 'mask']);

const isLoadMediaNodeType = (classType: string): boolean => {
  const normalizedType = normalizeComfyType(classType);
  return (
    normalizedType.includes('loadimage') ||
    normalizedType.includes('loadimages') ||
    normalizedType.includes('loadvideo')
  );
};

export const getComfyWorkflowInputCandidates = (
  workflow: ComfyWorkflow | null | undefined,
): ComfyWorkflowInputCandidate[] => {
  if (!workflow) return [];
  if (workflow.inputCandidates) return workflow.inputCandidates;

  const result: ComfyWorkflowInputCandidate[] = [];

  for (const [nodeId, promptNode] of Object.entries(workflow.prompt)) {
    if (!isJsonObject(promptNode) || typeof promptNode.class_type !== 'string') continue;

    const classType = promptNode.class_type;
    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};

    if (isLoadMediaNodeType(classType)) {
      const inputName = ['image', 'images', 'video'].find(
        (candidateInputName) => typeof inputs[candidateInputName] === 'string',
      );
      if (!inputName) continue;
      result.push({
        id: `${nodeId}:${inputName}`,
        nodeId,
        nodeType: classType,
        inputName,
        label: `${classType} #${nodeId}`,
      });
      continue;
    }

    for (const inputName of mediaInputNames) {
      const value = inputs[inputName];
      const isBindableEmptyInput =
        inputName === 'mask' ? value === null : value === null || value === undefined;
      if (isBindableEmptyInput) {
        result.push({
          id: `${nodeId}:${inputName}`,
          nodeId,
          nodeType: classType,
          inputName,
          label: `${classType} #${nodeId}`,
        });
      }
    }
  }

  return result;
};
