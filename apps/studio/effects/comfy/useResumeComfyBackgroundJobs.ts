import { useEffect, useMemo, useRef } from 'react';
import { AnyNode, ComfyNode, ComfyWorkflow, GeneratedOutput, NodeType } from '@blackboard/types';
import { saveAsset } from '@/state/assetStorage';
import { readImageDimensions } from '@/state/editor/utils';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { getOrderedNodesFromFlow, getRootFlow } from '@/state/editor/flowModel';
import { loadProjectState } from '@/state/persist';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import {
  fetchComfyImage,
  fetchComfyPromptStatus,
  normalizeComfyEndpoint,
  waitForComfyOutputImages,
  type ComfyOutputImage,
} from '@/services/comfy/client';
import { isBackgroundJobActive, type BackgroundJob } from '@/state/editor/services/backgroundJobs';

type ComfyJobContext = {
  projectId: string | null;
  node: ComfyNode;
  sceneNode: AnyNode | null;
  workflow: ComfyWorkflow | null;
};

const isComfyNode = (node: AnyNode | undefined | null): node is ComfyNode =>
  node?.type === NodeType.COMFY;

const getSelectedWorkflowOutputIds = (workflow: ComfyWorkflow): string[] => {
  const candidateIds = new Set((workflow.outputCandidates ?? []).map((candidate) => candidate.id));
  if (workflow.selectedOutputIds) {
    return workflow.selectedOutputIds.filter((id) => candidateIds.has(id));
  }
  const firstCandidate = workflow.outputCandidates?.[0];
  return firstCandidate ? [firstCandidate.id] : [];
};

const getSelectedOutputNodeIds = (
  workflow: ComfyWorkflow | null,
  sourceNodeIds: string[] | undefined,
): string[] | undefined => {
  if (sourceNodeIds?.length) return sourceNodeIds;
  if (!workflow) return undefined;

  const selectedIds = new Set(getSelectedWorkflowOutputIds(workflow));
  const outputNodeIds = (workflow.outputCandidates ?? [])
    .filter((candidate) => selectedIds.has(candidate.id))
    .map((candidate) => candidate.previewNodeId);

  return outputNodeIds.length > 0 ? outputNodeIds : undefined;
};

const getComfyJobContext = async ({
  job,
  currentProjectId,
  currentNodes,
}: {
  job: BackgroundJob;
  currentProjectId: string | null;
  currentNodes: AnyNode[];
}): Promise<ComfyJobContext | null> => {
  const nodeId = job.source?.nodeId;
  if (!nodeId) return null;

  if (!job.source?.projectId || job.source.projectId === currentProjectId) {
    const node = currentNodes.find((candidate) => candidate.id === nodeId);
    if (!isComfyNode(node)) return null;

    return {
      projectId: currentProjectId,
      node,
      sceneNode: currentNodes.find((candidate) => candidate.type === NodeType.SCENE) ?? null,
      workflow: node.workflows.find((workflow) => workflow.id === job.source?.workflowId) ?? null,
    };
  }

  const projectState = await loadProjectState(job.source.projectId);
  if (!projectState) return null;

  const rootFlow = getRootFlow(projectState.flows || {}, projectState.rootFlowId || null);
  const nodes = getOrderedNodesFromFlow(rootFlow);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!isComfyNode(node)) return null;

  return {
    projectId: job.source.projectId,
    node,
    sceneNode: nodes.find((candidate) => candidate.type === NodeType.SCENE) ?? null,
    workflow: node.workflows.find((workflow) => workflow.id === job.source?.workflowId) ?? null,
  };
};

const getRecoveredOutputId = ({
  promptId,
  image,
  outputIndex,
}: {
  promptId: string;
  image: ComfyOutputImage;
  outputIndex: number;
}): string => {
  const imageKey = [image.nodeId, image.filename, image.subfolder, image.type]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('_')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .slice(0, 96);
  return `comfy_output_${promptId}_${imageKey || outputIndex}`;
};

const downloadGeneratedOutputs = async ({
  endpoint,
  images,
  workflow,
  promptId,
  signal,
}: {
  endpoint: string;
  images: ComfyOutputImage[];
  workflow: ComfyWorkflow | null;
  promptId: string;
  signal?: AbortSignal;
}): Promise<GeneratedOutput[]> => {
  const createdAt = Date.now();
  const outputCandidateByPreviewId = new Map(
    (workflow?.outputCandidates ?? []).map((candidate) => [candidate.previewNodeId, candidate]),
  );

  return Promise.all(
    images.map(async (image, outputIndex): Promise<GeneratedOutput> => {
      const blob = await fetchComfyImage({ endpoint, image, signal });
      const file = new File([blob], image.filename, { type: blob.type || 'image/png' });
      const { width, height } = await readImageDimensions(file);
      const assetId = await saveAsset(file);
      const outputCandidate = image.nodeId ? outputCandidateByPreviewId.get(image.nodeId) : null;

      return {
        id: getRecoveredOutputId({ promptId, image, outputIndex }),
        src: assetId,
        width,
        height,
        createdAt: createdAt + outputIndex,
        label: outputCandidate ? `${outputCandidate.label} · ${image.filename}` : image.filename,
        promptId,
        workflowId: workflow?.id,
        workflowName: workflow?.name,
      };
    }),
  );
};

export const useResumeComfyBackgroundJobs = () => {
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const currentProjectId = useEditorSelector((state) => state.projectId);
  const currentNodes = useEditorSelector((state) => state.nodes);
  const { comfyEndpoint } = usePreferences();
  const { updateBackgroundJob, finishBackgroundJob, applyComfyNodeRunResult } = useEditorActions();
  const resumedJobIdsRef = useRef<Set<string>>(new Set());
  const resumeControllersRef = useRef<Map<string, AbortController>>(new Map());

  const resumableJobs = useMemo(
    () =>
      backgroundJobs.filter(
        (job) =>
          job.type === 'comfy' &&
          isBackgroundJobActive(job) &&
          !!job.source?.promptId &&
          job.source.restoredFromStorage === true,
      ),
    [backgroundJobs],
  );

  useEffect(() => {
    resumableJobs.forEach((job) => {
      const promptId = job.source?.promptId;
      if (!promptId || resumedJobIdsRef.current.has(job.id)) return;

      resumedJobIdsRef.current.add(job.id);
      const controller = new AbortController();
      resumeControllersRef.current.set(job.id, controller);

      void (async () => {
        const endpoint = normalizeComfyEndpoint(job.source?.comfyEndpoint ?? comfyEndpoint);
        const baseSource = {
          ...job.source,
          comfyEndpoint: endpoint,
          promptId,
        };

        try {
          updateBackgroundJob(job.id, {
            status: 'running',
            detail: 'Checking ComfyUI prompt',
            progress: job.progress ?? 35,
            indeterminate: true,
            cancellable: false,
            source: baseSource,
          });

          const context = await getComfyJobContext({ job, currentProjectId, currentNodes });
          if (!context) {
            finishBackgroundJob(job.id, {
              status: 'error',
              detail: 'Comfy output finished, but its node was not found.',
              error: 'Comfy node missing after reload',
              progress: 100,
              source: baseSource,
            });
            return;
          }

          const outputNodeIds = getSelectedOutputNodeIds(
            context.workflow,
            job.source?.outputNodeIds,
          );
          const status = await fetchComfyPromptStatus({
            endpoint,
            promptId,
            outputNodeIds,
            signal: controller.signal,
          });

          if (status.status === 'missing') {
            finishBackgroundJob(job.id, {
              status: 'error',
              detail: 'ComfyUI no longer has this prompt in queue or history.',
              error: 'Prompt not found after reload',
              progress: 100,
              source: baseSource,
            });
            return;
          }

          if (status.status === 'error') {
            finishBackgroundJob(job.id, {
              status: 'error',
              detail: status.message,
              error: status.message,
              progress: 100,
              source: baseSource,
            });
            return;
          }

          updateBackgroundJob(job.id, {
            status: 'running',
            detail:
              status.status === 'queued'
                ? 'Waiting in ComfyUI queue'
                : 'Waiting for ComfyUI output',
            progress: status.status === 'queued' ? 15 : Math.max(job.progress ?? 35, 35),
            indeterminate: true,
            cancellable: false,
            source: baseSource,
          });

          const outputImages =
            status.status === 'success'
              ? status.images
              : await waitForComfyOutputImages({
                  endpoint,
                  promptId,
                  outputNodeIds,
                  signal: controller.signal,
                  onPoll: (attempt) => {
                    updateBackgroundJob(job.id, {
                      status: 'running',
                      detail: `Waiting for ComfyUI output. History check ${attempt}.`,
                      progress: 35,
                      indeterminate: true,
                      cancellable: false,
                      source: baseSource,
                    });
                  },
                });

          updateBackgroundJob(job.id, {
            status: 'running',
            detail: 'Downloading ComfyUI output',
            progress: 92,
            indeterminate: true,
            cancellable: false,
            source: baseSource,
          });

          const generatedOutputs = await downloadGeneratedOutputs({
            endpoint,
            images: outputImages,
            workflow: context.workflow,
            promptId,
            signal: controller.signal,
          });
          const activeGeneratedOutput = generatedOutputs[0];
          if (!activeGeneratedOutput) {
            throw new Error('ComfyUI completed the workflow, but no output image was found.');
          }

          const nextGeneratedOutputs = [
            ...(context.node.generatedOutputs ?? []),
            ...generatedOutputs,
          ];
          const transform =
            context.sceneNode && 'width' in context.sceneNode && 'height' in context.sceneNode
              ? {
                  ...context.node.transform,
                  ...calculateTransformForFitMode(
                    { width: activeGeneratedOutput.width, height: activeGeneratedOutput.height },
                    { width: context.sceneNode.width, height: context.sceneNode.height },
                    context.node.transform.fitMode,
                  ),
                  x: 0,
                  y: 0,
                }
              : context.node.transform;
          const applyTarget = await applyComfyNodeRunResult({
            projectId: context.projectId,
            nodeId: context.node.id,
            updates: {
              src: activeGeneratedOutput.src,
              width: activeGeneratedOutput.width,
              height: activeGeneratedOutput.height,
              transform,
              generatedOutputs: nextGeneratedOutputs,
              activeGeneratedOutputId: activeGeneratedOutput.id,
              lastPromptId: promptId,
              lastRunAt: activeGeneratedOutput.createdAt,
              lastError: undefined,
            },
            withHistory: true,
            historyLabel: `Run ${context.node.name} Comfy Workflow`,
            noticeLabel: `${context.node.name} output ready`,
            galleryNoticeLabel: `${context.node.name} output added to Gallery`,
            expectedHistoryId: job.source?.historyId,
          });

          finishBackgroundJob(job.id, {
            status: 'complete',
            detail:
              applyTarget === 'gallery'
                ? `${context.node.name} changed meanwhile, so the output was added to Gallery`
                : `${context.node.name} output ready`,
            progress: 100,
            source: baseSource,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          const message =
            error instanceof Error ? error.message : 'Could not finish the ComfyUI job.';
          finishBackgroundJob(job.id, {
            status: 'error',
            detail: message,
            error: message,
            progress: 100,
            source: baseSource,
          });
        } finally {
          resumeControllersRef.current.delete(job.id);
        }
      })();
    });
  }, [
    applyComfyNodeRunResult,
    comfyEndpoint,
    currentNodes,
    currentProjectId,
    finishBackgroundJob,
    resumableJobs,
    updateBackgroundJob,
  ]);

  useEffect(
    () => () => {
      resumeControllersRef.current.forEach((controller) => controller.abort());
      resumeControllersRef.current.clear();
      resumedJobIdsRef.current.clear();
    },
    [],
  );
};
