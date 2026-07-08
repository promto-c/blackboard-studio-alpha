import type { RefObject } from 'react';
import {
  AnyNode,
  GeneratedOutput,
  RotoNode,
  TrackingConfig,
  type ProjectColorManagement,
} from '@blackboard/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  saveProject,
  loadProjectState,
  touchProjectBranch,
  type ProjectBranchRecord,
} from '@/state/persist';

import { type StoredProjectState } from '@/state/editor/projectSnapshots';
import { type GalleryEntry } from '@blackboard/project-store';

import { getInitialState } from '@/state/editor/initialState';

import { type SequenceImportMode } from '@/state/editor/utils';

import type { SetState, GetState } from '@/state/editor/slices/types';
import { getOrderedNodesFromFlow, getRootFlow, replaceFlowNodes } from '@/state/editor/flowModel';

import { type RotoTrackingTarget } from '@/utils/rotoTracking';

import {
  type BackgroundJobInput,
  type BackgroundJobUpdate,
} from '@/state/editor/services/backgroundJobs';

import {
  type ComfyApplyTarget,
  type ComfyNodeRunUpdates,
  type ComfyGallerySyncMode,
  syncComfyGeneratedOutputsWithGalleryEntriesService,
  applyComfyNodeRunResultService,
} from '@/state/editor/services/comfySync';
import {
  type RotoTrackingRunOptions,
  cancelTrackingService,
  clearRotoTrackingTargetService,
  trackRotoSelectionService,
  smartTrackRotoSelectionService,
} from '@/state/editor/services/rotoTracking';
import {
  type ProjectBranchContext,
  getProjectBranchContext as getProjectBranchContextService,
  isCurrentProjectBranchContext as isCurrentProjectBranchContextService,
  setIfCurrentProjectBranch as setIfCurrentProjectBranchService,
  updateProjectIndexModified as updateProjectIndexModifiedService,
  saveOpenProjectBranchSnapshot as saveOpenProjectBranchSnapshotService,
  loadProjectStateIntoEditor as loadProjectStateIntoEditorService,
  createProjectBranchService,
  transferProjectBranchOwnershipService,
  switchProjectBranchService,
  applyProjectBranchToParentService,
  applyProjectBranchNodeChangesToParentService,
  deleteProjectBranchService,
} from '@/state/editor/services/projectBranch';
import {
  loadImageService,
  loadImageSequenceService,
  loadImageSequenceFromDirectoryService,
  replaceNodeSourceService,
  replaceNodeSourceSequenceService,
} from '@/state/editor/services/projectImport';
import {
  setProjectThumbnailService,
  closeProjectService,
  createNewProjectService,
  createNewProjectFromFilesService,
  createNewProjectFromDirectoryService,
  createNewProjectFromDimensionsService,
  importProjectFileService,
  exportProjectFileService,
  loadProjectService,
  deleteProjectService,
  type ProjectOpenTarget,
} from '@/state/editor/services/projectManagement';

export function createProjectActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation;
    getNewProjectColorManagement?: () => ProjectColorManagement;
    getReopenHistoryLimit?: () => number;
    getAutoCheckpointEnabled?: () => boolean;
    trackingAbortController: RefObject<AbortController | null>;
    startBackgroundJob?: (input: BackgroundJobInput) => string;
    updateBackgroundJob?: (jobId: string, updates: BackgroundJobUpdate) => void;
    finishBackgroundJob?: (jobId: string, updates?: BackgroundJobUpdate) => void;
  },
) {
  // ---------------------------------------------------------------------------
  // Node factory helpers — reduce construction duplication across project actions
  // ---------------------------------------------------------------------------
  const updateProjectIndexModified = (
    projectId: string,
    timestamp = Date.now(),
    thumbnail?: string | null,
  ) => updateProjectIndexModifiedService(projectId, get, timestamp, thumbnail);

  const getProjectBranchContext = (): ProjectBranchContext => {
    const { projectId, activeProjectBranchId } = get();
    return getProjectBranchContextService(projectId, activeProjectBranchId);
  };

  const isCurrentProjectBranchContext = (context: ProjectBranchContext): boolean =>
    isCurrentProjectBranchContextService(get(), context);

  const setIfCurrentProjectBranch = (
    context: ProjectBranchContext,
    patch: Partial<ReturnType<typeof getInitialState> & { maxFrames: number }>,
  ) => setIfCurrentProjectBranchService(set, get, context, patch);

  const branchDeps = {
    commitMutation: deps.commitMutation,
    getReopenHistoryLimit: deps.getReopenHistoryLimit,
    getAutoCheckpointEnabled: deps.getAutoCheckpointEnabled,
  };

  const trackingDeps = {
    trackingAbortController: deps.trackingAbortController,
    startBackgroundJob: deps.startBackgroundJob,
    updateBackgroundJob: deps.updateBackgroundJob,
    finishBackgroundJob: deps.finishBackgroundJob,
  };

  const getNewProjectCreationOptions = () => ({
    colorManagement: deps.getNewProjectColorManagement?.(),
  });

  const applyRotoTrackingResult = async ({
    context,
    rotoNodeId,
    trackedNode,
    trackingLabel,
  }: {
    context: ProjectBranchContext;
    rotoNodeId: string;
    trackedNode: RotoNode;
    trackingLabel: string;
  }): Promise<'current' | 'saved' | 'missing'> => {
    if (isCurrentProjectBranchContext(context)) {
      const state = get();
      if (!state.nodes.some((node) => node.id === rotoNodeId)) return 'missing';

      const nextNodes = state.nodes.map((node) =>
        node.id === rotoNodeId ? (trackedNode as AnyNode) : node,
      );
      deps.commitMutation({
        patch: { nodes: nextNodes },
        history: {
          label: trackingLabel,
          state: { nodes: nextNodes, selectedNodeId: rotoNodeId },
        },
      });
      return 'current';
    }

    if (!context.projectId || !context.storageId) return 'missing';

    const projectState = await loadProjectState(context.storageId);
    if (!projectState) return 'missing';

    const rootFlowId = projectState.rootFlowId || null;
    const rootFlow = getRootFlow(projectState.flows || {}, rootFlowId);
    const nodes = getOrderedNodesFromFlow(rootFlow);
    if (!nodes.some((node) => node.id === rotoNodeId)) return 'missing';

    const nextNodes = nodes.map((node) =>
      node.id === rotoNodeId ? (trackedNode as AnyNode) : node,
    );
    const nextFlows = replaceFlowNodes(
      projectState.flows || {},
      rootFlowId,
      nextNodes,
      rootFlow?.name ?? 'Root Flow',
    );
    await saveProject(context.storageId, {
      ...projectState,
      flows: nextFlows,
      selectedNodeId: rotoNodeId,
    });

    const timestamp = Date.now();
    touchProjectBranch(context.projectId, context.branchId, timestamp);
    updateProjectIndexModified(context.projectId, timestamp);

    return 'saved';
  };

  const saveOpenProjectBranchSnapshot = async () =>
    saveOpenProjectBranchSnapshotService(get, branchDeps);

  const loadProjectStateIntoEditor = async ({
    projectId,
    branchId,
    projectState,
    branches,
  }: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) =>
    loadProjectStateIntoEditorService({
      projectId,
      branchId,
      projectState,
      branches,
      set,
    });

  const projectActions = {
    setProjectThumbnail: (thumbnail: string | null) => {
      setProjectThumbnailService(set, get, thumbnail);
    },

    syncComfyGeneratedOutputsWithGalleryEntries: async ({
      entries,
      mode,
      deletedAt,
    }: {
      entries: GalleryEntry[];
      mode: ComfyGallerySyncMode;
      deletedAt?: number;
    }) => {
      await syncComfyGeneratedOutputsWithGalleryEntriesService(
        set,
        get,
        { commitMutation: deps.commitMutation },
        entries,
        mode,
        deletedAt,
      );
    },

    applyComfyNodeRunResult: async ({
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
      return applyComfyNodeRunResultService({
        set,
        get,
        deps: { commitMutation: deps.commitMutation },
        projectId,
        branchId,
        nodeId,
        updates,
        newGeneratedOutputs,
        withHistory,
        historyLabel,
        noticeLabel,
        galleryNoticeLabel,
        expectedHistoryId,
      });
    },

    closeProject: () => {
      closeProjectService(set, get, saveOpenProjectBranchSnapshot);
    },

    createNewProject: async (file: File) => {
      await createNewProjectService(set, get, file, getNewProjectCreationOptions());
    },

    createNewProjectFromFiles: async (files: File[]) => {
      await createNewProjectFromFilesService(set, get, files, getNewProjectCreationOptions());
    },

    createNewProjectFromDirectory: async (
      directoryHandle: FileSystemDirectoryHandle,
      importMode: SequenceImportMode = 'copy',
    ) => {
      await createNewProjectFromDirectoryService(
        set,
        get,
        directoryHandle,
        importMode,
        getNewProjectCreationOptions(),
      );
    },

    createNewProjectFromDimensions: (name: string, width: number, height: number) => {
      createNewProjectFromDimensionsService(
        set,
        get,
        name,
        width,
        height,
        getNewProjectCreationOptions(),
      );
    },

    importProjectFile: async (
      file: File,
      referenceDirectoriesByGroupId?: ReadonlyMap<string, FileSystemDirectoryHandle>,
    ) => {
      await importProjectFileService(
        file,
        (projectId: string) => projectActions.loadProject(projectId),
        referenceDirectoriesByGroupId,
      );
    },

    exportProjectFile: async (projectId?: string) => {
      await exportProjectFileService(
        get,
        { getReopenHistoryLimit: deps.getReopenHistoryLimit },
        projectId,
      );
    },

    loadProject: async (projectId: string, target?: ProjectOpenTarget) => {
      await loadProjectService(
        get,
        projectId,
        saveOpenProjectBranchSnapshot,
        loadProjectStateIntoEditor,
        target,
      );
    },

    createProjectBranch: async (
      name?: string,
      options?: { kind?: 'user' | 'agent' | 'review'; agentRunId?: string },
    ): Promise<string | null> => {
      return createProjectBranchService(set, get, branchDeps, name, options);
    },

    transferProjectBranchOwnership: async (
      branchId: string,
      ownership: {
        workingOwnerType: 'user' | 'agent' | 'mixed';
        workingOwnerId?: string;
        defaultUserAccess: 'read-only' | 'review' | 'editor';
      },
    ): Promise<boolean> => {
      return transferProjectBranchOwnershipService(set, get, branchDeps, branchId, ownership);
    },

    switchProjectBranch: async (branchId: string): Promise<void> => {
      await switchProjectBranchService(get, branchDeps, branchId, loadProjectStateIntoEditor);
    },

    applyProjectBranchToParent: async (branchId: string): Promise<void> => {
      await applyProjectBranchToParentService(
        get,
        branchDeps,
        branchId,
        loadProjectStateIntoEditor,
      );
    },

    applyProjectBranchNodeChangesToParent: async (branchId: string): Promise<void> => {
      await applyProjectBranchNodeChangesToParentService(
        get,
        branchDeps,
        branchId,
        loadProjectStateIntoEditor,
      );
    },

    deleteProjectBranch: async (branchId: string): Promise<void> => {
      await deleteProjectBranchService(set, get, branchId, loadProjectStateIntoEditor);
    },

    deleteProject: async (projectId: string) => {
      await deleteProjectService(get, projectId);
    },

    loadImage: async (file: File) => {
      await loadImageService(get, { commitMutation: deps.commitMutation }, file, (f: File) =>
        projectActions.createNewProject(f),
      );
    },

    loadImageSequence: async (files: File[]) => {
      await loadImageSequenceService(get, { commitMutation: deps.commitMutation }, files);
    },

    loadImageSequenceFromDirectory: async (
      directoryHandle: FileSystemDirectoryHandle,
      importMode: SequenceImportMode = 'copy',
    ) => {
      await loadImageSequenceFromDirectoryService(
        get,
        { commitMutation: deps.commitMutation },
        directoryHandle,
        importMode,
        (dh: FileSystemDirectoryHandle, im: SequenceImportMode) =>
          projectActions.createNewProjectFromDirectory(dh, im),
      );
    },

    replaceNodeSource: async (nodeId: string, file: File) => {
      await replaceNodeSourceService(get, { commitMutation: deps.commitMutation }, nodeId, file);
    },

    replaceNodeSourceSequence: async (nodeId: string, files: File[]) => {
      await replaceNodeSourceSequenceService(
        get,
        { commitMutation: deps.commitMutation },
        nodeId,
        files,
      );
    },

    // --- Tracking actions ---

    cancelTracking: () => {
      cancelTrackingService(trackingDeps);
    },

    trackRotoSelection: async (
      rotoNodeId: string,
      sourcePathIds: string[],
      target: RotoTrackingTarget,
      sourceId: string,
      direction: 'forward' | 'backward',
      frameCount: number,
      config: TrackingConfig,
      options: RotoTrackingRunOptions = {},
    ) => {
      await trackRotoSelectionService(
        get,
        trackingDeps,
        rotoNodeId,
        sourcePathIds,
        target,
        sourceId,
        direction,
        frameCount,
        config,
        options,
        getProjectBranchContext,
        applyRotoTrackingResult,
        setIfCurrentProjectBranch,
      );
    },

    smartTrackRotoSelection: async (
      rotoNodeId: string,
      sourcePathIds: string[],
      target: RotoTrackingTarget,
      sourceId: string,
      config: TrackingConfig,
      options: RotoTrackingRunOptions = {},
    ) => {
      await smartTrackRotoSelectionService(
        get,
        trackingDeps,
        rotoNodeId,
        sourcePathIds,
        target,
        sourceId,
        config,
        options,
        getProjectBranchContext,
        applyRotoTrackingResult,
        setIfCurrentProjectBranch,
      );
    },

    clearRotoTrackingTarget: (rotoNodeId: string, target: RotoTrackingTarget) => {
      clearRotoTrackingTargetService(
        set,
        get,
        { commitMutation: deps.commitMutation },
        rotoNodeId,
        target,
      );
    },
  };

  return projectActions;
}
