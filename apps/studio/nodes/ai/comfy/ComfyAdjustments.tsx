import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { getAsset, saveAsset } from '@/state/assetStorage';
import { readImageDimensions } from '@/state/editor/utils';
import {
  AnyNode,
  ComfyNode,
  EditorTab,
  GeneratedOutput,
  ComfyWorkflow,
  ComfyWorkflowControl,
  ComfyWorkflowInputImage,
  ComfyWorkflowInputCandidate,
  ComfyWorkflowOutputCandidate,
  NodeType,
  SceneNode,
  ViewportPromptRegion,
} from '@blackboard/types';
import {
  fetchComfyWorkflowFile,
  listComfyWorkflowFiles,
  normalizeComfyEndpoint,
  applyComfyWorkflowInputImages,
  queueComfyPrompt,
  interruptComfyPrompt,
  selectComfyPromptOutputs,
  subscribeComfyProgress,
  type ComfyWorkflowFile,
  uploadComfyInputImage,
  waitForComfyOutputFiles,
} from '@/services/comfy/client';
import {
  applyComfyWorkflowControls,
  createComfyWorkflowControl,
  getComfyControlKey,
  getComfyWorkflowControlRunMode,
  getComfyWorkflowControlCandidates,
  isPromptLikeComfyTextInput,
  prepareComfyWorkflowControlsForRun,
  supportsComfyWorkflowControlRunMode,
} from './comfyControls';
import { getComfyWorkflowInputCandidates } from './comfyInputs';
import { getComfyInputPortName, remapInputsOnWorkflowChange } from '../../portMapping';
import {
  createComfyWorkflowFromJson,
  createDefaultComfyWorkflowControls,
  getComfyWorkflowNameFromJson,
  hashComfyWorkflowSource,
  isComfyWorkflowImageFile,
  readComfyWorkflowFile,
} from './comfyWorkflowImport';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import { isBackgroundJobActive } from '@/state/editor/services/backgroundJobs';
import { registerBackgroundJobCancelHandler } from '@/state/editor/services/backgroundJobExecutor';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import type { NodeExecutionContext } from '@/utils/nodeExecutionRegistry';
import { isExrFileLike, isImageFileLike } from '@/utils/mediaFiles';
import { isNonEmptyString, getNonEmptyString } from '@/utils/guards';
import { defaultComfyRunCoordinator } from './comfyRunCoordinator';
import {
  fetchMissingModelDownloadSize,
  getMissingModelDownloadUrl,
  getMissingModelSizeKey,
  getMissingWorkflowControlOptions,
  getMissingWorkflowControlStatus,
  type MissingModelSizeStatus,
  type MissingWorkflowControlOption,
} from './comfyMissingModels';
import {
  getWorkflowFileDetail,
  getWorkflowModifiedAt,
  getWorkflowNameFromPath,
} from './comfyWorkflowDisplay';
import { createGeneratedOutputsFromComfyFiles } from './comfyGeneratedOutputs';
import {
  clampPixelRect,
  renderNodeInputFrameToPngBlob,
  renderNodeInputRegionToPngBlob,
} from '@/utils/nodeInputFrame';
import { ComfyWorkflowPicker } from './components/ComfyWorkflowPicker';
import { ComfyWorkflowControlsSection } from './components/ComfyWorkflowControlsSection';
import { ComfyWorkflowInputList } from './components/ComfyWorkflowInputList';
import { ComfyWorkflowOutputPicker } from './components/ComfyWorkflowOutputPicker';
import { ComfyExecuteSection } from './components/ComfyExecuteSection';
import { ComfyRegionInspector } from './components/ComfyRegionInspector';
import { ComfyOutputTransformSection } from './components/ComfyOutputTransformSection';
import { ComfyRootSizeBindingsSection } from './components/ComfyRootSizeBindingsSection';
import {
  applyComfyRootBindings,
  applyComfyViewportPromptRegionBindings,
  type ComfyRunInputContext,
  createComfyRootBindings,
  getExplicitSelectedComfyViewportPromptRegion,
  getComfyRootBindingSourceLabel,
  getComfyRootBindingValue,
  getComfyRootControlSourceSummaries,
  getComfyViewportControlSourceSummaries,
  shouldUseComfyWorkflowInputSource,
} from './comfyViewportBindings';
import { getComfyOutputTransform } from './comfyOutputTransform';
import {
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyOutputActivationRegionId,
} from './comfyOutputLayers';

type RunState = 'idle' | 'queueing' | 'running' | 'downloading' | 'complete' | 'error';
type WorkflowBrowserState = 'idle' | 'loading' | 'importing' | 'error';
type WorkflowEmptyMode = 'choice' | 'paste';
const DICE_ROLL_ANIMATION_LEAD_MS = 180;
const EMPTY_COMFY_WORKFLOW_CONTROLS: ComfyWorkflowControl[] = [];
const EMPTY_COMFY_WORKFLOW_OUTPUT_CANDIDATES: ComfyWorkflowOutputCandidate[] = [];

interface RunProgress {
  label: string;
  detail?: string;
  value?: number;
  max?: number;
  percent?: number;
  indeterminate?: boolean;
}

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
      isNonEmptyString(control.value) &&
      isPromptLikeComfyTextInput({
        inputName: control.inputName,
        label: control.label,
        classType: control.classType,
        description: control.description,
      }),
  );

  return getNonEmptyString(promptControl?.value);
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

const getComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
): Record<string, unknown> =>
  candidate.syntheticOutputNodeInputs ?? candidate.outputNodeInputs ?? {};

const isMatchingComfyDynamicOption = (
  optionKey: string | number,
  selectedValue: unknown,
): boolean => optionKey === selectedValue || String(optionKey) === String(selectedValue);

const getComfyOutputDynamicNestedInputNames = (
  candidate: ComfyWorkflowOutputCandidate,
): Set<string> => {
  const names = new Set<string>();
  for (const option of candidate.outputNodeDynamicInputs ?? []) {
    for (const field of option.fields) {
      names.add(field.inputName);
      names.add(field.dottedInputName);
    }
  }
  return names;
};

const getNextComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
  inputName: string,
  value: ComfyWorkflowControl['value'],
): Record<string, unknown> => {
  const inputs = { ...getComfyOutputCandidateInputs(candidate), [inputName]: value };
  const dynamicOptions = candidate.outputNodeDynamicInputs ?? [];
  const changedParentNames = new Set(
    dynamicOptions
      .filter((option) => option.parentInputName === inputName)
      .map((option) => option.parentInputName),
  );

  for (const parentInputName of changedParentNames) {
    const selectedOption = dynamicOptions.find(
      (option) =>
        option.parentInputName === parentInputName &&
        isMatchingComfyDynamicOption(option.optionKey, inputs[parentInputName]),
    );

    for (const option of dynamicOptions.filter(
      (candidateOption) => candidateOption.parentInputName === parentInputName,
    )) {
      for (const field of option.fields) {
        delete inputs[field.inputName];
        delete inputs[field.dottedInputName];
      }
    }

    for (const field of selectedOption?.fields ?? []) {
      if (field.defaultValue !== undefined) {
        inputs[field.dottedInputName] = field.defaultValue;
      }
    }
  }

  return inputs;
};

const getOutputCountLabel = (count: number): string => `${count} output${count === 1 ? '' : 's'}`;

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

const createComfyPromptExtraData = (
  workflow: ComfyWorkflow,
  prompt: Record<string, unknown>,
): Record<string, unknown> => ({
  extra_pnginfo: {
    prompt,
    workflow: workflow.sourceGraph ?? prompt,
  },
});

const getSourceNodeImageAssetId = (sourceNode: AnyNode, frame: number): string | null => {
  const mediaKind = 'mediaKind' in sourceNode ? sourceNode.mediaKind : undefined;
  if (mediaKind === 'video') return null;

  const frames =
    'frames' in sourceNode && Array.isArray(sourceNode.frames) ? sourceNode.frames : [];
  if (frames.length > 0) {
    const frameIndex = Math.max(0, Math.min(frames.length - 1, Math.round(frame)));
    const frameAssetId = frames[frameIndex];
    return getNonEmptyString(frameAssetId) ?? null;
  }

  const src = 'src' in sourceNode ? sourceNode.src : undefined;
  return getNonEmptyString(src) ?? null;
};

const readNativeWorkflowSourceImage = async (
  sourceNode: AnyNode,
  frame: number,
): Promise<{ blob: Blob; sourceName: string } | null> => {
  const assetId = getSourceNodeImageAssetId(sourceNode, frame);
  if (!assetId) return null;

  const blob = await getAsset(assetId);
  if (!blob) return null;

  const sourceName = sourceNode.name || sourceNode.id;
  if (!isImageFileLike(blob, sourceName)) return null;

  return { blob, sourceName };
};

const encodeCanvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode cropped Comfy input image.'));
    }, 'image/png');
  });

const cropImageBlobToRegion = async ({
  blob,
  region,
  sceneNode,
}: {
  blob: Blob;
  region: ViewportPromptRegion;
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
}): Promise<Blob> => {
  const bitmap = await createImageBitmap(blob);

  try {
    const cropRect = clampPixelRect(
      {
        x: (region.rect.x / sceneNode.width) * bitmap.width,
        y: (region.rect.y / sceneNode.height) * bitmap.height,
        width: (region.rect.width / sceneNode.width) * bitmap.width,
        height: (region.rect.height / sceneNode.height) * bitmap.height,
      },
      bitmap,
    );

    if (!cropRect) {
      throw new Error('Selected Comfy region is outside the loaded input image.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = cropRect.width;
    canvas.height = cropRect.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create a canvas for cropped Comfy input image.');
    }

    context.drawImage(
      bitmap,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      0,
      0,
      cropRect.width,
      cropRect.height,
    );

    return encodeCanvasToPngBlob(canvas);
  } finally {
    bitmap.close();
  }
};

const isRunShortcut = (event: React.KeyboardEvent<HTMLElement>): boolean =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey;

const getRunInputContext = (context?: NodeExecutionContext): ComfyRunInputContext =>
  context?.source === 'viewportTool' ? 'viewportTool' : 'props';

export function ComfyAdjustmentsPanel({ node }: { node: ComfyNode }) {
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
    integrationConnections,
    setPreferences,
  } = usePreferences();
  const endpoint = normalizeComfyEndpoint(comfyEndpoint);
  const allNodes = useEditorSelector((state) => state.nodes);
  const flows = useEditorSelector((state) => state.flows);
  const projectId = useEditorSelector((state) => state.projectId);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const activeHistoryEntryId = useEditorSelector(
    (state) => state.history[state.historyIndex]?.id ?? null,
  );
  const sceneNode = useMemo(
    () =>
      allNodes.find((candidate: AnyNode) => candidate.type === NodeType.SCENE) as
        | SceneNode
        | undefined,
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
            (!job.source.branchId || job.source.branchId === activeProjectBranchId) &&
            isBackgroundJobActive(job),
        )
        .sort((a, b) => a.startedAt - b.startedAt),
    [activeProjectBranchId, backgroundJobs, node.id, projectId],
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
    integrationConnections,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const imagePromptRoute = imagePromptRouteError
    ? null
    : resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        integrationConnections,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });

  const selectedWorkflow = useMemo(
    () => node.workflows.find((workflow) => workflow.id === node.selectedWorkflowId) ?? null,
    [node.selectedWorkflowId, node.workflows],
  );
  const hierarchySelection = useEditorSelector((state) => state.hierarchySelections[node.id]);
  const selectedRegionIds = hierarchySelection?.layerIds ?? [];
  const selectedOutputIds = hierarchySelection?.itemIds ?? [];
  const selectedRegionIdForProps =
    selectedRegionIds.length === 1 && selectedOutputIds.length === 0 ? selectedRegionIds[0] : null;
  const selectedRegionForProps = selectedRegionIdForProps
    ? ((node.viewportPromptRegions ?? []).find(
        (region) => region.id === selectedRegionIdForProps,
      ) ?? null)
    : null;
  const inspectorInputContext: ComfyRunInputContext = selectedRegionForProps
    ? 'viewportTool'
    : 'props';
  const selectedOutputIdForProps = selectedOutputIds.length === 1 ? selectedOutputIds[0] : null;
  const selectedOutputForProps = selectedOutputIdForProps
    ? ((node.generatedOutputs ?? []).find((output) => output.id === selectedOutputIdForProps) ??
      null)
    : null;
  const outputRegionForSelectedOutput = selectedOutputForProps?.regionId
    ? ((node.viewportPromptRegions ?? []).find(
        (region) => region.id === selectedOutputForProps?.regionId,
      ) ?? null)
    : null;
  const selectedOutputSceneSizeLabel = outputRegionForSelectedOutput
    ? `Region ${Math.round(outputRegionForSelectedOutput.rect.width)} x ${Math.round(outputRegionForSelectedOutput.rect.height)}`
    : sceneNode
      ? `${Math.round(sceneNode.width)} x ${Math.round(sceneNode.height)}`
      : 'No scene';

  const workflowControls = useMemo(
    () => node.workflowControls ?? EMPTY_COMFY_WORKFLOW_CONTROLS,
    [node.workflowControls],
  );
  const recentGeneratedOutputs = useMemo(
    () => [...(node.generatedOutputs ?? [])].filter((output) => !output.deletedAt).reverse(),
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
  const controlSourceSummaries = useMemo(
    () => ({
      ...getComfyRootControlSourceSummaries(node, selectedWorkflow, sceneNode),
      ...getComfyViewportControlSourceSummaries(node, selectedWorkflow, { inputContext: 'props' }),
    }),
    [node, sceneNode, selectedWorkflow],
  );
  const recommendedControlSourceSummaries = useMemo(() => {
    if (!selectedWorkflow) return {};

    const summaries: Record<string, { label: string; value?: ComfyWorkflowControl['value'] }> = {};
    const sourceLabel = getComfyRootBindingSourceLabel(node, sceneNode);
    for (const binding of createComfyRootBindings(selectedWorkflow)) {
      if (!binding.target?.nodeId || !binding.target.inputName) continue;
      const key = getComfyControlKey(binding.target.nodeId, binding.target.inputName);
      if (controlSourceSummaries[key]) continue;
      summaries[key] = {
        label: sourceLabel,
        value: getComfyRootBindingValue(binding, node, sceneNode),
      };
    }
    return summaries;
  }, [controlSourceSummaries, node, sceneNode, selectedWorkflow]);
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
  const workflowOutputCandidates =
    selectedWorkflow?.outputCandidates ?? EMPTY_COMFY_WORKFLOW_OUTPUT_CANDIDATES;
  const workflowInputCandidates = useMemo(
    () => getComfyWorkflowInputCandidates(selectedWorkflow),
    [selectedWorkflow],
  );
  const getWorkflowInputPortName = useCallback(
    (workflow: ComfyWorkflow, candidate: ComfyWorkflowInputCandidate): string =>
      getComfyInputPortName(
        workflow.id,
        candidate,
        [...Object.keys(node.inputs ?? {}), ...Object.keys(node.workflowInputImages ?? {})],
        {
          allowSingleReservedPort: getComfyWorkflowInputCandidates(workflow).length === 1,
        },
      ),
    [node.inputs, node.workflowInputImages],
  );
  const connectedWorkflowInputs = useMemo(() => {
    if (!selectedWorkflow) return [];

    return workflowInputCandidates.map((candidate) => {
      const portName = getWorkflowInputPortName(selectedWorkflow, candidate);
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
  }, [
    allNodes,
    getWorkflowInputPortName,
    node.inputs,
    node.workflowInputImages,
    selectedWorkflow,
    workflowInputCandidates,
  ]);
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
  const workflowSectionFieldControlKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const candidate of workflowInputCandidates) {
      keys.add(getComfyControlKey(candidate.nodeId, candidate.inputName));
    }
    for (const candidate of workflowOutputCandidates) {
      const inputs = candidate.syntheticOutputNodeInputs ?? candidate.outputNodeInputs ?? {};
      for (const [inputName, value] of Object.entries(inputs)) {
        if (
          ['images', 'image', 'video'].includes(inputName.toLowerCase()) ||
          Array.isArray(value) ||
          !['string', 'number', 'boolean'].includes(typeof value)
        ) {
          continue;
        }
        keys.add(getComfyControlKey(candidate.previewNodeId, inputName));
      }
    }
    return keys;
  }, [workflowInputCandidates, workflowOutputCandidates]);
  const visibleControlCandidates = useMemo(
    () =>
      controlCandidates.filter((candidate) => !workflowSectionFieldControlKeys.has(candidate.key)),
    [controlCandidates, workflowSectionFieldControlKeys],
  );
  const visibleActiveWorkflowControls = useMemo(
    () =>
      activeWorkflowControls.filter(
        (control) =>
          !workflowSectionFieldControlKeys.has(
            getComfyControlKey(control.nodeId, control.inputName),
          ),
      ),
    [activeWorkflowControls, workflowSectionFieldControlKeys],
  );

  const activeControlKeyList = useMemo(
    () =>
      visibleActiveWorkflowControls
        .map((control) => getComfyControlKey(control.nodeId, control.inputName))
        .sort(),
    [visibleActiveWorkflowControls],
  );

  const activeControlKeys = useMemo(() => new Set(activeControlKeyList), [activeControlKeyList]);

  const defaultControlKeyList = useMemo(
    () => visibleControlCandidates.map((candidate) => candidate.key).sort(),
    [visibleControlCandidates],
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
    if (!selectedWorkflow) return;
    const existingFields = new Set((node.rootBindings ?? []).map((binding) => binding.field));
    const missingBindings = createComfyRootBindings(selectedWorkflow).filter(
      (binding) => !existingFields.has(binding.field),
    );
    if (missingBindings.length === 0) return;

    updateNode(
      node.id,
      {
        rootBindings: [...(node.rootBindings ?? []), ...missingBindings],
      },
      false,
    );
  }, [node.id, node.rootBindings, selectedWorkflow, updateNode]);

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
    const transform = getComfyOutputTransform({ node, output, sceneNode });
    const nextGeneratedOutputs = getComfyGeneratedOutputsForGalleryActivation(node, output);
    generatedOutputsRef.current = nextGeneratedOutputs;

    updateNode(
      node.id,
      {
        src: output.src,
        mediaKind: output.mediaKind ?? 'image',
        colorSpace: output.colorSpace ?? node.colorSpace,
        frames: output.frames,
        duration: output.duration,
        fps: output.fps,
        width: output.width,
        height: output.height,
        transform,
        generatedOutputs: nextGeneratedOutputs,
        activeGeneratedOutputId: output.id,
        selectedViewportPromptRegionId: getComfyOutputActivationRegionId(node, output),
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
      const inputCandidates = getComfyWorkflowInputCandidates(workflow);
      const remappedInputs = remapInputsOnWorkflowChange(node.inputs, workflow.id, inputCandidates);
      const defaultWorkflowControls = createDefaultComfyWorkflowControls(workflow);
      const importedAt = Date.now();
      const rawImportedOutput = isComfyWorkflowImageFile(file)
        ? await (async (): Promise<GeneratedOutput> => {
            const { width, height } = await readImageDimensions(file);
            const assetId = await saveAsset(file);
            return {
              id: `comfy_output_import_${importedAt}_${Math.random().toString(36).slice(2, 8)}`,
              src: assetId,
              mediaKind: 'image',
              colorSpace: isExrFileLike(file, file.name) ? 'Linear' : 'sRGB',
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
      const nextGeneratedOutputs = rawImportedOutput
        ? [...generatedOutputsRef.current, rawImportedOutput]
        : generatedOutputsRef.current;
      if (rawImportedOutput) {
        generatedOutputsRef.current = nextGeneratedOutputs;
      }
      const importedTransform = rawImportedOutput
        ? getComfyOutputTransform({
            node,
            output: rawImportedOutput,
            sceneNode,
          })
        : node.transform;

      updateNode(
        node.id,
        {
          workflows: [...node.workflows, workflow],
          selectedWorkflowId: workflow.id,
          inputs: remappedInputs,
          workflowControls: [...workflowControls, ...defaultWorkflowControls],
          rootBindings: createComfyRootBindings(workflow),
          ...(rawImportedOutput
            ? {
                src: rawImportedOutput.src,
                colorSpace: rawImportedOutput.colorSpace ?? node.colorSpace,
                width: rawImportedOutput.width,
                height: rawImportedOutput.height,
                transform: importedTransform,
                generatedOutputs: nextGeneratedOutputs,
                activeGeneratedOutputId: rawImportedOutput.id,
                selectedViewportPromptRegionId: rawImportedOutput.regionId,
                lastRunAt: rawImportedOutput.createdAt,
              }
            : {}),
          lastError: undefined,
        },
        true,
      );
      const missingOptions = getMissingWorkflowControlOptions(defaultWorkflowControls, workflow);
      setRunState('complete');
      setStatusMessage(
        rawImportedOutput
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

    const inputKey = getWorkflowInputPortName(workflow, candidate);

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
    const inputKey = getWorkflowInputPortName(workflow, candidate);
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
      const inputCandidates = getComfyWorkflowInputCandidates(workflow);
      const remappedInputs = remapInputsOnWorkflowChange(node.inputs, workflow.id, inputCandidates);
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
          inputs: remappedInputs,
          workflowControls: [...workflowControls, ...defaultWorkflowControls],
          rootBindings: createComfyRootBindings(workflow),
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
      const inputCandidates = getComfyWorkflowInputCandidates(workflow);
      const remappedInputs = remapInputsOnWorkflowChange(node.inputs, workflow.id, inputCandidates);
      const defaultWorkflowControls = createDefaultComfyWorkflowControls(workflow);

      updateNode(
        node.id,
        {
          workflows: [...node.workflows, workflow],
          selectedWorkflowId: workflow.id,
          inputs: remappedInputs,
          workflowControls: [...workflowControls, ...defaultWorkflowControls],
          rootBindings: createComfyRootBindings(workflow),
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
    const workflow = node.workflows.find((candidate) => candidate.id === workflowId) ?? null;
    const inputCandidates = getComfyWorkflowInputCandidates(workflow);
    const remappedInputs = remapInputsOnWorkflowChange(node.inputs, workflowId, inputCandidates);
    updateNode(
      node.id,
      {
        selectedWorkflowId: workflowId,
        inputs: remappedInputs,
        rootBindings: createComfyRootBindings(workflow),
        lastError: undefined,
      },
      true,
    );
    setLocalError(null);
  };

  const handleRemoveWorkflow = () => {
    if (!selectedWorkflow) return;
    const workflows = node.workflows.filter((workflow) => workflow.id !== selectedWorkflow.id);
    const nextWorkflow = workflows[0] ?? null;
    const inputCandidates = getComfyWorkflowInputCandidates(nextWorkflow);
    const remappedInputs = nextWorkflow
      ? remapInputsOnWorkflowChange(node.inputs, nextWorkflow.id, inputCandidates)
      : undefined;
    updateNode(
      node.id,
      {
        workflows,
        selectedWorkflowId: nextWorkflow?.id,
        inputs: remappedInputs,
        rootBindings: createComfyRootBindings(nextWorkflow),
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
    const nextWorkflowControls = visibleControlCandidates
      .filter((candidate) => pendingControlKeys.has(candidate.key))
      .map((candidate) => {
        const existingControl = existingControlsByKey.get(candidate.key);
        return existingControl ?? createComfyWorkflowControl(selectedWorkflow.id, candidate);
      });
    const existingSectionWorkflowControls = activeWorkflowControls.filter((control) =>
      workflowSectionFieldControlKeys.has(getComfyControlKey(control.nodeId, control.inputName)),
    );

    updateWorkflowControls(
      [
        ...workflowControls.filter((control) => control.workflowId !== selectedWorkflow.id),
        ...existingSectionWorkflowControls,
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

  const handleUnbindControlSource = (controlKey: string) => {
    const bindings =
      node.rootBindings && node.rootBindings.length > 0
        ? node.rootBindings
        : createComfyRootBindings(selectedWorkflow);
    updateNode(
      node.id,
      {
        rootBindings: bindings.map((binding) => {
          const targetKey =
            binding.target?.nodeId && binding.target.inputName
              ? getComfyControlKey(binding.target.nodeId, binding.target.inputName)
              : null;
          return targetKey === controlKey ? { ...binding, target: undefined } : binding;
        }),
      },
      true,
    );
  };

  const handleBindControlSource = (controlKey: string) => {
    const recommendedBinding = createComfyRootBindings(selectedWorkflow).find((binding) => {
      if (!binding.target?.nodeId || !binding.target.inputName) return false;
      return getComfyControlKey(binding.target.nodeId, binding.target.inputName) === controlKey;
    });
    if (!recommendedBinding) return;

    const bindings =
      node.rootBindings && node.rootBindings.length > 0
        ? node.rootBindings
        : createComfyRootBindings(selectedWorkflow);
    const hasBindingField = bindings.some((binding) => binding.field === recommendedBinding.field);

    updateNode(
      node.id,
      {
        rootBindings: [
          ...bindings.map((binding) =>
            binding.field === recommendedBinding.field
              ? { ...binding, target: recommendedBinding.target }
              : binding,
          ),
          ...(hasBindingField ? [] : [recommendedBinding]),
        ],
      },
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

  const handleUpdateWorkflowOutputField = (
    candidate: ComfyWorkflowOutputCandidate,
    inputName: string,
    value: ComfyWorkflowControl['value'],
  ) => {
    if (!selectedWorkflow) return;

    const nextCandidateInputs = getNextComfyOutputCandidateInputs(candidate, inputName, value);
    const dynamicNestedInputNames = getComfyOutputDynamicNestedInputNames(candidate);
    const resetDynamicControlKeys = new Set(
      (candidate.outputNodeDynamicInputs ?? [])
        .filter((option) => option.parentInputName === inputName)
        .flatMap((option) =>
          option.fields.flatMap((field) => [
            getComfyControlKey(candidate.previewNodeId, field.inputName),
            getComfyControlKey(candidate.previewNodeId, field.dottedInputName),
          ]),
        ),
    );
    const removedDynamicControlKeys = new Set(
      [...dynamicNestedInputNames]
        .filter((dynamicInputName) => !(dynamicInputName in nextCandidateInputs))
        .map((dynamicInputName) => getComfyControlKey(candidate.previewNodeId, dynamicInputName)),
    );
    const controlKey = getComfyControlKey(candidate.previewNodeId, inputName);
    const existingControl = activeWorkflowControls.find(
      (control) => getComfyControlKey(control.nodeId, control.inputName) === controlKey,
    );
    const candidateControl = controlCandidates.find((control) => control.key === controlKey);
    const nextControl =
      existingControl ??
      (candidateControl ? createComfyWorkflowControl(selectedWorkflow.id, candidateControl) : null);
    const nextWorkflowControlsBeforePrune = nextControl
      ? existingControl
        ? workflowControls.map((control) =>
            control.id === existingControl.id ? { ...control, value } : control,
          )
        : [...workflowControls, { ...nextControl, value }]
      : workflowControls;
    const nextWorkflowControls = nextWorkflowControlsBeforePrune.filter(
      (control) =>
        control.workflowId !== selectedWorkflow.id ||
        (!removedDynamicControlKeys.has(getComfyControlKey(control.nodeId, control.inputName)) &&
          !resetDynamicControlKeys.has(getComfyControlKey(control.nodeId, control.inputName))),
    );

    const nextWorkflows = node.workflows.map((workflow) => {
      if (workflow.id !== selectedWorkflow.id) return workflow;
      const nextPrompt = { ...workflow.prompt };
      const promptNode = nextPrompt[candidate.previewNodeId];
      if (promptNode && typeof promptNode === 'object' && !Array.isArray(promptNode)) {
        const promptNodeObject = promptNode as Record<string, unknown>;
        nextPrompt[candidate.previewNodeId] = {
          ...promptNodeObject,
          inputs: nextCandidateInputs,
        };
      }

      return {
        ...workflow,
        prompt: nextPrompt,
        outputCandidates: (workflow.outputCandidates ?? []).map((outputCandidate) => {
          if (outputCandidate.id !== candidate.id) return outputCandidate;
          const inputKey =
            outputCandidate.kind === 'synthetic' ? 'syntheticOutputNodeInputs' : 'outputNodeInputs';
          return {
            ...outputCandidate,
            [inputKey]: nextCandidateInputs,
          };
        }),
      };
    });

    updateNode(
      node.id,
      {
        workflows: nextWorkflows,
        workflowControls: nextWorkflowControls,
        lastError: undefined,
      },
      true,
    );
    setLocalError(null);
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
    inputContext: ComfyRunInputContext,
  ): Promise<Array<{ candidate: ComfyWorkflowInputCandidate; imageName: string }>> => {
    const uploads: Array<{ candidate: ComfyWorkflowInputCandidate; imageName: string }> = [];
    const selectedRegion =
      inputContext === 'viewportTool' ? getExplicitSelectedComfyViewportPromptRegion(node) : null;

    if (selectedRegion && !sceneNode) {
      throw new Error('Scene node not found for Comfy region input rendering.');
    }

    for (const candidate of getComfyWorkflowInputCandidates(workflow)) {
      if (!shouldUseComfyWorkflowInputSource({ node, workflow, candidate, inputContext })) {
        continue;
      }

      const portName = getWorkflowInputPortName(workflow, candidate);
      const sourceNodeId = node.inputs?.[portName];
      const inputImage = node.workflowInputImages?.[portName];
      if (!sourceNodeId && !inputImage) continue;

      if (sourceNodeId) {
        const sourceNode = allNodes.find((candidateNode) => candidateNode.id === sourceNodeId);
        if (!sourceNode) {
          throw new Error(`Connected source for ${candidate.label} was not found.`);
        }

        if (!sceneNode) {
          throw new Error('Scene node not found for Comfy input rendering.');
        }

        const nativeSourceImage = selectedRegion
          ? null
          : await readNativeWorkflowSourceImage(sourceNode, currentFrame);
        const blob =
          selectedRegion && sceneNode
            ? await renderNodeInputRegionToPngBlob({
                nodes: allNodes,
                flows,
                sourceNodeId,
                sceneNode,
                frame: currentFrame,
                regionRect: selectedRegion.rect,
                finalColorSpace: sceneNode.colorSpace === 'Linear' ? 'srgb' : 'raw_texture',
              })
            : (nativeSourceImage?.blob ??
              (await renderNodeInputFrameToPngBlob({
                nodes: allNodes,
                flows,
                sourceNodeId,
                sceneNode,
                frame: currentFrame,
                finalColorSpace: sceneNode.colorSpace === 'Linear' ? 'srgb' : 'raw_texture',
              })));
        const sourceName = nativeSourceImage?.sourceName ?? sourceNode.name ?? sourceNode.id;

        const imageName = await uploadComfyInputImage({
          endpoint,
          image: blob,
          filename: getComfyInputUploadFilename({
            sourceName: selectedRegion ? `${sourceName}_region` : sourceName,
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
      const uploadBlob =
        selectedRegion && sceneNode
          ? await cropImageBlobToRegion({ blob, region: selectedRegion, sceneNode })
          : blob;
      const imageName = await uploadComfyInputImage({
        endpoint,
        image: uploadBlob,
        filename: getComfyInputUploadFilename({
          sourceName: selectedRegion
            ? `${inputImage.name || candidate.label}_region`
            : inputImage.name || candidate.label,
          candidate,
          blob: uploadBlob,
        }),
        signal,
      });
      uploads.push({ candidate, imageName });
    }

    return uploads;
  };

  const handleRunWorkflow = async (runCount = 1, inputContext: ComfyRunInputContext = 'props') => {
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
    const originBranchId = activeProjectBranchId;
    const originHistoryEntryId = activeHistoryEntryId;
    const selectedOutputNodeIds = selectedOutputCandidates.map(
      (candidate) => candidate.previewNodeId,
    );
    const selectedRunRegion =
      inputContext === 'viewportTool' ? getExplicitSelectedComfyViewportPromptRegion(node) : null;
    if (inputContext === 'viewportTool' && !selectedRunRegion) {
      setRunState('error');
      setNodeError('Select a Comfy region before running from the viewport.');
      return;
    }
    const viewportRect = selectedRunRegion?.rect ?? null;
    const selectedRunRegionId = selectedRunRegion?.id ?? null;
    const getRunSource = (runIndex: number, totalRuns = runCount, promptId?: string | null) => ({
      ...getComfyBatchSource(originProjectId, node.id, selectedWorkflow.id, runIndex, totalRuns),
      ...(originBranchId ? { branchId: originBranchId } : {}),
      ...(originHistoryEntryId ? { historyId: originHistoryEntryId } : {}),
      ...(promptId ? { promptId } : {}),
      comfyEndpoint: endpoint,
      outputNodeIds: selectedOutputNodeIds,
      comfyInputContext: inputContext,
      ...(viewportRect ? { comfyViewportRect: viewportRect } : {}),
      ...(selectedRunRegionId ? { comfyRegionId: selectedRunRegionId } : {}),
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
    let jobPromptRef: { promptId: string; endpoint: string } | null = null;
    let jobCancelled = false;
    let jobFinished = false;
    const finishJobOnce = (updates: Parameters<typeof finishBackgroundJob>[1]) => {
      if (jobFinished) return;
      jobFinished = true;
      finishBackgroundJob(jobId, updates);
    };

    const cancelWithInterrupt = () => {
      jobCancelled = true;
      if (jobPromptRef) {
        void interruptComfyPrompt(jobPromptRef.promptId, jobPromptRef.endpoint).catch(() => {});
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

            const clientId = defaultComfyRunCoordinator.createClientId();
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
            const promptWithRootBindings =
              inputContext === 'props'
                ? applyComfyRootBindings(promptWithControls, node, sceneNode, selectedWorkflow)
                : promptWithControls;
            const promptWithViewportBindings = applyComfyViewportPromptRegionBindings(
              promptWithRootBindings,
              node,
              selectedWorkflow,
              { inputContext },
            );
            const inputImages = await uploadConnectedWorkflowInputs(
              selectedWorkflow,
              abortController.signal,
              inputContext,
            );
            const prompt =
              inputImages.length > 0
                ? applyComfyWorkflowInputImages(promptWithViewportBindings, inputImages)
                : promptWithViewportBindings;
            const queued = await queueComfyPrompt({
              endpoint,
              prompt,
              clientId,
              extraData: createComfyPromptExtraData(selectedWorkflow, prompt),
            });
            jobPromptRef = {
              promptId: queued.promptId,
              endpoint,
            };

            queuedRuns.push({
              runIndex,
              promptId: queued.promptId,
              clientId,
              promptSummary: getOutputPromptSummary(
                preparedControls.promptControls,
                selectedWorkflow.id,
              ),
            });

            defaultComfyRunCoordinator.setLatestPrompt(endpoint, {
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

            const outputFiles = await waitForComfyOutputFiles({
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
                `Downloading ${getOutputCountLabel(outputFiles.length)}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Downloading output', runIndex, runCount),
              detail: outputFiles.map((file) => file.filename).join(', '),
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

            const generatedOutputs = await createGeneratedOutputsFromComfyFiles({
              endpoint,
              files: outputFiles,
              workflow: selectedWorkflow,
              promptId,
              promptSummary,
              signal: abortController.signal,
            });
            const generatedOutputsWithRegion = selectedRunRegionId
              ? generatedOutputs.map((o) => ({ ...o, regionId: selectedRunRegionId }))
              : generatedOutputs;
            const activeGeneratedOutput = generatedOutputsWithRegion[0];
            if (!activeGeneratedOutput) {
              throw new Error('ComfyUI completed the workflow, but no output file was found.');
            }

            generatedOutputsRef.current = [
              ...generatedOutputsRef.current,
              ...generatedOutputsWithRegion,
            ];
            const transform = getComfyOutputTransform({
              node,
              output: activeGeneratedOutput,
              sceneNode,
            });

            const applyTarget = await applyComfyNodeRunResult({
              projectId: originProjectId,
              branchId: originBranchId,
              nodeId: node.id,
              updates: {
                src: activeGeneratedOutput.src,
                mediaKind: activeGeneratedOutput.mediaKind ?? 'image',
                colorSpace: activeGeneratedOutput.colorSpace ?? node.colorSpace,
                frames: activeGeneratedOutput.frames,
                duration: activeGeneratedOutput.duration,
                fps: activeGeneratedOutput.fps,
                width: activeGeneratedOutput.width,
                height: activeGeneratedOutput.height,
                transform,
                activeGeneratedOutputId: activeGeneratedOutput.id,
                selectedViewportPromptRegionId: activeGeneratedOutput.regionId,
                lastPromptId: promptId,
                lastRunAt: activeGeneratedOutput.createdAt,
                lastError: undefined,
              },
              newGeneratedOutputs: generatedOutputsWithRegion,
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
      await defaultComfyRunCoordinator.enqueue(endpointQueueKey, async () => {
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

          const clientId = defaultComfyRunCoordinator.createClientId();
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
            const promptWithRootBindings =
              inputContext === 'props'
                ? applyComfyRootBindings(promptWithControls, node, sceneNode, selectedWorkflow)
                : promptWithControls;
            const promptWithViewportBindings = applyComfyViewportPromptRegionBindings(
              promptWithRootBindings,
              node,
              selectedWorkflow,
              { inputContext },
            );
            const inputImages = await uploadConnectedWorkflowInputs(
              selectedWorkflow,
              abortController.signal,
              inputContext,
            );
            const prompt =
              inputImages.length > 0
                ? applyComfyWorkflowInputImages(promptWithViewportBindings, inputImages)
                : promptWithViewportBindings;
            const queued = await queueComfyPrompt({
              endpoint,
              prompt,
              clientId,
              extraData: createComfyPromptExtraData(selectedWorkflow, prompt),
            });
            queuedPromptId = queued.promptId;
            jobPromptRef = {
              promptId: queued.promptId,
              endpoint,
            };
            updateNode(node.id, { lastPromptId: queued.promptId }, false);

            defaultComfyRunCoordinator.setLatestPrompt(endpoint, {
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

            const outputFiles = await waitForComfyOutputFiles({
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
                `Downloading ${getOutputCountLabel(outputFiles.length)}.`,
                runIndex,
                runCount,
              ),
            );
            setRunProgress({
              label: formatRunProgressLabel('Downloading output', runIndex, runCount),
              detail: outputFiles.map((file) => file.filename).join(', '),
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
            const generatedOutputs = await createGeneratedOutputsFromComfyFiles({
              endpoint,
              files: outputFiles,
              workflow: selectedWorkflow,
              promptId: queued.promptId,
              promptSummary: getOutputPromptSummary(currentWorkflowControls, selectedWorkflow.id),
              signal: abortController.signal,
            });
            const generatedOutputsWithRegion = selectedRunRegionId
              ? generatedOutputs.map((o) => ({ ...o, regionId: selectedRunRegionId }))
              : generatedOutputs;
            const activeGeneratedOutput = generatedOutputsWithRegion[0];
            if (!activeGeneratedOutput) {
              throw new Error('ComfyUI completed the workflow, but no output file was found.');
            }
            generatedOutputsRef.current = [
              ...generatedOutputsRef.current,
              ...generatedOutputsWithRegion,
            ];
            const transform = getComfyOutputTransform({
              node,
              output: activeGeneratedOutput,
              sceneNode,
            });

            const applyTarget = await applyComfyNodeRunResult({
              projectId: originProjectId,
              branchId: originBranchId,
              nodeId: node.id,
              updates: {
                src: activeGeneratedOutput.src,
                mediaKind: activeGeneratedOutput.mediaKind ?? 'image',
                colorSpace: activeGeneratedOutput.colorSpace ?? node.colorSpace,
                frames: activeGeneratedOutput.frames,
                duration: activeGeneratedOutput.duration,
                fps: activeGeneratedOutput.fps,
                width: activeGeneratedOutput.width,
                height: activeGeneratedOutput.height,
                transform,
                activeGeneratedOutputId: activeGeneratedOutput.id,
                selectedViewportPromptRegionId: activeGeneratedOutput.regionId,
                lastPromptId: queued.promptId,
                lastRunAt: activeGeneratedOutput.createdAt,
                lastError: undefined,
              },
              newGeneratedOutputs: generatedOutputsWithRegion,
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
  useNodeExecutionHandler(node.id, (context) => {
    if (isRunActionDisabled) return;
    const requestedRunCount =
      typeof context?.runCount === 'number' && Number.isFinite(context.runCount)
        ? Math.max(1, Math.floor(context.runCount))
        : 1;
    void handleRunWorkflow(requestedRunCount, getRunInputContext(context));
  });
  const handleRunSingleWorkflow = () => {
    void handleRunWorkflow(1, inspectorInputContext);
  };
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
      void handleRunWorkflow(1, 'props');
    }, 0);
  };

  const handleCancelRun = () => {
    if (activeNodeComfyJob) {
      requestBackgroundJobCancel(activeNodeComfyJob.id);
    } else if (abortRef.current) {
      void interruptComfyPrompt('', endpoint).catch(() => {});
      abortRef.current.abort();
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="min-w-0 flex-1">
        {selectedRegionForProps ? (
          <ComfyRegionInspector
            node={node}
            selectedWorkflow={selectedWorkflow}
            regionId={selectedRegionForProps.id}
          />
        ) : selectedOutputForProps ? (
          <ComfyOutputTransformSection
            node={node}
            output={selectedOutputForProps}
            sceneSizeLabel={selectedOutputSceneSizeLabel}
          />
        ) : (
          <>
            <ComfyWorkflowPicker
              fileInputRef={fileInputRef}
              pasteTextareaRef={pasteTextareaRef}
              selectedWorkflow={selectedWorkflow}
              workflows={node.workflows}
              workflowEmptyMode={workflowEmptyMode}
              workflowJsonDraft={workflowJsonDraft}
              workflowBrowserState={workflowBrowserState}
              backendWorkflowFiles={backendWorkflowFiles}
              filteredBackendWorkflowFiles={filteredBackendWorkflowFiles}
              backendWorkflowSearch={backendWorkflowSearch}
              isBackendWorkflowPickerOpen={isBackendWorkflowPickerOpen}
              isBrowsingWorkflows={isBrowsingWorkflows}
              onImportWorkflow={handleImportWorkflow}
              onRemoveWorkflow={handleRemoveWorkflow}
              onChooseImportWorkflow={handleChooseImportWorkflow}
              onChoosePasteWorkflow={handleChoosePasteWorkflow}
              onWorkflowEmptyModeChange={setWorkflowEmptyMode}
              onWorkflowJsonDraftChange={setWorkflowJsonDraft}
              onImportPastedWorkflow={handleImportPastedWorkflow}
              onBackendWorkflowPickerOpenChange={handleBackendWorkflowPickerOpenChange}
              onBackendWorkflowSearchChange={setBackendWorkflowSearch}
              onLoadBackendWorkflow={handleLoadBackendWorkflow}
              onSelectWorkflow={handleSelectWorkflow}
            />

            <ComfyWorkflowControlsSection
              selectedWorkflow={selectedWorkflow}
              isWorkflowControlBuilderOpen={isWorkflowControlBuilderOpen}
              pendingControlKeys={pendingControlKeys}
              activeControlKeys={activeControlKeys}
              controlCandidates={visibleControlCandidates}
              activeWorkflowControls={visibleActiveWorkflowControls}
              activeMissingControlOptions={activeMissingControlOptions}
              missingModelSizeStatuses={missingModelSizeStatuses}
              missingModelDetailsVisible={comfyMissingModelDetailsVisible}
              runRollTokens={runRollTokens}
              promptApplyNoticeId={promptApplyNotice?.id ?? null}
              promptApplyNoticeFieldId={promptApplyNotice?.fieldId ?? null}
              imagePromptRoute={imagePromptRoute}
              imagePromptRouteError={imagePromptRouteError}
              controlSourceSummaries={controlSourceSummaries}
              recommendedControlSourceSummaries={recommendedControlSourceSummaries}
              onOpenWorkflowControlBuilder={handleOpenWorkflowControlBuilder}
              onCancelWorkflowControlBuilder={handleCancelWorkflowControlBuilder}
              onApplyWorkflowControlBuilder={handleApplyWorkflowControlBuilder}
              onToggleWorkflowControlCandidate={handleToggleWorkflowControlCandidate}
              onToggleMissingModelDetails={handleToggleMissingModelDetails}
              onDownloadMissingModel={handleDownloadMissingModel}
              onCopyMissingModelPath={handleCopyMissingModelPath}
              onResetWorkflowControl={handleResetWorkflowControl}
              onBindControlSource={handleBindControlSource}
              onUnbindControlSource={handleUnbindControlSource}
              onUpdateWorkflowControl={handleUpdateWorkflowControl}
              onStartPromptEnhancementChat={(controlId, promptRoute) =>
                startComfyPromptEnhancementChat(node.id, controlId, promptRoute)
              }
              advancedControlId={advancedControlId}
              onAdvancedControlIdChange={setAdvancedControlId}
              onWorkflowPropsKeyDown={handleWorkflowPropsKeyDown}
            />

            {selectedWorkflow && (
              <ComfyRootSizeBindingsSection node={node} selectedWorkflow={selectedWorkflow} />
            )}

            {selectedWorkflow && (
              <ComfyWorkflowInputList
                selectedWorkflow={selectedWorkflow}
                workflowInputCandidates={workflowInputCandidates}
                connectedWorkflowInputs={connectedWorkflowInputs}
                onImportWorkflowInputImage={handleImportWorkflowInputImage}
                onClearWorkflowInputImage={handleClearWorkflowInputImage}
              />
            )}

            {selectedWorkflow && (
              <ComfyWorkflowOutputPicker
                workflowOutputCandidates={workflowOutputCandidates}
                workflowControls={activeWorkflowControls}
                controlCandidates={controlCandidates}
                selectedWorkflowOutputIds={selectedWorkflowOutputIds}
                selectedWorkflowOutputIdSet={selectedWorkflowOutputIdSet}
                hasNoSelectedWorkflowOutputs={hasNoSelectedWorkflowOutputs}
                onSelectAllWorkflowOutputs={handleSelectAllWorkflowOutputs}
                onToggleWorkflowOutputCandidate={handleToggleWorkflowOutputCandidate}
                onUpdateWorkflowOutputField={handleUpdateWorkflowOutputField}
              />
            )}
          </>
        )}
      </div>

      <ComfyExecuteSection
        node={node}
        outputApplyNoticeId={outputApplyNotice?.id}
        pendingGeneratedOutputSlots={pendingGeneratedOutputSlots}
        recentGeneratedOutputs={recentGeneratedOutputs}
        isRunActionDisabled={isRunActionDisabled}
        runShortcutHint={runShortcutHint}
        localError={localError}
        hasRunProgress={hasRunProgress}
        inspectorProgressLabel={inspectorProgressLabel}
        inspectorProgressPercent={inspectorProgressPercent}
        inspectorProgressIndeterminate={inspectorProgressIndeterminate}
        inspectorLogMessage={inspectorLogMessage}
        onRunSingleWorkflow={handleRunSingleWorkflow}
        onRunBatchWorkflow={(count) => void handleRunWorkflow(count, inspectorInputContext)}
        onActivateGeneratedOutput={handleActivateGeneratedOutput}
        onOpenGalleryView={openGalleryView}
        onCancelRun={handleCancelRun}
        onClearInspectorLog={clearInspectorLog}
      />
    </div>
  );
}
