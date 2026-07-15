import type { HistoryEntry, ViewerSlotAssignments } from '@blackboard/types';
import {
  SCHEMA_VERSION,
  saveProject,
  loadProjectState,
  saveProjectIndex,
  getProjectIndex,
  MAIN_PROJECT_BRANCH_ID,
  getActiveProjectBranchId,
  getProjectBranches,
  getProjectBranchStorageId,
  setActiveProjectBranchId,
  touchProjectBranch,
  upsertProjectBranch,
  deleteProjectBranchRecord,
  createProjectBranchRecord,
  updateProjectBranchOwnership,
  deleteProject as deleteProjectFromStorage,
  type ProjectBranchRecord,
} from '@/state/persist';
import { requestReferencePermissions } from '@/state/assetStorage';
import {
  buildPersistedProjectState,
  type StoredProjectState,
} from '@/state/editor/projectSnapshots';
import { assertProjectColorManagement } from '@/color-management';
import { getOrderedNodesFromFlow, getRootFlow } from '@/state/editor/flowModel';
import { getDefaultViewportTool } from '@/nodes/helpers';
import {
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';
import { findSceneNode } from '@/utils/graphCommands';
import { getInitialState } from '@/state/editor/initialState';
import { collectNodeAssetIds } from '@/state/editor/utils';
import { cherryPickAgentNodeChanges } from '@/utils/agentBranchMerge';
import type { GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { clampToTimelineRange, getSceneTimelineRange } from '@/utils/timelineRange';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectBranchContext = {
  projectId: string | null;
  branchId: string;
  storageId: string | null;
};

export type BranchDeps = {
  commitMutation: CommitEditorMutation;
  getReopenHistoryLimit?: () => number;
  getAutoCheckpointEnabled?: () => boolean;
};

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

export const getProjectBranchContext = (
  projectId: string | null,
  activeProjectBranchId: string | null | undefined,
): ProjectBranchContext => {
  const branchId = projectId
    ? activeProjectBranchId || getActiveProjectBranchId(projectId)
    : MAIN_PROJECT_BRANCH_ID;

  return {
    projectId,
    branchId,
    storageId: projectId ? getProjectBranchStorageId(projectId, branchId) : null,
  };
};

export const isCurrentProjectBranchContext = (
  state: { projectId: string | null; activeProjectBranchId: string | null | undefined },
  context: ProjectBranchContext,
): boolean =>
  state.projectId === context.projectId &&
  (state.activeProjectBranchId || MAIN_PROJECT_BRANCH_ID) === context.branchId;

export const setIfCurrentProjectBranch = (
  set: SetState,
  get: GetState,
  context: ProjectBranchContext,
  patch: Partial<ReturnType<typeof getInitialState> & { maxFrames: number }>,
) => {
  if (
    !isCurrentProjectBranchContext(
      { projectId: get().projectId, activeProjectBranchId: get().activeProjectBranchId },
      context,
    )
  )
    return;
  set(() => patch);
};

// ---------------------------------------------------------------------------
// Project persistence helpers
// ---------------------------------------------------------------------------

export const updateProjectIndexModified = (
  projectId: string,
  get: GetState,
  timestamp = Date.now(),
  thumbnail?: string | null,
) => {
  const state = get();
  const index = getProjectIndex();
  saveProjectIndex(
    index.map((entry) =>
      entry.id === projectId
        ? {
            ...entry,
            lastModified: timestamp,
            thumbnail: thumbnail ?? entry.thumbnail,
            thumbnailAssetId: state.thumbnailAssetId ?? entry.thumbnailAssetId,
            schemaVersion: SCHEMA_VERSION,
          }
        : entry,
    ),
  );
};

export const saveOpenProjectBranchSnapshot = async (get: GetState, deps: BranchDeps) => {
  const state = get();
  if (!state.projectId) return;

  const timestamp = Date.now();
  const branchId = state.activeProjectBranchId || getActiveProjectBranchId(state.projectId);
  await saveProject(
    getProjectBranchStorageId(state.projectId, branchId),
    buildPersistedProjectState(state, {
      maxHistoryEntries: deps.getReopenHistoryLimit?.(),
      checkpointLatestHistoryEntry: deps.getAutoCheckpointEnabled?.(),
    }),
  );
  touchProjectBranch(state.projectId, branchId, timestamp);
  updateProjectIndexModified(state.projectId, get, timestamp, state.thumbnail);
};

// ---------------------------------------------------------------------------
// Load project state
// ---------------------------------------------------------------------------

export const loadProjectStateIntoEditor = async ({
  projectId,
  branchId,
  projectState,
  branches,
  set,
}: {
  projectId: string;
  branchId: string;
  projectState: StoredProjectState;
  branches: ProjectBranchRecord[];
  set: SetState;
}) => {
  const colorManagement = assertProjectColorManagement(projectState.colorManagement);
  const loadedFlows = projectState.flows || {};
  const rootFlowId = projectState.rootFlowId || null;
  const rootFlow = getRootFlow(loadedFlows, rootFlowId);
  const requestedActiveFlowId = projectState.activeFlowId || rootFlowId;
  const activeFlow = getRootFlow(loadedFlows, requestedActiveFlowId) ?? rootFlow;
  const activeFlowId = activeFlow?.id ?? rootFlowId;
  const loadedNodes = getOrderedNodesFromFlow(activeFlow);
  const permissionNodes = Object.values(loadedFlows).flatMap((flow) =>
    getOrderedNodesFromFlow(flow),
  );
  try {
    await requestReferencePermissions(collectNodeAssetIds(permissionNodes));
  } catch (error) {
    console.warn('Could not restore all directory permissions for this project.', error);
  }

  const sceneNode = findSceneNode(getOrderedNodesFromFlow(rootFlow));
  const timelineRange = sceneNode
    ? getSceneTimelineRange(sceneNode)
    : { startFrame: 0, endFrame: 0, frameCount: 1 };
  const maxFrames = timelineRange.endFrame;
  const fps = sceneNode?.fps || 30;
  const initialState = getInitialState();
  const currentFrame =
    typeof projectState.currentFrame === 'number' && Number.isFinite(projectState.currentFrame)
      ? clampToTimelineRange(projectState.currentFrame, timelineRange)
      : timelineRange.startFrame;
  const nextViewerSlots = sanitizeViewerSlots(
    projectState.viewerSlots as ViewerSlotAssignments | undefined,
    loadedNodes,
  );
  const nextViewerNodeId = sanitizeViewerNodeId(projectState.viewerNodeId, loadedNodes);
  const nextActiveViewerSlot = sanitizeActiveViewerSlot(
    projectState.activeViewerSlot,
    nextViewerSlots,
    nextViewerNodeId,
  );
  const selectedNodeId = projectState.selectedNodeId || loadedNodes[0]?.id || null;
  const selectedNode = loadedNodes.find((node) => node.id === selectedNodeId) ?? null;
  const nextAiChats = projectState.aiChats ?? [];
  const nextAiAgentRuns = projectState.aiAgentRuns ?? [];
  const nextActiveAiAgentRunId = projectState.activeAiAgentRunId ?? nextAiAgentRuns[0]?.id ?? null;
  const nextActiveAiChatId = projectState.activeAiChatId ?? nextAiChats[0]?.id ?? null;
  const history = Array.isArray(projectState.history)
    ? projectState.history.filter(
        (entry): entry is HistoryEntry =>
          !!entry &&
          typeof entry.id === 'string' &&
          typeof entry.label === 'string' &&
          !!entry.state,
      )
    : [];
  const historyIndex =
    typeof projectState.historyIndex === 'number'
      ? Math.max(0, Math.min(projectState.historyIndex, history.length - 1))
      : history.length - 1;

  set((state) => ({
    ...initialState,
    projectId,
    activeProjectBranchId: branchId,
    projectBranches: branches,
    flows: loadedFlows,
    rootFlowId,
    activeFlowId,
    nodes: loadedNodes,
    selectedNodeId,
    selectedNodeIds: selectedNodeId ? [selectedNodeId] : [],
    activeViewportTool: getDefaultViewportTool(selectedNode?.type),
    activeTab: projectState.activeTab || initialState.activeTab,
    colorManagement,
    viewerColorManagement: initialState.viewerColorManagement,
    aiChats: nextAiChats,
    aiAgentRuns: nextAiAgentRuns,
    activeAiAgentRunId: nextActiveAiAgentRunId,
    activeAiChatId: nextActiveAiChatId,
    currentFrame,
    timelineStartFrame: timelineRange.startFrame,
    maxFrames,
    fps,
    nodePositionsByFlow: projectState.nodePositionsByFlow || {},
    viewerNodeId: nextViewerNodeId,
    viewerSlots: nextViewerSlots,
    activeViewerSlot: nextActiveViewerSlot,
    renderSettings: {
      ...initialState.renderSettings,
      ...(projectState.renderSettings || {}),
    },
    viewerSettings: initialState.viewerSettings,
    backgroundJobs: state.backgroundJobs,
    history,
    historyIndex,
  }));
};

// ---------------------------------------------------------------------------
// Branch action methods (extracted from createProjectActions)
// ---------------------------------------------------------------------------

export const createProjectBranchService = async (
  set: SetState,
  get: GetState,
  deps: BranchDeps,
  name?: string,
  options?: { kind?: 'user' | 'agent' | 'review'; agentRunId?: string },
): Promise<string | null> => {
  const state = get();
  if (!state.projectId) return null;

  const sourceBranchId = state.activeProjectBranchId || getActiveProjectBranchId(state.projectId);
  await saveOpenProjectBranchSnapshot(get, deps);

  const branch = createProjectBranchRecord({
    projectId: state.projectId,
    name: name?.trim() || `branch-${new Date().toISOString().slice(0, 10)}`,
    kind: options?.kind ?? 'user',
    parentBranchId: sourceBranchId,
    createdByAgentRunId: options?.agentRunId,
    workingOwnerType: options?.kind === 'agent' ? 'agent' : undefined,
    workingOwnerId: options?.kind === 'agent' ? options?.agentRunId : undefined,
    defaultUserAccess: options?.kind === 'agent' ? 'read-only' : undefined,
  });
  const branchIndex = upsertProjectBranch(state.projectId, branch, branch.id);
  await saveProject(
    getProjectBranchStorageId(state.projectId, branch.id),
    buildPersistedProjectState(get(), {
      maxHistoryEntries: deps.getReopenHistoryLimit?.(),
    }),
  );

  set(() => ({
    activeProjectBranchId: branch.id,
    projectBranches: branchIndex.branches,
  }));

  return branch.id;
};

export const transferProjectBranchOwnershipService = async (
  set: SetState,
  get: GetState,
  deps: BranchDeps,
  branchId: string,
  ownership: {
    workingOwnerType: 'user' | 'agent' | 'mixed';
    workingOwnerId?: string;
    defaultUserAccess: 'read-only' | 'review' | 'editor';
  },
): Promise<boolean> => {
  const state = get();
  if (!state.projectId || branchId === MAIN_PROJECT_BRANCH_ID) return false;
  const branch = state.projectBranches.find((entry) => entry.id === branchId);
  if (!branch) return false;

  const branchIndex = updateProjectBranchOwnership(state.projectId, branchId, ownership);
  deps.commitMutation({
    patch: { projectBranches: branchIndex.branches },
    persist: 'debounced',
  });
  return true;
};

export const switchProjectBranchService = async (
  get: GetState,
  deps: BranchDeps,
  branchId: string,
  loadProjectStateIntoEditor: (params: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) => Promise<void>,
): Promise<void> => {
  const state = get();
  if (!state.projectId || state.activeProjectBranchId === branchId) return;

  const branches = getProjectBranches(state.projectId);
  if (!branches.some((branch) => branch.id === branchId)) return;

  await saveOpenProjectBranchSnapshot(get, deps);
  const projectState = await loadProjectState(getProjectBranchStorageId(state.projectId, branchId));
  if (!projectState) return;

  const branchIndex = setActiveProjectBranchId(state.projectId, branchId);
  await loadProjectStateIntoEditor({
    projectId: state.projectId,
    branchId,
    projectState,
    branches: branchIndex.branches,
  });
};

export const applyProjectBranchToParentService = async (
  get: GetState,
  deps: BranchDeps,
  branchId: string,
  loadProjectStateIntoEditor: (params: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) => Promise<void>,
): Promise<void> => {
  const state = get();
  if (!state.projectId || branchId === MAIN_PROJECT_BRANCH_ID) return;

  const branches = getProjectBranches(state.projectId);
  const branch = branches.find((entry) => entry.id === branchId);
  if (!branch) return;

  const parentBranchId =
    branch.parentBranchId && branches.some((entry) => entry.id === branch.parentBranchId)
      ? branch.parentBranchId
      : MAIN_PROJECT_BRANCH_ID;

  await saveOpenProjectBranchSnapshot(get, deps);

  const branchState = await loadProjectState(getProjectBranchStorageId(state.projectId, branchId));
  if (!branchState) return;

  const timestamp = Date.now();
  await saveProject(getProjectBranchStorageId(state.projectId, parentBranchId), branchState);
  touchProjectBranch(state.projectId, parentBranchId, timestamp);

  const branchIndex = upsertProjectBranch(
    state.projectId,
    {
      ...branch,
      status: 'merged',
      updatedAt: timestamp,
    },
    parentBranchId,
  );

  await loadProjectStateIntoEditor({
    projectId: state.projectId,
    branchId: parentBranchId,
    projectState: branchState,
    branches: branchIndex.branches,
  });
};

export const applyProjectBranchNodeChangesToParentService = async (
  get: GetState,
  deps: BranchDeps,
  branchId: string,
  loadProjectStateIntoEditor: (params: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) => Promise<void>,
): Promise<void> => {
  const state = get();
  if (!state.projectId || branchId === MAIN_PROJECT_BRANCH_ID) return;

  const branches = getProjectBranches(state.projectId);
  const branch = branches.find((entry) => entry.id === branchId);
  if (!branch) return;

  const parentBranchId =
    branch.parentBranchId && branches.some((entry) => entry.id === branch.parentBranchId)
      ? branch.parentBranchId
      : MAIN_PROJECT_BRANCH_ID;

  await saveOpenProjectBranchSnapshot(get, deps);

  const [parentState, branchState] = await Promise.all([
    loadProjectState(getProjectBranchStorageId(state.projectId, parentBranchId)),
    loadProjectState(getProjectBranchStorageId(state.projectId, branchId)),
  ]);
  if (!parentState || !branchState) return;

  const timestamp = Date.now();
  const result = cherryPickAgentNodeChanges(parentState, branchState);

  await saveProject(getProjectBranchStorageId(state.projectId, parentBranchId), result.state);
  touchProjectBranch(state.projectId, parentBranchId, timestamp);

  const branchIndex = setActiveProjectBranchId(state.projectId, parentBranchId);
  await loadProjectStateIntoEditor({
    projectId: state.projectId,
    branchId: parentBranchId,
    projectState: result.state,
    branches: branchIndex.branches,
  });
};

export const deleteProjectBranchService = async (
  set: SetState,
  get: GetState,
  branchId: string,
  loadProjectStateIntoEditor: (params: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) => Promise<void>,
): Promise<void> => {
  const state = get();
  if (!state.projectId || branchId === MAIN_PROJECT_BRANCH_ID) return;

  const branches = getProjectBranches(state.projectId);
  const branch = branches.find((entry) => entry.id === branchId);
  if (!branch) return;

  const activeBranchId = state.activeProjectBranchId || getActiveProjectBranchId(state.projectId);
  const fallbackBranchId =
    branch.parentBranchId && branches.some((entry) => entry.id === branch.parentBranchId)
      ? branch.parentBranchId
      : MAIN_PROJECT_BRANCH_ID;

  if (activeBranchId === branchId) {
    const fallbackProjectState = await loadProjectState(
      getProjectBranchStorageId(state.projectId, fallbackBranchId),
    );
    if (!fallbackProjectState) return;

    const branchIndex = deleteProjectBranchRecord(state.projectId, branchId, fallbackBranchId);
    await deleteProjectFromStorage(getProjectBranchStorageId(state.projectId, branchId));
    await loadProjectStateIntoEditor({
      projectId: state.projectId,
      branchId: branchIndex.activeBranchId,
      projectState: fallbackProjectState,
      branches: branchIndex.branches,
    });
    return;
  }

  const branchIndex = deleteProjectBranchRecord(state.projectId, branchId);
  await deleteProjectFromStorage(getProjectBranchStorageId(state.projectId, branchId));
  set(() => ({ projectBranches: branchIndex.branches }));
};
