import type { ComfyWorkflowOutputCandidate } from '@blackboard/types';

export interface ComfyOutputCandidateNode {
  id: string;
  nodeType: string;
  inputs: Record<string, unknown>;
  dynamicInputs: ComfyWorkflowOutputCandidate['outputNodeDynamicInputs'];
}

export const getComfyOutputCandidateTerminalNode = (candidate: ComfyWorkflowOutputCandidate) =>
  candidate.syntheticOutputNodes?.at(-1);

export const getComfyOutputCandidateNodeType = (candidate: ComfyWorkflowOutputCandidate): string =>
  getComfyOutputCandidateTerminalNode(candidate)?.nodeType ?? candidate.nodeType;

export const getComfyOutputCandidateNodes = (
  candidate: ComfyWorkflowOutputCandidate,
): ComfyOutputCandidateNode[] => {
  if (candidate.syntheticOutputNodes?.length) {
    return candidate.syntheticOutputNodes.map((node) => ({
      ...node,
      dynamicInputs:
        node.id === candidate.previewNodeId ? candidate.outputNodeDynamicInputs : undefined,
    }));
  }
  return [
    {
      id: candidate.previewNodeId,
      nodeType: candidate.nodeType,
      inputs: candidate.outputNodeInputs ?? {},
      dynamicInputs: candidate.outputNodeDynamicInputs,
    },
  ];
};

export const getComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
  nodeId = candidate.previewNodeId,
): Record<string, unknown> =>
  getComfyOutputCandidateNodes(candidate).find((node) => node.id === nodeId)?.inputs ?? {};

export const updateComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
  nodeId: string,
  inputs: Record<string, unknown>,
): ComfyWorkflowOutputCandidate => {
  if (candidate.kind !== 'synthetic') return { ...candidate, outputNodeInputs: inputs };
  if (!candidate.syntheticOutputNodes?.some((node) => node.id === nodeId)) return candidate;
  return {
    ...candidate,
    syntheticOutputNodes: candidate.syntheticOutputNodes?.map((node) =>
      node.id === nodeId ? { ...node, inputs } : node,
    ),
  };
};
