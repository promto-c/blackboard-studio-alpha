import type { ComfyWorkflow } from '@blackboard/types';
import type { ComfyWorkflowFile } from '@/services/comfy/client';

export const formatDateTime = (timestamp: number | undefined): string => {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getWorkflowNodeCount = (workflow: ComfyWorkflow | null): number =>
  workflow ? Object.keys(workflow.prompt).length : 0;

export const getWorkflowNameFromPath = (path: string): string => {
  const fileName = path.split('/').filter(Boolean).pop() ?? path;
  return fileName.replace(/\.json$/i, '') || 'Comfy Workflow';
};

const getWorkflowFileDisplayPath = (path: string): string => path.replace(/^workflows\//, '');

const getWorkflowFileFolder = (path: string): string => {
  const parts = getWorkflowFileDisplayPath(path).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'workflows/';
};

const formatWorkflowFileSize = (bytes: number | undefined): string | null => {
  if (bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
};

export const getWorkflowModifiedAt = (modified: number | undefined): number => {
  if (modified === undefined) return Date.now();
  return modified > 10_000_000_000 ? modified : modified * 1000;
};

export const getWorkflowFileDetail = (workflowFile: ComfyWorkflowFile): string => {
  const details = [
    getWorkflowFileFolder(workflowFile.path),
    formatWorkflowFileSize(workflowFile.size),
    workflowFile.modified ? formatDateTime(getWorkflowModifiedAt(workflowFile.modified)) : null,
  ].filter((detail): detail is string => Boolean(detail));

  return details.join(' · ');
};
