import { useEffect, useMemo, useRef, useState } from 'react';
import { AnyNode, ComfyNode, ComfyWorkflow, Flow, NodeType } from '@blackboard/types';
import { getOrderedNodesFromFlow, getRootFlow } from '@/state/editor/flowModel';
import {
  getProjectBranchStorageId,
  loadProjectState,
  MAIN_PROJECT_BRANCH_ID,
} from '@/state/persist';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import {
  fetchComfyPromptStatus,
  normalizeComfyEndpoint,
  waitForComfyOutputFiles,
} from '@/services/comfy/client';
import { isBackgroundJobActive, type BackgroundJob } from '@/state/editor/services/backgroundJobs';
import {
  createBackgroundJobRetryUpdate,
  shouldRetryBackgroundJobFailure,
} from '@/state/editor/services/backgroundJobExecutor';
import { createGeneratedOutputsFromComfyFiles } from './comfyGeneratedOutputs';
import { isComfyNode } from '@/nodes/helpers';
import { isAbortError } from '@/utils/guards';
import { getComfyOutputTransform } from './comfyOutputTransform';

type ComfyJobContext = {
  projectId: string | null;
  node: ComfyNode;
  sceneNode: AnyNode | null;
  workflow: ComfyWorkflow | null;
};

const COMFY_JOB_RECHECK_INTERVAL_MS = 5_000;
const STALE_COMFY_JOB_RECHECK_MS = 15_000;

type ComfySyncPhase = 'checking' | 'waiting' | 'downloading' | 'applying';

const isTerminalComfySyncError = (message: string): boolean =>
  message.startsWith('ComfyUI workflow failed') ||
  message.startsWith('Timed out waiting for ComfyUI output') ||
  message.includes('completed the workflow, but no output file was found');

const findComfyNodeContextInFlows = (
  flows: Record<string, Flow>,
  rootFlowId: string | null,
  nodeId: string,
): Pick<ComfyJobContext, 'node' | 'sceneNode'> | null => {
  let targetNode: ComfyNode | null = null;
  let targetSceneNode: AnyNode | null = null;

  for (const flow of Object.values(flows)) {
    const nodes = getOrderedNodesFromFlow(flow);
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (isComfyNode(node)) {
      targetNode = node;
      targetSceneNode = nodes.find((candidate) => candidate.type === NodeType.SCENE) ?? null;
      break;
    }
  }

  if (!targetNode) return null;

  const rootFlow = getRootFlow(flows, rootFlowId);
  const rootSceneNode =
    getOrderedNodesFromFlow(rootFlow).find((candidate) => candidate.type === NodeType.SCENE) ??
    null;

  return {
    node: targetNode,
    sceneNode: targetSceneNode ?? rootSceneNode,
  };
};

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
  currentBranchId,
  currentFlows,
  currentRootFlowId,
  currentNodes,
}: {
  job: BackgroundJob;
  currentProjectId: string | null;
  currentBranchId: string | null;
  currentFlows: Record<string, Flow>;
  currentRootFlowId: string | null;
  currentNodes: AnyNode[];
}): Promise<ComfyJobContext | null> => {
  const nodeId = job.source?.nodeId;
  if (!nodeId) return null;

  const jobBranchId = job.source?.branchId ?? MAIN_PROJECT_BRANCH_ID;
  const currentResolvedBranchId = currentBranchId ?? MAIN_PROJECT_BRANCH_ID;

  if (
    (!job.source?.projectId || job.source.projectId === currentProjectId) &&
    jobBranchId === currentResolvedBranchId
  ) {
    const flowContext = findComfyNodeContextInFlows(currentFlows, currentRootFlowId, nodeId);
    if (!flowContext) return null;

    return {
      projectId: currentProjectId,
      node: flowContext.node,
      sceneNode:
        flowContext.sceneNode ??
        currentNodes.find((candidate) => candidate.type === NodeType.SCENE) ??
        null,
      workflow:
        flowContext.node.workflows.find((workflow) => workflow.id === job.source?.workflowId) ??
        null,
    };
  }

  if (!job.source?.projectId) return null;

  const projectState = await loadProjectState(
    getProjectBranchStorageId(job.source.projectId, jobBranchId),
  );
  if (!projectState) return null;

  const rootFlow = getRootFlow(projectState.flows || {}, projectState.rootFlowId || null);
  const flowContext = findComfyNodeContextInFlows(
    projectState.flows || {},
    projectState.rootFlowId || null,
    nodeId,
  );
  if (!flowContext) return null;

  return {
    projectId: job.source.projectId,
    node: flowContext.node,
    sceneNode:
      flowContext.sceneNode ??
      getOrderedNodesFromFlow(rootFlow).find((candidate) => candidate.type === NodeType.SCENE) ??
      null,
    workflow:
      flowContext.node.workflows.find((workflow) => workflow.id === job.source?.workflowId) ?? null,
  };
};

export const useSyncComfyBackgroundJobs = () => {
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const currentProjectId = useEditorSelector((state) => state.projectId);
  const currentBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const currentFlows = useEditorSelector((state) => state.flows);
  const currentRootFlowId = useEditorSelector((state) => state.rootFlowId);
  const currentNodes = useEditorSelector((state) => state.nodes);
  const { comfyEndpoint } = usePreferences();
  const { updateBackgroundJob, finishBackgroundJob, applyComfyNodeRunResult } = useEditorActions();
  const [recheckNow, setRecheckNow] = useState(() => Date.now());
  const syncingJobIdsRef = useRef<Set<string>>(new Set());
  const syncControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRecheckNow(Date.now());
    }, COMFY_JOB_RECHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  const syncableJobs = useMemo(
    () =>
      backgroundJobs.filter((job) => {
        if (job.type !== 'comfy' || !isBackgroundJobActive(job) || !job.source?.promptId) {
          return false;
        }

        return (
          job.source.restoredFromStorage === true ||
          recheckNow - job.updatedAt >= STALE_COMFY_JOB_RECHECK_MS
        );
      }),
    [backgroundJobs, recheckNow],
  );

  useEffect(() => {
    syncableJobs.forEach((job) => {
      const promptId = job.source?.promptId;
      if (!promptId || syncingJobIdsRef.current.has(job.id)) return;

      syncingJobIdsRef.current.add(job.id);
      const controller = new AbortController();
      syncControllersRef.current.set(job.id, controller);

      void (async () => {
        const source = { ...(job.source ?? {}) };
        delete source.restoredFromStorage;
        const endpoint = normalizeComfyEndpoint(job.source?.comfyEndpoint ?? comfyEndpoint);
        const baseSource = {
          ...source,
          comfyEndpoint: endpoint,
          promptId,
        };
        let phase: ComfySyncPhase = 'checking';

        try {
          updateBackgroundJob(job.id, {
            status: 'running',
            detail: 'Syncing ComfyUI prompt state',
            progress: job.progress ?? 35,
            indeterminate: true,
            cancellable: false,
            source: baseSource,
          });

          const context = await getComfyJobContext({
            job,
            currentProjectId,
            currentBranchId,
            currentFlows,
            currentRootFlowId,
            currentNodes,
          });
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
          phase = 'checking';
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

          phase = 'waiting';
          const outputFiles =
            status.status === 'success'
              ? status.outputs
              : await waitForComfyOutputFiles({
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

          phase = 'downloading';
          updateBackgroundJob(job.id, {
            status: 'running',
            detail: 'Downloading ComfyUI output',
            progress: 92,
            indeterminate: true,
            cancellable: false,
            source: baseSource,
          });

          const generatedOutputs = await createGeneratedOutputsFromComfyFiles({
            endpoint,
            files: outputFiles,
            workflow: context.workflow,
            promptId,
            signal: controller.signal,
          });
          const generatedOutputsWithRegion = source.comfyRegionId
            ? generatedOutputs.map((o) => ({ ...o, regionId: source.comfyRegionId }))
            : generatedOutputs;
          const activeGeneratedOutput = generatedOutputsWithRegion[0];
          if (!activeGeneratedOutput) {
            throw new Error('ComfyUI completed the workflow, but no output file was found.');
          }

          const transform = getComfyOutputTransform({
            node: context.node,
            output: activeGeneratedOutput,
            sceneNode: context.sceneNode as { width: number; height: number } | null,
          });
          phase = 'applying';
          const applyTarget = await applyComfyNodeRunResult({
            projectId: context.projectId,
            branchId: job.source?.branchId,
            nodeId: context.node.id,
            updates: {
              src: activeGeneratedOutput.src,
              mediaKind: activeGeneratedOutput.mediaKind ?? 'image',
              colorSpace: activeGeneratedOutput.colorSpace ?? context.node.colorSpace,
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
          if (isAbortError(error)) return;
          const message =
            error instanceof Error ? error.message : 'Could not finish the ComfyUI job.';
          if (
            !isTerminalComfySyncError(message) &&
            shouldRetryBackgroundJobFailure(job, { phase, message })
          ) {
            updateBackgroundJob(job.id, {
              ...createBackgroundJobRetryUpdate(job, {
                phase,
                message: `Could not reach ComfyUI. ${message}`,
              }),
              progress: job.progress ?? 35,
              source: baseSource,
            });
            return;
          }

          finishBackgroundJob(job.id, {
            status: 'error',
            detail: message,
            error: message,
            progress: 100,
            source: baseSource,
          });
        } finally {
          syncControllersRef.current.delete(job.id);
          syncingJobIdsRef.current.delete(job.id);
        }
      })();
    });
  }, [
    applyComfyNodeRunResult,
    comfyEndpoint,
    currentNodes,
    currentBranchId,
    currentFlows,
    currentRootFlowId,
    currentProjectId,
    finishBackgroundJob,
    syncableJobs,
    updateBackgroundJob,
  ]);

  useEffect(
    () => () => {
      syncControllersRef.current.forEach((controller) => controller.abort());
      syncControllersRef.current.clear();
      syncingJobIdsRef.current.clear();
    },
    [],
  );
};
