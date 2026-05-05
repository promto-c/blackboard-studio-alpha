import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { getAsset, saveAsset } from '@/state/assetStorage';
import { readImageDimensions } from '@/state/editor/utils';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { ScrollArea } from '@blackboard/ui';
import {
  AnyNode,
  ComfyNode,
  EditorTab,
  GeneratedOutput,
  ComfyWorkflow,
  ComfyWorkflowControl,
  ComfyWorkflowControlRunMode,
  ComfyWorkflowControlValue,
  ComfyWorkflowInputImage,
  ComfyWorkflowInputCandidate,
  ComfyWorkflowOutputCandidate,
  ImageSequenceNode,
  NodeType,
} from '@blackboard/types';
import {
  fetchComfyWorkflowFile,
  fetchComfyImage,
  listComfyWorkflowFiles,
  normalizeComfyEndpoint,
  applyComfyWorkflowInputImages,
  queueComfyPrompt,
  interruptComfyPrompt,
  selectComfyPromptOutputs,
  subscribeComfyProgress,
  type ComfyWorkflowFile,
  uploadComfyInputImage,
  waitForComfyOutputImages,
} from '@/services/comfy/client';
import {
  AttentionPulse,
  CollapsibleSection,
  InspectorLogFooter,
  Popover,
  PromptTextField,
  PropertyField,
  ResetIconButton,
  Slider,
  StyledDropdown,
  ToggleSwitch,
} from '@/components';
import {
  applyComfyWorkflowControls,
  createComfyWorkflowControl,
  getComfyControlDescription,
  getComfyControlKey,
  getComfyWorkflowControlRunMode,
  getComfyWorkflowControlCandidates,
  isPromptLikeComfyTextInput,
  isSeedLikeComfyInput,
  prepareComfyWorkflowControlsForRun,
  supportsComfyWorkflowControlRunMode,
} from './comfyControls';
import { getComfyWorkflowInputCandidates, getComfyWorkflowInputPortName } from './comfyInputs';
import {
  createComfyWorkflowFromJson,
  createDefaultComfyWorkflowControls,
  getComfyWorkflowNameFromJson,
  hashComfyWorkflowSource,
  isComfyWorkflowImageFile,
  readComfyWorkflowFile,
} from './comfyWorkflowImport';
import { getPromptSuggestions } from '@/utils/ai';
import {
  getAiTaskRouteError,
  resolveAiTaskRoute,
  type ResolvedAiTextRoute,
} from '@/utils/aiRouting';
import {
  isBackgroundJobActive,
  registerBackgroundJobCancelHandler,
} from '@/state/editor/services/backgroundJobs';
import { IMAGE_IMPORT_ACCEPT, isImageFileLike } from '@/utils/mediaFiles';
import * as Icons from '@blackboard/icons';

type RunState = 'idle' | 'queueing' | 'running' | 'downloading' | 'complete' | 'error';
type WorkflowBrowserState = 'idle' | 'loading' | 'importing' | 'error';
type WorkflowEmptyMode = 'choice' | 'paste';
const BATCH_RUN_COUNTS = [2, 4, 8, 16] as const;
const DICE_ROLL_ANIMATION_LEAD_MS = 180;
const RUN_MODE_BADGE_ANIMATION_MS = 520;
const comfyRunQueues = new Map<string, Promise<void>>();
const latestComfyPromptId = new Map<string, { promptId: string; endpoint: string }>();

interface RunProgress {
  label: string;
  detail?: string;
  value?: number;
  max?: number;
  percent?: number;
  indeterminate?: boolean;
}

const createClientId = (): string =>
  `blackboard_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const enqueueComfyRun = async <T,>(queueKey: string, task: () => Promise<T>): Promise<T> => {
  const previousRun = comfyRunQueues.get(queueKey) ?? Promise.resolve();
  let releaseRun!: () => void;
  const currentRun = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const queueTail = previousRun.catch(() => undefined).then(() => currentRun);
  comfyRunQueues.set(queueKey, queueTail);

  await previousRun.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseRun();
    if (comfyRunQueues.get(queueKey) === queueTail) {
      comfyRunQueues.delete(queueKey);
    }
  }
};

const formatDateTime = (timestamp: number | undefined): string => {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getWorkflowNodeCount = (workflow: ComfyWorkflow | null): number =>
  workflow ? Object.keys(workflow.prompt).length : 0;

const getWorkflowNameFromPath = (path: string): string => {
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

const getWorkflowFileDetail = (workflowFile: ComfyWorkflowFile): string => {
  const details = [
    getWorkflowFileFolder(workflowFile.path),
    formatWorkflowFileSize(workflowFile.size),
    workflowFile.modified ? formatDateTime(getWorkflowModifiedAt(workflowFile.modified)) : null,
  ].filter((detail): detail is string => Boolean(detail));

  return details.join(' · ');
};

const getWorkflowModifiedAt = (modified: number | undefined): number => {
  if (modified === undefined) return Date.now();
  return modified > 10_000_000_000 ? modified : modified * 1000;
};

const coerceControlValue = (
  value: string,
  originalValue: ComfyWorkflowControlValue,
): ComfyWorkflowControlValue => {
  if (typeof originalValue === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : originalValue;
  }
  if (typeof originalValue === 'boolean') return value === 'true';
  return value;
};

const formatControlValue = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2);
};

const formatDefaultValueLabel = (value: ComfyWorkflowControlValue): string => {
  if (typeof value === 'number') return formatControlValue(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : '(empty)';
};

const getControlResetTooltip = (control: ComfyWorkflowControl): string =>
  `Reset ${control.label} to default (${formatDefaultValueLabel(control.defaultValue)})`;

interface MissingWorkflowControlOption {
  control: ComfyWorkflowControl;
  value: string;
  installTargets: string[];
  guidance: string;
  downloadUrl?: string;
}

type MissingModelSizeStatus = number | 'loading' | null;

const getModelFileName = (value: string): string =>
  value.split(/[\\/]/).filter(Boolean).pop() ?? value;

const getModelSearchName = (value: string): string => {
  const fileName = getModelFileName(value.trim());
  const searchName = fileName.replace(/\.[^.]+$/, '').trim();
  return searchName || fileName || value.trim();
};

const buildMissingModelSearchUrl = (modelName: string): string =>
  `https://huggingface.co/models?search=${encodeURIComponent(getModelSearchName(modelName))}`;

const getMissingModelDownloadUrl = (missingOption: MissingWorkflowControlOption): string =>
  missingOption.downloadUrl ?? buildMissingModelSearchUrl(missingOption.value);

const getMissingModelSizeKey = (missingOption: MissingWorkflowControlOption): string =>
  missingOption.downloadUrl ?? missingOption.value;

const formatModelSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  const gigabytes = megabytes / 1024;
  return `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`;
};

const getMissingModelSizeLabel = (
  sizeStatus: MissingModelSizeStatus | undefined,
): string | null => {
  if (sizeStatus === undefined || sizeStatus === 'loading') return 'Size...';
  if (sizeStatus === null) return 'Size unknown';
  return formatModelSize(sizeStatus);
};

const fetchMissingModelDownloadSize = async (
  url: string,
  signal: AbortSignal,
): Promise<number | null> => {
  try {
    const response = await fetch(url, { method: 'HEAD', signal });
    if (!response.ok) return null;
    const contentLength = response.headers.get('content-length');
    if (!contentLength) return null;
    const size = Number(contentLength);
    return Number.isFinite(size) && size >= 0 ? size : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
};

const extractHttpUrl = (value: string): string | null =>
  value.match(/https?:\/\/[^\s"'<>]+/i)?.[0].replace(/[),.;]+$/, '') ?? null;

const normalizeSearchValue = (value: string): string => {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
};

const stringReferencesModel = (value: string, modelName: string): boolean => {
  const normalizedValue = normalizeSearchValue(value);
  const normalizedModelName = normalizeSearchValue(modelName);
  const normalizedFileName = normalizeSearchValue(getModelFileName(modelName));

  return (
    normalizedValue.includes(normalizedModelName) ||
    (normalizedFileName.length > 0 && normalizedValue.includes(normalizedFileName))
  );
};

const isWorkflowDownloadKey = (key: string): boolean => {
  const normalizedKey = key.toLowerCase();
  return (
    normalizedKey.includes('download') ||
    normalizedKey === 'url' ||
    normalizedKey.endsWith('_url') ||
    normalizedKey.endsWith('url') ||
    normalizedKey.includes('href')
  );
};

const collectWorkflowDownloadUrls = (value: unknown, modelName: string): string[] => {
  if (typeof value === 'string') {
    const url = extractHttpUrl(value);
    return url && stringReferencesModel(url, modelName) ? [url] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectWorkflowDownloadUrls(entry, modelName));
  }

  if (typeof value !== 'object' || value === null) return [];

  const entries = Object.entries(value as Record<string, unknown>);
  const objectReferencesModel = entries.some(
    ([, entryValue]) =>
      typeof entryValue === 'string' && stringReferencesModel(entryValue, modelName),
  );
  const localUrls = entries.flatMap(([key, entryValue]) => {
    if (typeof entryValue !== 'string') return [];

    const url = extractHttpUrl(entryValue);
    if (!url) return [];
    if (stringReferencesModel(url, modelName)) return [url];
    return objectReferencesModel && isWorkflowDownloadKey(key) ? [url] : [];
  });

  return [
    ...localUrls,
    ...entries.flatMap(([, entryValue]) => collectWorkflowDownloadUrls(entryValue, modelName)),
  ];
};

const getWorkflowModelDownloadUrl = (
  workflow: ComfyWorkflow,
  control: ComfyWorkflowControl,
): string | undefined => {
  const modelName = String(control.value);
  const urls = [workflow.sourceGraph, workflow.prompt].flatMap((value) =>
    collectWorkflowDownloadUrls(value, modelName),
  );

  return [...new Set(urls)][0];
};

const getMissingModelInstallPaths = ({
  value,
  installTargets,
}: Pick<MissingWorkflowControlOption, 'value' | 'installTargets'>): string[] => {
  const fileName = value.trim().replace(/^\/+/, '');
  if (!fileName) return installTargets;
  if (installTargets.length === 0) return [fileName];

  return installTargets.map((target) => `${target.replace(/\/+$/, '')}/${fileName}`);
};

const getMissingModelInstallDirBadge = (missingOption: MissingWorkflowControlOption): string => {
  const installPath = getMissingModelInstallPaths(missingOption)[0];
  if (!installPath) return '';
  return installPath.split('/').filter(Boolean).slice(0, -1).pop() ?? '';
};

const copyTextToClipboard = async (value: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
};

const MissingModelActions: React.FC<{
  missingOption: MissingWorkflowControlOption;
  onDownload: (missingOption: MissingWorkflowControlOption) => void;
  onCopyPath: (missingOption: MissingWorkflowControlOption) => void;
}> = ({ missingOption, onDownload, onCopyPath }) => {
  const downloadUrl = missingOption.downloadUrl;
  const searchName = getModelSearchName(missingOption.value);
  const actionLabel = downloadUrl ? 'Download' : 'Find';
  const ActionIcon = downloadUrl ? Icons.ArrowDownTray : Icons.MagnifyingGlass;
  const actionTitle = downloadUrl
    ? `Open download URL for ${missingOption.value}`
    : `Find ${searchName} on Hugging Face`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {downloadUrl ? (
        <div className="inline-flex overflow-hidden rounded-md border border-red-200/25 bg-black/20 text-red-50 transition hover:border-red-100/45">
          <button
            type="button"
            onClick={() => onDownload(missingOption)}
            className="inline-flex h-7 items-center gap-1.5 px-2 text-[11px] font-medium transition hover:bg-red-200/10"
            title={actionTitle}
          >
            <ActionIcon className="h-4 w-4" />
            {actionLabel}
          </button>
          <button
            type="button"
            onClick={() => onCopyPath(missingOption)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center border-l border-red-200/20 transition hover:bg-red-200/10"
            title={`Copy download URL for ${missingOption.value}`}
          >
            <Icons.Copy className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onDownload(missingOption)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200/25 bg-black/20 px-2 text-[11px] font-medium text-red-50 transition hover:border-red-100/45 hover:bg-red-200/10"
          title={actionTitle}
        >
          <ActionIcon className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};

const normalizeComparableControlValue = (value: ComfyWorkflowControlValue): string =>
  String(value).trim().toLowerCase();

const isWorkflowControlOptionAvailable = (
  control: ComfyWorkflowControl,
  value: ComfyWorkflowControlValue,
): boolean => {
  if (!control.options || control.options.length === 0) return true;

  const normalizedValue = normalizeComparableControlValue(value);
  return control.options.some(
    (option) => normalizeComparableControlValue(option) === normalizedValue,
  );
};

const isWorkflowControlSelectedOptionMissing = (control: ComfyWorkflowControl): boolean => {
  if (!control.options || control.options.length === 0) return false;
  if (typeof control.value !== 'string' && typeof control.value !== 'number') return false;

  return !isWorkflowControlOptionAvailable(control, control.value);
};

const getComfyModelInstallTargets = (control: ComfyWorkflowControl): string[] => {
  const searchText = [
    control.label,
    control.inputName,
    control.classType,
    control.description ?? '',
    String(control.value),
  ]
    .join(' ')
    .toLowerCase();

  if (searchText.includes('lora')) return ['ComfyUI/models/loras'];
  if (searchText.includes('vae')) return ['ComfyUI/models/vae'];
  if (searchText.includes('controlnet') || searchText.includes('control_net')) {
    return ['ComfyUI/models/controlnet'];
  }
  if (searchText.includes('clip vision') || searchText.includes('clip_vision')) {
    return ['ComfyUI/models/clip_vision'];
  }
  if (searchText.includes('clip')) return ['ComfyUI/models/clip'];
  if (searchText.includes('upscale')) return ['ComfyUI/models/upscale_models'];
  if (searchText.includes('embedding') || searchText.includes('textual inversion')) {
    return ['ComfyUI/models/embeddings'];
  }
  if (searchText.includes('unet') || searchText.includes('diffusion model')) {
    return ['ComfyUI/models/unet', 'ComfyUI/models/checkpoints'];
  }
  if (
    searchText.includes('checkpoint') ||
    searchText.includes('ckpt') ||
    searchText.includes('model_name') ||
    searchText.includes('model name') ||
    searchText.includes('model')
  ) {
    return ['ComfyUI/models/checkpoints'];
  }

  return [];
};

const getMissingWorkflowControlGuidance = (control: ComfyWorkflowControl): string => {
  const installTargets = getComfyModelInstallTargets(control);
  if (installTargets.length > 0) {
    return `Download or restore the missing file, place it in ${installTargets.join(
      ' or ',
    )}, then refresh/restart ComfyUI and reload the workflow.`;
  }

  return 'Choose an available value, or install the missing custom node/model that provides this option, then refresh/restart ComfyUI and reload the workflow.';
};

const getMissingWorkflowControlOption = (
  control: ComfyWorkflowControl,
  workflow: ComfyWorkflow,
): MissingWorkflowControlOption | null => {
  if (!isWorkflowControlSelectedOptionMissing(control)) return null;

  const installTargets = getComfyModelInstallTargets(control);
  if (installTargets.length === 0) return null;

  return {
    control,
    value: String(control.value),
    installTargets,
    guidance: getMissingWorkflowControlGuidance(control),
    downloadUrl: getWorkflowModelDownloadUrl(workflow, control),
  };
};

const getMissingWorkflowControlOptions = (
  controls: ComfyWorkflowControl[],
  workflow: ComfyWorkflow,
): MissingWorkflowControlOption[] =>
  controls
    .filter((control) => control.workflowId === workflow.id)
    .map((control) => getMissingWorkflowControlOption(control, workflow))
    .filter(
      (missingOption): missingOption is MissingWorkflowControlOption => missingOption !== null,
    );

const getMissingWorkflowControlStatus = (
  workflowName: string,
  missingOptions: MissingWorkflowControlOption[],
): string => {
  if (missingOptions.length === 0) return `Imported ${workflowName}.`;

  const firstMissing = missingOptions[0];
  const extraCount = missingOptions.length - 1;
  const suffix =
    extraCount > 0 ? ` and ${extraCount} more missing field${extraCount === 1 ? '' : 's'}` : '';
  return `Imported ${workflowName}, but ${firstMissing.control.label} uses unavailable value "${firstMissing.value}"${suffix}. Install the missing model/file or choose an available value before running.`;
};

const getMissingModelCountLabel = (count: number): string =>
  `${count} model${count === 1 ? '' : 's'}`;

const MissingModelWarning: React.FC<{
  missingOptions: MissingWorkflowControlOption[];
  modelSizeStatuses: Record<string, MissingModelSizeStatus>;
  detailsVisible: boolean;
  onToggleDetails: () => void;
  onDownload: (missingOption: MissingWorkflowControlOption) => void;
  onCopyPath: (missingOption: MissingWorkflowControlOption) => void;
}> = ({
  missingOptions,
  modelSizeStatuses,
  detailsVisible,
  onToggleDetails,
  onDownload,
  onCopyPath,
}) => {
  const countLabel = getMissingModelCountLabel(missingOptions.length);
  const installTarget = missingOptions.length === 1 ? 'it' : 'them';
  const detailsAction = detailsVisible ? 'Hide details' : 'Show details';

  return (
    <div className="rounded-lg border border-red-300/25 bg-red-300/[0.07] p-2.5 text-xs text-red-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-red-50">{countLabel} missing from ComfyUI</p>
          <p className="mt-0.5 text-[11px] leading-4 text-red-100/75">
            Install {installTarget}, or choose available values before running.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleDetails}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-red-200/20 bg-black/15 px-2 text-[11px] font-medium text-red-50 transition hover:border-red-100/45 hover:bg-red-200/10"
          aria-expanded={detailsVisible}
          aria-label={detailsAction}
          title={detailsAction}
        >
          {detailsVisible ? (
            <Icons.ChevronDown className="h-3 w-3" />
          ) : (
            <Icons.ChevronRight className="h-3 w-3" />
          )}
          {detailsVisible ? 'Hide' : 'Show'}
        </button>
      </div>
      {detailsVisible ? (
        <div className="mt-2 divide-y divide-red-100/10 overflow-hidden rounded-md border border-red-100/10 bg-black/15">
          {missingOptions.map((missingOption) => {
            const dirBadge = getMissingModelInstallDirBadge(missingOption);
            const sizeLabel = missingOption.downloadUrl
              ? getMissingModelSizeLabel(modelSizeStatuses[getMissingModelSizeKey(missingOption)])
              : null;

            return (
              <div
                key={missingOption.control.id}
                className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-[11px] font-medium text-red-50">
                      {missingOption.control.label}
                    </p>
                    {dirBadge ? (
                      <span className="shrink-0 rounded-md border border-red-200/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-red-100/70">
                        {dirBadge}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-red-100/70">
                      {missingOption.value}
                    </span>
                    {sizeLabel ? (
                      <span className="shrink-0 text-[10px] font-medium text-red-100/45">
                        {sizeLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                <MissingModelActions
                  missingOption={missingOption}
                  onDownload={onDownload}
                  onCopyPath={onCopyPath}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const getRunBatchLabel = (runIndex: number, runCount: number): string =>
  runCount > 1 ? `Run ${runIndex}/${runCount}` : '';

const formatRunProgressLabel = (label: string, runIndex: number, runCount: number): string => {
  const batchLabel = getRunBatchLabel(runIndex, runCount);
  return batchLabel ? `${batchLabel} · ${label}` : label;
};

const formatRunStatusMessage = (message: string, runIndex: number, runCount: number): string => {
  const batchLabel = getRunBatchLabel(runIndex, runCount);
  return batchLabel ? `${batchLabel}: ${message}` : message;
};

const getComfyBatchSource = (
  projectId: string | null,
  nodeId: string,
  workflowId: string,
  runIndex: number,
  runCount: number,
) => ({
  ...(projectId ? { projectId } : {}),
  nodeId,
  workflowId,
  runIndex,
  runCount,
  completedCount: Math.max(0, Math.min(runCount, runIndex - 1)),
});

const getRunProgressPercent = (progress: RunProgress | null): number => {
  if (!progress) return 0;
  if (
    progress.value !== undefined &&
    progress.max !== undefined &&
    Number.isFinite(progress.max) &&
    progress.max > 0
  ) {
    return Math.max(0, Math.min(100, (progress.value / progress.max) * 100));
  }
  return Math.max(0, Math.min(100, progress.percent ?? 0));
};

const getOutputPromptSummary = (
  controls: ComfyWorkflowControl[],
  workflowId: string,
): string | undefined => {
  const promptControl = controls.find(
    (control) =>
      control.workflowId === workflowId &&
      typeof control.value === 'string' &&
      control.value.trim().length > 0 &&
      isPromptLikeComfyTextInput({
        inputName: control.inputName,
        label: control.label,
        classType: control.classType,
        description: control.description,
      }),
  );

  return typeof promptControl?.value === 'string' ? promptControl.value.trim() : undefined;
};

const getSelectedWorkflowOutputIds = (workflow: ComfyWorkflow): string[] => {
  const candidateIds = new Set((workflow.outputCandidates ?? []).map((candidate) => candidate.id));
  if (workflow.selectedOutputIds) {
    return workflow.selectedOutputIds.filter((id) => candidateIds.has(id));
  }
  const firstCandidate = workflow.outputCandidates?.[0];
  return firstCandidate ? [firstCandidate.id] : [];
};

const getSelectedWorkflowOutputCandidates = (
  workflow: ComfyWorkflow,
): ComfyWorkflowOutputCandidate[] => {
  const selectedIds = new Set(getSelectedWorkflowOutputIds(workflow));
  return (workflow.outputCandidates ?? []).filter((candidate) => selectedIds.has(candidate.id));
};

const getOutputCountLabel = (count: number): string => `${count} output${count === 1 ? '' : 's'}`;

const useComfyOutputUrl = (assetId: string) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadAsset = async () => {
      try {
        const blob = await getAsset(assetId);
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (error) {
        console.error(`Failed to load Comfy output ${assetId}`, error);
      }
    };

    setUrl(null);
    void loadAsset();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  return url;
};

const ComfyOutputThumbnail: React.FC<{
  output: GeneratedOutput;
  active: boolean;
  onClick: () => void;
}> = ({ output, active, onClick }) => {
  const imageUrl = useComfyOutputUrl(output.src);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-gray-800 transition ${
        active
          ? 'border-primary-300 ring-1 ring-primary-300/50'
          : 'border-white/10 hover:border-white/30'
      }`}
      title={output.prompt || output.label || 'Comfy output'}
      aria-pressed={active}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-500">
          <Icons.Photo className="h-5 w-5" />
        </div>
      )}
      {active ? (
        <span className="absolute right-1 top-1 rounded-full bg-primary-300 p-0.5 text-gray-950">
          <Icons.Check className="h-2.5 w-2.5" />
        </span>
      ) : null}
    </button>
  );
};

const ComfyOutputPlaceholder: React.FC<{
  label: string;
  detail?: string;
  active?: boolean;
}> = ({ label, detail, active = false }) => (
  <div
    className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed px-1.5 text-center ${
      active
        ? 'border-primary-300/45 bg-primary-300/[0.08] text-primary-100'
        : 'border-white/10 bg-gray-900/60 text-gray-500'
    }`}
    title={detail ?? label}
  >
    <Icons.CubeTransparent className={`h-4 w-4 ${active ? 'animate-pulse' : ''}`} />
    <span className="mt-0.5 max-w-full truncate text-[10px] font-medium">{label}</span>
  </div>
);

const getImageExtensionFromMime = (mimeType: string): string => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
};

const sanitizeComfyUploadNamePart = (value: string): string =>
  value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'input';

const getComfyInputUploadFilename = ({
  sourceName,
  candidate,
  blob,
}: {
  sourceName: string;
  candidate: ComfyWorkflowInputCandidate;
  blob: Blob;
}): string => {
  const uploadSourceName = sanitizeComfyUploadNamePart(sourceName);
  const inputName = sanitizeComfyUploadNamePart(`${candidate.nodeId}_${candidate.inputName}`);
  const extensionFromName = sourceName
    .match(/\.(png|jpe?g|webp|gif|exr)$/i)?.[1]
    ?.toLowerCase()
    .replace('jpeg', 'jpg');
  const extension = extensionFromName ?? getImageExtensionFromMime(blob.type);
  return `${uploadSourceName}_${inputName}_${Date.now()}.${extension}`;
};

const getConnectedSourceAssetId = (sourceNode: AnyNode, currentFrame: number): string | null => {
  if (sourceNode.type === NodeType.IMAGE || sourceNode.type === NodeType.COMFY) {
    const src = (sourceNode as { src?: string }).src;
    return src || null;
  }

  if (sourceNode.type === NodeType.IMAGE_SEQUENCE) {
    const sequenceNode = sourceNode as ImageSequenceNode;
    if (sequenceNode.frames.length === 0) return null;
    const index = Math.floor(currentFrame - sequenceNode.startFrame);
    if (sequenceNode.loop) {
      const safeIndex =
        ((index % sequenceNode.frames.length) + sequenceNode.frames.length) %
        sequenceNode.frames.length;
      return sequenceNode.frames[safeIndex] ?? null;
    }
    return (
      sequenceNode.frames[Math.max(0, Math.min(sequenceNode.frames.length - 1, index))] ?? null
    );
  }

  return null;
};

const getIntegerRangeDefaults = (control: ComfyWorkflowControl): { min: number; max: number } => {
  const value = typeof control.value === 'number' ? control.value : 0;
  const min =
    typeof control.min === 'number' && Number.isFinite(control.min)
      ? control.min
      : Math.min(0, value);
  const max =
    typeof control.max === 'number' && Number.isFinite(control.max)
      ? control.max
      : Math.max(10, value);
  return min <= max ? { min, max } : { min: max, max: min };
};

const getIntegerStepDefault = (control: ComfyWorkflowControl): number => {
  const step = control.incrementStep ?? control.step ?? 1;
  const integerStep = Math.trunc(step);
  return integerStep === 0 ? 1 : integerStep;
};

const parseFiniteIntegerInput = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const getNumericModeSelectorValue = (
  mode: ComfyWorkflowControlRunMode,
): 'fixed' | 'randomize' | 'increment' => {
  if (mode === 'randomRange') return 'randomize';
  return mode;
};

const getNumericModeLabel = (mode: ComfyWorkflowControlRunMode): string => {
  switch (mode) {
    case 'randomize':
      return 'Random on run';
    case 'randomRange':
      return 'Random on run';
    case 'increment':
      return 'Increment on run';
    case 'fixed':
    default:
      return 'Fixed value';
  }
};

const formatIncrementBadgeStep = (step: number): string => {
  const integerStep = Math.trunc(step);
  if (integerStep <= -10) return '-9';
  if (integerStep >= 100) return '99';
  return String(integerStep);
};

const isRunShortcut = (event: React.KeyboardEvent<HTMLElement>): boolean =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey;

interface WorkflowRunModeControlProps {
  control: ComfyWorkflowControl;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

const WorkflowRunModeControl: React.FC<WorkflowRunModeControlProps> = ({
  control,
  isOpen,
  onOpenChange,
  onUpdate,
  onKeyDown,
}) => {
  const mode = getComfyWorkflowControlRunMode(control);
  const selectedMode = getNumericModeSelectorValue(mode);
  const rangeDefaults = getIntegerRangeDefaults(control);
  const incrementStep = getIntegerStepDefault(control);
  const [randomMinDraft, setRandomMinDraft] = useState(
    control.randomMin === undefined ? '' : String(control.randomMin),
  );
  const [randomMaxDraft, setRandomMaxDraft] = useState(
    control.randomMax === undefined ? '' : String(control.randomMax),
  );
  const [incrementDraft, setIncrementDraft] = useState(String(incrementStep));

  useEffect(() => {
    setRandomMinDraft(control.randomMin === undefined ? '' : String(control.randomMin));
  }, [control.randomMin]);

  useEffect(() => {
    setRandomMaxDraft(control.randomMax === undefined ? '' : String(control.randomMax));
  }, [control.randomMax]);

  useEffect(() => {
    setIncrementDraft(String(incrementStep));
  }, [incrementStep]);

  const setMode = (nextMode: 'fixed' | 'randomize' | 'increment') => {
    onUpdate({
      runMode: nextMode,
      incrementStep: nextMode === 'increment' ? incrementStep : control.incrementStep,
    });
  };

  const commitRandomBound = (field: 'randomMin' | 'randomMax', draft: string): boolean => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onUpdate({
        runMode: 'randomize',
        [field]: undefined,
      });
      return true;
    }

    const parsed = parseFiniteIntegerInput(trimmed);
    if (parsed === null) return false;

    onUpdate({
      runMode: 'randomize',
      [field]: parsed,
    });
    return true;
  };

  const commitIncrementStep = (draft: string): boolean => {
    const parsed = parseFiniteIntegerInput(draft.trim());
    if (parsed === null) return false;

    onUpdate({
      runMode: 'increment',
      incrementStep: parsed,
    });
    return true;
  };

  const handleDraftKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    resetDraft: () => void,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      resetDraft();
      event.currentTarget.blur();
    }
  };

  const modeItemClass = (candidate: 'fixed' | 'randomize' | 'increment') =>
    `rounded-md border px-2 py-1.5 transition ${
      selectedMode === candidate
        ? 'border-primary-300/25 bg-primary-300/10 text-primary-50'
        : 'border-transparent text-gray-300 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
    }`;

  const inlineInputClass =
    'h-6 w-full rounded-md border border-white/10 bg-black/30 px-2 text-right text-[11px] text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-primary-300/60 focus:bg-gray-950';

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      align="end"
      widthClass="w-56"
      trigger={
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-100"
          title="Run behavior"
          aria-label="Run behavior"
        >
          <Icons.EllipsisVertical className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-1" onKeyDown={onKeyDown}>
        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          Run Behavior
        </p>
        <div className="space-y-1">
          {(['fixed', 'randomize', 'increment'] as const).map((candidate) => (
            <div key={candidate} className={modeItemClass(candidate)}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMode(candidate)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px]"
                >
                  <span className="truncate">{getNumericModeLabel(candidate)}</span>
                </button>
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {selectedMode === candidate && <Icons.Check className="h-3.5 w-3.5" />}
                </span>
              </div>

              {candidate === 'randomize' && selectedMode === candidate && (
                <div className="mt-1 grid grid-cols-2 gap-1.5 pl-0">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={randomMinDraft}
                    placeholder="Min"
                    aria-label="Random minimum"
                    title={`Leave blank to use the detected minimum (${rangeDefaults.min}).`}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      setMode('randomize');
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      const nextDraft = event.currentTarget.value;
                      setRandomMinDraft(nextDraft);
                      if (nextDraft.trim() === '' || parseFiniteIntegerInput(nextDraft) !== null) {
                        commitRandomBound('randomMin', nextDraft);
                      }
                    }}
                    onBlur={() => {
                      if (commitRandomBound('randomMin', randomMinDraft)) return;
                      setRandomMinDraft(
                        control.randomMin === undefined ? '' : String(control.randomMin),
                      );
                    }}
                    onKeyDown={(event) =>
                      handleDraftKeyDown(event, () =>
                        setRandomMinDraft(
                          control.randomMin === undefined ? '' : String(control.randomMin),
                        ),
                      )
                    }
                    className={inlineInputClass}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={randomMaxDraft}
                    placeholder="Max"
                    aria-label="Random maximum"
                    title={`Leave blank to use the detected maximum (${rangeDefaults.max}).`}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      setMode('randomize');
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      const nextDraft = event.currentTarget.value;
                      setRandomMaxDraft(nextDraft);
                      if (nextDraft.trim() === '' || parseFiniteIntegerInput(nextDraft) !== null) {
                        commitRandomBound('randomMax', nextDraft);
                      }
                    }}
                    onBlur={() => {
                      if (commitRandomBound('randomMax', randomMaxDraft)) return;
                      setRandomMaxDraft(
                        control.randomMax === undefined ? '' : String(control.randomMax),
                      );
                    }}
                    onKeyDown={(event) =>
                      handleDraftKeyDown(event, () =>
                        setRandomMaxDraft(
                          control.randomMax === undefined ? '' : String(control.randomMax),
                        ),
                      )
                    }
                    className={inlineInputClass}
                  />
                </div>
              )}

              {candidate === 'increment' && selectedMode === candidate && (
                <div className="mt-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={incrementDraft}
                    placeholder="Step"
                    aria-label="Increment amount"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      setMode('increment');
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      const nextDraft = event.currentTarget.value;
                      setIncrementDraft(nextDraft);
                      if (nextDraft.trim() !== '' && parseFiniteIntegerInput(nextDraft) !== null) {
                        commitIncrementStep(nextDraft);
                      }
                    }}
                    onBlur={() => {
                      if (commitIncrementStep(incrementDraft)) return;
                      setIncrementDraft(String(incrementStep));
                    }}
                    onKeyDown={(event) =>
                      handleDraftKeyDown(event, () => setIncrementDraft(String(incrementStep)))
                    }
                    className={inlineInputClass}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
};

interface WorkflowRunModeBadgeProps {
  control: ComfyWorkflowControl;
  rollToken?: number;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
}

const IncrementRunModeIcon: React.FC<{
  className?: string;
  step: number;
  isAnimating?: boolean;
}> = ({ className, step, isAnimating = false }) => {
  const stepLabel = formatIncrementBadgeStep(step);
  const isNegative = step < 0;
  const textSize = stepLabel.length > 1 ? 7.2 : 10;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {/* Frame */}
      <path
        d="M7.25 3.75h8.55c1.24 0 2.25 1.01 2.25 2.25v1.05"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.25 7.15v9.6c0 1.38 1.12 2.5 2.5 2.5h8.05c1.38 0 2.5-1.12 2.5-2.5v-1.5"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Value */}
      <text
        x="11.0"
        y="15.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize={textSize}
        fontWeight="500"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
      >
        {stepLabel}
      </text>

      {/* Arrow */}
      <g
        className={
          isAnimating
            ? 'origin-center motion-safe:animate-[incrementArrow_520ms_cubic-bezier(0.22,1,0.36,1)_1]'
            : undefined
        }
        style={{ transformOrigin: '18.5px 11.5px' }}
      >
        <path
          d={isNegative ? 'M18.5 7.1v9.2' : 'M18.5 16.3V7.1'}
          stroke="var(--increment-icon-accent, currentColor)"
          strokeWidth={1.9}
          strokeLinecap="round"
        />
        <path
          d={isNegative ? 'M15.9 13.7L18.5 16.3L21.1 13.7' : 'M15.9 9.7L18.5 7.1L21.1 9.7'}
          stroke="var(--increment-icon-accent, currentColor)"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};

const WorkflowRunModeBadge: React.FC<WorkflowRunModeBadgeProps> = ({
  control,
  rollToken = 0,
  onUpdate,
}) => {
  const mode = getComfyWorkflowControlRunMode(control);
  const isFixed = mode === 'fixed';
  const shouldShow = isSeedLikeComfyInput(control.inputName) || !isFixed;
  const [isRolling, setIsRolling] = useState(false);
  const incrementStep = getIntegerStepDefault(control);
  const isIncrementMode = mode === 'increment';

  useEffect(() => {
    if (rollToken <= 0) return;
    setIsRolling(true);
  }, [rollToken]);

  useEffect(() => {
    if (!isRolling) return;
    const timeoutId = window.setTimeout(() => {
      setIsRolling(false);
    }, RUN_MODE_BADGE_ANIMATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isRolling]);

  if (!shouldShow) return null;

  return (
    <button
      type="button"
      onClick={() => onUpdate({ runMode: isFixed ? 'randomize' : 'fixed' })}
      aria-pressed={!isFixed}
      title={`${getNumericModeLabel(mode)}. Click to ${isFixed ? 'randomize on run' : 'fix value'}.`}
      aria-label={`${getNumericModeLabel(mode)}. Click to ${isFixed ? 'randomize on run' : 'fix value'}.`}
      style={
        {
          '--increment-icon-accent': 'rgb(var(--color-primary-200))',
        } as React.CSSProperties
      }
      className={`inline-flex h-5 w-5 items-center justify-center overflow-visible rounded border border-transparent focus-visible:outline-none focus-visible:ring-1 ${
        isFixed
          ? 'text-gray-500 hover:border-gray-500/70 hover:bg-white/[0.03] hover:text-gray-200 focus-visible:border-gray-500/70 focus-visible:ring-white/20'
          : 'bg-primary-300/10 text-primary-100 hover:border-primary-300/50 hover:bg-primary-300/14 focus-visible:border-primary-300/50 focus-visible:ring-primary-300/30'
      } ${
        isRolling && !isIncrementMode
          ? 'motion-safe:animate-[diceRoll_520ms_cubic-bezier(0.22,1,0.36,1)_1]'
          : ''
      }`}
    >
      {isIncrementMode ? (
        <IncrementRunModeIcon
          step={incrementStep}
          isAnimating={isRolling}
          className="h-5 w-5 scale-[1.18]"
        />
      ) : (
        <Icons.Dice className="h-5 w-5 scale-[1.35]" />
      )}
    </button>
  );
};

interface ExpandableWorkflowTextControlProps {
  control: ComfyWorkflowControl;
  description: string;
  promptRoute: ResolvedAiTextRoute | null;
  promptRouteError: string | null;
  onChange: (value: string) => void;
  onEnhance: () => Promise<void>;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
  onReset: () => void;
}

const ExpandableWorkflowTextControl: React.FC<ExpandableWorkflowTextControlProps> = ({
  control,
  description,
  promptRoute,
  promptRouteError,
  onChange,
  onEnhance,
  onUpdate,
  onReset,
}) => {
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const promptValue = String(control.value);
  const isPromptLikeField = isPromptLikeComfyTextInput(control);
  const canUsePromptTools = Boolean(promptRoute);
  const isBusy = isSuggesting || isEnhancing;
  const suggestionPages = control.promptSuggestionPages ?? [];
  const suggestionPageIndex = Math.min(
    Math.max(0, control.promptSuggestionPageIndex ?? 0),
    Math.max(0, suggestionPages.length - 1),
  );
  const currentSuggestions = suggestionPages[suggestionPageIndex] ?? [];
  const areSuggestionsVisible = Boolean(control.promptSuggestionsVisible);
  const promptToolsUnavailableReason = canUsePromptTools
    ? ''
    : (promptRouteError ?? 'Configure prompt tools in Preferences > Integrations.');

  const handleSuggest = async () => {
    if (!promptRoute || isBusy) return;

    setIsSuggesting(true);
    try {
      const suggestionResult = await getPromptSuggestions(promptRoute);
      if (suggestionResult.length > 0) {
        const nextPages = [...suggestionPages, suggestionResult];
        onUpdate({
          promptSuggestionPages: nextPages,
          promptSuggestionPageIndex: nextPages.length - 1,
          promptSuggestionsVisible: true,
        });
      }
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleToggleSuggestions = () => {
    if (areSuggestionsVisible) {
      onUpdate({ promptSuggestionsVisible: false });
      return;
    }

    if (suggestionPages.length === 0) {
      void handleSuggest();
      return;
    }

    onUpdate({ promptSuggestionsVisible: true });
  };

  const handleEnhance = async () => {
    if (!promptRoute || isBusy || promptValue.trim().length === 0) return;

    setIsEnhancing(true);
    try {
      await onEnhance();
    } finally {
      setIsEnhancing(false);
    }
  };

  const clearCurrentSuggestionPage = () => {
    const nextPages = suggestionPages.filter((_, index) => index !== suggestionPageIndex);
    onUpdate({
      promptSuggestionPages: nextPages,
      promptSuggestionPageIndex: Math.min(suggestionPageIndex, Math.max(0, nextPages.length - 1)),
      promptSuggestionsVisible: nextPages.length > 0,
    });
  };

  return (
    <PromptTextField
      label={control.label}
      description={description}
      value={promptValue}
      onValueChange={onChange}
      canUsePromptTools={canUsePromptTools}
      promptToolsUnavailableReason={promptToolsUnavailableReason}
      isSuggesting={isSuggesting}
      isEnhancing={isEnhancing}
      suggestions={currentSuggestions}
      suggestionsVisible={areSuggestionsVisible}
      suggestionPageLabel={`${suggestionPageIndex + 1}/${suggestionPages.length}`}
      canPreviousSuggestions={suggestionPageIndex > 0}
      canNextSuggestions={suggestionPageIndex < suggestionPages.length - 1}
      onSuggest={isPromptLikeField ? () => void handleSuggest() : undefined}
      onEnhance={isPromptLikeField ? () => void handleEnhance() : undefined}
      onToggleSuggestions={isPromptLikeField ? handleToggleSuggestions : undefined}
      onPreviousSuggestions={() =>
        onUpdate({
          promptSuggestionPageIndex: Math.max(0, suggestionPageIndex - 1),
          promptSuggestionsVisible: true,
        })
      }
      onNextSuggestions={() =>
        onUpdate({
          promptSuggestionPageIndex: Math.min(suggestionPages.length - 1, suggestionPageIndex + 1),
          promptSuggestionsVisible: true,
        })
      }
      onClearSuggestions={clearCurrentSuggestionPage}
      onSuggestionSelect={onChange}
      onReset={onReset}
      resetTooltip={getControlResetTooltip(control)}
      enhanceLabel="Enhance in Chat"
    />
  );
};

const ComfyAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as ComfyNode;
  const {
    startComfyPromptEnhancementChat,
    updateNode,
    setActiveTab,
    setSubPanelVisible,
    startBackgroundJob,
    updateBackgroundJob,
    finishBackgroundJob,
    requestBackgroundJobCancel,
    applyComfyNodeRunResult,
  } = useEditorActions();
  const {
    comfyEndpoint,
    comfyMissingModelDetailsVisible,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
    aiTaskRoutes,
    setPreferences,
  } = usePreferences();
  const endpoint = normalizeComfyEndpoint(comfyEndpoint);
  const allNodes = useEditorSelector((state) => state.nodes);
  const projectId = useEditorSelector((state) => state.projectId);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const activeHistoryEntryId = useEditorSelector(
    (state) => state.history[state.historyIndex]?.id ?? null,
  );
  const sceneNode = useMemo(
    () => allNodes.find((candidate: AnyNode) => candidate.type === NodeType.SCENE),
    [allNodes],
  );
  const aiApplyNotice = useEditorSelector((state) => state.aiApplyNotice);
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const activeNodeComfyJobs = useMemo(
    () =>
      backgroundJobs
        .filter(
          (job) =>
            job.type === 'comfy' &&
            job.source?.nodeId === node.id &&
            (!job.source.projectId || job.source.projectId === projectId) &&
            isBackgroundJobActive(job),
        )
        .sort((a, b) => a.startedAt - b.startedAt),
    [backgroundJobs, node.id, projectId],
  );
  const activeNodeComfyJob = activeNodeComfyJobs[0] ?? null;
  const endpointQueueKey = `comfy:${endpoint}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generatedOutputsRef = useRef<GeneratedOutput[]>(node.generatedOutputs ?? []);
  const hasStepProgressRef = useRef(false);
  const [runState, setRunState] = useState<RunState>('idle');
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);
  const [runRollTokens, setRunRollTokens] = useState<Record<string, number>>({});
  const [workflowBrowserState, setWorkflowBrowserState] = useState<WorkflowBrowserState>('idle');
  const [backendWorkflowFiles, setBackendWorkflowFiles] = useState<ComfyWorkflowFile[]>([]);
  const [workflowEmptyMode, setWorkflowEmptyMode] = useState<WorkflowEmptyMode>('choice');
  const [workflowJsonDraft, setWorkflowJsonDraft] = useState('');
  const [isWorkflowControlBuilderOpen, setIsWorkflowControlBuilderOpen] = useState(false);
  const [pendingControlKeys, setPendingControlKeys] = useState<Set<string>>(() => new Set());
  const [advancedControlId, setAdvancedControlId] = useState<string | null>(null);
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);
  const [isBackendWorkflowPickerOpen, setIsBackendWorkflowPickerOpen] = useState(false);
  const [backendWorkflowSearch, setBackendWorkflowSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [localError, setLocalError] = useState<string | null>(node.lastError ?? null);
  const [missingModelSizeStatuses, setMissingModelSizeStatuses] = useState<
    Record<string, MissingModelSizeStatus>
  >({});
  const missingModelSizeStatusesRef = useRef<Record<string, MissingModelSizeStatus>>({});
  const imagePromptRouteError = getAiTaskRouteError('imagePromptTools', {
    aiTaskRoutes,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const imagePromptRoute = imagePromptRouteError
    ? null
    : resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });

  const selectedWorkflow = useMemo(
    () => node.workflows.find((workflow) => workflow.id === node.selectedWorkflowId) ?? null,
    [node.selectedWorkflowId, node.workflows],
  );

  const workflowControls = useMemo(() => node.workflowControls ?? [], [node.workflowControls]);
  const recentGeneratedOutputs = useMemo(
    () =>
      [...(node.generatedOutputs ?? [])]
        .filter((output) => !output.deletedAt)
        .reverse()
        .slice(0, 5),
    [node.generatedOutputs],
  );
  const pendingGeneratedOutputSlots = useMemo(() => {
    return activeNodeComfyJobs.flatMap((job, jobIndex) => {
      const source = job.source;
      const runCount = source?.runCount ?? 0;
      if (runCount <= 0) return [];

      const runIndex = Math.max(1, Math.min(runCount, source?.runIndex ?? 1));
      const completedCount = Math.max(
        0,
        Math.min(runCount, source?.completedCount ?? runIndex - 1),
      );
      const remainingCount = Math.max(0, runCount - completedCount);
      const queuedJobNumber = jobIndex + 1;

      return Array.from({ length: remainingCount }, (_, index) => {
        const slot = completedCount + index + 1;
        const isActiveSlot = slot === runIndex && job.status !== 'queued';
        return {
          id: `${job.id}:${slot}`,
          slot,
          label: isActiveSlot
            ? 'Generating'
            : queuedJobNumber > 1
              ? `Queued ${queuedJobNumber}`
              : `Queued ${slot}`,
          detail: runCount > 1 ? `Run ${slot}/${runCount}` : job.detail,
          active: isActiveSlot,
        };
      });
    });
  }, [activeNodeComfyJobs]);

  const activeWorkflowControls = useMemo(
    () =>
      selectedWorkflow
        ? workflowControls.filter((control) => control.workflowId === selectedWorkflow.id)
        : [],
    [selectedWorkflow, workflowControls],
  );
  const activeMissingControlOptions = useMemo(
    () =>
      selectedWorkflow ? getMissingWorkflowControlOptions(workflowControls, selectedWorkflow) : [],
    [selectedWorkflow, workflowControls],
  );
  useEffect(() => {
    missingModelSizeStatusesRef.current = missingModelSizeStatuses;
  }, [missingModelSizeStatuses]);

  useEffect(() => {
    const pendingOptions = activeMissingControlOptions.filter((missingOption) => {
      if (!missingOption.downloadUrl) return false;
      return (
        missingModelSizeStatusesRef.current[getMissingModelSizeKey(missingOption)] === undefined
      );
    });
    if (pendingOptions.length === 0) return;

    const controller = new AbortController();

    setMissingModelSizeStatuses((currentStatuses) => {
      let changed = false;
      const nextStatuses = { ...currentStatuses };
      pendingOptions.forEach((missingOption) => {
        const key = getMissingModelSizeKey(missingOption);
        if (nextStatuses[key] === undefined) {
          nextStatuses[key] = 'loading';
          changed = true;
        }
      });
      return changed ? nextStatuses : currentStatuses;
    });

    pendingOptions.forEach((missingOption) => {
      const downloadUrl = missingOption.downloadUrl;
      if (!downloadUrl) return;
      const key = getMissingModelSizeKey(missingOption);

      void fetchMissingModelDownloadSize(downloadUrl, controller.signal)
        .then((size) => {
          if (controller.signal.aborted) return;
          setMissingModelSizeStatuses((currentStatuses) => ({
            ...currentStatuses,
            [key]: size,
          }));
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setMissingModelSizeStatuses((currentStatuses) => ({
            ...currentStatuses,
            [key]: null,
          }));
        });
    });

    return () => controller.abort();
  }, [activeMissingControlOptions]);
  const filteredBackendWorkflowFiles = useMemo(() => {
    const query = backendWorkflowSearch.trim().toLowerCase();
    if (!query) return backendWorkflowFiles;

    return backendWorkflowFiles.filter((workflowFile) =>
      [
        workflowFile.path,
        getWorkflowNameFromPath(workflowFile.path),
        getWorkflowFileDetail(workflowFile),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [backendWorkflowFiles, backendWorkflowSearch]);
  const workflowOutputCandidates = selectedWorkflow?.outputCandidates ?? [];
  const workflowInputCandidates = useMemo(
    () => getComfyWorkflowInputCandidates(selectedWorkflow),
    [selectedWorkflow],
  );
  const connectedWorkflowInputs = useMemo(() => {
    if (!selectedWorkflow) return [];

    return workflowInputCandidates.map((candidate) => {
      const portName = getComfyWorkflowInputPortName(selectedWorkflow.id, candidate);
      const sourceNodeId = node.inputs?.[portName];
      const sourceNode = sourceNodeId
        ? allNodes.find((candidateNode) => candidateNode.id === sourceNodeId)
        : undefined;
      const inputImage = node.workflowInputImages?.[portName] ?? null;

      return {
        candidate,
        portName,
        sourceNode: sourceNode ?? null,
        inputImage,
      };
    });
  }, [allNodes, node.inputs, node.workflowInputImages, selectedWorkflow, workflowInputCandidates]);
  const selectedWorkflowOutputIds = useMemo(
    () => (selectedWorkflow ? getSelectedWorkflowOutputIds(selectedWorkflow) : []),
    [selectedWorkflow],
  );
  const selectedWorkflowOutputIdSet = useMemo(
    () => new Set(selectedWorkflowOutputIds),
    [selectedWorkflowOutputIds],
  );
  const promptApplyNotice =
    aiApplyNotice?.nodeId === node.id && aiApplyNotice.field === 'prompt' ? aiApplyNotice : null;
  const outputApplyNotice =
    aiApplyNotice?.nodeId === node.id && aiApplyNotice.field === 'comfy-output'
      ? aiApplyNotice
      : null;

  useEffect(() => {
    if (!promptApplyNotice?.fieldId) {
      return;
    }

    window.requestAnimationFrame(() => {
      document
        .querySelector(
          `[data-ai-apply-control-id="${CSS.escape(promptApplyNotice.fieldId ?? '')}"]`,
        )
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [promptApplyNotice?.fieldId, promptApplyNotice?.id]);

  const controlCandidates = useMemo(
    () => getComfyWorkflowControlCandidates(selectedWorkflow),
    [selectedWorkflow],
  );

  const activeControlKeyList = useMemo(
    () =>
      activeWorkflowControls
        .map((control) => getComfyControlKey(control.nodeId, control.inputName))
        .sort(),
    [activeWorkflowControls],
  );

  const activeControlKeys = useMemo(() => new Set(activeControlKeyList), [activeControlKeyList]);

  const defaultControlKeyList = useMemo(
    () => controlCandidates.map((candidate) => candidate.key).sort(),
    [controlCandidates],
  );

  const getDefaultPendingControlKeys = useCallback(
    () => new Set(activeControlKeyList.length > 0 ? activeControlKeyList : defaultControlKeyList),
    [activeControlKeyList, defaultControlKeyList],
  );

  const activeControlKeySignature = useMemo(
    () => activeControlKeyList.join('\n'),
    [activeControlKeyList],
  );

  const defaultControlKeySignature = useMemo(
    () => defaultControlKeyList.join('\n'),
    [defaultControlKeyList],
  );

  useEffect(() => {
    setLocalError(node.lastError ?? null);
  }, [node.lastError]);

  useEffect(() => {
    generatedOutputsRef.current = node.generatedOutputs ?? [];
  }, [node.generatedOutputs]);

  useEffect(() => {
    setIsWorkflowControlBuilderOpen(false);
    setAdvancedControlId(null);
    setPendingControlKeys(getDefaultPendingControlKeys());
  }, [
    activeControlKeySignature,
    defaultControlKeySignature,
    getDefaultPendingControlKeys,
    selectedWorkflow?.id,
  ]);

  useEffect(() => {
    if (workflowEmptyMode === 'paste') {
      pasteTextareaRef.current?.focus();
    }
  }, [workflowEmptyMode]);

  useEffect(() => {
    if (workflowEmptyMode !== 'paste') return;

    const textarea = pasteTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(96, textarea.scrollHeight)}px`;
  }, [workflowEmptyMode, workflowJsonDraft]);

  const setNodeError = (message: string | null) => {
    setLocalError(message);
    updateNode(node.id, { lastError: message ?? undefined }, false);
  };

  const handleActivateGeneratedOutput = (output: GeneratedOutput) => {
    const transform =
      sceneNode && 'width' in sceneNode && 'height' in sceneNode
        ? {
            ...node.transform,
            ...calculateTransformForFitMode(
              { width: output.width, height: output.height },
              { width: sceneNode.width, height: sceneNode.height },
              node.transform.fitMode,
            ),
            x: 0,
            y: 0,
          }
        : node.transform;

    updateNode(
      node.id,
      {
        src: output.src,
        width: output.width,
        height: output.height,
        transform,
        activeGeneratedOutputId: output.id,
        lastPromptId: output.promptId,
        lastRunAt: output.createdAt,
      },
      true,
    );
  };

  const openGalleryView = () => {
    setSubPanelVisible(true);
    setActiveTab(EditorTab.Gallery);
  };

  const handleImportWorkflow = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const workflow = await readComfyWorkflowFile(file, endpoint);
      const defaultWorkflowControls = createDefaultComfyWorkflowControls(workflow);
      const importedAt = Date.now();
      const importedOutput = isComfyWorkflowImageFile(file)
        ? await (async (): Promise<GeneratedOutput> => {
            const { width, height } = await readImageDimensions(file);
            const assetId = await saveAsset(file);
            return {
              id: `comfy_output_import_${importedAt}_${Math.random().toString(36).slice(2, 8)}`,
              src: assetId,
              width,
              height,
              createdAt: importedAt,
              label: file.name || 'Imported Comfy output',
              prompt: getOutputPromptSummary(defaultWorkflowControls, workflow.id),
              workflowId: workflow.id,
              workflowName: workflow.name,
            };
          })()
        : null;
      const nextGeneratedOutputs = importedOutput
        ? [...generatedOutputsRef.current, importedOutput]
        : generatedOutputsRef.current;
      if (importedOutput) {
        generatedOutputsRef.current = nextGeneratedOutputs;
      }
      const importedTransform =
        importedOutput && sceneNode && 'width' in sceneNode && 'height' in sceneNode
          ? {
              ...node.transform,
              ...calculateTransformForFitMode(
                { width: importedOutput.width, height: importedOutput.height },
                { width: sceneNode.width, height: sceneNode.height },
                node.transform.fitMode,
              ),
              x: 0,
              y: 0,
            }
          : node.transform;

      updateNode(
        node.id,
        {
          workflows: [...node.workflows, workflow],
          selectedWorkflowId: workflow.id,
          workflowControls: [...workflowControls, ...defaultWorkflowControls],
          ...(importedOutput
            ? {
                src: importedOutput.src,
                width: importedOutput.width,
                height: importedOutput.height,
                transform: importedTransform,
                generatedOutputs: nextGeneratedOutputs,
                activeGeneratedOutputId: importedOutput.id,
                lastRunAt: importedOutput.createdAt,
              }
            : {}),
          lastError: undefined,
        },
        true,
      );
      const missingOptions = getMissingWorkflowControlOptions(defaultWorkflowControls, workflow);
      setRunState('complete');
      setStatusMessage(
        importedOutput
          ? `${getMissingWorkflowControlStatus(workflow.name, missingOptions)} Added ${file.name} to Gallery.`
          : getMissingWorkflowControlStatus(workflow.name, missingOptions),
      );
      setLocalError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not import the ComfyUI workflow JSON.';
      setRunState('error');
      setStatusMessage('');
      setNodeError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handleReadBackendWorkflows = async () => {
    setWorkflowBrowserState('loading');
    setStatusMessage('Reading ComfyUI workflows.');
    setNodeError(null);

    try {
      const files = await listComfyWorkflowFiles(endpoint);
      setBackendWorkflowFiles(files);
      setWorkflowBrowserState('idle');
      setStatusMessage(
        files.length > 0
          ? `Found ${files.length} ComfyUI workflow${files.length === 1 ? '' : 's'}.`
          : 'No ComfyUI workflows found in workflows/.',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not read workflows from ComfyUI.';
      setWorkflowBrowserState('error');
      setStatusMessage('');
      setNodeError(message);
    }
  };

  const handleChooseImportWorkflow = () => {
    fileInputRef.current?.click();
  };

  const handleImportWorkflowInputImage = async (
    workflow: ComfyWorkflow,
    candidate: ComfyWorkflowInputCandidate,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const inputKey = getComfyWorkflowInputPortName(workflow.id, candidate);

    try {
      if (!isImageFileLike(file, file.name)) {
        throw new Error(`${file.name} is not an image ComfyUI can load.`);
      }

      const { width, height } = await readImageDimensions(file);
      const assetId = await saveAsset(file);
      const inputImage: ComfyWorkflowInputImage = {
        assetId,
        name: file.name || candidate.label,
        type: file.type || undefined,
        width,
        height,
        createdAt: Date.now(),
      };

      updateNode(
        node.id,
        {
          workflowInputImages: {
            ...(node.workflowInputImages ?? {}),
            [inputKey]: inputImage,
          },
          lastError: undefined,
        },
        true,
      );
      setRunState('idle');
      setStatusMessage(`Loaded ${inputImage.name} for ${candidate.label}.`);
      setLocalError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Could not load image for ${candidate.label}.`;
      setRunState('error');
      setStatusMessage('');
      setNodeError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handleClearWorkflowInputImage = (
    workflow: ComfyWorkflow,
    candidate: ComfyWorkflowInputCandidate,
  ) => {
    const inputKey = getComfyWorkflowInputPortName(workflow.id, candidate);
    const nextInputImages = { ...(node.workflowInputImages ?? {}) };
    delete nextInputImages[inputKey];

    updateNode(
      node.id,
      {
        workflowInputImages: nextInputImages,
      },
      true,
    );
    setStatusMessage(`Cleared loaded image for ${candidate.label}.`);
  };

  const handleBackendWorkflowPickerOpenChange = (open: boolean) => {
    setIsBackendWorkflowPickerOpen(open);
    if (!open) return;

    setBackendWorkflowSearch('');
    void handleReadBackendWorkflows();
  };

  const handleChoosePasteWorkflow = async () => {
    setWorkflowEmptyMode('paste');

    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) {
        setWorkflowJsonDraft(clipboardText);
      }
    } catch {
      // Clipboard access can be blocked by browser permission or insecure origins.
    }
  };

  const handleLoadBackendWorkflow = async (workflowFile: ComfyWorkflowFile) => {
    setWorkflowBrowserState('importing');
    setStatusMessage(`Loading ${getWorkflowNameFromPath(workflowFile.path)}.`);
    setNodeError(null);

    try {
      const workflowJson = await fetchComfyWorkflowFile(endpoint, workflowFile.path);
      const modifiedAt = getWorkflowModifiedAt(workflowFile.modified);
      const workflow = await createComfyWorkflowFromJson({
        endpoint,
        id: `comfy_workflow_backend_${hashComfyWorkflowSource(workflowFile.path)}`,
        name: getWorkflowNameFromPath(workflowFile.path),
        value: workflowJson,
        createdAt: modifiedAt,
        updatedAt: modifiedAt,
      });
      const hasExistingWorkflowControls = workflowControls.some(
        (control) => control.workflowId === workflow.id,
      );
      const defaultWorkflowControls = hasExistingWorkflowControls
        ? []
        : createDefaultComfyWorkflowControls(workflow);
      const workflows = node.workflows.some((candidate) => candidate.id === workflow.id)
        ? node.workflows.map((candidate) => (candidate.id === workflow.id ? workflow : candidate))
        : [...node.workflows, workflow];

      updateNode(
        node.id,
        {
          workflows,
          selectedWorkflowId: workflow.id,
          workflowControls: [...workflowControls, ...defaultWorkflowControls],
          lastError: undefined,
        },
        true,
      );
      const missingOptions = getMissingWorkflowControlOptions(
        defaultWorkflowControls.length > 0 ? defaultWorkflowControls : workflowControls,
        workflow,
      );
      setWorkflowBrowserState('idle');
      setRunState('complete');
      setStatusMessage(
        missingOptions.length > 0
          ? getMissingWorkflowControlStatus(workflow.name, missingOptions)
          : `Loaded ${workflow.name} from ComfyUI.`,
      );
      setLocalError(null);
      setWorkflowEmptyMode('choice');
      setIsBackendWorkflowPickerOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not load the ComfyUI workflow.';
      setWorkflowBrowserState('error');
      setStatusMessage('');
      setNodeError(message);
    }
  };

  const handleImportPastedWorkflow = async () => {
    const trimmedJson = workflowJsonDraft.trim();
    if (!trimmedJson) {
      setNodeError('Paste a ComfyUI workflow JSON first.');
      return;
    }

    setWorkflowBrowserState('importing');
    setStatusMessage('Importing pasted workflow.');
    setNodeError(null);

    try {
      const parsed = JSON.parse(trimmedJson) as unknown;
      const workflow = await createComfyWorkflowFromJson({
        endpoint,
        id: `comfy_workflow_pasted_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: getComfyWorkflowNameFromJson(parsed),
        value: parsed,
        createdAt: Date.now(),
      });
      const defaultWorkflowControls = createDefaultComfyWorkflowControls(workflow);

      updateNode(
        node.id,
        {
          workflows: [...node.workflows, workflow],
          selectedWorkflowId: workflow.id,
          workflowControls: [...workflowControls, ...defaultWorkflowControls],
          lastError: undefined,
        },
        true,
      );
      const missingOptions = getMissingWorkflowControlOptions(defaultWorkflowControls, workflow);
      setWorkflowBrowserState('idle');
      setRunState('complete');
      setStatusMessage(getMissingWorkflowControlStatus(workflow.name, missingOptions));
      setLocalError(null);
      setWorkflowJsonDraft('');
      setWorkflowEmptyMode('choice');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not import the pasted workflow JSON.';
      setWorkflowBrowserState('error');
      setStatusMessage('');
      setNodeError(message);
    }
  };

  const handleSelectWorkflow = (workflowId: string) => {
    updateNode(node.id, { selectedWorkflowId: workflowId, lastError: undefined }, true);
    setLocalError(null);
  };

  const handleRemoveWorkflow = () => {
    if (!selectedWorkflow) return;
    const workflows = node.workflows.filter((workflow) => workflow.id !== selectedWorkflow.id);
    updateNode(
      node.id,
      {
        workflows,
        selectedWorkflowId: workflows[0]?.id,
        workflowControls: workflowControls.filter(
          (control) => control.workflowId !== selectedWorkflow.id,
        ),
      },
      true,
    );
  };

  const updateWorkflowControls = (controls: ComfyWorkflowControl[], withHistory = true) => {
    updateNode(node.id, { workflowControls: controls }, withHistory);
  };

  const updateSelectedWorkflowOutputs = (selectedOutputIds: string[]) => {
    if (!selectedWorkflow) return;
    updateNode(
      node.id,
      {
        workflows: node.workflows.map((workflow) =>
          workflow.id === selectedWorkflow.id ? { ...workflow, selectedOutputIds } : workflow,
        ),
        lastError: undefined,
      },
      true,
    );
    setLocalError(null);
  };

  const handleToggleWorkflowOutputCandidate = (candidateId: string) => {
    const nextSelectedIds = selectedWorkflowOutputIdSet.has(candidateId)
      ? selectedWorkflowOutputIds.filter((id) => id !== candidateId)
      : [...selectedWorkflowOutputIds, candidateId];
    updateSelectedWorkflowOutputs(nextSelectedIds);
  };

  const handleSelectAllWorkflowOutputs = () => {
    updateSelectedWorkflowOutputs(workflowOutputCandidates.map((candidate) => candidate.id));
  };

  const handleOpenWorkflowControlBuilder = () => {
    setPendingControlKeys(getDefaultPendingControlKeys());
    setIsWorkflowControlBuilderOpen(true);
  };

  const handleCancelWorkflowControlBuilder = () => {
    setPendingControlKeys(getDefaultPendingControlKeys());
    setIsWorkflowControlBuilderOpen(false);
  };

  const handleToggleWorkflowControlCandidate = (candidateKey: string) => {
    setPendingControlKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      if (nextKeys.has(candidateKey)) {
        nextKeys.delete(candidateKey);
      } else {
        nextKeys.add(candidateKey);
      }
      return nextKeys;
    });
  };

  const handleApplyWorkflowControlBuilder = () => {
    if (!selectedWorkflow) return;

    const existingControlsByKey = new Map(
      activeWorkflowControls.map((control) => [
        getComfyControlKey(control.nodeId, control.inputName),
        control,
      ]),
    );
    const nextWorkflowControls = controlCandidates
      .filter((candidate) => pendingControlKeys.has(candidate.key))
      .map((candidate) => {
        const existingControl = existingControlsByKey.get(candidate.key);
        return existingControl ?? createComfyWorkflowControl(selectedWorkflow.id, candidate);
      });

    updateWorkflowControls(
      [
        ...workflowControls.filter((control) => control.workflowId !== selectedWorkflow.id),
        ...nextWorkflowControls,
      ],
      true,
    );
    setIsWorkflowControlBuilderOpen(false);
  };

  const handleResetWorkflowControl = (controlId: string) => {
    updateWorkflowControls(
      workflowControls.map((control) =>
        control.id === controlId ? { ...control, value: control.defaultValue } : control,
      ),
      true,
    );
  };

  const handleUpdateWorkflowControl = (
    controlId: string,
    updates: Partial<ComfyWorkflowControl>,
    withHistory = true,
  ) => {
    updateWorkflowControls(
      workflowControls.map((control) =>
        control.id === controlId ? { ...control, ...updates } : control,
      ),
      withHistory,
    );
  };

  const handleDownloadMissingModel = (missingOption: MissingWorkflowControlOption) => {
    window.open(getMissingModelDownloadUrl(missingOption), '_blank', 'noopener,noreferrer');
  };

  const handleCopyMissingModelPath = async (missingOption: MissingWorkflowControlOption) => {
    const copyValue = missingOption.downloadUrl ?? missingOption.value;

    try {
      const copied = await copyTextToClipboard(copyValue);
      setStatusMessage(
        copied
          ? `Copied download URL for ${missingOption.value}.`
          : 'Clipboard access is not available in this browser.',
      );
      if (copied) setLocalError(null);
    } catch {
      setStatusMessage('Could not copy the download URL. Check browser clipboard permissions.');
    }
  };

  const handleToggleMissingModelDetails = () => {
    setPreferences({
      comfyMissingModelDetailsVisible: !comfyMissingModelDetailsVisible,
    });
  };

  const triggerRunRollAnimation = async (controls: ComfyWorkflowControl[], workflowId: string) => {
    const rollingControlIds = controls
      .filter((control) => control.workflowId === workflowId)
      .filter((control) => supportsComfyWorkflowControlRunMode(control))
      .filter((control) => {
        const mode = getComfyWorkflowControlRunMode(control);
        return mode === 'randomize' || mode === 'randomRange' || mode === 'increment';
      })
      .map((control) => control.id);

    if (rollingControlIds.length === 0) return;

    setRunRollTokens((current) => {
      const next = { ...current };
      rollingControlIds.forEach((controlId) => {
        next[controlId] = (next[controlId] ?? 0) + 1;
      });
      return next;
    });

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, DICE_ROLL_ANIMATION_LEAD_MS);
    });
  };

  const uploadConnectedWorkflowInputs = async (
    workflow: ComfyWorkflow,
    signal: AbortSignal,
  ): Promise<Array<{ candidate: ComfyWorkflowInputCandidate; imageName: string }>> => {
    const uploads: Array<{ candidate: ComfyWorkflowInputCandidate; imageName: string }> = [];

    for (const candidate of getComfyWorkflowInputCandidates(workflow)) {
      const portName = getComfyWorkflowInputPortName(workflow.id, candidate);
      const sourceNodeId = node.inputs?.[portName];
      const inputImage = node.workflowInputImages?.[portName];
      if (!sourceNodeId && !inputImage) continue;

      if (sourceNodeId) {
        const sourceNode = allNodes.find((candidateNode) => candidateNode.id === sourceNodeId);
        if (!sourceNode) {
          throw new Error(`Connected source for ${candidate.label} was not found.`);
        }

        const assetId = getConnectedSourceAssetId(sourceNode, currentFrame);
        if (!assetId) {
          throw new Error(`${sourceNode.name} cannot be used as a Comfy image input yet.`);
        }

        const blob = await getAsset(assetId);
        if (!blob) {
          throw new Error(`Could not read ${sourceNode.name} for ${candidate.label}.`);
        }
        if (!blob.type.startsWith('image/')) {
          throw new Error(`${sourceNode.name} is not an image asset ComfyUI can load.`);
        }

        const imageName = await uploadComfyInputImage({
          endpoint,
          image: blob,
          filename: getComfyInputUploadFilename({
            sourceName: sourceNode.name || sourceNode.id,
            candidate,
            blob,
          }),
          signal,
        });
        uploads.push({ candidate, imageName });
        continue;
      }

      if (!inputImage) continue;

      const blob = await getAsset(inputImage.assetId);
      if (!blob) {
        throw new Error(`Could not read loaded image ${inputImage.name} for ${candidate.label}.`);
      }
      if (!isImageFileLike(blob, inputImage.name)) {
        throw new Error(`${inputImage.name} is not an image asset ComfyUI can load.`);
      }
      const imageName = await uploadComfyInputImage({
        endpoint,
        image: blob,
        filename: getComfyInputUploadFilename({
          sourceName: inputImage.name || candidate.label,
          candidate,
          blob,
        }),
        signal,
      });
      uploads.push({ candidate, imageName });
    }

    return uploads;
  };

  const handleRunWorkflow = async (runCount = 1) => {
    if (!selectedWorkflow) {
      setRunState('error');
      setNodeError('Import and select a ComfyUI workflow before running.');
      return;
    }
    const missingOptions = getMissingWorkflowControlOptions(workflowControls, selectedWorkflow);
    if (missingOptions.length > 0) {
      const firstMissing = missingOptions[0];
      setRunState('error');
      setNodeError(
        `${firstMissing.control.label} uses unavailable value "${firstMissing.value}". ${firstMissing.guidance}`,
      );
      return;
    }

    const selectedOutputCandidates = getSelectedWorkflowOutputCandidates(selectedWorkflow);
    if (
      (selectedWorkflow.outputCandidates ?? []).length > 0 &&
      selectedOutputCandidates.length === 0
    ) {
      setRunState('error');
      setNodeError('Select at least one Comfy workflow output before running.');
      return;
    }

    const originProjectId = projectId;
    const originHistoryEntryId = activeHistoryEntryId;
    const selectedOutputNodeIds = selectedOutputCandidates.map(
      (candidate) => candidate.previewNodeId,
    );
    const getRunSource = (runIndex: number, totalRuns = runCount, promptId?: string | null) => ({
      ...getComfyBatchSource(originProjectId, node.id, selectedWorkflow.id, runIndex, totalRuns),
      ...(originHistoryEntryId ? { historyId: originHistoryEntryId } : {}),
      ...(promptId ? { promptId } : {}),
      comfyEndpoint: endpoint,
      outputNodeIds: selectedOutputNodeIds,
    });

    const jobId = startBackgroundJob({
      type: 'comfy',
      title: runCount > 1 ? `${selectedWorkflow.name} x${runCount}` : selectedWorkflow.name,
      subtitle: node.name,
      detail: runCount > 1 ? `${runCount} queued runs` : 'Queueing prompt',
      status: 'queued',
      progress: 8,
      indeterminate: true,
      cancellable: true,
      source: getRunSource(1),
    });
    let jobAbortController: AbortController | null = null;
    let jobCancelled = false;
    let jobFinished = false;
    const finishJobOnce = (updates: Parameters<typeof finishBackgroundJob>[1]) => {
      if (jobFinished) return;
      jobFinished = true;
      finishBackgroundJob(jobId, updates);
    };

    const cancelWithInterrupt = () => {
      jobCancelled = true;
      const latest = latestComfyPromptId.get(endpoint);
      if (latest) {
        void interruptComfyPrompt(latest.promptId, latest.endpoint).catch(() => {});
      }
      if (jobAbortController) {
        jobAbortController.abort();
        return;
      }
      finishJobOnce({
        status: 'cancelled',
        detail: 'Queued run cancelled',
        progress: 0,
        source: getRunSource(1),
      });
    };

    const unregisterJobCancelHandler = registerBackgroundJobCancelHandler(
      jobId,
      cancelWithInterrupt,
    );

    setNodeError(null);
    let currentWorkflowControls = workflowControls;

    if (runCount > 1) {
      const queuedRuns: Array<{
        runIndex: number;
        promptId: string;
        clientId: string;
        promptSummary?: string;
      }> = [];
      let completedRunCount = 0;

      try {
        for (let runIndex = 1; runIndex <= runCount; runIndex += 1) {
          if (jobCancelled) return;

          const abortController = new AbortController();
          jobAbortController = abortController;
          abortRef.current = abortController;

          try {
            setRunState('queueing');
            setStatusMessage(
              formatRunStatusMessage('Sending workflow to ComfyUI.', runIndex, runCount),
            );
            setRunProgress({
              label: formatRunProgressLabel('Queueing prompt', runIndex, runCount),
              detail: `${runCount} total runs`,
              percent: 8,
              indeterminate: true,
            });
            updateBackgroundJob(jobId, {
              status: 'queued',
              detail: formatRunProgressLabel('Queueing prompt', runIndex, runCount),
              progress: Math.max(8, Math.round(((runIndex - 1) / runCount) * 15)),
              indeterminate: true,
              source: {
                ...getRunSource(runIndex, runCount),
                completedCount: completedRunCount,
              },
            });

            const clientId = createClientId();
            await triggerRunRollAnimation(currentWorkflowControls, selectedWorkflow.id);
            const preparedControls = prepareComfyWorkflowControlsForRun(
              currentWorkflowControls,
              selectedWorkflow.id,
            );
            currentWorkflowControls = preparedControls.nextControls;
            if (preparedControls.changed) {
              updateNode(node.id, { workflowControls: preparedControls.nextControls }, false);
            }

            const promptWithSelectedOutputs = selectComfyPromptOutputs({
              prompt: selectedWorkflow.prompt,
              outputCandidates: selectedWorkflow.outputCandidates,
              selectedOutputIds: getSelectedWorkflowOutputIds(selectedWorkflow),
            });
            const promptWithControls = applyComfyWorkflowControls(
              promptWithSelectedOutputs,
              preparedControls.promptControls,
              selectedWorkflow.id,
            );
            const inputImages = await uploadConnectedWorkflowInputs(
              selectedWorkflow,
              abortController.signal,
            );
            const prompt =
              inputImages.length > 0
                ? applyComfyWorkflowInputImages(promptWithControls, inputImages)
                : promptWithControls;
            const queued = await queueComfyPrompt({
              endpoint,
              prompt,
              clientId,
            });

            queuedRuns.push({
              runIndex,
              promptId: queued.promptId,
              clientId,
              promptSummary: getOutputPromptSummary(
                preparedControls.promptControls,
                selectedWorkflow.id,
              ),
            });

            latestComfyPromptId.set(endpoint, {
              promptId: queued.promptId,
              endpoint,
            });
            updateNode(node.id, { lastPromptId: queued.promptId }, false);

            setRunState('running');
            setStatusMessage(
              formatRunStatusMessage(
                `Queued prompt ${queued.promptId} in ComfyUI.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Queued prompt', runIndex, runCount),
              detail: queued.promptId,
              percent: Math.max(15, Math.round((queuedRuns.length / runCount) * 25)),
              indeterminate: true,
            });
            updateBackgroundJob(jobId, {
              status: 'running',
              detail: `Queued ${queuedRuns.length}/${runCount} prompts in ComfyUI`,
              progress: Math.max(15, Math.round((queuedRuns.length / runCount) * 25)),
              indeterminate: true,
              source: {
                ...getRunSource(runIndex, runCount, queued.promptId),
                completedCount: completedRunCount,
              },
            });
          } finally {
            if (jobAbortController === abortController) {
              jobAbortController = null;
            }
            if (abortRef.current === abortController) {
              abortRef.current = null;
            }
          }
        }

        for (const queuedRun of queuedRuns) {
          if (jobCancelled) return;

          const { runIndex, promptId, clientId, promptSummary } = queuedRun;
          const abortController = new AbortController();
          jobAbortController = abortController;
          abortRef.current = abortController;
          hasStepProgressRef.current = false;

          const unsubscribeProgress = subscribeComfyProgress({
            endpoint,
            clientId,
            signal: abortController.signal,
            onProgress: (event) => {
              if (event.promptId && event.promptId !== promptId) return;

              if (event.type === 'started') {
                setRunState('running');
                setRunProgress({
                  label: formatRunProgressLabel('Starting workflow', runIndex, runCount),
                  detail: event.promptId ? `Prompt ${event.promptId}` : undefined,
                  percent: 18,
                  indeterminate: true,
                });
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel('Starting workflow', runIndex, runCount),
                  progress: 18,
                  indeterminate: true,
                  source: {
                    ...getRunSource(runIndex, runCount, promptId),
                    completedCount: completedRunCount,
                  },
                });
                setStatusMessage(
                  formatRunStatusMessage('ComfyUI started the workflow.', runIndex, runCount),
                );
                return;
              }

              if (event.type === 'executing') {
                setRunState('running');
                setRunProgress((currentProgress) => ({
                  label: formatRunProgressLabel(
                    event.nodeId ? `Running node #${event.nodeId}` : 'Running workflow',
                    runIndex,
                    runCount,
                  ),
                  percent: hasStepProgressRef.current ? getRunProgressPercent(currentProgress) : 35,
                  indeterminate: true,
                }));
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel(
                    event.nodeId ? `Running node #${event.nodeId}` : 'Running workflow',
                    runIndex,
                    runCount,
                  ),
                  progress: 35,
                  indeterminate: true,
                  source: {
                    ...getRunSource(runIndex, runCount, promptId),
                    completedCount: completedRunCount,
                  },
                });
                setStatusMessage(
                  formatRunStatusMessage(
                    event.nodeId
                      ? `ComfyUI is rendering node #${event.nodeId}.`
                      : 'ComfyUI is rendering.',
                    runIndex,
                    runCount,
                  ),
                );
                return;
              }

              if (event.type === 'progress') {
                hasStepProgressRef.current = true;
                const hasSteps = event.value !== undefined && event.max !== undefined;
                const stepLabel = hasSteps ? `Step ${event.value}/${event.max}` : 'Rendering step';
                setRunState('running');
                setRunProgress({
                  label: formatRunProgressLabel(stepLabel, runIndex, runCount),
                  detail: event.nodeId ? `Node #${event.nodeId}` : undefined,
                  value: event.value,
                  max: event.max,
                });
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel(stepLabel, runIndex, runCount),
                  progress:
                    event.value !== undefined && event.max !== undefined && event.max > 0
                      ? (event.value / event.max) * 100
                      : 35,
                  indeterminate: false,
                  source: {
                    ...getRunSource(runIndex, runCount, promptId),
                    completedCount: completedRunCount,
                  },
                });
                setStatusMessage(
                  formatRunStatusMessage(
                    event.nodeId
                      ? `ComfyUI is rendering. ${stepLabel} on node #${event.nodeId}.`
                      : `ComfyUI is rendering. ${stepLabel}.`,
                    runIndex,
                    runCount,
                  ),
                );
                return;
              }

              if (event.type === 'complete') {
                setRunProgress({
                  label: formatRunProgressLabel('Finalizing output', runIndex, runCount),
                  percent: 88,
                  indeterminate: true,
                });
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel('Finalizing output', runIndex, runCount),
                  progress: 88,
                  indeterminate: true,
                  source: {
                    ...getRunSource(runIndex, runCount, promptId),
                    completedCount: completedRunCount,
                  },
                });
                setStatusMessage(
                  formatRunStatusMessage(
                    'ComfyUI finished rendering. Reading output.',
                    runIndex,
                    runCount,
                  ),
                );
                return;
              }

              if (event.type === 'error' && event.message) {
                setRunProgress({
                  label: formatRunProgressLabel('ComfyUI reported an error', runIndex, runCount),
                  detail: event.message,
                  percent: 100,
                });
                updateBackgroundJob(jobId, {
                  status: 'error',
                  detail: event.message,
                  error: event.message,
                  progress: 100,
                  indeterminate: false,
                  source: {
                    ...getRunSource(runIndex, runCount, promptId),
                    completedCount: completedRunCount,
                  },
                });
                setStatusMessage(formatRunStatusMessage(event.message, runIndex, runCount));
              }
            },
          });

          try {
            setRunState('running');
            setStatusMessage(
              formatRunStatusMessage(
                `Queued prompt ${promptId}. Waiting for ${getOutputCountLabel(
                  selectedOutputCandidates.length || 1,
                )}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Waiting for ComfyUI', runIndex, runCount),
              detail: promptId,
              percent: 15,
              indeterminate: true,
            });
            updateBackgroundJob(jobId, {
              status: 'running',
              detail: formatRunProgressLabel('Waiting for ComfyUI', runIndex, runCount),
              progress: 15,
              indeterminate: true,
              source: {
                ...getRunSource(runIndex, runCount, promptId),
                completedCount: completedRunCount,
              },
            });

            const outputImages = await waitForComfyOutputImages({
              endpoint,
              promptId,
              outputNodeIds: selectedOutputNodeIds,
              signal: abortController.signal,
              onPoll: (attempt) => {
                if (!hasStepProgressRef.current) {
                  setRunProgress({
                    label: formatRunProgressLabel('Waiting for ComfyUI', runIndex, runCount),
                    detail: `History check ${attempt}`,
                    percent: 35,
                    indeterminate: true,
                  });
                  updateBackgroundJob(jobId, {
                    status: 'running',
                    detail: formatRunProgressLabel('Waiting for ComfyUI', runIndex, runCount),
                    progress: 35,
                    indeterminate: true,
                    source: {
                      ...getRunSource(runIndex, runCount, promptId),
                      completedCount: completedRunCount,
                    },
                  });
                  setStatusMessage(
                    formatRunStatusMessage(
                      `ComfyUI is rendering. History check ${attempt}.`,
                      runIndex,
                      runCount,
                    ),
                  );
                }
              },
            });

            setRunState('downloading');
            setStatusMessage(
              formatRunStatusMessage(
                `Downloading ${getOutputCountLabel(outputImages.length)}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Downloading output', runIndex, runCount),
              detail: outputImages.map((image) => image.filename).join(', '),
              percent: 92,
              indeterminate: true,
            });
            updateBackgroundJob(jobId, {
              status: 'running',
              detail: formatRunProgressLabel('Downloading output', runIndex, runCount),
              progress: 92,
              indeterminate: true,
              source: {
                ...getRunSource(runIndex, runCount, promptId),
                completedCount: completedRunCount,
              },
            });

            const createdAt = Date.now();
            const outputCandidateByPreviewId = new Map(
              selectedOutputCandidates.map((candidate) => [candidate.previewNodeId, candidate]),
            );
            const generatedOutputs = await Promise.all(
              outputImages.map(async (outputImage, outputIndex): Promise<GeneratedOutput> => {
                const blob = await fetchComfyImage({
                  endpoint,
                  image: outputImage,
                  signal: abortController.signal,
                });
                const file = new File([blob], outputImage.filename, {
                  type: blob.type || 'image/png',
                });
                const { width, height } = await readImageDimensions(file);
                const assetId = await saveAsset(file);
                const outputCandidate = outputImage.nodeId
                  ? outputCandidateByPreviewId.get(outputImage.nodeId)
                  : undefined;
                return {
                  id: `comfy_output_${createdAt}_${outputIndex}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`,
                  src: assetId,
                  width,
                  height,
                  createdAt: createdAt + outputIndex,
                  label: outputCandidate
                    ? `${outputCandidate.label} · ${outputImage.filename}`
                    : outputImage.filename,
                  prompt: promptSummary,
                  promptId,
                  workflowId: selectedWorkflow.id,
                  workflowName: selectedWorkflow.name,
                };
              }),
            );
            const activeGeneratedOutput = generatedOutputs[0];
            if (!activeGeneratedOutput) {
              throw new Error('ComfyUI completed the workflow, but no output image was found.');
            }

            const nextGeneratedOutputs = [...generatedOutputsRef.current, ...generatedOutputs];
            generatedOutputsRef.current = nextGeneratedOutputs;
            const transform =
              sceneNode && 'width' in sceneNode && 'height' in sceneNode
                ? {
                    ...node.transform,
                    ...calculateTransformForFitMode(
                      { width: activeGeneratedOutput.width, height: activeGeneratedOutput.height },
                      { width: sceneNode.width, height: sceneNode.height },
                      node.transform.fitMode,
                    ),
                    x: 0,
                    y: 0,
                  }
                : node.transform;

            const applyTarget = await applyComfyNodeRunResult({
              projectId: originProjectId,
              nodeId: node.id,
              updates: {
                src: activeGeneratedOutput.src,
                width: activeGeneratedOutput.width,
                height: activeGeneratedOutput.height,
                transform,
                generatedOutputs: nextGeneratedOutputs,
                activeGeneratedOutputId: activeGeneratedOutput.id,
                lastPromptId: promptId,
                lastRunAt: createdAt,
                lastError: undefined,
              },
              withHistory: runIndex === runCount,
              historyLabel: `Run ${node.name} Comfy Workflow`,
              noticeLabel: `${node.name} output updated`,
              galleryNoticeLabel: `${node.name} output added to Gallery`,
              expectedHistoryId: originHistoryEntryId,
            });
            const completionDetail =
              applyTarget === 'gallery'
                ? `Output downloaded; ${node.name} changed meanwhile, so it was added to Gallery`
                : applyTarget === 'saved'
                  ? `Saved ${node.name} in its project`
                  : applyTarget === 'missing'
                    ? `Output downloaded; ${node.name} was not found`
                    : `Updated ${node.name}`;

            completedRunCount = runIndex;
            setRunState('complete');
            setStatusMessage(
              formatRunStatusMessage(
                `Updated node with ${getOutputCountLabel(generatedOutputs.length)}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Complete', runIndex, runCount),
              detail: generatedOutputs.map((output) => output.label ?? 'Comfy output').join(', '),
              percent: 100,
            });
            if (runIndex === runCount) {
              finishJobOnce({
                status: 'complete',
                detail: completionDetail,
                progress: 100,
                source: {
                  ...getRunSource(runCount, runCount, promptId),
                  completedCount: runCount,
                },
              });
            } else {
              const nextPromptId = queuedRuns[runIndex]?.promptId;
              updateBackgroundJob(jobId, {
                status: 'queued',
                detail: formatRunProgressLabel(
                  'Waiting for next queued run',
                  runIndex + 1,
                  runCount,
                ),
                progress: Math.min(95, (runIndex / runCount) * 100),
                indeterminate: true,
                source: {
                  ...getRunSource(runIndex + 1, runCount, nextPromptId),
                  completedCount: completedRunCount,
                },
              });
            }
            setLocalError(null);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              const remainingQueuedCount = Math.max(0, queuedRuns.length - completedRunCount);
              setRunState('idle');
              setStatusMessage(
                formatRunStatusMessage('ComfyUI run cancelled.', runIndex, runCount),
              );
              setRunProgress(null);
              finishJobOnce({
                status: 'cancelled',
                detail:
                  remainingQueuedCount > 1
                    ? `Stopped local tracking; ${remainingQueuedCount} prompts remain queued in ComfyUI`
                    : remainingQueuedCount === 1
                      ? 'Stopped local tracking; 1 prompt remains queued in ComfyUI'
                      : formatRunProgressLabel('Cancelled', runIndex, runCount),
                progress: getRunProgressPercent(runProgress),
                source: {
                  ...getRunSource(runIndex, runCount, promptId),
                  completedCount: completedRunCount,
                },
              });
              return;
            }

            const remainingQueuedCount = Math.max(0, queuedRuns.length - completedRunCount);
            const message = error instanceof Error ? error.message : 'ComfyUI workflow failed.';
            const detail =
              remainingQueuedCount > 1
                ? `${message} ${remainingQueuedCount} prompts may still be queued in ComfyUI.`
                : remainingQueuedCount === 1
                  ? `${message} 1 prompt may still be queued in ComfyUI.`
                  : message;
            setRunState('error');
            setStatusMessage('');
            setRunProgress(null);
            setNodeError(detail);
            finishJobOnce({
              status: 'error',
              detail,
              error: message,
              progress: 100,
              source: {
                ...getRunSource(runIndex, runCount, promptId),
                completedCount: completedRunCount,
              },
            });
            return;
          } finally {
            unsubscribeProgress();
            if (jobAbortController === abortController) {
              jobAbortController = null;
            }
            if (abortRef.current === abortController) {
              abortRef.current = null;
            }
          }
        }
      } finally {
        unregisterJobCancelHandler();
      }

      return;
    }

    try {
      await enqueueComfyRun(endpointQueueKey, async () => {
        if (jobCancelled) return;

        for (let runIndex = 1; runIndex <= runCount; runIndex += 1) {
          if (jobCancelled) return;
          const abortController = new AbortController();
          jobAbortController = abortController;
          abortRef.current = abortController;
          hasStepProgressRef.current = false;

          setRunState('queueing');
          setStatusMessage(
            formatRunStatusMessage('Sending workflow to ComfyUI.', runIndex, runCount),
          );
          setRunProgress({
            label: formatRunProgressLabel('Queueing prompt', runIndex, runCount),
            detail: runCount > 1 ? `${runCount} total runs` : 'Ready for ComfyUI',
            percent: 8,
            indeterminate: true,
          });
          updateBackgroundJob(jobId, {
            status: 'queued',
            detail: formatRunProgressLabel('Queueing prompt', runIndex, runCount),
            progress: 8,
            indeterminate: true,
            source: getRunSource(runIndex),
          });

          const clientId = createClientId();
          let queuedPromptId: string | null = null;
          await triggerRunRollAnimation(currentWorkflowControls, selectedWorkflow.id);
          const preparedControls = prepareComfyWorkflowControlsForRun(
            currentWorkflowControls,
            selectedWorkflow.id,
          );
          currentWorkflowControls = preparedControls.nextControls;
          if (preparedControls.changed) {
            updateNode(node.id, { workflowControls: preparedControls.nextControls }, false);
          }

          const unsubscribeProgress = subscribeComfyProgress({
            endpoint,
            clientId,
            signal: abortController.signal,
            onProgress: (event) => {
              if (queuedPromptId && event.promptId && event.promptId !== queuedPromptId) return;

              if (event.type === 'started') {
                setRunState('running');
                setRunProgress({
                  label: formatRunProgressLabel('Starting workflow', runIndex, runCount),
                  detail: event.promptId ? `Prompt ${event.promptId}` : undefined,
                  percent: 18,
                  indeterminate: true,
                });
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel('Starting workflow', runIndex, runCount),
                  progress: 18,
                  indeterminate: true,
                  source: getRunSource(runIndex, runCount, queuedPromptId),
                });
                setStatusMessage(
                  formatRunStatusMessage('ComfyUI started the workflow.', runIndex, runCount),
                );
                return;
              }

              if (event.type === 'executing') {
                setRunState('running');
                setRunProgress((currentProgress) => ({
                  label: formatRunProgressLabel(
                    event.nodeId ? `Running node #${event.nodeId}` : 'Running workflow',
                    runIndex,
                    runCount,
                  ),
                  percent: hasStepProgressRef.current ? getRunProgressPercent(currentProgress) : 35,
                  indeterminate: true,
                }));
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel(
                    event.nodeId ? `Running node #${event.nodeId}` : 'Running workflow',
                    runIndex,
                    runCount,
                  ),
                  progress: 35,
                  indeterminate: true,
                  source: getRunSource(runIndex, runCount, queuedPromptId),
                });
                setStatusMessage(
                  formatRunStatusMessage(
                    event.nodeId
                      ? `ComfyUI is rendering node #${event.nodeId}.`
                      : 'ComfyUI is rendering.',
                    runIndex,
                    runCount,
                  ),
                );
                return;
              }

              if (event.type === 'progress') {
                hasStepProgressRef.current = true;
                const hasSteps = event.value !== undefined && event.max !== undefined;
                const stepLabel = hasSteps ? `Step ${event.value}/${event.max}` : 'Rendering step';
                setRunState('running');
                setRunProgress({
                  label: formatRunProgressLabel(stepLabel, runIndex, runCount),
                  detail: event.nodeId ? `Node #${event.nodeId}` : undefined,
                  value: event.value,
                  max: event.max,
                });
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel(stepLabel, runIndex, runCount),
                  progress:
                    event.value !== undefined && event.max !== undefined && event.max > 0
                      ? (event.value / event.max) * 100
                      : 35,
                  indeterminate: false,
                  source: getRunSource(runIndex, runCount, queuedPromptId),
                });
                setStatusMessage(
                  formatRunStatusMessage(
                    event.nodeId
                      ? `ComfyUI is rendering. ${stepLabel} on node #${event.nodeId}.`
                      : `ComfyUI is rendering. ${stepLabel}.`,
                    runIndex,
                    runCount,
                  ),
                );
                return;
              }

              if (event.type === 'complete') {
                setRunProgress({
                  label: formatRunProgressLabel('Finalizing output', runIndex, runCount),
                  percent: 88,
                  indeterminate: true,
                });
                updateBackgroundJob(jobId, {
                  status: 'running',
                  detail: formatRunProgressLabel('Finalizing output', runIndex, runCount),
                  progress: 88,
                  indeterminate: true,
                  source: getRunSource(runIndex, runCount, queuedPromptId),
                });
                setStatusMessage(
                  formatRunStatusMessage(
                    'ComfyUI finished rendering. Reading output.',
                    runIndex,
                    runCount,
                  ),
                );
                return;
              }

              if (event.type === 'error' && event.message) {
                setRunProgress({
                  label: formatRunProgressLabel('ComfyUI reported an error', runIndex, runCount),
                  detail: event.message,
                  percent: 100,
                });
                updateBackgroundJob(jobId, {
                  status: 'error',
                  detail: event.message,
                  error: event.message,
                  progress: 100,
                  indeterminate: false,
                });
                setStatusMessage(formatRunStatusMessage(event.message, runIndex, runCount));
              }
            },
          });

          try {
            const promptWithSelectedOutputs = selectComfyPromptOutputs({
              prompt: selectedWorkflow.prompt,
              outputCandidates: selectedWorkflow.outputCandidates,
              selectedOutputIds: getSelectedWorkflowOutputIds(selectedWorkflow),
            });
            const promptWithControls = applyComfyWorkflowControls(
              promptWithSelectedOutputs,
              preparedControls.promptControls,
              selectedWorkflow.id,
            );
            const inputImages = await uploadConnectedWorkflowInputs(
              selectedWorkflow,
              abortController.signal,
            );
            const prompt =
              inputImages.length > 0
                ? applyComfyWorkflowInputImages(promptWithControls, inputImages)
                : promptWithControls;
            const queued = await queueComfyPrompt({
              endpoint,
              prompt,
              clientId,
            });
            queuedPromptId = queued.promptId;
            updateNode(node.id, { lastPromptId: queued.promptId }, false);

            latestComfyPromptId.set(endpoint, {
              promptId: queued.promptId,
              endpoint,
            });

            setRunState('running');
            setStatusMessage(
              formatRunStatusMessage(
                `Queued prompt ${queued.promptId}. Waiting for ${getOutputCountLabel(
                  selectedOutputCandidates.length || 1,
                )}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Queued prompt', runIndex, runCount),
              detail: queued.promptId,
              percent: 15,
              indeterminate: true,
            });
            updateBackgroundJob(jobId, {
              status: 'running',
              detail: formatRunProgressLabel('Queued prompt', runIndex, runCount),
              progress: 15,
              indeterminate: true,
              source: getRunSource(runIndex, runCount, queued.promptId),
            });

            const outputImages = await waitForComfyOutputImages({
              endpoint,
              promptId: queued.promptId,
              outputNodeIds: selectedOutputNodeIds,
              signal: abortController.signal,
              onPoll: (attempt) => {
                if (!hasStepProgressRef.current) {
                  setRunProgress({
                    label: formatRunProgressLabel('Waiting for ComfyUI', runIndex, runCount),
                    detail: `History check ${attempt}`,
                    percent: 35,
                    indeterminate: true,
                  });
                  updateBackgroundJob(jobId, {
                    status: 'running',
                    detail: formatRunProgressLabel('Waiting for ComfyUI', runIndex, runCount),
                    progress: 35,
                    indeterminate: true,
                    source: getRunSource(runIndex, runCount, queued.promptId),
                  });
                  setStatusMessage(
                    formatRunStatusMessage(
                      `ComfyUI is rendering. History check ${attempt}.`,
                      runIndex,
                      runCount,
                    ),
                  );
                }
              },
            });

            setRunState('downloading');
            setStatusMessage(
              formatRunStatusMessage(
                `Downloading ${getOutputCountLabel(outputImages.length)}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Downloading output', runIndex, runCount),
              detail: outputImages.map((image) => image.filename).join(', '),
              percent: 92,
              indeterminate: true,
            });
            updateBackgroundJob(jobId, {
              status: 'running',
              detail: formatRunProgressLabel('Downloading output', runIndex, runCount),
              progress: 92,
              indeterminate: true,
              source: getRunSource(runIndex, runCount, queued.promptId),
            });
            const createdAt = Date.now();
            const outputCandidateByPreviewId = new Map(
              selectedOutputCandidates.map((candidate) => [candidate.previewNodeId, candidate]),
            );
            const generatedOutputs = await Promise.all(
              outputImages.map(async (outputImage, outputIndex): Promise<GeneratedOutput> => {
                const blob = await fetchComfyImage({
                  endpoint,
                  image: outputImage,
                  signal: abortController.signal,
                });
                const file = new File([blob], outputImage.filename, {
                  type: blob.type || 'image/png',
                });
                const { width, height } = await readImageDimensions(file);
                const assetId = await saveAsset(file);
                const outputCandidate = outputImage.nodeId
                  ? outputCandidateByPreviewId.get(outputImage.nodeId)
                  : undefined;
                return {
                  id: `comfy_output_${createdAt}_${outputIndex}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`,
                  src: assetId,
                  width,
                  height,
                  createdAt: createdAt + outputIndex,
                  label: outputCandidate
                    ? `${outputCandidate.label} · ${outputImage.filename}`
                    : outputImage.filename,
                  prompt: getOutputPromptSummary(currentWorkflowControls, selectedWorkflow.id),
                  promptId: queued.promptId,
                  workflowId: selectedWorkflow.id,
                  workflowName: selectedWorkflow.name,
                };
              }),
            );
            const activeGeneratedOutput = generatedOutputs[0];
            if (!activeGeneratedOutput) {
              throw new Error('ComfyUI completed the workflow, but no output image was found.');
            }
            const nextGeneratedOutputs = [...generatedOutputsRef.current, ...generatedOutputs];
            generatedOutputsRef.current = nextGeneratedOutputs;
            const transform =
              sceneNode && 'width' in sceneNode && 'height' in sceneNode
                ? {
                    ...node.transform,
                    ...calculateTransformForFitMode(
                      { width: activeGeneratedOutput.width, height: activeGeneratedOutput.height },
                      { width: sceneNode.width, height: sceneNode.height },
                      node.transform.fitMode,
                    ),
                    x: 0,
                    y: 0,
                  }
                : node.transform;

            const applyTarget = await applyComfyNodeRunResult({
              projectId: originProjectId,
              nodeId: node.id,
              updates: {
                src: activeGeneratedOutput.src,
                width: activeGeneratedOutput.width,
                height: activeGeneratedOutput.height,
                transform,
                generatedOutputs: nextGeneratedOutputs,
                activeGeneratedOutputId: activeGeneratedOutput.id,
                lastPromptId: queued.promptId,
                lastRunAt: createdAt,
                lastError: undefined,
              },
              withHistory: runIndex === runCount,
              historyLabel: `Run ${node.name} Comfy Workflow`,
              noticeLabel: `${node.name} output updated`,
              galleryNoticeLabel: `${node.name} output added to Gallery`,
              expectedHistoryId: originHistoryEntryId,
            });
            const completionDetail =
              applyTarget === 'gallery'
                ? `Output downloaded; ${node.name} changed meanwhile, so it was added to Gallery`
                : applyTarget === 'saved'
                  ? `Saved ${node.name} in its project`
                  : applyTarget === 'missing'
                    ? `Output downloaded; ${node.name} was not found`
                    : `Updated ${node.name}`;

            setRunState('complete');
            setStatusMessage(
              formatRunStatusMessage(
                `Updated node with ${getOutputCountLabel(generatedOutputs.length)}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Complete', runIndex, runCount),
              detail: generatedOutputs.map((output) => output.label ?? 'Comfy output').join(', '),
              percent: 100,
            });
            if (runIndex === runCount) {
              finishJobOnce({
                status: 'complete',
                detail: completionDetail,
                progress: 100,
                source: {
                  ...getRunSource(runCount, runCount, queued.promptId),
                  completedCount: runCount,
                },
              });
            } else {
              updateBackgroundJob(jobId, {
                status: 'queued',
                detail: formatRunProgressLabel('Preparing next run', runIndex + 1, runCount),
                progress: Math.min(95, (runIndex / runCount) * 100),
                indeterminate: true,
                source: getRunSource(runIndex + 1),
              });
            }
            setLocalError(null);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              setRunState('idle');
              setStatusMessage(
                formatRunStatusMessage('ComfyUI run cancelled.', runIndex, runCount),
              );
              setRunProgress(null);
              finishJobOnce({
                status: 'cancelled',
                detail: formatRunProgressLabel('Cancelled', runIndex, runCount),
                progress: getRunProgressPercent(runProgress),
                source: getRunSource(runIndex, runCount, queuedPromptId),
              });
              return;
            }

            const message = error instanceof Error ? error.message : 'ComfyUI workflow failed.';
            setRunState('error');
            setStatusMessage('');
            setRunProgress(null);
            setNodeError(message);
            finishJobOnce({
              status: 'error',
              detail: message,
              error: message,
              progress: 100,
              source: getRunSource(runIndex, runCount, queuedPromptId),
            });
            return;
          } finally {
            unsubscribeProgress();
            if (jobAbortController === abortController) {
              jobAbortController = null;
            }
            if (abortRef.current === abortController) {
              abortRef.current = null;
            }
          }
        }
      });
    } finally {
      unregisterJobCancelHandler();
    }
  };

  const isBusy =
    runState === 'queueing' ||
    runState === 'running' ||
    runState === 'downloading' ||
    Boolean(activeNodeComfyJob);
  const isBrowsingWorkflows =
    workflowBrowserState === 'loading' || workflowBrowserState === 'importing';
  const runProgressPercent = getRunProgressPercent(runProgress);
  const activeJobProgressPercent = Math.max(0, Math.min(100, activeNodeComfyJob?.progress ?? 0));
  const hasRunProgress = isBusy && (runProgress !== null || activeNodeComfyJob !== null);
  const inspectorProgressLabel =
    runProgress?.label ?? activeNodeComfyJob?.detail ?? activeNodeComfyJob?.title ?? 'Running';
  const inspectorProgressPercent = runProgress ? runProgressPercent : activeJobProgressPercent;
  const inspectorProgressIndeterminate =
    runProgress?.indeterminate ?? activeNodeComfyJob?.indeterminate ?? false;
  const inspectorLogMessage =
    localError ||
    (hasRunProgress
      ? runProgress?.detail || activeNodeComfyJob?.detail || statusMessage || inspectorProgressLabel
      : statusMessage);
  const clearInspectorLog = () => {
    setStatusMessage('');
    setNodeError(null);
  };
  const runShortcutHint = 'Ctrl/Cmd+Enter';
  const hasNoSelectedWorkflowOutputs =
    workflowOutputCandidates.length > 0 && selectedWorkflowOutputIds.length === 0;
  const isRunActionDisabled = !selectedWorkflow || hasNoSelectedWorkflowOutputs;
  const hasWorkflowControlBuilderChanges =
    pendingControlKeys.size !== activeControlKeys.size ||
    [...pendingControlKeys].some((key) => !activeControlKeys.has(key));
  const handleWorkflowPropsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRunShortcut(event)) return;
    if (!selectedWorkflow || hasNoSelectedWorkflowOutputs || isWorkflowControlBuilderOpen) return;

    const field = (event.target as HTMLElement | null)?.closest('input, textarea, select');
    if (!(field instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopPropagation();
    if (document.activeElement === field) {
      field.blur();
    }

    window.setTimeout(() => {
      void handleRunWorkflow();
    }, 0);
  };

  return (
    <>
      <CollapsibleSection title="Workflow" defaultOpen>
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={handleImportWorkflow}
          />

          {selectedWorkflow ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-white">{selectedWorkflow.name}</p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {getWorkflowNodeCount(selectedWorkflow)} nodes ·{' '}
                    {formatDateTime(selectedWorkflow.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveWorkflow}
                  className="rounded-md p-1.5 text-gray-500 transition hover:bg-red-500/10 hover:text-red-300"
                  title="Remove workflow"
                >
                  <Icons.Trash className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3">
              {workflowEmptyMode === 'choice' && (
                <>
                  <div className="flex flex-col items-center gap-1.5 py-1 text-center">
                    {/* <Icons.FolderOpen className="h-6 w-6 text-gray-500" /> */}
                    <p className="text-xs font-medium text-gray-300">No workflow loaded</p>
                    <p className="text-[11px] leading-4 text-gray-500">
                      Import JSON/image, load from Comfy, or paste JSON.
                    </p>
                  </div>

                  <div className="mx-auto flex w-fit max-w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-950/80">
                    <button
                      type="button"
                      onClick={handleChooseImportWorkflow}
                      disabled={isBrowsingWorkflows}
                      className="inline-flex min-w-0 items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-100 transition hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icons.ArrowUpTray className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">Import</span>
                    </button>
                    <Popover
                      isOpen={isBackendWorkflowPickerOpen}
                      onOpenChange={handleBackendWorkflowPickerOpenChange}
                      widthClass="w-80"
                      align="start"
                      trigger={
                        <button
                          type="button"
                          disabled={workflowBrowserState === 'importing'}
                          className="inline-flex min-w-0 items-center justify-center gap-1.5 border-l border-gray-700 px-2.5 py-1.5 text-[11px] font-medium text-gray-100 transition hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Icons.FolderOpen className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 truncate">From Comfy</span>
                        </button>
                      }
                    >
                      {(closeBackendWorkflowPicker) => (
                        <div className="space-y-2">
                          <input
                            value={backendWorkflowSearch}
                            onChange={(event) =>
                              setBackendWorkflowSearch(event.currentTarget.value)
                            }
                            placeholder="Search workflows..."
                            className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-2.5 py-2 text-xs text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-primary-300/60 focus:ring-2 focus:ring-primary-300/20"
                            autoFocus
                          />

                          {workflowBrowserState === 'loading' ? (
                            <p className="px-1 py-2 text-[11px] text-primary-100/60">
                              Reading workflows...
                            </p>
                          ) : backendWorkflowFiles.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
                              No workflows found in workflows/.
                            </p>
                          ) : filteredBackendWorkflowFiles.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
                              No matches
                            </p>
                          ) : (
                            <ScrollArea
                              axis="y"
                              viewportClassName="max-h-[min(18rem,calc(100vh-9rem))] pr-1"
                            >
                              <div className="space-y-1">
                                {filteredBackendWorkflowFiles.map((workflowFile) => (
                                  <button
                                    key={workflowFile.path}
                                    type="button"
                                    onClick={() => {
                                      closeBackendWorkflowPicker();
                                      void handleLoadBackendWorkflow(workflowFile);
                                    }}
                                    disabled={isBrowsingWorkflows}
                                    className="w-full min-w-0 rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition-all duration-150 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <span className="block truncate text-xs font-medium text-gray-100">
                                      {getWorkflowNameFromPath(workflowFile.path)}
                                    </span>
                                    <span className="mt-1 block truncate text-[11px] text-gray-500">
                                      {getWorkflowFileDetail(workflowFile)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </ScrollArea>
                          )}
                        </div>
                      )}
                    </Popover>
                    <button
                      type="button"
                      onClick={() => void handleChoosePasteWorkflow()}
                      disabled={isBrowsingWorkflows}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center border-l border-gray-700 text-gray-300 transition hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      title="Paste JSON"
                      aria-label="Paste JSON"
                    >
                      <Icons.Paste className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}

              {workflowEmptyMode === 'paste' && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setWorkflowEmptyMode('choice')}
                      className="rounded-md p-1.5 text-gray-500 transition hover:bg-white/5 hover:text-gray-200"
                      title="Choose another workflow source"
                      aria-label="Choose another workflow source"
                    >
                      <Icons.ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-200">
                      Paste workflow JSON
                    </p>
                  </div>

                  <ScrollArea
                    axis="y"
                    viewportClassName="max-h-44 rounded-md border border-gray-700 bg-black/30 transition focus-within:border-primary-400/70 focus-within:ring-2 focus-within:ring-primary-400/20"
                    contentClassName="min-h-24"
                  >
                    <textarea
                      ref={pasteTextareaRef}
                      value={workflowJsonDraft}
                      onChange={(event) => setWorkflowJsonDraft(event.currentTarget.value)}
                      placeholder="Paste ComfyUI API workflow JSON..."
                      spellCheck={false}
                      rows={4}
                      className="block min-h-24 w-full resize-none overflow-hidden border-0 bg-transparent px-2 py-2 font-mono text-[11px] leading-5 text-gray-100 outline-none placeholder:text-gray-600"
                    />
                  </ScrollArea>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] text-gray-500">
                      API format, or graph JSON with Comfy connected
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleImportPastedWorkflow()}
                      disabled={isBrowsingWorkflows || workflowJsonDraft.trim().length === 0}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2.5 py-1.5 text-[11px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icons.Check className="h-3.5 w-3.5" />
                      Import JSON
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {node.workflows.length > 1 && (
            <ScrollArea
              axis="y"
              viewportClassName="max-h-32 rounded-lg border border-white/10 bg-gray-950/60"
              contentClassName="space-y-1 p-1 pr-3"
            >
              {node.workflows.map((workflow) => {
                const isSelected = workflow.id === selectedWorkflow?.id;
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => handleSelectWorkflow(workflow.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition ${
                      isSelected
                        ? 'bg-primary-300/10 text-primary-50'
                        : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        isSelected ? 'border-primary-300/50 text-primary-200' : 'border-gray-700'
                      }`}
                    >
                      {isSelected && <Icons.Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
                    <span className="shrink-0 text-gray-600">{getWorkflowNodeCount(workflow)}</span>
                  </button>
                );
              })}
            </ScrollArea>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Props"
        defaultOpen
        action={
          selectedWorkflow ? (
            isWorkflowControlBuilderOpen ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCancelWorkflowControlBuilder}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-1 text-[10px] font-medium text-gray-400 transition hover:border-gray-500 hover:text-gray-100"
                >
                  <Icons.XMark className="h-3.5 w-3.5" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyWorkflowControlBuilder}
                  disabled={!hasWorkflowControlBuilderChanges}
                  className="inline-flex items-center gap-1 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icons.Check className="h-3.5 w-3.5" />
                  Apply
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleOpenWorkflowControlBuilder}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15"
              >
                <Icons.Plus className="h-3.5 w-3.5" />
                Fields
              </button>
            )
          ) : undefined
        }
      >
        <div className="space-y-3">
          {selectedWorkflow ? (
            isWorkflowControlBuilderOpen ? (
              <div className="space-y-3 rounded-lg border border-primary-400/20 bg-primary-400/[0.06] p-2">
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-primary-50">Workflow fields</p>
                    <p className="mt-0.5 truncate text-[11px] text-primary-100/60">
                      {pendingControlKeys.size} shown · {controlCandidates.length} editable
                    </p>
                  </div>
                </div>

                {controlCandidates.length > 0 ? (
                  <ScrollArea
                    axis="y"
                    viewportClassName="max-h-64 rounded-lg border border-primary-300/10 bg-gray-950/60"
                    contentClassName="space-y-1 p-1 pr-3"
                  >
                    {controlCandidates.map((candidate) => {
                      const isPending = pendingControlKeys.has(candidate.key);
                      return (
                        <button
                          key={candidate.key}
                          type="button"
                          onClick={() => handleToggleWorkflowControlCandidate(candidate.key)}
                          aria-pressed={isPending}
                          className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left transition ${
                            isPending
                              ? 'bg-primary-300/10 text-primary-50'
                              : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              isPending
                                ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                                : 'border-gray-700'
                            }`}
                          >
                            {isPending && <Icons.Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {candidate.label}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                              {candidate.classType} · #{candidate.nodeId} · {candidate.inputName}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </ScrollArea>
                ) : (
                  <div className="rounded-lg border border-dashed border-primary-300/15 bg-gray-950/60 p-3 text-xs leading-5 text-primary-100/60">
                    This workflow does not expose editable primitive fields.
                  </div>
                )}
              </div>
            ) : activeWorkflowControls.length > 0 ? (
              <div className="space-y-3" onKeyDown={handleWorkflowPropsKeyDown}>
                {activeMissingControlOptions.length > 0 ? (
                  <MissingModelWarning
                    missingOptions={activeMissingControlOptions}
                    modelSizeStatuses={missingModelSizeStatuses}
                    detailsVisible={comfyMissingModelDetailsVisible}
                    onToggleDetails={handleToggleMissingModelDetails}
                    onDownload={handleDownloadMissingModel}
                    onCopyPath={(option) => void handleCopyMissingModelPath(option)}
                  />
                ) : null}
                {activeWorkflowControls.map((control) => {
                  const isNumeric = typeof control.defaultValue === 'number';
                  const numericValue =
                    typeof control.value === 'number'
                      ? control.value
                      : (control.defaultValue as number);
                  const booleanValue =
                    typeof control.value === 'boolean'
                      ? control.value
                      : Boolean(control.defaultValue);
                  const description = control.description ?? getComfyControlDescription(control);
                  const supportsRunMode = supportsComfyWorkflowControlRunMode(control);
                  const enumValue =
                    typeof control.value === 'string' || typeof control.value === 'number'
                      ? control.value
                      : String(control.value);
                  const isSelectedEnumOptionMissing =
                    isWorkflowControlSelectedOptionMissing(control);
                  const enumOptions =
                    control.options && control.options.length > 0
                      ? isSelectedEnumOptionMissing
                        ? [enumValue, ...control.options]
                        : control.options
                      : [];
                  const hasEnumOptions = enumOptions.length > 0;
                  const applyNoticeKey =
                    promptApplyNotice?.fieldId === control.id ? promptApplyNotice.id : null;

                  return (
                    <AttentionPulse
                      key={control.id}
                      activeKey={applyNoticeKey}
                      data-ai-apply-control-id={control.id}
                      className="rounded-lg"
                    >
                      <PropertyField
                        label={hasEnumOptions ? control.label : undefined}
                        description={hasEnumOptions ? description : undefined}
                        actions={
                          hasEnumOptions ? (
                            <>
                              {isSelectedEnumOptionMissing ? (
                                <span
                                  className="shrink-0 rounded-md border border-red-200/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-red-100/70"
                                  title="Selected option is missing"
                                >
                                  Missing
                                </span>
                              ) : null}
                              <ResetIconButton
                                onClick={() => handleResetWorkflowControl(control.id)}
                                tooltip={getControlResetTooltip(control)}
                              />
                            </>
                          ) : undefined
                        }
                      >
                        {hasEnumOptions ? (
                          <StyledDropdown
                            value={enumValue}
                            options={enumOptions.map((option) => {
                              const isMissingOption =
                                isSelectedEnumOptionMissing &&
                                normalizeComparableControlValue(option) ===
                                  normalizeComparableControlValue(enumValue);

                              return {
                                value: option,
                                label: String(option),
                                badges: isMissingOption ? ['Missing'] : undefined,
                                searchText: isMissingOption
                                  ? `${String(option)} missing`
                                  : undefined,
                              };
                            })}
                            onChange={(value) =>
                              handleUpdateWorkflowControl(control.id, {
                                value:
                                  typeof value === 'string' || typeof value === 'number'
                                    ? value
                                    : String(value),
                              })
                            }
                            popoverWidthClass="w-72"
                            showSelectedBadges={false}
                          />
                        ) : isNumeric ? (
                          <Slider
                            label={control.label}
                            description={description}
                            value={numericValue}
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            onChange={(value) =>
                              handleUpdateWorkflowControl(control.id, { value }, true)
                            }
                            onReset={() => handleResetWorkflowControl(control.id)}
                            resetTooltip={getControlResetTooltip(control)}
                            displayFormatter={formatControlValue}
                            valuePrefix={
                              supportsRunMode ? (
                                <WorkflowRunModeBadge
                                  control={control}
                                  rollToken={runRollTokens[control.id] ?? 0}
                                  onUpdate={(updates) =>
                                    handleUpdateWorkflowControl(control.id, updates, true)
                                  }
                                />
                              ) : undefined
                            }
                            headerActions={
                              supportsRunMode ? (
                                <WorkflowRunModeControl
                                  control={control}
                                  isOpen={advancedControlId === control.id}
                                  onOpenChange={(open) =>
                                    setAdvancedControlId(open ? control.id : null)
                                  }
                                  onKeyDown={handleWorkflowPropsKeyDown}
                                  onUpdate={(updates) =>
                                    handleUpdateWorkflowControl(control.id, updates, true)
                                  }
                                />
                              ) : undefined
                            }
                          />
                        ) : typeof control.defaultValue === 'boolean' ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <ToggleSwitch
                                label={control.label}
                                description={description}
                                checked={booleanValue}
                                onCheckedChange={(checked) =>
                                  handleUpdateWorkflowControl(control.id, {
                                    value: checked,
                                  })
                                }
                                ariaLabel={control.label}
                                title={booleanValue ? 'Enabled' : 'Disabled'}
                                size="sm"
                              />
                            </div>
                            <ResetIconButton
                              onClick={() => handleResetWorkflowControl(control.id)}
                              tooltip={getControlResetTooltip(control)}
                            />
                          </div>
                        ) : (
                          <ExpandableWorkflowTextControl
                            control={control}
                            description={description}
                            promptRoute={imagePromptRoute}
                            promptRouteError={imagePromptRouteError}
                            onChange={(value) =>
                              handleUpdateWorkflowControl(control.id, {
                                value: coerceControlValue(value, control.defaultValue),
                              })
                            }
                            onEnhance={() =>
                              startComfyPromptEnhancementChat(node.id, control.id, imagePromptRoute)
                            }
                            onUpdate={(updates) => handleUpdateWorkflowControl(control.id, updates)}
                            onReset={() => handleResetWorkflowControl(control.id)}
                          />
                        )}
                      </PropertyField>
                    </AttentionPulse>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3 text-xs leading-5 text-gray-400">
                No workflow props are shown yet. Use Fields to choose which workflow inputs appear
                here.
              </div>
            )
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3 text-xs leading-5 text-gray-400">
              Load a workflow before choosing Comfy props.
            </div>
          )}
        </div>
      </CollapsibleSection>

      {selectedWorkflow && workflowInputCandidates.length > 0 && (
        <CollapsibleSection
          title="Workflow Inputs"
          defaultOpen={workflowInputCandidates.length > 1}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-gray-900/70 px-2.5 py-2 text-[11px]">
              <span className="min-w-0 truncate text-gray-400">
                {workflowInputCandidates.length} image input
                {workflowInputCandidates.length === 1 ? '' : 's'} detected
              </span>
              <span className="shrink-0 font-mono text-primary-100/70">
                {connectedWorkflowInputs.filter((entry) => entry.sourceNode).length} connected ·{' '}
                {connectedWorkflowInputs.filter((entry) => entry.inputImage).length} loaded
              </span>
            </div>

            <div className="space-y-1">
              {connectedWorkflowInputs.map(({ candidate, sourceNode, inputImage }) => {
                const hasInput = Boolean(sourceNode || inputImage);
                const activeSourceLabel = sourceNode
                  ? sourceNode.name
                  : inputImage
                    ? inputImage.name
                    : 'Unconnected';
                const activeSourceKind = sourceNode ? 'Port' : inputImage ? 'Loaded' : 'None';

                return (
                  <div
                    key={candidate.id}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left ${
                      hasInput
                        ? 'border-primary-300/25 bg-primary-300/10 text-primary-50'
                        : 'border-white/10 bg-gray-950/40 text-gray-400'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        hasInput
                          ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                          : 'border-gray-700'
                      }`}
                    >
                      {hasInput ? (
                        <Icons.Check className="h-3 w-3" />
                      ) : (
                        <Icons.Photo className="h-3 w-3" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{candidate.label}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-500">
                        #{candidate.nodeId} · {candidate.inputName}
                      </span>
                    </span>
                    <span className="min-w-0 shrink basis-28 text-right">
                      <span className="block truncate text-[11px] text-gray-300">
                        {activeSourceLabel}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wide text-gray-500">
                        {activeSourceKind}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <label
                        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 text-[11px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15"
                        title={`Load image for ${candidate.label}`}
                      >
                        <Icons.ArrowUpTray className="h-3.5 w-3.5" />
                        Load
                        <input
                          type="file"
                          accept={IMAGE_IMPORT_ACCEPT}
                          className="hidden"
                          onChange={(event) =>
                            handleImportWorkflowInputImage(selectedWorkflow, candidate, event)
                          }
                        />
                      </label>
                      {inputImage ? (
                        <button
                          type="button"
                          onClick={() => handleClearWorkflowInputImage(selectedWorkflow, candidate)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-gray-400 transition hover:border-red-300/40 hover:bg-red-300/10 hover:text-red-100"
                          title={`Clear loaded image for ${candidate.label}`}
                          aria-label={`Clear loaded image for ${candidate.label}`}
                        >
                          <Icons.Trash className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {selectedWorkflow && workflowOutputCandidates.length > 0 && (
        <CollapsibleSection
          title="Workflow Output"
          defaultOpen={workflowOutputCandidates.length > 1}
          action={
            workflowOutputCandidates.length > 1 ? (
              <button
                type="button"
                onClick={handleSelectAllWorkflowOutputs}
                disabled={selectedWorkflowOutputIds.length === workflowOutputCandidates.length}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icons.Check className="h-3.5 w-3.5" />
                All
              </button>
            ) : undefined
          }
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-gray-900/70 px-2.5 py-2 text-[11px]">
              <span className="min-w-0 truncate text-gray-400">
                {workflowOutputCandidates.length} image port
                {workflowOutputCandidates.length === 1 ? '' : 's'} detected
              </span>
              <span
                className={`shrink-0 font-mono ${
                  selectedWorkflowOutputIds.length > 0 ? 'text-primary-100/70' : 'text-red-200/80'
                }`}
              >
                {selectedWorkflowOutputIds.length} selected
              </span>
            </div>

            <div className="space-y-1">
              {workflowOutputCandidates.map((candidate) => {
                const isSelected = selectedWorkflowOutputIdSet.has(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => handleToggleWorkflowOutputCandidate(candidate.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                      isSelected
                        ? 'border-primary-300/30 bg-primary-300/10 text-primary-50'
                        : 'border-white/10 bg-gray-950/40 text-gray-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-gray-100'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                          : 'border-gray-700'
                      }`}
                    >
                      {isSelected && <Icons.Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{candidate.label}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-500">
                        #{candidate.nodeId} · output {candidate.outputIndex + 1} ·{' '}
                        {candidate.outputName}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {hasNoSelectedWorkflowOutputs ? (
              <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-2 text-[11px] leading-5 text-red-100/80">
                Select at least one output port before running this workflow.
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Execute" defaultOpen>
        <div className="space-y-3">
          <div className="flex items-stretch gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 text-[11px] text-gray-500">
              <div className="min-w-0 rounded-lg bg-gray-900/70 p-2">
                <span className="block text-gray-400">Last prompt</span>
                <span className="block truncate font-mono">{node.lastPromptId ?? 'None'}</span>
              </div>
              <div className="min-w-0 rounded-lg bg-gray-900/70 p-2">
                <span className="block text-gray-400">Last output</span>
                <span className="block truncate">{formatDateTime(node.lastRunAt)}</span>
              </div>
            </div>

            <div className="inline-flex min-w-24 shrink-0 overflow-hidden rounded-lg border border-primary-300/20 bg-primary-300/10 text-primary-100 transition hover:border-primary-300/40">
              <button
                type="button"
                onClick={() => {
                  setIsRunMenuOpen(false);
                  void handleRunWorkflow(1);
                }}
                disabled={isRunActionDisabled}
                title={`Run workflow (${runShortcutHint})`}
                className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:bg-gray-900/70 disabled:text-gray-500"
              >
                <Icons.Play className="h-4 w-4" />
                Run
              </button>
              <Popover
                isOpen={isRunActionDisabled ? false : isRunMenuOpen}
                onOpenChange={(open) => {
                  if (isRunActionDisabled) return;
                  setIsRunMenuOpen(open);
                }}
                align="end"
                widthClass="w-36"
                trigger={
                  <button
                    type="button"
                    disabled={isRunActionDisabled}
                    className="inline-flex h-full items-center justify-center border-l border-primary-300/20 px-2.5 transition hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900/70 disabled:text-gray-500"
                    title="Run batch"
                    aria-label="Run batch"
                  >
                    <Icons.ChevronDown className="h-4 w-4" />
                  </button>
                }
              >
                {(closePopover) => (
                  <div className="space-y-1">
                    <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                      Batch Run
                    </p>
                    {BATCH_RUN_COUNTS.map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => {
                          closePopover();
                          void handleRunWorkflow(count);
                        }}
                        className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-gray-300 transition hover:bg-white/[0.06] hover:text-white"
                      >
                        <span>{count} runs</span>
                        <span className="font-mono text-[11px] text-gray-500">x{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </div>
          </div>

          <AttentionPulse
            activeKey={outputApplyNotice?.id}
            className="rounded-lg border border-white/10 bg-gray-950/40 p-2"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                Outputs
              </span>
              <span className="font-mono text-[10px] text-gray-600">
                {(node.generatedOutputs ?? []).filter((output) => !output.deletedAt).length}
              </span>
            </div>
            <div className="flex gap-1.5 overflow-hidden">
              {pendingGeneratedOutputSlots.map((slot) => (
                <ComfyOutputPlaceholder
                  key={slot.id}
                  label={slot.label}
                  detail={slot.detail}
                  active={slot.active}
                />
              ))}
              {recentGeneratedOutputs.length > 0 ? (
                recentGeneratedOutputs.map((output) => (
                  <ComfyOutputThumbnail
                    key={output.id}
                    output={output}
                    active={
                      node.activeGeneratedOutputId
                        ? node.activeGeneratedOutputId === output.id
                        : node.src === output.src
                    }
                    onClick={() => handleActivateGeneratedOutput(output)}
                  />
                ))
              ) : pendingGeneratedOutputSlots.length === 0 ? (
                <div className="flex h-14 min-w-0 flex-1 items-center justify-center rounded-md border border-dashed border-white/10 bg-gray-900/60 px-3 text-center text-[11px] text-gray-500">
                  Run output thumbnails appear here
                </div>
              ) : null}
              <button
                type="button"
                onClick={openGalleryView}
                className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-primary-300/25 bg-primary-300/[0.05] text-primary-100/70 transition hover:border-primary-300/50 hover:bg-primary-300/10 hover:text-primary-100"
                title="Open Gallery"
              >
                <Icons.Photo className="h-4 w-4" />
                <span className="mt-0.5 text-[10px] font-medium">More</span>
              </button>
            </div>
          </AttentionPulse>
        </div>
      </CollapsibleSection>

      <InspectorLogFooter
        className="-mx-1.5 -mb-1.5"
        label={localError ? 'Error' : hasRunProgress ? inspectorProgressLabel : 'Log'}
        message={inspectorLogMessage}
        progressIndeterminate={hasRunProgress ? inspectorProgressIndeterminate : undefined}
        progressLabel={hasRunProgress ? inspectorProgressLabel : undefined}
        progressPercent={hasRunProgress ? inspectorProgressPercent : undefined}
        variant={localError ? 'error' : 'info'}
        actions={
          hasRunProgress ? (
            <>
              <span className="font-mono text-[11px] text-primary-100/70">
                {Math.round(inspectorProgressPercent)}%
              </span>
              <button
                type="button"
                onClick={() => {
                  if (activeNodeComfyJob) {
                    requestBackgroundJobCancel(activeNodeComfyJob.id);
                  } else if (abortRef.current) {
                    void interruptComfyPrompt('', endpoint).catch(() => {});
                    abortRef.current.abort();
                  }
                }}
                className="rounded-md border border-primary-100/20 px-2 py-1 text-[11px] font-medium text-primary-100/75 transition hover:border-red-300/50 hover:bg-red-500/10 hover:text-red-100"
              >
                Cancel
              </button>
            </>
          ) : inspectorLogMessage ? (
            <button
              type="button"
              onClick={clearInspectorLog}
              className="rounded-md p-1 text-gray-400 transition hover:bg-white/10 hover:text-gray-100"
              title="Clear log"
              aria-label="Clear log"
            >
              <Icons.XMark className="h-3.5 w-3.5" />
            </button>
          ) : undefined
        }
      />
    </>
  );
};

export default ComfyAdjustments;
