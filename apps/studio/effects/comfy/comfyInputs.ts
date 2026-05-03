import type { ComfyWorkflow, ComfyWorkflowInputCandidate } from '@blackboard/types';

export const getComfyWorkflowInputPortName = (
  workflowId: string,
  candidate: Pick<ComfyWorkflowInputCandidate, 'id'>,
): string => `comfy-input:${workflowId}:${candidate.id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getComfyWorkflowInputCandidates = (
  workflow: ComfyWorkflow | null | undefined,
): ComfyWorkflowInputCandidate[] => {
  if (!workflow) return [];
  if (workflow.inputCandidates) return workflow.inputCandidates;

  return Object.entries(workflow.prompt).flatMap(([nodeId, promptNode]) => {
    if (!isRecord(promptNode) || typeof promptNode.class_type !== 'string') return [];
    if (!promptNode.class_type.toLowerCase().includes('loadimage')) return [];

    const inputs = isRecord(promptNode.inputs) ? promptNode.inputs : {};
    if (typeof inputs.image !== 'string') return [];

    return [
      {
        id: `${nodeId}:image`,
        nodeId,
        nodeType: promptNode.class_type,
        inputName: 'image',
        label: `${promptNode.class_type} #${nodeId}`,
      },
    ];
  });
};
