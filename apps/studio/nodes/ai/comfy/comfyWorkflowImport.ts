import type { ComfyWorkflow, ComfyWorkflowControl } from '@blackboard/types';
import {
  extractComfyPromptWithOutputs,
  extractComfyWorkflowFromImage,
  fetchComfyObjectInfo,
  isComfyGraphWorkflow,
} from '@/services/comfy/client';
import { createComfyWorkflowControl, getComfyWorkflowControlCandidates } from './comfyControls';
import { getNonEmptyString } from '@/utils/guards';

export const hashComfyWorkflowSource = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

export const getComfyWorkflowNameFromJson = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Pasted Comfy Workflow';
  }

  const record = value as Record<string, unknown>;
  return (
    getNonEmptyString(record.name) ?? getNonEmptyString(record.title) ?? 'Pasted Comfy Workflow'
  );
};

const getComfyWorkflowNameFromImageFile = (file: File): string => {
  const name = file.name.replace(/\.(png|jpe?g|webp)$/i, '').trim();
  return name ? `${name} metadata` : 'Image Metadata Workflow';
};

export const isComfyWorkflowImageFile = (file: File): boolean =>
  file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);

const reconcileComfyWorkflowCandidateSelection = ({
  previousCandidateIds,
  selectedIds,
  nextCandidateIds,
  nextDefaultIds,
}: {
  previousCandidateIds: string[];
  selectedIds: string[] | undefined;
  nextCandidateIds: string[];
  nextDefaultIds: string[];
}): string[] => {
  if (selectedIds === undefined) return nextDefaultIds;
  const previousIds = new Set(previousCandidateIds);
  const nextIds = new Set(nextCandidateIds);
  return Array.from(
    new Set([
      ...selectedIds.filter((id) => nextIds.has(id)),
      ...nextDefaultIds.filter((id) => !previousIds.has(id)),
    ]),
  );
};

export const reconcileComfyWorkflowOutputSelection = ({
  previousCandidateIds,
  selectedOutputIds,
  nextCandidateIds,
  nextDefaultOutputIds,
}: {
  previousCandidateIds: string[];
  selectedOutputIds: string[] | undefined;
  nextCandidateIds: string[];
  nextDefaultOutputIds: string[];
}): string[] =>
  reconcileComfyWorkflowCandidateSelection({
    previousCandidateIds,
    selectedIds: selectedOutputIds,
    nextCandidateIds,
    nextDefaultIds: nextDefaultOutputIds,
  });

export const reconcileComfyWorkflowInputSelection = ({
  previousCandidateIds,
  selectedInputIds,
  nextCandidateIds,
  nextDefaultInputIds,
}: {
  previousCandidateIds: string[];
  selectedInputIds: string[] | undefined;
  nextCandidateIds: string[];
  nextDefaultInputIds: string[];
}): string[] =>
  reconcileComfyWorkflowCandidateSelection({
    previousCandidateIds,
    selectedIds: selectedInputIds,
    nextCandidateIds,
    nextDefaultIds: nextDefaultInputIds,
  });

export const createComfyWorkflowFromJson = async ({
  endpoint,
  id,
  name,
  value,
  createdAt = Date.now(),
  updatedAt,
}: {
  endpoint: string;
  id: string;
  name: string;
  value: unknown;
  createdAt?: number;
  updatedAt?: number;
}): Promise<ComfyWorkflow> => {
  const sourceGraph = isComfyGraphWorkflow(value) ? value : undefined;
  let objectInfo: Awaited<ReturnType<typeof fetchComfyObjectInfo>> | undefined;
  if (sourceGraph) {
    objectInfo = await fetchComfyObjectInfo(endpoint);
  } else {
    try {
      objectInfo = await fetchComfyObjectInfo(endpoint);
    } catch {
      // API-format workflows can still import without Comfy metadata; dropdown choices appear when metadata is available.
    }
  }
  const extracted = extractComfyPromptWithOutputs(sourceGraph ?? value, objectInfo);

  return {
    id,
    name,
    prompt: extracted.prompt,
    inputCandidates: extracted.inputCandidates,
    selectedInputIds: extracted.selectedInputIds,
    controlOptions: extracted.controlOptions,
    defaultControlKeys: extracted.defaultControlKeys,
    outputCandidates: extracted.outputCandidates,
    selectedOutputIds: extracted.selectedOutputIds,
    sourceGraph,
    createdAt,
    updatedAt,
  };
};

export const refreshComfyWorkflowFromSource = async (
  endpoint: string,
  workflow: ComfyWorkflow,
): Promise<ComfyWorkflow> => {
  if (!workflow.sourceGraph) return workflow;

  const objectInfo = await fetchComfyObjectInfo(endpoint);
  const extracted = extractComfyPromptWithOutputs(workflow.sourceGraph, objectInfo);
  const selectedOutputIds = reconcileComfyWorkflowOutputSelection({
    previousCandidateIds: (workflow.outputCandidates ?? []).map((candidate) => candidate.id),
    selectedOutputIds: workflow.selectedOutputIds,
    nextCandidateIds: extracted.outputCandidates.map((candidate) => candidate.id),
    nextDefaultOutputIds: extracted.selectedOutputIds,
  });
  const selectedInputIds = reconcileComfyWorkflowInputSelection({
    previousCandidateIds: (workflow.inputCandidates ?? []).map((candidate) => candidate.id),
    selectedInputIds: workflow.selectedInputIds,
    nextCandidateIds: extracted.inputCandidates.map((candidate) => candidate.id),
    nextDefaultInputIds: extracted.selectedInputIds,
  });

  return {
    ...workflow,
    prompt: extracted.prompt,
    inputCandidates: extracted.inputCandidates,
    selectedInputIds,
    controlOptions: extracted.controlOptions,
    defaultControlKeys: extracted.defaultControlKeys,
    outputCandidates: extracted.outputCandidates,
    selectedOutputIds,
  };
};

export const readComfyWorkflowFile = async (
  file: File,
  endpoint: string,
): Promise<ComfyWorkflow> => {
  const id = `comfy_workflow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();

  if (isComfyWorkflowImageFile(file)) {
    const workflowJson = await extractComfyWorkflowFromImage(file);
    return createComfyWorkflowFromJson({
      endpoint,
      id,
      name: getComfyWorkflowNameFromImageFile(file),
      value: workflowJson,
      createdAt,
    });
  }

  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  return createComfyWorkflowFromJson({
    endpoint,
    id,
    name: file.name.replace(/\.json$/i, '') || 'Comfy Workflow',
    value: parsed,
    createdAt,
  });
};

export const createComfyWorkflowFromImage = async ({
  endpoint,
  image,
  id,
  name,
  createdAt = Date.now(),
  updatedAt,
  preferPrompt,
}: {
  endpoint: string;
  image: Blob;
  id: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
  preferPrompt?: boolean;
}): Promise<ComfyWorkflow> => {
  const workflowJson = await extractComfyWorkflowFromImage(image, { preferPrompt });
  return createComfyWorkflowFromJson({
    endpoint,
    id,
    name,
    value: workflowJson,
    createdAt,
    updatedAt,
  });
};

export const createDefaultComfyWorkflowControls = (
  workflow: ComfyWorkflow,
): ComfyWorkflowControl[] =>
  getComfyWorkflowControlCandidates(workflow)
    .filter(
      (candidate) =>
        !workflow.defaultControlKeys || workflow.defaultControlKeys.includes(candidate.key),
    )
    .map((candidate) => createComfyWorkflowControl(workflow.id, candidate));
