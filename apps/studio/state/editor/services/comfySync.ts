import type { HistoryEntry, AnyNode, ComfyNode, GeneratedOutput, Flow } from '@blackboard/types';
import {
  addGalleryEntries,
  createEntryId,
  makeProjectTag,
  makeNodeTag,
  makeWorkflowTag,
  makeBranchTag,
  makeSourceTag,
  getTagValue,
  hasTag,
  loadGalleryEntries,
  type GalleryEntry,
} from '@blackboard/project-store';
import {
  MAIN_PROJECT_BRANCH_ID,
  loadProjectState,
  getProjectBranchStorageId,
  saveProject,
  saveProjectIndex,
  getProjectIndex,
  touchProjectBranch,
} from '@/state/persist';
import { getOrderedNodesFromFlow, replaceFlowNodes, getRootFlow } from '@/state/editor/flowModel';
import { isComfyNode } from '@/nodes/helpers';
import { getComfyGeneratedOutputsForActivation } from '@/nodes/ai/comfy/comfyOutputActivation';
import type { GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComfyApplyTarget = 'current' | 'saved' | 'missing' | 'gallery';
export type ComfyNodeRunUpdates = Partial<Omit<ComfyNode, 'generatedOutputs'>>;
export type ComfyGallerySyncMode = 'soft-delete' | 'restore' | 'permanent-delete';
export type ComfyGalleryOutputSyncTarget = {
  projectId: string;
  branchId: string;
  nodeId: string;
  outputId?: string;
  assetId?: string;
  mode: ComfyGallerySyncMode;
  deletedAt?: number;
};

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

export const getResolvedBranchId = (branchId: string | null | undefined): string =>
  branchId || MAIN_PROJECT_BRANCH_ID;

// ---------------------------------------------------------------------------
// Generated output merge / diff
// ---------------------------------------------------------------------------

export const mergeGeneratedOutputs = (
  existingOutputs: GeneratedOutput[] | undefined,
  incomingOutputs: GeneratedOutput[] | undefined,
): GeneratedOutput[] | undefined => {
  if (!incomingOutputs || incomingOutputs.length === 0) return existingOutputs;

  const mergedOutputs = [...(existingOutputs ?? [])];
  const outputIndexById = new Map(mergedOutputs.map((output, index) => [output.id, index]));

  incomingOutputs.forEach((incomingOutput) => {
    const existingIndex = outputIndexById.get(incomingOutput.id);
    if (existingIndex === undefined) {
      outputIndexById.set(incomingOutput.id, mergedOutputs.length);
      mergedOutputs.push(incomingOutput);
      return;
    }

    mergedOutputs[existingIndex] = {
      ...incomingOutput,
      ...mergedOutputs[existingIndex],
    };
  });

  return mergedOutputs;
};

export const getUnstoredGeneratedOutputs = (
  existingOutputs: GeneratedOutput[] | undefined,
  incomingOutputs: GeneratedOutput[] | undefined,
): GeneratedOutput[] | undefined => {
  if (!incomingOutputs || incomingOutputs.length === 0) return undefined;

  const existingOutputIds = new Set((existingOutputs ?? []).map((output) => output.id));
  const unstoredOutputs = incomingOutputs.filter((output) => !existingOutputIds.has(output.id));

  return unstoredOutputs.length > 0 ? unstoredOutputs : undefined;
};

const getMergedGeneratedOutputsForActivation = (
  node: ComfyNode,
  updates: ComfyNodeRunUpdates,
  incomingOutputs: GeneratedOutput[] | undefined,
): GeneratedOutput[] | undefined => {
  const mergedOutputs = mergeGeneratedOutputs(node.generatedOutputs, incomingOutputs);
  if (!mergedOutputs || !incomingOutputs?.length) return mergedOutputs;

  const activeOutputId =
    typeof updates.activeGeneratedOutputId === 'string'
      ? updates.activeGeneratedOutputId
      : undefined;
  const activatedOutput =
    (activeOutputId ? mergedOutputs.find((output) => output.id === activeOutputId) : undefined) ??
    incomingOutputs[0];
  if (!activatedOutput) return mergedOutputs;

  return getComfyGeneratedOutputsForActivation({
    node: { ...node, generatedOutputs: mergedOutputs },
    outputs: mergedOutputs,
    activatedOutput,
  });
};

// ---------------------------------------------------------------------------
// Gallery entry helpers
// ---------------------------------------------------------------------------

export const createComfyGalleryEntries = ({
  projectId,
  branchId,
  nodeId,
  nodeName,
  workflowId,
  existingOutputs,
  incomingOutputs,
}: {
  projectId: string;
  branchId: string;
  nodeId: string;
  nodeName?: string;
  workflowId?: string;
  existingOutputs?: GeneratedOutput[];
  incomingOutputs?: GeneratedOutput[];
}): GalleryEntry[] => {
  const galleryGeneratedOutputs = getUnstoredGeneratedOutputs(existingOutputs, incomingOutputs);

  return (galleryGeneratedOutputs ?? [])
    .filter((output) => !!output.src)
    .map((output) => ({
      id: createEntryId(),
      source: 'Comfy' as const,
      assetId: output.src,
      mediaKind: output.mediaKind ?? 'image',
      frames: output.frames,
      width: output.width,
      height: output.height,
      duration: output.duration,
      fps: output.fps,
      createdAt: output.createdAt,
      label: output.label ?? output.workflowName,
      prompt: output.prompt,
      tags: [
        makeProjectTag(projectId),
        makeNodeTag(nodeId),
        makeBranchTag(branchId),
        makeSourceTag('Comfy'),
        ...(workflowId ? [makeWorkflowTag(workflowId)] : []),
        ...(output.id ? [`output:${output.id}`] : []),
      ],
      nodeName,
      outputId: output.id,
      workflowId: output.workflowId,
      workflowName: output.workflowName,
      promptId: output.promptId,
    }));
};

export const getComfyGallerySyncTargets = ({
  entries,
  mode,
  deletedAt,
}: {
  entries: GalleryEntry[];
  mode: ComfyGallerySyncMode;
  deletedAt?: number;
}): ComfyGalleryOutputSyncTarget[] =>
  entries.flatMap((entry) => {
    if (entry.source !== 'Comfy') return [];

    const projectId = getTagValue(entry.tags, 'project:');
    const branchId = getTagValue(entry.tags, 'branch:') ?? MAIN_PROJECT_BRANCH_ID;
    const nodeId = getTagValue(entry.tags, 'node:');

    if (!projectId || !nodeId || (!entry.outputId && !entry.assetId)) return [];

    return [
      {
        projectId,
        branchId,
        nodeId,
        outputId: entry.outputId,
        assetId: entry.assetId,
        mode,
        deletedAt,
      },
    ];
  });

export const comfyOutputMatchesGalleryTarget = (
  output: GeneratedOutput,
  target: Pick<ComfyGalleryOutputSyncTarget, 'outputId' | 'assetId'>,
): boolean => {
  if (target.outputId && output.id === target.outputId) return true;
  if (!target.assetId) return false;
  return output.src === target.assetId || (output.frames ?? []).includes(target.assetId);
};

export const addGeneratedOutputAssetIds = (
  assetIds: Set<string>,
  output: GeneratedOutput,
): void => {
  if (output.src) assetIds.add(output.src);
  output.frames?.forEach((assetId) => {
    if (assetId) assetIds.add(assetId);
  });
};

export const collectGalleryProtectedAssets = async (
  projectId: string,
): Promise<{
  assetIds: Set<string>;
  targets: ComfyGalleryOutputSyncTarget[];
}> => {
  const protectedAssetIds = new Set<string>();
  let targets: ComfyGalleryOutputSyncTarget[] = [];

  try {
    const projectTag = makeProjectTag(projectId);
    const entries = await loadGalleryEntries();
    const projectEntries = entries.filter((entry) => hasTag(entry.tags, projectTag));
    targets = getComfyGallerySyncTargets({
      entries: projectEntries,
      mode: 'restore',
    });

    projectEntries.forEach((entry) => {
      if (entry.assetId) protectedAssetIds.add(entry.assetId);
      entry.frames?.forEach((assetId) => {
        if (assetId) protectedAssetIds.add(assetId);
      });
    });
  } catch {
    // Gallery protection is best-effort; project deletion should still complete.
  }

  return { assetIds: protectedAssetIds, targets };
};

export const protectGalleryGeneratedOutputs = (
  protectedAssetIds: Set<string>,
  nodes: AnyNode[],
  targets: Pick<ComfyGalleryOutputSyncTarget, 'nodeId' | 'outputId' | 'assetId'>[],
): void => {
  if (targets.length === 0) return;

  nodes.forEach((node) => {
    if (!isComfyNode(node) || !node.generatedOutputs?.length) return;

    const nodeTargets = targets.filter((target) => target.nodeId === node.id);
    if (nodeTargets.length === 0) return;

    node.generatedOutputs.forEach((output) => {
      if (nodeTargets.some((target) => comfyOutputMatchesGalleryTarget(output, target))) {
        addGeneratedOutputAssetIds(protectedAssetIds, output);
      }
    });
  });
};

// ---------------------------------------------------------------------------
// Comfy output activation / sync helpers
// ---------------------------------------------------------------------------

export const getComfyOutputActivationUpdates = (output: GeneratedOutput): Partial<ComfyNode> => ({
  src: output.src,
  mediaKind: output.mediaKind ?? 'image',
  ...(output.colorSpace ? { colorSpace: output.colorSpace } : {}),
  frames: output.frames,
  duration: output.duration,
  fps: output.fps,
  width: output.width,
  height: output.height,
  activeGeneratedOutputId: output.id,
  lastPromptId: output.promptId,
  lastRunAt: output.createdAt,
});

export const syncComfyGeneratedOutputs = (
  node: ComfyNode,
  targets: ComfyGalleryOutputSyncTarget[],
): ComfyNode => {
  const nodeTargets = targets.filter((target) => target.nodeId === node.id);
  if (nodeTargets.length === 0 || !node.generatedOutputs?.length) return node;

  let removedActiveOutput = false;
  let changed = false;
  let nextGeneratedOutputs = node.generatedOutputs;

  nodeTargets.forEach((target) => {
    if (target.mode === 'permanent-delete') {
      const beforeLength = nextGeneratedOutputs.length;
      nextGeneratedOutputs = nextGeneratedOutputs.filter((output) => {
        const matches = comfyOutputMatchesGalleryTarget(output, target);
        if (matches && output.id === node.activeGeneratedOutputId) {
          removedActiveOutput = true;
        }
        return !matches;
      });
      if (nextGeneratedOutputs.length !== beforeLength) changed = true;
      return;
    }

    nextGeneratedOutputs = nextGeneratedOutputs.map((output) => {
      if (!comfyOutputMatchesGalleryTarget(output, target)) return output;

      if (target.mode === 'restore') {
        if (!output.deletedAt) return output;
        changed = true;
        const { deletedAt: _deletedAt, ...restoredOutput } = output;
        return restoredOutput;
      }

      const nextDeletedAt = target.deletedAt ?? Date.now();
      if (output.deletedAt === nextDeletedAt) return output;
      changed = true;
      return { ...output, deletedAt: nextDeletedAt };
    });
  });

  if (!changed) return node;

  if (!removedActiveOutput) {
    return {
      ...node,
      generatedOutputs: nextGeneratedOutputs,
    };
  }

  const fallbackOutput = [...nextGeneratedOutputs].reverse().find((output) => !output.deletedAt);
  if (fallbackOutput) {
    return {
      ...node,
      ...getComfyOutputActivationUpdates(fallbackOutput),
      generatedOutputs: nextGeneratedOutputs,
    };
  }

  return {
    ...node,
    generatedOutputs: nextGeneratedOutputs,
    src: '',
    mediaKind: undefined,
    frames: undefined,
    duration: undefined,
    fps: undefined,
    width: 0,
    height: 0,
    activeGeneratedOutputId: undefined,
  };
};

export const syncComfyGeneratedOutputsIntoNodes = (
  nodes: AnyNode[] | undefined,
  targets: ComfyGalleryOutputSyncTarget[],
): AnyNode[] | undefined => {
  if (!nodes || targets.length === 0) return nodes;

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!isComfyNode(node)) return node;

    const nextNode = syncComfyGeneratedOutputs(node, targets);
    if (nextNode === node) return node;

    changed = true;
    return nextNode;
  });

  return changed ? nextNodes : nodes;
};

export const syncComfyGeneratedOutputsIntoHistory = (
  history: HistoryEntry[] | undefined,
  targets: ComfyGalleryOutputSyncTarget[],
): HistoryEntry[] | undefined => {
  if (!history || targets.length === 0) return history;

  let historyChanged = false;
  const nextHistory = history.map((entry) => {
    const nextNodes = syncComfyGeneratedOutputsIntoNodes(entry.state.nodes, targets);
    let nextFlows = entry.state.flows;

    if (entry.state.flows) {
      for (const [flowId, flow] of Object.entries(entry.state.flows)) {
        const flowNodes = getOrderedNodesFromFlow(flow);
        const nextFlowNodes = syncComfyGeneratedOutputsIntoNodes(flowNodes, targets);
        if (nextFlowNodes && nextFlowNodes !== flowNodes) {
          nextFlows = replaceFlowNodes(nextFlows ?? {}, flowId, nextFlowNodes, flow.name);
        }
      }
    }

    if (nextNodes === entry.state.nodes && nextFlows === entry.state.flows) {
      return entry;
    }

    historyChanged = true;
    return {
      ...entry,
      state: {
        ...entry.state,
        ...(nextNodes !== entry.state.nodes ? { nodes: nextNodes } : {}),
        ...(nextFlows !== entry.state.flows ? { flows: nextFlows } : {}),
      },
    };
  });

  return historyChanged ? nextHistory : history;
};

export const syncComfyGeneratedOutputsIntoFlows = (
  flows: Record<string, Flow>,
  targets: ComfyGalleryOutputSyncTarget[],
): Record<string, Flow> => {
  if (targets.length === 0) return flows;

  let nextFlows = flows;
  for (const [flowId, flow] of Object.entries(flows)) {
    const nodes = getOrderedNodesFromFlow(flow);
    const nextNodes = syncComfyGeneratedOutputsIntoNodes(nodes, targets);
    if (nextNodes && nextNodes !== nodes) {
      nextFlows = replaceFlowNodes(nextFlows, flowId, nextNodes, flow.name);
    }
  }

  return nextFlows;
};

// ---------------------------------------------------------------------------
// Merge output into nodes / history
// ---------------------------------------------------------------------------

export const mergeGeneratedOutputsIntoNodes = (
  nodes: AnyNode[] | undefined,
  nodeId: string,
  generatedOutputs: GeneratedOutput[] | undefined,
): AnyNode[] | undefined => {
  if (!nodes || !generatedOutputs || generatedOutputs.length === 0) return nodes;

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId || !isComfyNode(node)) return node;

    const nextGeneratedOutputs = mergeGeneratedOutputs(node.generatedOutputs, generatedOutputs);
    if (nextGeneratedOutputs === node.generatedOutputs) return node;

    changed = true;
    return {
      ...node,
      generatedOutputs: nextGeneratedOutputs,
    } as ComfyNode;
  });

  return changed ? nextNodes : nodes;
};

export const mergeGeneratedOutputsIntoHistory = (
  history: HistoryEntry[],
  nodeId: string,
  generatedOutputs: GeneratedOutput[] | undefined,
): HistoryEntry[] => {
  if (!generatedOutputs || generatedOutputs.length === 0) return history;

  let historyChanged = false;
  const nextHistory = history.map((entry) => {
    const nextNodes = mergeGeneratedOutputsIntoNodes(entry.state.nodes, nodeId, generatedOutputs);
    let nextFlows = entry.state.flows;

    if (entry.state.flows) {
      const flowMatch = findFlowContainingNode(entry.state.flows, nodeId);
      const nextFlowNodes = mergeGeneratedOutputsIntoNodes(
        flowMatch?.nodes,
        nodeId,
        generatedOutputs,
      );
      if (flowMatch && nextFlowNodes && nextFlowNodes !== flowMatch.nodes) {
        nextFlows = replaceFlowNodes(
          entry.state.flows,
          flowMatch.flowId,
          nextFlowNodes,
          flowMatch.flow.name,
        );
      }
    }

    if (nextNodes === entry.state.nodes && nextFlows === entry.state.flows) {
      return entry;
    }

    historyChanged = true;
    return {
      ...entry,
      state: {
        ...entry.state,
        ...(nextNodes !== entry.state.nodes ? { nodes: nextNodes } : {}),
        ...(nextFlows !== entry.state.flows ? { flows: nextFlows } : {}),
      },
    };
  });

  return historyChanged ? nextHistory : history;
};

// ---------------------------------------------------------------------------
// General history / node helpers used across services
// ---------------------------------------------------------------------------

export const getActiveHistoryEntryId = (
  history: HistoryEntry[],
  historyIndex: number,
): string | null => history[historyIndex]?.id ?? null;

export const findFlowContainingNode = (
  flows: Record<string, Flow>,
  nodeId: string,
): { flowId: string; flow: Flow; nodes: AnyNode[]; node: AnyNode } | null => {
  for (const [flowId, flow] of Object.entries(flows)) {
    const nodes = getOrderedNodesFromFlow(flow);
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (node) {
      return { flowId, flow, nodes, node };
    }
  }

  return null;
};

export const applyNodeUpdatesIntoNodes = (
  nodes: AnyNode[] | undefined,
  nodeId: string,
  updates: Partial<AnyNode>,
): AnyNode[] | undefined => {
  if (!nodes) return nodes;

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    return { ...node, ...updates } as AnyNode;
  });

  return changed ? nextNodes : nodes;
};

export const applyNodeUpdatesIntoHistoryEntry = (
  entry: HistoryEntry,
  nodeId: string,
  updates: Partial<AnyNode>,
): HistoryEntry => {
  const nextNodes = applyNodeUpdatesIntoNodes(entry.state.nodes, nodeId, updates);
  let nextFlows = entry.state.flows;

  if (entry.state.flows) {
    const flowMatch = findFlowContainingNode(entry.state.flows, nodeId);
    if (flowMatch) {
      const nextFlowNodes = applyNodeUpdatesIntoNodes(flowMatch.nodes, nodeId, updates);
      if (nextFlowNodes && nextFlowNodes !== flowMatch.nodes) {
        nextFlows = replaceFlowNodes(
          entry.state.flows,
          flowMatch.flowId,
          nextFlowNodes,
          flowMatch.flow.name,
        );
      }
    }
  }

  if (nextNodes === entry.state.nodes && nextFlows === entry.state.flows) {
    return entry;
  }

  return {
    ...entry,
    state: {
      ...entry.state,
      ...(nextNodes !== entry.state.nodes ? { nodes: nextNodes } : {}),
      ...(nextFlows !== entry.state.flows ? { flows: nextFlows } : {}),
    },
  };
};

export const applyComfyResultIntoHistory = (
  history: HistoryEntry[] | undefined,
  nodeId: string,
  nodeUpdates: Partial<AnyNode>,
  generatedOutputs: GeneratedOutput[] | undefined,
  activeEntryId: string | null | undefined,
  activateActiveEntry: boolean,
): HistoryEntry[] | undefined => {
  if (!history) return history;

  return history.map((entry) => {
    if (activateActiveEntry && activeEntryId && entry.id === activeEntryId) {
      return applyNodeUpdatesIntoHistoryEntry(entry, nodeId, nodeUpdates);
    }

    return mergeGeneratedOutputsIntoHistory([entry], nodeId, generatedOutputs)[0] ?? entry;
  });
};

// ---------------------------------------------------------------------------
// Comfy orchestration action methods (extracted from createProjectActions)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type for deps needed by comfy orchestration methods
// ---------------------------------------------------------------------------

export type ComfyOrchestrationDeps = {
  commitMutation: CommitEditorMutation;
};

// ---------------------------------------------------------------------------
// syncComfyGeneratedOutputsWithGalleryEntriesService
// ---------------------------------------------------------------------------

export const syncComfyGeneratedOutputsWithGalleryEntriesService = async (
  set: SetState,
  get: GetState,
  deps: ComfyOrchestrationDeps,
  entries: GalleryEntry[],
  mode: ComfyGallerySyncMode,
  deletedAt?: number,
) => {
  const targets = getComfyGallerySyncTargets({ entries, mode, deletedAt });
  if (targets.length === 0) return;

  const state = get();
  const currentProjectId = state.projectId;
  const currentBranchId = getResolvedBranchId(state.activeProjectBranchId);
  const currentTargets = targets.filter(
    (target) => target.projectId === currentProjectId && target.branchId === currentBranchId,
  );

  if (currentTargets.length > 0) {
    const nextFlows = syncComfyGeneratedOutputsIntoFlows(state.flows, currentTargets);
    const nextHistory =
      syncComfyGeneratedOutputsIntoHistory(state.history, currentTargets) ?? state.history;

    if (nextFlows !== state.flows || nextHistory !== state.history) {
      const activeFlow = getRootFlow(nextFlows, state.activeFlowId ?? state.rootFlowId);
      deps.commitMutation({
        patch: {
          flows: nextFlows,
          nodes: getOrderedNodesFromFlow(activeFlow),
          history: nextHistory,
        },
        persist: 'debounced',
      });
    }
  }

  const savedTargetsByBranch = new Map<string, ComfyGalleryOutputSyncTarget[]>();
  targets.forEach((target) => {
    if (target.projectId === currentProjectId && target.branchId === currentBranchId) {
      return;
    }
    const key = `${target.projectId}\x00$\{target.branchId}`;
    savedTargetsByBranch.set(key, [...(savedTargetsByBranch.get(key) ?? []), target]);
  });

  for (const [key, branchTargets] of savedTargetsByBranch) {
    const [projectId, branchId] = key.split('\x00');
    if (!projectId || !branchId) continue;

    const storageId = getProjectBranchStorageId(projectId, branchId);
    const projectState = await loadProjectState(storageId);
    if (!projectState) continue;

    const flows = projectState.flows || {};
    const nextFlows = syncComfyGeneratedOutputsIntoFlows(flows, branchTargets);
    const nextHistory = syncComfyGeneratedOutputsIntoHistory(projectState.history, branchTargets);

    if (nextFlows === flows && nextHistory === projectState.history) {
      continue;
    }

    await saveProject(storageId, {
      ...projectState,
      flows: nextFlows,
      history: nextHistory ?? projectState.history,
    });

    const timestamp = Date.now();
    const index = getProjectIndex();
    saveProjectIndex(
      index.map((entry) =>
        entry.id === projectId ? { ...entry, lastModified: timestamp } : entry,
      ),
    );
    touchProjectBranch(projectId, branchId, timestamp);
  }
};

// ---------------------------------------------------------------------------
// applyComfyNodeRunResultService
// ---------------------------------------------------------------------------

export const applyComfyNodeRunResultService = async ({
  set,
  get,
  deps,
  projectId,
  branchId,
  nodeId,
  updates,
  newGeneratedOutputs,
  withHistory = false,
  historyLabel = 'Update Comfy Node',
  noticeLabel,
  galleryNoticeLabel,
  expectedHistoryId,
}: {
  set: SetState;
  get: GetState;
  deps: ComfyOrchestrationDeps;
  projectId: string | null;
  branchId?: string | null;
  nodeId: string;
  updates: ComfyNodeRunUpdates;
  newGeneratedOutputs?: GeneratedOutput[];
  withHistory?: boolean;
  historyLabel?: string;
  noticeLabel?: string;
  galleryNoticeLabel?: string;
  expectedHistoryId?: string | null;
}): Promise<ComfyApplyTarget> => {
  if (!projectId) return 'missing';

  const targetBranchId = getResolvedBranchId(branchId);
  const state = get();
  const generatedOutputs = newGeneratedOutputs?.length ? newGeneratedOutputs : undefined;
  const currentBranchId = getResolvedBranchId(state.activeProjectBranchId);

  if (state.projectId === projectId && currentBranchId === targetBranchId) {
    const flowMatch = findFlowContainingNode(state.flows, nodeId);
    if (!flowMatch) return 'missing';

    const activeHistoryId = getActiveHistoryEntryId(state.history, state.historyIndex);
    const historyMoved =
      !!expectedHistoryId && !!activeHistoryId && activeHistoryId !== expectedHistoryId;
    const nodeUpdates: Partial<AnyNode> =
      historyMoved && generatedOutputs && isComfyNode(flowMatch.node)
        ? ({
            generatedOutputs:
              mergeGeneratedOutputs(flowMatch.node.generatedOutputs, generatedOutputs) ??
              flowMatch.node.generatedOutputs,
            lastError: undefined,
          } as Partial<ComfyNode>)
        : generatedOutputs && isComfyNode(flowMatch.node)
          ? ({
              ...updates,
              generatedOutputs:
                getMergedGeneratedOutputsForActivation(flowMatch.node, updates, generatedOutputs) ??
                flowMatch.node.generatedOutputs,
              lastError: undefined,
            } as Partial<ComfyNode>)
          : updates;
    const nextFlowNodes = flowMatch.nodes.map((node: AnyNode) =>
      node.id === nodeId ? ({ ...node, ...nodeUpdates } as AnyNode) : node,
    );
    const nextFlows = replaceFlowNodes(
      state.flows,
      flowMatch.flowId,
      nextFlowNodes,
      flowMatch.flow.name,
    );
    const nextHistory = mergeGeneratedOutputsIntoHistory(state.history, nodeId, generatedOutputs);
    set(() => ({
      flows: nextFlows,
      ...(flowMatch.flowId === (state.activeFlowId ?? state.rootFlowId)
        ? { nodes: nextFlowNodes }
        : {}),
      history: nextHistory,
      aiApplyNotice: noticeLabel
        ? {
            id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            nodeId,
            field: 'comfy-output',
            label: historyMoved && galleryNoticeLabel ? galleryNoticeLabel : noticeLabel,
            createdAt: Date.now(),
          }
        : state.aiApplyNotice,
    }));

    if (generatedOutputs?.length && typeof indexedDB !== 'undefined') {
      try {
        const nodeName = flowMatch.node.name;
        const comfyNode = isComfyNode(flowMatch.node) ? (flowMatch.node as ComfyNode) : null;
        const galleryEntries = createComfyGalleryEntries({
          projectId,
          branchId: targetBranchId,
          nodeId,
          nodeName,
          workflowId: comfyNode?.selectedWorkflowId,
          existingOutputs: comfyNode?.generatedOutputs,
          incomingOutputs: generatedOutputs,
        });
        if (galleryEntries.length > 0) {
          await addGalleryEntries(galleryEntries);
          set(() => ({ galleryUpdatedAt: Date.now() }));
        }
      } catch {
        // Gallery is best-effort; skip if storage is unavailable.
      }
    }

    if (historyMoved) {
      deps.commitMutation({ patch: {}, persist: 'debounced' });
      return 'gallery';
    }

    if (withHistory) {
      deps.commitMutation({
        patch: {},
        history: {
          label: historyLabel,
          state: {
            flows: nextFlows,
            rootFlowId: state.rootFlowId,
            activeFlowId: state.activeFlowId,
            selectedNodeId: state.selectedNodeId,
          },
        },
      });
    } else {
      deps.commitMutation({ patch: {}, persist: 'debounced' });
    }
    return 'current';
  }

  const storageId = getProjectBranchStorageId(projectId, targetBranchId);
  const projectState = await loadProjectState(storageId);
  if (!projectState) return 'missing';

  const persistedHistoryIndex =
    typeof projectState.historyIndex === 'number' ? projectState.historyIndex : -1;
  const persistedHistoryId =
    persistedHistoryIndex >= 0 && projectState.history
      ? projectState.history[persistedHistoryIndex]?.id
      : undefined;
  const historyMoved =
    !!expectedHistoryId && !!persistedHistoryId && persistedHistoryId !== expectedHistoryId;

  const flowMatch = findFlowContainingNode(projectState.flows || {}, nodeId);
  if (!flowMatch) return 'missing';

  const nodeUpdates: Partial<AnyNode> =
    historyMoved && generatedOutputs && isComfyNode(flowMatch.node)
      ? ({
          generatedOutputs:
            mergeGeneratedOutputs(flowMatch.node.generatedOutputs, generatedOutputs) ??
            flowMatch.node.generatedOutputs,
          lastError: undefined,
        } as Partial<ComfyNode>)
      : generatedOutputs && isComfyNode(flowMatch.node)
        ? ({
            ...updates,
            generatedOutputs:
              getMergedGeneratedOutputsForActivation(flowMatch.node, updates, generatedOutputs) ??
              flowMatch.node.generatedOutputs,
            lastError: undefined,
          } as Partial<ComfyNode>)
        : updates;

  const nextNodes = flowMatch.nodes.map((node: AnyNode) =>
    node.id === nodeId ? ({ ...node, ...nodeUpdates } as AnyNode) : node,
  );
  const nextFlows = replaceFlowNodes(
    projectState.flows || {},
    flowMatch.flowId,
    nextNodes,
    flowMatch.flow.name,
  );
  const activePersistedHistoryId = persistedHistoryId ?? expectedHistoryId ?? null;
  const shouldActivatePersistedHistory = !historyMoved;
  const nextHistory = applyComfyResultIntoHistory(
    projectState.history,
    nodeId,
    nodeUpdates,
    generatedOutputs,
    activePersistedHistoryId,
    shouldActivatePersistedHistory,
  );
  await saveProject(storageId, {
    ...projectState,
    flows: nextFlows,
    selectedNodeId: nodeId,
    history: nextHistory ?? projectState.history,
  });

  if (generatedOutputs?.length && typeof indexedDB !== 'undefined') {
    try {
      const comfyNode = isComfyNode(flowMatch.node) ? (flowMatch.node as ComfyNode) : null;
      const galleryEntries = createComfyGalleryEntries({
        projectId,
        branchId: targetBranchId,
        nodeId,
        nodeName: flowMatch.node.name,
        workflowId: comfyNode?.selectedWorkflowId,
        existingOutputs: comfyNode?.generatedOutputs,
        incomingOutputs: generatedOutputs,
      });
      if (galleryEntries.length > 0) {
        await addGalleryEntries(galleryEntries);
        set(() => ({ galleryUpdatedAt: Date.now() }));
      }
    } catch {
      // Gallery is best-effort; skip if storage is unavailable.
    }
  }

  const index = getProjectIndex();
  saveProjectIndex(
    index.map((entry) => (entry.id === projectId ? { ...entry, lastModified: Date.now() } : entry)),
  );
  touchProjectBranch(projectId, targetBranchId, Date.now());

  return historyMoved ? 'gallery' : 'saved';
};
