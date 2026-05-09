import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { getAsset, saveAsset } from '@/state/assetStorage';
import { readImageDimensions } from '@/state/editor/utils';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
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
  applyComfyWorkflowControls,
  createComfyWorkflowControl,
  getComfyControlKey,
  getComfyWorkflowControlRunMode,
  getComfyWorkflowControlCandidates,
  isPromptLikeComfyTextInput,
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
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import {
  isBackgroundJobActive,
  registerBackgroundJobCancelHandler,
} from '@/state/editor/services/backgroundJobs';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import { isImageFileLike } from '@/utils/mediaFiles';
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
import { ComfyWorkflowPicker } from './components/ComfyWorkflowPicker';
import { ComfyWorkflowControlsSection } from './components/ComfyWorkflowControlsSection';
import { ComfyWorkflowInputList } from './components/ComfyWorkflowInputList';
import { ComfyWorkflowOutputPicker } from './components/ComfyWorkflowOutputPicker';
import { ComfyExecuteSection } from './components/ComfyExecuteSection';

type RunState = 'idle' | 'queueing' | 'running' | 'downloading' | 'complete' | 'error';
type WorkflowBrowserState = 'idle' | 'loading' | 'importing' | 'error';
type WorkflowEmptyMode = 'choice' | 'paste';
const DICE_ROLL_ANIMATION_LEAD_MS = 180;

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

const isRunShortcut = (event: React.KeyboardEvent<HTMLElement>): boolean =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey;

const ComfyAdjustmentsPanel: React.FC<{ node: ComfyNode }> = ({ node }) => {
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
  useNodeExecutionHandler(node.id, () => {
    if (isRunActionDisabled) return;
    void handleRunWorkflow(1);
  });
  const handleRunSingleWorkflow = () => {
    setIsRunMenuOpen(false);
    void handleRunWorkflow(1);
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
      void handleRunWorkflow();
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
          controlCandidates={controlCandidates}
          activeWorkflowControls={activeWorkflowControls}
          activeMissingControlOptions={activeMissingControlOptions}
          missingModelSizeStatuses={missingModelSizeStatuses}
          missingModelDetailsVisible={comfyMissingModelDetailsVisible}
          runRollTokens={runRollTokens}
          promptApplyNoticeId={promptApplyNotice?.id ?? null}
          promptApplyNoticeFieldId={promptApplyNotice?.fieldId ?? null}
          imagePromptRoute={imagePromptRoute}
          imagePromptRouteError={imagePromptRouteError}
          onOpenWorkflowControlBuilder={handleOpenWorkflowControlBuilder}
          onCancelWorkflowControlBuilder={handleCancelWorkflowControlBuilder}
          onApplyWorkflowControlBuilder={handleApplyWorkflowControlBuilder}
          onToggleWorkflowControlCandidate={handleToggleWorkflowControlCandidate}
          onToggleMissingModelDetails={handleToggleMissingModelDetails}
          onDownloadMissingModel={handleDownloadMissingModel}
          onCopyMissingModelPath={handleCopyMissingModelPath}
          onResetWorkflowControl={handleResetWorkflowControl}
          onUpdateWorkflowControl={handleUpdateWorkflowControl}
          onStartPromptEnhancementChat={(controlId, promptRoute) =>
            startComfyPromptEnhancementChat(node.id, controlId, promptRoute)
          }
          advancedControlId={advancedControlId}
          onAdvancedControlIdChange={setAdvancedControlId}
          onWorkflowPropsKeyDown={handleWorkflowPropsKeyDown}
        />

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
            selectedWorkflowOutputIds={selectedWorkflowOutputIds}
            selectedWorkflowOutputIdSet={selectedWorkflowOutputIdSet}
            hasNoSelectedWorkflowOutputs={hasNoSelectedWorkflowOutputs}
            onSelectAllWorkflowOutputs={handleSelectAllWorkflowOutputs}
            onToggleWorkflowOutputCandidate={handleToggleWorkflowOutputCandidate}
          />
        )}
      </div>

      <ComfyExecuteSection
        node={node}
        outputApplyNoticeId={outputApplyNotice?.id}
        pendingGeneratedOutputSlots={pendingGeneratedOutputSlots}
        recentGeneratedOutputs={recentGeneratedOutputs}
        isRunActionDisabled={isRunActionDisabled}
        isRunMenuOpen={isRunMenuOpen}
        runShortcutHint={runShortcutHint}
        localError={localError}
        hasRunProgress={hasRunProgress}
        inspectorProgressLabel={inspectorProgressLabel}
        inspectorProgressPercent={inspectorProgressPercent}
        inspectorProgressIndeterminate={inspectorProgressIndeterminate}
        inspectorLogMessage={inspectorLogMessage}
        onRunSingleWorkflow={handleRunSingleWorkflow}
        onRunBatchWorkflow={(count) => void handleRunWorkflow(count)}
        onRunMenuOpenChange={setIsRunMenuOpen}
        onActivateGeneratedOutput={handleActivateGeneratedOutput}
        onOpenGalleryView={openGalleryView}
        onCancelRun={handleCancelRun}
        onClearInspectorLog={clearInspectorLog}
      />
    </div>
  );
};

export default ComfyAdjustmentsPanel;
