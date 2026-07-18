import type { ComfyWorkflowInputCandidate } from '@blackboard/types';

export const normalizeComfyType = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

export type ComfyWorkflowMediaInputKind = 'image' | 'mask' | 'video';

const comfyMaskInputTypes = new Set(['mask', 'masks']);
const comfyVideoInputTypes = new Set(['video', 'videoupload']);

/** Resolves Comfy socket semantics, including workflows imported before inputType was persisted. */
export const getComfyWorkflowMediaInputKind = (
  candidate: Pick<ComfyWorkflowInputCandidate, 'inputName' | 'inputType' | 'nodeType'>,
): ComfyWorkflowMediaInputKind => {
  const inputType = normalizeComfyType(candidate.inputType ?? '');
  if (comfyMaskInputTypes.has(inputType)) return 'mask';
  if (comfyVideoInputTypes.has(inputType)) return 'video';

  const inputName = normalizeComfyType(candidate.inputName);
  if (inputName === 'alpha' || inputName.includes('mask') || inputName.includes('matte')) {
    return 'mask';
  }
  if (inputName.includes('video') || normalizeComfyType(candidate.nodeType).includes('loadvideo')) {
    return 'video';
  }
  return 'image';
};

export const isComfyMaskWorkflowInput = (
  candidate: Pick<ComfyWorkflowInputCandidate, 'inputName' | 'inputType' | 'nodeType'>,
): boolean => getComfyWorkflowMediaInputKind(candidate) === 'mask';
