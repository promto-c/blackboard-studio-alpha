import type { ComfyWorkflow, ComfyWorkflowInputCandidate } from '@blackboard/types';
import { isJsonObject } from '@/utils/guards';
import { isComfyMaskWorkflowInput, normalizeComfyType } from '@/utils/comfyUtils';

const mediaInputNames = new Set(['image', 'images', 'video', 'alpha', 'mask']);

const getFallbackComfyInputType = (inputName: string): string => {
  const normalizedName = normalizeComfyType(inputName);
  if (normalizedName === 'alpha' || normalizedName.includes('mask')) return 'MASK';
  if (normalizedName.includes('video')) return 'VIDEO';
  return 'IMAGE';
};

export const getComfyWorkflowInputAlphaMode = (
  candidate: ComfyWorkflowInputCandidate,
  configuredMode: 'opaque' | 'preserve' = 'opaque',
): 'opaque' | 'preserve' => (isComfyMaskWorkflowInput(candidate) ? 'preserve' : configuredMode);

export const getComfyWorkflowInputPortPresentation = (candidate: ComfyWorkflowInputCandidate) => {
  const inputLabel = candidate.inputName.trim() || candidate.label;
  if (!isComfyMaskWorkflowInput(candidate)) {
    return { label: inputLabel, type: 'texture' as const };
  }

  return {
    label: normalizeComfyType(candidate.inputName) === 'alpha' ? 'Alpha / Mask' : inputLabel,
    type: 'mask' as const,
    dataSemantic: 'mask' as const,
    channel: 'a' as const,
    processingDomain: 'alpha' as const,
    color: '#9da5b2',
  };
};

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
        inputType: getFallbackComfyInputType(inputName),
        label: `${classType} #${nodeId}`,
      });
      continue;
    }

    for (const inputName of mediaInputNames) {
      const value = inputs[inputName];
      const isMaskInputName = inputName === 'alpha' || inputName === 'mask';
      const isBindableEmptyInput = isMaskInputName
        ? value === null
        : value === null || value === undefined;
      if (isBindableEmptyInput) {
        result.push({
          id: `${nodeId}:${inputName}`,
          nodeId,
          nodeType: classType,
          inputName,
          inputType: getFallbackComfyInputType(inputName),
          label: `${classType} #${nodeId}`,
        });
      }
    }
  }

  return result;
};

export const getSelectedComfyWorkflowInputCandidates = (
  workflow: ComfyWorkflow | null | undefined,
): ComfyWorkflowInputCandidate[] => {
  const candidates = getComfyWorkflowInputCandidates(workflow);
  if (!workflow?.selectedInputIds) return candidates;
  const selectedIds = new Set(workflow.selectedInputIds);
  return candidates.filter((candidate) => selectedIds.has(candidate.id));
};
