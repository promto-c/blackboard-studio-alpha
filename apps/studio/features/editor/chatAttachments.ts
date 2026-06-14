import type { AiChatAttachment, AiChatRenderComparisonArtifact } from '@blackboard/types';

export type QueuedDraft = {
  prompt: string;
  attachments: AiChatAttachment[];
};

export const ChatAttachmentLimits = {
  MAX_ATTACHMENTS: 6,
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,
  MAX_TEXT_BYTES: 256 * 1024,
} as const;

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'css',
  'csv',
  'frag',
  'glsl',
  'html',
  'js',
  'json',
  'md',
  'tsx',
  'ts',
  'txt',
  'vert',
  'xml',
  'yaml',
  'yml',
]);

export const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
};

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() ?? '';

export const isTextAttachmentFile = (file: File) =>
  file.type.startsWith('text/') || TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name));

export const getAttachmentKind = (file: File): AiChatAttachment['kind'] => {
  if (file.type.startsWith('image/')) {
    return 'image';
  }

  return isTextAttachmentFile(file) ? 'text' : 'file';
};

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.readAsDataURL(file);
  });

export const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.readAsText(file);
  });

export const createAttachmentId = () =>
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getAttachmentSummary = (attachments: AiChatAttachment[]) => {
  if (attachments.length === 0) {
    return '';
  }

  return attachments.length === 1 ? attachments[0].name : `${attachments.length} files`;
};

export const getQueuedDraftPreview = (queuedDraft: QueuedDraft) => {
  const prompt = queuedDraft.prompt.trim();
  const attachmentSummary = getAttachmentSummary(queuedDraft.attachments);

  if (prompt && attachmentSummary) {
    return `${prompt} / ${attachmentSummary}`;
  }

  return prompt || attachmentSummary || 'Queued message';
};

const getDataUrlSizeEstimate = (dataUrl: string) => {
  const payload = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  return Math.max(0, Math.floor((payload.length * 3) / 4));
};

export const createRenderComparisonAttachments = (
  artifact: AiChatRenderComparisonArtifact,
): AiChatAttachment[] => [
  {
    id: `agent_review_before_${artifact.capturedAt}`,
    name: 'Before render preview.png',
    mimeType: artifact.before.mimeType,
    size: getDataUrlSizeEstimate(artifact.before.dataUrl),
    kind: 'image',
    dataUrl: artifact.before.dataUrl,
  },
  {
    id: `agent_review_after_${artifact.capturedAt}`,
    name: 'After render preview.png',
    mimeType: artifact.after.mimeType,
    size: getDataUrlSizeEstimate(artifact.after.dataUrl),
    kind: 'image',
    dataUrl: artifact.after.dataUrl,
  },
];
