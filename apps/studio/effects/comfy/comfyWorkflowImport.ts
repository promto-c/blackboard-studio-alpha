import type { ComfyWorkflow, ComfyWorkflowControl } from '@blackboard/types';
import {
  extractComfyPromptWithOutputs,
  extractComfyWorkflowFromImage,
  fetchComfyObjectInfo,
  isComfyGraphWorkflow,
} from '@/services/comfy/client';
import { createComfyWorkflowControl, getComfyWorkflowControlCandidates } from './comfyControls';

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
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  return name || title || 'Pasted Comfy Workflow';
};

const getComfyWorkflowNameFromImageFile = (file: File): string => {
  const name = file.name.replace(/\.(png|jpe?g|webp)$/i, '').trim();
  return name ? `${name} metadata` : 'Image Metadata Workflow';
};

export const isComfyWorkflowImageFile = (file: File): boolean =>
  file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);

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
    controlOptions: extracted.controlOptions,
    outputCandidates: extracted.outputCandidates,
    selectedOutputIds: extracted.selectedOutputIds,
    sourceGraph,
    createdAt,
    updatedAt,
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
  getComfyWorkflowControlCandidates(workflow).map((candidate) =>
    createComfyWorkflowControl(workflow.id, candidate),
  );
