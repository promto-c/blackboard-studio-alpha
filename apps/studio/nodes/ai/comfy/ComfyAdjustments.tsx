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
  DEFAULT_COMFY_ENDPOINT,
  listComfyWorkflowFiles,
  normalizeComfyEndpoint,
  applyComfyWorkflowInputImages,
  queueComfyPrompt,
  cancelComfyPrompt,
  createComfyPromptId,
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
import {
  getComfyWorkflowInputCandidates,
  getSelectedComfyWorkflowInputCandidates,
} from './comfyInputs';
import { getComfyInputPortName, remapInputsOnWorkflowChange } from '../../portMapping';
import {
  createComfyWorkflowFromJson,
  createDefaultComfyWorkflowControls,
  getComfyWorkflowNameFromJson,
  hashComfyWorkflowSource,
  isComfyWorkflowImageFile,
  readComfyWorkflowFile,
  refreshComfyWorkflowFromSource,
} from './comfyWorkflowImport';
import { getAiTaskRouteError, getComfyEndpoint, resolveAiTaskRoute } from '@/utils/aiRouting';
import { registerBackgroundJobCancelHandler } from '@/state/editor/services/backgroundJobExecutor';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import type { NodeExecutionContext } from '@/utils/nodeExecutionRegistry';
import { getImportedImageColorManagement, isImageFileLike } from '@/utils/mediaFiles';
import { decodeRasterImageSource } from '@/utils/rasterImageSource';
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
import { getMediaSourceColorSpace } from '@/color-management';
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
import { alignComfyOutputToInput, type ComfyAlignmentReference } from './comfyImageAlignment';
import { createComfyDifferenceMask } from './comfyDifferenceMask';
import { isComfyRunShortcut } from './comfyRunShortcut';
import { getActiveComfyOutputJobs, getPendingComfyOutputSlots } from './comfyOutputGallery';
import { getComfyGeneratedOutputsForGalleryScope } from './comfyOutputLayers';
import {
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyMediaOutput,
  getComfyOutputActivationUpdates,
  isComfy3DGeneratedOutput,
} from './comfyOutputActivation';
import { useComfyOutputActivation } from './useComfyOutputActivation';
import {
  getComfyOutputCandidateControlValues,
  getComfyOutputCandidateNodes,
  getNextComfyOutputCandidateInputs,
  updateComfyOutputCandidateInputs,
} from './comfyOutputCandidates';
import { ComfyInputUploadCache, getComfyInputBlobFingerprint } from './comfyInputUploadCache';
import {
  getComfyRenderedInputName,
  renderComfyConnectedInputToPngBlob,
} from './comfyInputRendering';
import { getComfyInputUploadFilename } from './comfyInputUploadFilename';
import {
  queueComfyPromptWithInputRecovery,
  type ComfyInputUploadRecoveryOptions,
  type ComfyQueuedInputUpload,
} from './comfyPromptQueueRecovery';

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

interface ComfyResolvedInputUpload extends ComfyQueuedInputUpload {
  candidate: ComfyWorkflowInputCandidate;
  alignmentBlob: Blob;
  alignmentName: string;
  alignmentReference?: ComfyAlignmentReference;
}

interface ComfyAlignmentInput {
  blob: Blob;
  nameHint?: string;
  reference?: ComfyAlignmentReference;
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

const createComfyBatchId = (): string =>
  `comfy_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getComfyBatchSource = (
  projectId: string | null,
  nodeId: string,
  workflowId: string,
  batchId: string,
  runIndex: number,
  runCount: number,
) => ({
  ...(projectId ? { projectId } : {}),
  nodeId,
  workflowId,
  batchId,
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

const getComfyOutputDynamicNestedInputNames = (
  candidate: ComfyWorkflowOutputCandidate,
  nodeId: string,
): Set<string> => {
  const names = new Set<string>();
  if (nodeId !== candidate.previewNodeId) return names;
  for (const option of candidate.outputNodeDynamicInputs ?? []) {
    for (const field of option.fields) {
      names.add(field.inputName);
      names.add(field.dottedInputName);
    }
  }
  return names;
};

const getOutputCountLabel = (count: number): string => `${count} output${count === 1 ? '' : 's'}`;

const createComfyPromptExtraData = (
  workflow: ComfyWorkflow,
  prompt: Record<string, unknown>,
): Record<string, unknown> => ({
  extra_pnginfo: {
    prompt,
    workflow: workflow.sourceGraph ?? prompt,
  },
});

const getSceneFrameAlignmentReference = (
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
): ComfyAlignmentReference => ({
  width: sceneNode.width,
  height: sceneNode.height,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
});

const getSceneRegionAlignmentReference = (
  rect: ViewportPromptRegion['rect'],
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
): ComfyAlignmentReference => {
  const left = Math.floor(Math.min(rect.x, rect.x + rect.width));
  const top = Math.floor(Math.min(rect.y, rect.y + rect.height));
  const right = Math.ceil(Math.max(rect.x, rect.x + rect.width));
  const bottom = Math.ceil(Math.max(rect.y, rect.y + rect.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return {
    width,
    height,
    transform: {
      x: left + width / 2 - sceneNode.width / 2,
      y: sceneNode.height / 2 - (top + height / 2),
      scaleX: 1,
      scaleY: 1,
    },
  };
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
  alphaMode,
  nameHint,
}: {
  blob: Blob;
  region: ViewportPromptRegion;
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
  alphaMode: 'opaque' | 'preserve';
  nameHint?: string;
}): Promise<Blob> => {
  const image = await decodeRasterImageSource(blob, {
    nameHint,
    label: 'Comfy region input image',
  });

  try {
    // Scale the region rect from scene coords to the bitmap's pixel coords
    const regionBmpX = (region.rect.x / sceneNode.width) * image.width;
    const regionBmpY = (region.rect.y / sceneNode.height) * image.height;
    const regionBmpW = (region.rect.width / sceneNode.width) * image.width;
    const regionBmpH = (region.rect.height / sceneNode.height) * image.height;

    // Compute pixel-aligned bounds consistently with floor/ceil
    const pixelLeft = Math.floor(Math.min(regionBmpX, regionBmpX + regionBmpW));
    const pixelTop = Math.floor(Math.min(regionBmpY, regionBmpY + regionBmpH));
    const pixelRight = Math.ceil(Math.max(regionBmpX, regionBmpX + regionBmpW));
    const pixelBottom = Math.ceil(Math.max(regionBmpY, regionBmpY + regionBmpH));
    const outputWidth = Math.max(1, Math.abs(pixelRight - pixelLeft));
    const outputHeight = Math.max(1, Math.abs(pixelBottom - pixelTop));

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create a canvas for cropped Comfy input image.');
    }

    // Calculate the overlap between the pixel-aligned rect and the bitmap bounds
    const overlapLeft = Math.max(0, pixelLeft);
    const overlapTop = Math.max(0, pixelTop);
    const overlapRight = Math.min(image.width, pixelRight);
    const overlapBottom = Math.min(image.height, pixelBottom);
    const overlapWidth = overlapRight - overlapLeft;
    const overlapHeight = overlapBottom - overlapTop;

    if (alphaMode === 'opaque') {
      // Fill with opaque black — areas not covered by the image become
      // opaque black (the default, most Comfy models expect opaque input).
      context.fillStyle = '#000';
      context.fillRect(0, 0, outputWidth, outputHeight);
    } else {
      // Fill with transparent pixels to preserve alpha.
      context.clearRect(0, 0, outputWidth, outputHeight);
    }

    if (overlapWidth > 0 && overlapHeight > 0) {
      // Where the overlap sits within the output canvas.
      const canvasOffsetX = overlapLeft - pixelLeft;
      const canvasOffsetY = overlapTop - pixelTop;

      if (canvasOffsetX >= 0 && canvasOffsetY >= 0) {
        context.drawImage(
          image.source,
          overlapLeft,
          overlapTop,
          overlapWidth,
          overlapHeight,
          canvasOffsetX,
          canvasOffsetY,
          overlapWidth,
          overlapHeight,
        );
      }
    }
    // If there is no overlap and alphaMode is 'opaque', the canvas stays opaque black.

    return encodeCanvasToPngBlob(canvas);
  } finally {
    image.close();
  }
};

const getRunInputContext = (context?: NodeExecutionContext): ComfyRunInputContext =>
  context?.source === 'viewportTool' ? 'viewportTool' : 'props';

export function ComfyAdjustmentsPanel({
  node,
  headless = false,
}: {
  node: ComfyNode;
  headless?: boolean;
}) {
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
  const { comfyMissingModelDetailsVisible, aiTaskRoutes, integrationConnections, setPreferences } =
    usePreferences();
  const endpoint = normalizeComfyEndpoint(
    getComfyEndpoint({ integrationConnections }) ?? DEFAULT_COMFY_ENDPOINT,
  );
  const allNodes = useEditorSelector((state) => state.nodes);
  const flows = useEditorSelector((state) => state.flows);
  const projectId = useEditorSelector((state) => state.projectId);
  const projectColorManagement = useEditorSelector((state) => state.colorManagement);
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
      getActiveComfyOutputJobs({
        jobs: backgroundJobs,
        nodeId: node.id,
        projectId,
        branchId: activeProjectBranchId,
      }),
    [activeProjectBranchId, backgroundJobs, node.id, projectId],
  );
  const activeNodeComfyJob = activeNodeComfyJobs[0] ?? null;
  const endpointQueueKey = `comfy:${endpoint}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputUploadCacheRef = useRef(new ComfyInputUploadCache());
  const generatedOutputsRef = useRef<GeneratedOutput[]>(node.generatedOutputs ?? []);
  const lastAlignmentInputRef = useRef<ComfyAlignmentInput | null>(null);
  const alignmentInputsByPromptIdRef = useRef(new Map<string, ComfyAlignmentInput>());
  const workflowsRef = useRef(node.workflows);
  const workflowControlsRef = useRef(node.workflowControls ?? []);
  const refreshedWorkflowMetadataKeysRef = useRef(new Set<string>());
  const refreshingWorkflowMetadataKeysRef = useRef(new Set<string>());
  const hasStepProgressRef = useRef(false);
  const [runState, setRunState] = useState<RunState>('idle');
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);
  const [runRollTokens, setRunRollTokens] = useState<Record<string, number>>({});
  const [workflowBrowserState, setWorkflowBrowserState] = useState<WorkflowBrowserState>('idle');
  const [backendWorkflowFiles, setBackendWorkflowFiles] = useState<ComfyWorkflowFile[]>([]);
  const [workflowEmptyMode, setWorkflowEmptyMode] = useState<WorkflowEmptyMode>('choice');
  const [workflowJsonDraft, setWorkflowJsonDraft] = useState('');
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
  });
  const imagePromptRoute = imagePromptRouteError
    ? null
    : resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        integrationConnections,
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
    () => getComfyGeneratedOutputsForGalleryScope(node, selectedRegionForProps?.id).reverse(),
    [node, selectedRegionForProps?.id],
  );
  const pendingGeneratedOutputSlots = useMemo(
    () => getPendingComfyOutputSlots(activeNodeComfyJobs, selectedRegionForProps?.id),
    [activeNodeComfyJobs, selectedRegionForProps?.id],
  );

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
  const selectedWorkflowInputCandidates = useMemo(
    () => getSelectedComfyWorkflowInputCandidates(selectedWorkflow),
    [selectedWorkflow],
  );
  const selectedWorkflowInputIdSet = useMemo(
    () => new Set(selectedWorkflowInputCandidates.map((candidate) => candidate.id)),
    [selectedWorkflowInputCandidates],
  );
  const getWorkflowInputPortName = useCallback(
    (workflow: ComfyWorkflow, candidate: ComfyWorkflowInputCandidate): string =>
      getComfyInputPortName(
        workflow.id,
        candidate,
        [...Object.keys(node.inputs ?? {}), ...Object.keys(node.workflowInputImages ?? {})],
        {
          allowSingleReservedPort:
            selectedWorkflowInputIdSet.has(candidate.id) &&
            getSelectedComfyWorkflowInputCandidates(workflow).length === 1,
        },
      ),
    [node.inputs, node.workflowInputImages, selectedWorkflowInputIdSet],
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
      for (const outputNode of getComfyOutputCandidateNodes(candidate)) {
        for (const [inputName, value] of Object.entries(outputNode.inputs)) {
          if (
            ['images', 'image', 'video', 'mesh', 'splat', 'model_3d'].includes(
              inputName.toLowerCase(),
            ) ||
            Array.isArray(value) ||
            !['string', 'number', 'boolean'].includes(typeof value)
          ) {
            continue;
          }
          keys.add(getComfyControlKey(outputNode.id, inputName));
        }
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

  useEffect(() => {
    setLocalError(node.lastError ?? null);
  }, [node.lastError]);

  useEffect(() => {
    generatedOutputsRef.current = node.generatedOutputs ?? [];
  }, [node.generatedOutputs]);

  useEffect(() => {
    workflowsRef.current = node.workflows;
    workflowControlsRef.current = node.workflowControls ?? [];
  }, [node.workflowControls, node.workflows]);

  useEffect(() => {
    if (!selectedWorkflow?.sourceGraph) return;
    const refreshKey = [
      endpoint,
      selectedWorkflow.id,
      selectedWorkflow.updatedAt ?? selectedWorkflow.createdAt,
    ].join('\u0000');
    if (
      refreshedWorkflowMetadataKeysRef.current.has(refreshKey) ||
      refreshingWorkflowMetadataKeysRef.current.has(refreshKey)
    ) {
      return;
    }
    refreshingWorkflowMetadataKeysRef.current.add(refreshKey);

    void refreshComfyWorkflowFromSource(endpoint, selectedWorkflow)
      .then((refreshedWorkflow) => {
        refreshedWorkflowMetadataKeysRef.current.add(refreshKey);
        const existingControls = workflowControlsRef.current;
        const refreshedOutputControlValues = new Map(
          (refreshedWorkflow.outputCandidates ?? [])
            .flatMap(getComfyOutputCandidateControlValues)
            .map((entry) => [getComfyControlKey(entry.nodeId, entry.inputName), entry.value]),
        );
        const normalizedExistingControls = existingControls.map((control) => {
          if (control.workflowId !== refreshedWorkflow.id) return control;
          const refreshedValue = refreshedOutputControlValues.get(
            getComfyControlKey(control.nodeId, control.inputName),
          );
          return refreshedValue === undefined ? control : { ...control, value: refreshedValue };
        });
        const existingControlKeys = new Set(
          normalizedExistingControls
            .filter((control) => control.workflowId === refreshedWorkflow.id)
            .map((control) => getComfyControlKey(control.nodeId, control.inputName)),
        );
        const missingControls = createDefaultComfyWorkflowControls(refreshedWorkflow).filter(
          (control) =>
            !existingControlKeys.has(getComfyControlKey(control.nodeId, control.inputName)),
        );
        const discoveredOutputCount = refreshedWorkflow.outputCandidates?.length ?? 0;
        const hadNoOutputCandidates = (selectedWorkflow.outputCandidates?.length ?? 0) === 0;

        updateNode(
          node.id,
          {
            workflows: workflowsRef.current.map((workflow) =>
              workflow.id === refreshedWorkflow.id ? refreshedWorkflow : workflow,
            ),
            workflowControls:
              missingControls.length > 0
                ? [...normalizedExistingControls, ...missingControls]
                : normalizedExistingControls,
          },
          false,
        );

        if (hadNoOutputCandidates && discoveredOutputCount > 0) {
          setStatusMessage(
            `Detected ${discoveredOutputCount} workflow output port${discoveredOutputCount === 1 ? '' : 's'}.`,
          );
        }
      })
      .catch(() => {
        refreshedWorkflowMetadataKeysRef.current.delete(refreshKey);
      })
      .finally(() => {
        refreshingWorkflowMetadataKeysRef.current.delete(refreshKey);
      });
  }, [endpoint, node.id, selectedWorkflow, updateNode]);

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
    setAdvancedControlId(null);
  }, [selectedWorkflow?.id]);

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

  const activateGeneratedOutput = useComfyOutputActivation(node);
  const handleActivateGeneratedOutput = (output: GeneratedOutput) => {
    if (!isComfy3DGeneratedOutput(output)) {
      generatedOutputsRef.current = getComfyGeneratedOutputsForGalleryActivation(node, output);
    }
    activateGeneratedOutput(output);
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
      const inputCandidates = getSelectedComfyWorkflowInputCandidates(workflow);
      const remappedInputs = remapInputsOnWorkflowChange(node.inputs, workflow.id, inputCandidates);
      const defaultWorkflowControls = createDefaultComfyWorkflowControls(workflow);
      const importedAt = Date.now();
      const rawImportedOutput = isComfyWorkflowImageFile(file)
        ? await (async (): Promise<GeneratedOutput> => {
            const { width, height } = await readImageDimensions(file);
            const assetId = await saveAsset(file);
            const mediaColorManagement = await getImportedImageColorManagement(file, file.name);
            const colorSpace = getMediaSourceColorSpace(mediaColorManagement);
            return {
              id: `comfy_output_import_${importedAt}_${Math.random().toString(36).slice(2, 8)}`,
              src: assetId,
              mediaKind: 'image',
              ...(colorSpace ? { colorSpace } : {}),
              mediaColorManagement,
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
                mediaColorManagement:
                  rawImportedOutput.mediaColorManagement ?? node.mediaColorManagement,
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
      const inputCandidates = getSelectedComfyWorkflowInputCandidates(workflow);
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
      const inputCandidates = getSelectedComfyWorkflowInputCandidates(workflow);
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
    const inputCandidates = getSelectedComfyWorkflowInputCandidates(workflow);
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
    const inputCandidates = getSelectedComfyWorkflowInputCandidates(nextWorkflow);
    const remappedInputs = nextWorkflow
      ? remapInputsOnWorkflowChange(node.inputs, nextWorkflow.id, inputCandidates)
      : node.inputs;
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

  const handleToggleWorkflowInputCandidate = (candidateId: string) => {
    if (!selectedWorkflow) return;
    const candidate = workflowInputCandidates.find((entry) => entry.id === candidateId);
    if (!candidate) return;

    const isSelected = selectedWorkflowInputIdSet.has(candidateId);
    const selectedInputIds = isSelected
      ? selectedWorkflowInputCandidates
          .filter((entry) => entry.id !== candidateId)
          .map((entry) => entry.id)
      : [...selectedWorkflowInputCandidates.map((entry) => entry.id), candidateId];
    const nextInputs = { ...(node.inputs ?? {}) };
    const nextInputImages = { ...(node.workflowInputImages ?? {}) };

    if (isSelected) {
      const portName = getWorkflowInputPortName(selectedWorkflow, candidate);
      delete nextInputs[portName];
      delete nextInputImages[portName];
    }

    updateNode(
      node.id,
      {
        workflows: node.workflows.map((workflow) =>
          workflow.id === selectedWorkflow.id ? { ...workflow, selectedInputIds } : workflow,
        ),
        inputs: Object.keys(nextInputs).length > 0 ? nextInputs : undefined,
        workflowInputImages: nextInputImages,
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

  const handleToggleWorkflowField = (candidateKey: string) => {
    if (!selectedWorkflow) return;

    const existingControl = activeWorkflowControls.find(
      (control) => getComfyControlKey(control.nodeId, control.inputName) === candidateKey,
    );

    if (existingControl) {
      // Hide: remove the control from workflowControls
      updateWorkflowControls(
        workflowControls.filter((control) => control.id !== existingControl.id),
        true,
      );
    } else {
      // Show: find the candidate and create a new control
      const candidate = visibleControlCandidates.find((c) => c.key === candidateKey);
      if (!candidate) return;
      const newControl = createComfyWorkflowControl(selectedWorkflow.id, candidate);
      updateWorkflowControls([...workflowControls, newControl], true);
    }
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
    outputNodeId: string,
    inputName: string,
    value: ComfyWorkflowControl['value'],
  ) => {
    if (!selectedWorkflow) return;

    const nextCandidateInputs = getNextComfyOutputCandidateInputs(
      candidate,
      outputNodeId,
      inputName,
      value,
    );
    const dynamicNestedInputNames = getComfyOutputDynamicNestedInputNames(candidate, outputNodeId);
    const dynamicOptions =
      outputNodeId === candidate.previewNodeId ? (candidate.outputNodeDynamicInputs ?? []) : [];
    const resetDynamicControlKeys = new Set(
      dynamicOptions
        .filter((option) => option.parentInputName === inputName)
        .flatMap((option) =>
          option.fields.flatMap((field) => [
            getComfyControlKey(outputNodeId, field.inputName),
            getComfyControlKey(outputNodeId, field.dottedInputName),
          ]),
        ),
    );
    const removedDynamicControlKeys = new Set(
      [...dynamicNestedInputNames]
        .filter((dynamicInputName) => !(dynamicInputName in nextCandidateInputs))
        .map((dynamicInputName) => getComfyControlKey(outputNodeId, dynamicInputName)),
    );
    const controlKey = getComfyControlKey(outputNodeId, inputName);
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
      const promptNode = nextPrompt[outputNodeId];
      if (promptNode && typeof promptNode === 'object' && !Array.isArray(promptNode)) {
        const promptNodeObject = promptNode as Record<string, unknown>;
        nextPrompt[outputNodeId] = {
          ...promptNodeObject,
          inputs: nextCandidateInputs,
        };
      }

      return {
        ...workflow,
        prompt: nextPrompt,
        outputCandidates: (workflow.outputCandidates ?? []).map((outputCandidate) => {
          if (outputCandidate.id !== candidate.id) return outputCandidate;
          return updateComfyOutputCandidateInputs(
            outputCandidate,
            outputNodeId,
            nextCandidateInputs,
          );
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

  const resolveWorkflowInputImage = async ({
    workflow,
    candidate,
    selectedRegion,
  }: {
    workflow: ComfyWorkflow;
    candidate: ComfyWorkflowInputCandidate;
    selectedRegion: ViewportPromptRegion | null;
  }): Promise<{
    blob: Blob;
    sourceName: string;
    alignmentReference?: ComfyAlignmentReference;
  } | null> => {
    const portName = getWorkflowInputPortName(workflow, candidate);
    const sourceNodeId = node.inputs?.[portName];
    const inputImage = node.workflowInputImages?.[portName];
    if (!sourceNodeId && !inputImage) return null;

    if (sourceNodeId) {
      const sourceNode = allNodes.find((candidateNode) => candidateNode.id === sourceNodeId);
      if (!sourceNode) {
        throw new Error(`Connected source for ${candidate.label} was not found.`);
      }
      if (!sceneNode) {
        throw new Error('Scene node not found for Comfy input rendering.');
      }

      const regionAlphaMode =
        selectedRegion?.regionInputAlphaMode ??
        node.viewportPromptRegionDefaults?.regionInputAlphaMode ??
        'opaque';
      const blob = await renderComfyConnectedInputToPngBlob({
        nodes: allNodes,
        flows,
        sourceNodeId,
        sceneNode,
        projectColorManagement,
        frame: currentFrame,
        region: selectedRegion,
        regionInputAlphaMode: regionAlphaMode,
      });
      return {
        blob,
        sourceName: getComfyRenderedInputName(sourceNode.name ?? sourceNode.id),
        alignmentReference: selectedRegion
          ? getSceneRegionAlignmentReference(selectedRegion.rect, sceneNode)
          : getSceneFrameAlignmentReference(sceneNode),
      };
    }

    if (!inputImage) return null;
    const blob = await getAsset(inputImage.assetId);
    if (!blob) {
      throw new Error(`Could not read loaded image ${inputImage.name} for ${candidate.label}.`);
    }
    if (!isImageFileLike(blob, inputImage.name)) {
      throw new Error(`${inputImage.name} is not an image asset ComfyUI can load.`);
    }
    const regionAlphaMode =
      selectedRegion?.regionInputAlphaMode ??
      node.viewportPromptRegionDefaults?.regionInputAlphaMode ??
      'opaque';
    return {
      blob:
        selectedRegion && sceneNode
          ? await cropImageBlobToRegion({
              blob,
              region: selectedRegion,
              sceneNode,
              alphaMode: regionAlphaMode,
              nameHint: inputImage.name,
            })
          : blob,
      sourceName: inputImage.name || candidate.label,
    };
  };

  const uploadConnectedWorkflowInputs = async (
    workflow: ComfyWorkflow,
    signal: AbortSignal,
    inputContext: ComfyRunInputContext,
    selectedRegionOverride?: ViewportPromptRegion | null,
    options: ComfyInputUploadRecoveryOptions = {},
  ): Promise<ComfyResolvedInputUpload[]> => {
    const uploads: ComfyResolvedInputUpload[] = [];
    const selectedRegion =
      inputContext === 'viewportTool'
        ? (selectedRegionOverride ?? getExplicitSelectedComfyViewportPromptRegion(node))
        : null;

    if (selectedRegion && !sceneNode) {
      throw new Error('Scene node not found for Comfy region input rendering.');
    }

    for (const candidate of getSelectedComfyWorkflowInputCandidates(workflow)) {
      if (
        !shouldUseComfyWorkflowInputSource({
          node,
          workflow,
          candidate,
          inputContext,
          regionId: selectedRegion?.id,
        })
      ) {
        continue;
      }
      const resolvedInput = await resolveWorkflowInputImage({
        workflow,
        candidate,
        selectedRegion,
      });
      if (!resolvedInput) continue;

      const sourceName = selectedRegion
        ? `${resolvedInput.sourceName}_region`
        : resolvedInput.sourceName;
      const fingerprint = await getComfyInputBlobFingerprint(resolvedInput.blob);
      if (signal.aborted) {
        throw new DOMException('ComfyUI run cancelled.', 'AbortError');
      }

      const cachedUpload = inputUploadCacheRef.current.get(endpoint, fingerprint);
      const shouldUseCachedUpload = Boolean(
        cachedUpload && !options.forceUploadImageNames?.has(cachedUpload.imageName),
      );
      let imageName = cachedUpload?.imageName ?? '';
      if (!shouldUseCachedUpload) {
        imageName = await uploadComfyInputImage({
          endpoint,
          image: resolvedInput.blob,
          filename: getComfyInputUploadFilename({
            sourceName,
            candidate,
            blob: resolvedInput.blob,
          }),
          signal,
        });
        inputUploadCacheRef.current.delete(endpoint, fingerprint);
        inputUploadCacheRef.current.set({
          endpoint,
          fingerprint,
          imageName,
          uploadedAt: Date.now(),
        });
      }
      uploads.push({
        candidate,
        imageName,
        alignmentBlob: resolvedInput.blob,
        alignmentName: resolvedInput.sourceName,
        alignmentReference: resolvedInput.alignmentReference,
        cacheHit: Boolean(shouldUseCachedUpload),
      });
    }

    lastAlignmentInputRef.current = uploads[0]
      ? {
          blob: uploads[0].alignmentBlob,
          nameHint: uploads[0].alignmentName,
          reference: uploads[0].alignmentReference,
        }
      : null;
    return uploads;
  };

  const createWorkflowPromptForRun = ({
    workflow,
    promptControls,
    inputContext,
    regionId,
  }: {
    workflow: ComfyWorkflow;
    promptControls: ComfyWorkflowControl[];
    inputContext: ComfyRunInputContext;
    regionId?: string | null;
  }): Record<string, unknown> => {
    const promptWithSelectedOutputs = selectComfyPromptOutputs({
      prompt: workflow.prompt,
      outputCandidates: workflow.outputCandidates,
      selectedOutputIds: getSelectedWorkflowOutputIds(workflow),
    });
    const promptWithControls = applyComfyWorkflowControls(
      promptWithSelectedOutputs,
      promptControls,
      workflow.id,
    );
    const promptWithRootBindings =
      inputContext === 'props'
        ? applyComfyRootBindings(promptWithControls, node, sceneNode, workflow)
        : promptWithControls;

    return applyComfyViewportPromptRegionBindings(promptWithRootBindings, node, workflow, {
      inputContext,
      regionId: regionId ?? undefined,
    });
  };

  const queueWorkflowPrompt = async ({
    workflow,
    clientId,
    promptId,
    promptWithViewportBindings,
    signal,
    inputContext,
    selectedRegion,
  }: {
    workflow: ComfyWorkflow;
    clientId: string;
    promptId: string;
    promptWithViewportBindings: Record<string, unknown>;
    signal: AbortSignal;
    inputContext: ComfyRunInputContext;
    selectedRegion: ViewportPromptRegion | null;
  }): Promise<{
    queued: Awaited<ReturnType<typeof queueComfyPrompt>>;
    inputImages: ComfyResolvedInputUpload[];
  }> =>
    queueComfyPromptWithInputRecovery({
      initialPromptId: promptId,
      uploadInputs: (options) =>
        uploadConnectedWorkflowInputs(workflow, signal, inputContext, selectedRegion, options),
      createPrompt: (inputImages) =>
        inputImages.length > 0
          ? applyComfyWorkflowInputImages(promptWithViewportBindings, inputImages)
          : promptWithViewportBindings,
      queuePrompt: (prompt, activePromptId) =>
        queueComfyPrompt({
          endpoint,
          prompt,
          clientId,
          promptId: activePromptId,
          extraData: createComfyPromptExtraData(workflow, prompt),
        }),
      invalidateCachedImage: (imageName) => {
        inputUploadCacheRef.current.deleteByImageName(endpoint, imageName);
      },
      cancelAcceptedPrompt: (acceptedPromptId) => cancelComfyPrompt(acceptedPromptId, endpoint),
      createPromptId: createComfyPromptId,
    });

  const postProcessGeneratedOutputs = async (
    outputs: GeneratedOutput[],
    input: ComfyAlignmentInput | null | undefined,
  ): Promise<GeneratedOutput[]> => {
    if (!input) return outputs;

    const alignedOutputs =
      node.autoAlignOutputs === false
        ? outputs
        : await Promise.all(
            outputs.map(async (output) => {
              try {
                return (
                  (await alignComfyOutputToInput({
                    node,
                    output,
                    sceneNode,
                    inputBlob: input.blob,
                    inputNameHint: input.nameHint,
                    reference: input.reference,
                    options: node.alignmentOptions,
                  })) ?? output
                );
              } catch {
                return output;
              }
            }),
          );

    if (!alignedOutputs.some((output) => !isComfy3DGeneratedOutput(output))) {
      return alignedOutputs;
    }

    try {
      const image = await decodeRasterImageSource(input.blob, {
        nameHint: input.nameHint,
        label: 'Comfy alignment reference image',
      });
      const referenceWidth = image.width;
      const referenceHeight = image.height;
      image.close();
      const referenceAssetId = await saveAsset(input.blob);

      return alignedOutputs.map((output) =>
        isComfy3DGeneratedOutput(output)
          ? output
          : {
              ...output,
              differenceMask: createComfyDifferenceMask({
                referenceAssetId,
                referenceWidth,
                referenceHeight,
                referenceTransform: input.reference?.transform,
              }),
            },
      );
    } catch {
      return alignedOutputs;
    }
  };

  const handleAlignSelectedOutputToInput = async () => {
    if (!selectedOutputForProps) return null;
    const alignmentInput = selectedOutputForProps.promptId
      ? alignmentInputsByPromptIdRef.current.get(selectedOutputForProps.promptId)
      : null;
    let resolvedAlignmentInput =
      alignmentInput ??
      (selectedOutputForProps.promptId === node.lastPromptId
        ? lastAlignmentInputRef.current
        : null);
    if (!resolvedAlignmentInput) {
      const outputWorkflow =
        node.workflows.find((workflow) => workflow.id === selectedOutputForProps.workflowId) ??
        selectedWorkflow;
      const liveRegion = selectedOutputForProps.regionId
        ? ((node.viewportPromptRegions ?? []).find(
            (region) => region.id === selectedOutputForProps.regionId,
          ) ?? null)
        : null;
      const selectedRegion =
        liveRegion ??
        (selectedOutputForProps.regionId && selectedOutputForProps.regionRect
          ? {
              id: selectedOutputForProps.regionId,
              rect: selectedOutputForProps.regionRect,
              prompt: '',
              bindings: [],
            }
          : null);
      const inputContext: ComfyRunInputContext = selectedRegion ? 'viewportTool' : 'props';
      if (outputWorkflow) {
        for (const candidate of getSelectedComfyWorkflowInputCandidates(outputWorkflow)) {
          if (
            !shouldUseComfyWorkflowInputSource({
              node,
              workflow: outputWorkflow,
              candidate,
              inputContext,
              regionId: selectedRegion?.id,
            })
          ) {
            continue;
          }
          const resolvedInput = await resolveWorkflowInputImage({
            workflow: outputWorkflow,
            candidate,
            selectedRegion,
          });
          if (resolvedInput) {
            resolvedAlignmentInput = {
              blob: resolvedInput.blob,
              nameHint: resolvedInput.sourceName,
              reference: resolvedInput.alignmentReference,
            };
            break;
          }
        }
      }
    }
    if (!resolvedAlignmentInput) {
      throw new Error('Connect or load an image-to-image input before aligning this output.');
    }
    const alignedOutput = await alignComfyOutputToInput({
      node,
      output: selectedOutputForProps,
      sceneNode,
      inputBlob: resolvedAlignmentInput.blob,
      inputNameHint: resolvedAlignmentInput.nameHint,
      reference: resolvedAlignmentInput.reference,
      options: node.alignmentOptions,
    });
    return alignedOutput?.transform ?? null;
  };

  const handleRunWorkflow = async (
    runCount = 1,
    inputContext: ComfyRunInputContext = 'props',
    requestedRegionId?: string,
    executionContext?: NodeExecutionContext,
  ) => {
    const requestedWorkflow = executionContext?.workflowId
      ? (node.workflows.find((workflow) => workflow.id === executionContext.workflowId) ?? null)
      : selectedWorkflow;
    if (!requestedWorkflow) {
      setRunState('error');
      setNodeError('Import and select a ComfyUI workflow before running.');
      return;
    }

    const executionWorkflowControls = executionContext?.controlValueOverrides
      ? workflowControls.map((control) => {
          const override = executionContext.controlValueOverrides?.[control.id];
          return override === undefined
            ? control
            : { ...control, value: override, runMode: 'fixed' as const };
        })
      : workflowControls;

    let workflowForRun: ComfyWorkflow;
    try {
      workflowForRun = await refreshComfyWorkflowFromSource(endpoint, requestedWorkflow);
      if (workflowForRun !== requestedWorkflow) {
        updateNode(
          node.id,
          {
            workflows: node.workflows.map((workflow) =>
              workflow.id === workflowForRun.id ? workflowForRun : workflow,
            ),
          },
          false,
        );
      }
    } catch (error) {
      setRunState('error');
      setNodeError(
        error instanceof Error
          ? `Could not refresh the ComfyUI workflow: ${error.message}`
          : 'Could not refresh the ComfyUI workflow.',
      );
      return;
    }

    const missingOptions = getMissingWorkflowControlOptions(
      executionWorkflowControls,
      workflowForRun,
    );
    if (missingOptions.length > 0) {
      const firstMissing = missingOptions[0];
      setRunState('error');
      setNodeError(
        `${firstMissing.control.label} uses unavailable value "${firstMissing.value}". ${firstMissing.guidance}`,
      );
      return;
    }

    const selectedOutputCandidates = getSelectedWorkflowOutputCandidates(workflowForRun);
    if (workflowForRun.sourceGraph && (workflowForRun.outputCandidates ?? []).length === 0) {
      setRunState('error');
      setNodeError(
        'Expose an IMAGE, MESH, SPLAT, or FILE_3D output at the top level of the ComfyUI workflow before running.',
      );
      return;
    }
    if (
      (workflowForRun.outputCandidates ?? []).length > 0 &&
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
      inputContext === 'viewportTool'
        ? requestedRegionId
          ? ((node.viewportPromptRegions ?? []).find(
              (region) => region.id === requestedRegionId && region.visible !== false,
            ) ?? null)
          : getExplicitSelectedComfyViewportPromptRegion(node)
        : null;
    if (inputContext === 'viewportTool' && !selectedRunRegion) {
      setRunState('error');
      setNodeError('Select a Comfy region before running from the viewport.');
      return;
    }
    const viewportRect = selectedRunRegion?.rect ?? null;
    const selectedRunRegionId = selectedRunRegion?.id ?? null;
    const batchId = createComfyBatchId();
    const getRunSource = (runIndex: number, totalRuns = runCount, promptId?: string | null) => ({
      ...getComfyBatchSource(
        originProjectId,
        node.id,
        workflowForRun.id,
        batchId,
        runIndex,
        totalRuns,
      ),
      ...(originBranchId ? { branchId: originBranchId } : {}),
      ...(originHistoryEntryId ? { historyId: originHistoryEntryId } : {}),
      ...(promptId ? { promptId } : {}),
      ...(executionContext?.generationGroupId
        ? { generationGroupId: executionContext.generationGroupId }
        : {}),
      comfyEndpoint: endpoint,
      outputNodeIds: selectedOutputNodeIds,
      comfyInputContext: inputContext,
      ...(viewportRect ? { comfyViewportRect: viewportRect } : {}),
      ...(selectedRunRegionId ? { comfyRegionId: selectedRunRegionId } : {}),
    });

    type RunJobState = {
      id: string;
      runIndex: number;
      promptId: string;
      abortController: AbortController | null;
      cancelled: boolean;
      finished: boolean;
      unregisterCancel: (() => void) | null;
    };

    const runJobs: RunJobState[] = Array.from({ length: runCount }, (_, index) => {
      const runIndex = index + 1;
      const promptId = createComfyPromptId();
      return {
        id: startBackgroundJob({
          type: 'comfy',
          title:
            runCount > 1
              ? `${workflowForRun.name} · Run ${runIndex}/${runCount}`
              : workflowForRun.name,
          subtitle: node.name,
          detail: formatRunProgressLabel('Queueing prompt', runIndex, runCount),
          status: 'queued',
          progress: 8,
          indeterminate: true,
          cancellable: true,
          source: getRunSource(runIndex, runCount, promptId),
        }),
        runIndex,
        promptId,
        abortController: null,
        cancelled: false,
        finished: false,
        unregisterCancel: null,
      };
    });

    const finishRunJobOnce = (
      runJob: RunJobState,
      updates: Parameters<typeof finishBackgroundJob>[1],
    ) => {
      if (runJob.finished) return;
      runJob.finished = true;
      runJob.unregisterCancel?.();
      runJob.unregisterCancel = null;
      finishBackgroundJob(runJob.id, updates);
    };

    const cancelRunJob = (runJob: RunJobState) => {
      runJob.cancelled = true;
      void cancelComfyPrompt(runJob.promptId, endpoint).catch(() => {});
      if (runJob.abortController) {
        runJob.abortController.abort();
        return;
      }
      finishRunJobOnce(runJob, {
        status: 'cancelled',
        detail: 'Queued run cancelled',
        progress: 0,
        indeterminate: false,
        source: getRunSource(runJob.runIndex, runCount, runJob.promptId),
      });
    };

    runJobs.forEach((runJob) => {
      runJob.unregisterCancel = registerBackgroundJobCancelHandler(runJob.id, () =>
        cancelRunJob(runJob),
      );
    });

    setNodeError(null);
    let currentWorkflowControls = executionWorkflowControls;

    if (runCount > 1) {
      const queuedRuns: Array<{
        job: RunJobState;
        runIndex: number;
        promptId: string;
        clientId: string;
        promptSummary?: string;
        submittedPrompt: Record<string, unknown>;
        alignmentInput?: ComfyAlignmentInput;
      }> = [];
      let completedRunCount = 0;

      try {
        for (const runJob of runJobs) {
          const { runIndex, promptId } = runJob;
          const jobId = runJob.id;
          if (runJob.cancelled) continue;

          const abortController = new AbortController();
          runJob.abortController = abortController;
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
                ...getRunSource(runIndex, runCount, promptId),
                completedCount: completedRunCount,
              },
            });

            const clientId = defaultComfyRunCoordinator.createClientId();
            await triggerRunRollAnimation(currentWorkflowControls, workflowForRun.id);
            const preparedControls = prepareComfyWorkflowControlsForRun(
              currentWorkflowControls,
              workflowForRun.id,
            );
            currentWorkflowControls = preparedControls.nextControls;
            if (preparedControls.changed) {
              updateNode(node.id, { workflowControls: preparedControls.nextControls }, false);
            }

            const promptWithViewportBindings = createWorkflowPromptForRun({
              workflow: workflowForRun,
              promptControls: preparedControls.promptControls,
              inputContext,
              regionId: selectedRunRegionId,
            });
            const { queued, inputImages } = await queueWorkflowPrompt({
              workflow: workflowForRun,
              clientId,
              promptId,
              promptWithViewportBindings,
              signal: abortController.signal,
              inputContext,
              selectedRegion: selectedRunRegion,
            });
            const alignmentInput = inputImages[0]
              ? {
                  blob: inputImages[0].alignmentBlob,
                  nameHint: inputImages[0].alignmentName,
                  reference: inputImages[0].alignmentReference,
                }
              : undefined;
            if (alignmentInput) {
              alignmentInputsByPromptIdRef.current.set(queued.promptId, alignmentInput);
            }

            queuedRuns.push({
              job: runJob,
              runIndex,
              promptId: queued.promptId,
              clientId,
              promptSummary: getOutputPromptSummary(
                preparedControls.promptControls,
                workflowForRun.id,
              ),
              submittedPrompt: promptWithViewportBindings,
              alignmentInput,
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
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              setRunState('idle');
              setStatusMessage(
                formatRunStatusMessage('ComfyUI run cancelled.', runIndex, runCount),
              );
              setRunProgress(null);
              finishRunJobOnce(runJob, {
                status: 'cancelled',
                detail: formatRunProgressLabel('Cancelled', runIndex, runCount),
                progress: getRunProgressPercent(runProgress),
                indeterminate: false,
                source: getRunSource(runIndex, runCount, promptId),
              });
              continue;
            }

            const message = error instanceof Error ? error.message : 'ComfyUI workflow failed.';
            setRunState('error');
            setStatusMessage('');
            setRunProgress(null);
            setNodeError(message);
            finishRunJobOnce(runJob, {
              status: 'error',
              detail: message,
              error: message,
              progress: 100,
              source: getRunSource(runIndex, runCount, promptId),
            });
            return;
          } finally {
            if (runJob.abortController === abortController) runJob.abortController = null;
            if (abortRef.current === abortController) {
              abortRef.current = null;
            }
          }
        }

        for (const queuedRun of queuedRuns) {
          if (queuedRun.job.cancelled) continue;

          const {
            job,
            runIndex,
            promptId,
            clientId,
            promptSummary,
            submittedPrompt,
            alignmentInput,
          } = queuedRun;
          const jobId = job.id;
          const abortController = new AbortController();
          job.abortController = abortController;
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
              workflow: workflowForRun,
              promptId,
              promptSummary,
              generationGroupId: executionContext?.generationGroupId,
              submittedPrompt,
              signal: abortController.signal,
            });
            let generatedOutputsWithRegion = selectedRunRegionId
              ? generatedOutputs.map((o) => ({ ...o, regionId: selectedRunRegionId }))
              : generatedOutputs;
            generatedOutputsWithRegion = await postProcessGeneratedOutputs(
              generatedOutputsWithRegion,
              alignmentInput,
            );
            const activeGeneratedOutput =
              getComfyMediaOutput(generatedOutputsWithRegion) ?? generatedOutputsWithRegion[0];
            if (!activeGeneratedOutput) {
              throw new Error('ComfyUI completed the workflow, but no output file was found.');
            }

            generatedOutputsRef.current = [
              ...generatedOutputsRef.current,
              ...generatedOutputsWithRegion,
            ];
            const transform = isComfy3DGeneratedOutput(activeGeneratedOutput)
              ? undefined
              : getComfyOutputTransform({ node, output: activeGeneratedOutput, sceneNode });

            const applyTarget = await applyComfyNodeRunResult({
              projectId: originProjectId,
              branchId: originBranchId,
              nodeId: node.id,
              updates: {
                ...getComfyOutputActivationUpdates(activeGeneratedOutput),
                ...(transform ? { transform } : {}),
                selectedViewportPromptRegionId: activeGeneratedOutput.regionId,
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
            finishRunJobOnce(job, {
              status: 'complete',
              detail: completionDetail,
              progress: 100,
              source: {
                ...getRunSource(runIndex, runCount, promptId),
                completedCount: completedRunCount,
              },
            });
            setLocalError(null);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              setRunState('idle');
              setStatusMessage(
                formatRunStatusMessage('ComfyUI run cancelled.', runIndex, runCount),
              );
              setRunProgress(null);
              finishRunJobOnce(job, {
                status: 'cancelled',
                detail: formatRunProgressLabel('Cancelled', runIndex, runCount),
                progress: getRunProgressPercent(runProgress),
                indeterminate: false,
                source: {
                  ...getRunSource(runIndex, runCount, promptId),
                  completedCount: completedRunCount,
                },
              });
              continue;
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
            finishRunJobOnce(job, {
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
            if (job.abortController === abortController) job.abortController = null;
            if (abortRef.current === abortController) {
              abortRef.current = null;
            }
          }
        }
      } finally {
        runJobs.forEach((runJob) => {
          runJob.unregisterCancel?.();
          runJob.unregisterCancel = null;
        });
      }

      return;
    }

    try {
      await defaultComfyRunCoordinator.enqueue(endpointQueueKey, async () => {
        for (const runJob of runJobs) {
          const { runIndex, promptId } = runJob;
          const jobId = runJob.id;
          if (runJob.cancelled) return;
          const abortController = new AbortController();
          runJob.abortController = abortController;
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
            source: getRunSource(runIndex, runCount, promptId),
          });

          const clientId = defaultComfyRunCoordinator.createClientId();
          let queuedPromptId: string | null = promptId;
          await triggerRunRollAnimation(currentWorkflowControls, workflowForRun.id);
          const preparedControls = prepareComfyWorkflowControlsForRun(
            currentWorkflowControls,
            workflowForRun.id,
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
            const promptWithViewportBindings = createWorkflowPromptForRun({
              workflow: workflowForRun,
              promptControls: preparedControls.promptControls,
              inputContext,
              regionId: selectedRunRegionId,
            });
            const { queued, inputImages } = await queueWorkflowPrompt({
              workflow: workflowForRun,
              clientId,
              promptId,
              promptWithViewportBindings,
              signal: abortController.signal,
              inputContext,
              selectedRegion: selectedRunRegion,
            });
            queuedPromptId = queued.promptId;
            const alignmentInput = inputImages[0]
              ? {
                  blob: inputImages[0].alignmentBlob,
                  nameHint: inputImages[0].alignmentName,
                  reference: inputImages[0].alignmentReference,
                }
              : undefined;
            if (alignmentInput) {
              alignmentInputsByPromptIdRef.current.set(queued.promptId, alignmentInput);
            }
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
              workflow: workflowForRun,
              promptId: queued.promptId,
              promptSummary: getOutputPromptSummary(currentWorkflowControls, workflowForRun.id),
              generationGroupId: executionContext?.generationGroupId,
              submittedPrompt: promptWithViewportBindings,
              signal: abortController.signal,
            });
            let generatedOutputsWithRegion = selectedRunRegionId
              ? generatedOutputs.map((o) => ({ ...o, regionId: selectedRunRegionId }))
              : generatedOutputs;
            generatedOutputsWithRegion = await postProcessGeneratedOutputs(
              generatedOutputsWithRegion,
              alignmentInput,
            );
            const activeGeneratedOutput =
              getComfyMediaOutput(generatedOutputsWithRegion) ?? generatedOutputsWithRegion[0];
            if (!activeGeneratedOutput) {
              throw new Error('ComfyUI completed the workflow, but no output file was found.');
            }
            generatedOutputsRef.current = [
              ...generatedOutputsRef.current,
              ...generatedOutputsWithRegion,
            ];
            const transform = isComfy3DGeneratedOutput(activeGeneratedOutput)
              ? undefined
              : getComfyOutputTransform({ node, output: activeGeneratedOutput, sceneNode });

            const applyTarget = await applyComfyNodeRunResult({
              projectId: originProjectId,
              branchId: originBranchId,
              nodeId: node.id,
              updates: {
                ...getComfyOutputActivationUpdates(activeGeneratedOutput),
                ...(transform ? { transform } : {}),
                selectedViewportPromptRegionId: activeGeneratedOutput.regionId,
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
            finishRunJobOnce(runJob, {
              status: 'complete',
              detail: completionDetail,
              progress: 100,
              source: {
                ...getRunSource(runIndex, runCount, queued.promptId),
                completedCount: runIndex,
              },
            });
            setLocalError(null);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              setRunState('idle');
              setStatusMessage(
                formatRunStatusMessage('ComfyUI run cancelled.', runIndex, runCount),
              );
              setRunProgress(null);
              finishRunJobOnce(runJob, {
                status: 'cancelled',
                detail: formatRunProgressLabel('Cancelled', runIndex, runCount),
                progress: getRunProgressPercent(runProgress),
                indeterminate: false,
                source: getRunSource(runIndex, runCount, queuedPromptId),
              });
              return;
            }

            const message = error instanceof Error ? error.message : 'ComfyUI workflow failed.';
            setRunState('error');
            setStatusMessage('');
            setRunProgress(null);
            setNodeError(message);
            finishRunJobOnce(runJob, {
              status: 'error',
              detail: message,
              error: message,
              progress: 100,
              source: getRunSource(runIndex, runCount, queuedPromptId),
            });
            return;
          } finally {
            unsubscribeProgress();
            if (runJob.abortController === abortController) runJob.abortController = null;
            if (abortRef.current === abortController) {
              abortRef.current = null;
            }
          }
        }
      });
    } finally {
      runJobs.forEach((runJob) => {
        runJob.unregisterCancel?.();
        runJob.unregisterCancel = null;
      });
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
    if (isRunActionDisabled && !context?.workflowId) return;
    const requestedRunCount =
      typeof context?.runCount === 'number' && Number.isFinite(context.runCount)
        ? Math.max(1, Math.floor(context.runCount))
        : 1;
    void handleRunWorkflow(
      requestedRunCount,
      getRunInputContext(context),
      context?.regionId,
      context,
    );
  });
  const handleRunSingleWorkflow = () => {
    void handleRunWorkflow(1, inspectorInputContext);
  };
  const handleWorkflowPropsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isComfyRunShortcut(event)) return;
    if (!selectedWorkflow || hasNoSelectedWorkflowOutputs) return;

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
    if (activeNodeComfyJobs.length > 0) {
      activeNodeComfyJobs.forEach((job) => requestBackgroundJobCancel(job.id));
    } else if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  if (headless) return null;

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
            onAlignToInput={handleAlignSelectedOutputToInput}
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
              onToggleWorkflowField={handleToggleWorkflowField}
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
                selectedWorkflowInputIdSet={selectedWorkflowInputIdSet}
                connectedWorkflowInputs={connectedWorkflowInputs}
                onToggleWorkflowInputCandidate={handleToggleWorkflowInputCandidate}
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
        outputGalleryLabel={selectedRegionForProps ? 'Region outputs' : 'Outputs'}
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
        onCancelPendingSlot={requestBackgroundJobCancel}
        onClearInspectorLog={clearInspectorLog}
      />
    </div>
  );
}
