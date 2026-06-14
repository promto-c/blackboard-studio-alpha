import { type AnyNode, EditorTab } from '@blackboard/types';
import {
  SCHEMA_VERSION,
  saveProject,
  loadProjectState,
  saveProjectIndex,
  getProjectIndex,
  deleteProject as deleteProjectFromStorage,
  getActiveProjectBranchId,
  getProjectBranches,
  getProjectBranchStorageId,
  initializeProjectBranches,
  ensureProjectBranches,
  setActiveProjectBranchId,
  deleteProjectBranchRecords,
} from '@/state/persist';
import { saveAsset, deleteAssets } from '@/state/assetStorage';
import { buildProjectInitState } from '@/state/editor/actions';
import { getInitialState, getInitialHistoryEntry } from '@/state/editor/initialState';
import { exportProjectBundle, importProjectBundle } from '@/state/projectTransfer';
import {
  buildPersistedProjectState,
  type StoredProjectState,
} from '@/state/editor/projectSnapshots';
import {
  type SequenceImportMode,
  readImageDimensions,
  getSequenceProjectName,
  collectImageEntriesFromDirectoryHandle,
  buildImageEntriesFromFiles,
  persistSequenceAssets,
  collectNodeAssetIds,
} from '@/state/editor/utils';
import { getMediaFileKind } from '@/utils/mediaFiles';
import { getImportedImageColorSpace } from '@/utils/mediaFiles';
import { readVideoMetadata, triggerDownload } from '@/utils/mediaUtils';
import { createMediaSourceNode, createSceneNode, createSequenceNode } from '@/utils/graphCommands';
import {
  collectGalleryProtectedAssets,
  protectGalleryGeneratedOutputs,
} from '@/state/editor/services/comfySync';
import type { GetState, SetState } from '@/state/editor/slices/types';
import { getOrderedNodesFromFlow, getRootFlow } from '@/state/editor/flowModel';
import type { ProjectBranchRecord } from '@/state/persist';

// ---------------------------------------------------------------------------
// Type for the deps needed by project management methods
// ---------------------------------------------------------------------------

export type ProjectManagementDeps = {
  getReopenHistoryLimit?: () => number;
};

// ---------------------------------------------------------------------------
// setupNewProject — shared helper for all createNewProject* methods
// ---------------------------------------------------------------------------

const setupNewProject = (
  set: SetState,
  newProjectId: string,
  projectName: string,
  nodes: AnyNode[],
  selectedId: string,
  maxFrames = 0,
) => {
  const fps = 30;
  const { historyEntry, persistedState } = buildProjectInitState({
    nodes,
    selectedNodeId: selectedId,
    fps,
  });
  const branchIndex = initializeProjectBranches(newProjectId);
  set((state) => ({
    ...getInitialState(),
    backgroundJobs: state.backgroundJobs,
    projectId: newProjectId,
    activeProjectBranchId: branchIndex.activeBranchId,
    projectBranches: branchIndex.branches,
    nodes,
    nodePositionsByFlow: persistedState.nodePositionsByFlow ?? {},
    selectedNodeId: selectedId,
    activeTab: EditorTab.Flow,
    history: [historyEntry],
    historyIndex: 0,
    maxFrames,
    fps,
  }));
  const index = getProjectIndex();
  saveProjectIndex([
    {
      id: newProjectId,
      name: projectName,
      lastModified: Date.now(),
      schemaVersion: SCHEMA_VERSION,
    },
    ...index,
  ]);
  void saveProject(newProjectId, persistedState);
};

// ---------------------------------------------------------------------------
// setProjectThumbnail
// ---------------------------------------------------------------------------

export const setProjectThumbnailService = (
  set: SetState,
  get: GetState,
  thumbnail: string | null,
) => {
  const prevAssetId = get().thumbnailAssetId;
  set(() => ({ thumbnail }));
  if (thumbnail) {
    fetch(thumbnail)
      .then((r) => r.blob())
      .then((blob) => saveAsset(blob))
      .then((assetId) => {
        set(() => ({ thumbnailAssetId: assetId }));
        if (prevAssetId) deleteAssets([prevAssetId]).catch(() => {});
      })
      .catch(() => {});
  } else if (prevAssetId) {
    deleteAssets([prevAssetId]).catch(() => {});
    set(() => ({ thumbnailAssetId: undefined }));
  }
};

// ---------------------------------------------------------------------------
// closeProject
// ---------------------------------------------------------------------------

export const closeProjectService = (
  set: SetState,
  _get: GetState,
  saveOpenProjectBranchSnapshot: () => Promise<void>,
) => {
  void (async () => {
    await saveOpenProjectBranchSnapshot();
    set((state) => ({
      ...getInitialState(),
      backgroundJobs: state.backgroundJobs,
      history: [getInitialHistoryEntry()],
      historyIndex: 0,
      maxFrames: 0,
    }));
  })();
};

// ---------------------------------------------------------------------------
// createNewProject
// ---------------------------------------------------------------------------

export const createNewProjectService = async (set: SetState, _get: GetState, file: File) => {
  const newProjectId = `proj_${Date.now()}`;
  const projectName = file.name.split('.').slice(0, -1).join('.') || 'New Project';
  const mediaKind = getMediaFileKind(file);

  if (mediaKind === 'image') {
    const { width, height } = await readImageDimensions(file);
    const assetId = await saveAsset(file);
    const mediaNode = createMediaSourceNode({
      name: file.name,
      src: assetId,
      sourceFileName: file.name,
      mediaKind: 'image',
      width,
      height,
      colorSpace: getImportedImageColorSpace(file),
    });
    const newSceneNode = createSceneNode({ width, height });
    setupNewProject(set, newProjectId, projectName, [newSceneNode, mediaNode], mediaNode.id, 0);
  } else if (mediaKind === 'video') {
    const { width, height, duration } = await readVideoMetadata(file);
    const assetId = await saveAsset(file);
    const fps = 30;
    const totalFrames = Math.floor(duration * fps);
    const newSceneNode = createSceneNode({
      width,
      height,
      maxFrames: totalFrames,
      fps,
    });
    const mediaNode = createMediaSourceNode({
      name: file.name,
      src: assetId,
      sourceFileName: file.name,
      mediaKind: 'video',
      width,
      height,
      duration,
    });
    setupNewProject(
      set,
      newProjectId,
      projectName,
      [newSceneNode, mediaNode],
      mediaNode.id,
      totalFrames,
    );
  }
};

export const createNewProjectFromFilesService = async (
  set: SetState,
  _get: GetState,
  files: File[],
) => {
  const imageEntries = buildImageEntriesFromFiles(files);
  if (imageEntries.length === 0) return;

  const firstEntry = imageEntries[0];
  const { width, height } = await readImageDimensions(firstEntry.file);
  const assetIds = await persistSequenceAssets(imageEntries, 'copy');

  const newProjectId = `proj_${Date.now()}`;
  const projectName = getSequenceProjectName(firstEntry.relativePath);

  const newSceneNode = createSceneNode({ width, height, maxFrames: assetIds.length - 1 });
  const sequenceNode = createSequenceNode({
    name: projectName,
    frames: assetIds,
    width,
    height,
    colorSpace: getImportedImageColorSpace(firstEntry.file),
  });

  setupNewProject(
    set,
    newProjectId,
    projectName,
    [newSceneNode, sequenceNode],
    sequenceNode.id,
    assetIds.length - 1,
  );
};

export const createNewProjectFromDirectoryService = async (
  set: SetState,
  _get: GetState,
  directoryHandle: FileSystemDirectoryHandle,
  importMode: SequenceImportMode = 'copy',
) => {
  const imageEntries = await collectImageEntriesFromDirectoryHandle(directoryHandle);
  if (imageEntries.length === 0) return;

  const firstEntry = imageEntries[0];
  const { width, height } = await readImageDimensions(firstEntry.file);
  const assetIds = await persistSequenceAssets(imageEntries, importMode, directoryHandle);

  const newProjectId = `proj_${Date.now()}`;
  const projectName = directoryHandle.name || getSequenceProjectName(firstEntry.relativePath);

  const newSceneNode = createSceneNode({ width, height, maxFrames: assetIds.length - 1 });
  const sequenceNode = createSequenceNode({
    name: projectName,
    frames: assetIds,
    width,
    height,
    colorSpace: getImportedImageColorSpace(firstEntry.file),
  });

  setupNewProject(
    set,
    newProjectId,
    projectName,
    [newSceneNode, sequenceNode],
    sequenceNode.id,
    assetIds.length - 1,
  );
};

export const createNewProjectFromDimensionsService = (
  set: SetState,
  _get: GetState,
  name: string,
  width: number,
  height: number,
) => {
  const newProjectId = `proj_${Date.now()}`;
  const newSceneNode = createSceneNode({ width, height, maxFrames: 120 });
  const newNodes: AnyNode[] = [newSceneNode];
  setupNewProject(set, newProjectId, name, newNodes, newSceneNode.id, 120);
};

// ---------------------------------------------------------------------------
// importProjectFile
// ---------------------------------------------------------------------------

export const importProjectFileService = async (
  file: File,
  loadProject: (projectId: string) => Promise<void>,
  referenceDirectoriesByGroupId?: ReadonlyMap<string, FileSystemDirectoryHandle>,
) => {
  const importedProject = await importProjectBundle(file, {
    referenceDirectoriesByGroupId,
  });
  const newProjectId = `proj_${Date.now()}`;
  initializeProjectBranches(newProjectId);
  const index = getProjectIndex();

  saveProjectIndex([
    {
      id: newProjectId,
      name: importedProject.projectName,
      lastModified: Date.now(),
      thumbnail: importedProject.thumbnail ?? undefined,
      schemaVersion: SCHEMA_VERSION,
    },
    ...index,
  ]);

  await saveProject(newProjectId, importedProject.state);
  await loadProject(newProjectId);
};

// ---------------------------------------------------------------------------
// exportProjectFile
// ---------------------------------------------------------------------------

export const exportProjectFileService = async (
  get: GetState,
  deps: ProjectManagementDeps,
  projectId?: string,
) => {
  const activeProjectId = get().projectId;
  const targetProjectId = projectId ?? activeProjectId;
  if (!targetProjectId) {
    throw new Error('No project is available to export.');
  }

  const indexEntry = getProjectIndex().find((entry) => entry.id === targetProjectId);
  const projectName = indexEntry?.name || 'Project';

  const state =
    activeProjectId === targetProjectId
      ? buildPersistedProjectState(get(), {
          maxHistoryEntries: deps.getReopenHistoryLimit?.(),
        })
      : await loadProjectState(
          getProjectBranchStorageId(targetProjectId, getActiveProjectBranchId(targetProjectId)),
        );

  if (!state) {
    throw new Error('Could not load the selected project for export.');
  }

  const { blob, filename } = await exportProjectBundle({
    projectName,
    thumbnail: activeProjectId === targetProjectId ? get().thumbnail : indexEntry?.thumbnail,
    state,
  });

  triggerDownload(blob, filename);
};

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// loadProject
// ---------------------------------------------------------------------------

export const loadProjectService = async (
  get: GetState,
  projectId: string,
  saveOpenProjectBranchSnapshot: () => Promise<void>,
  loadProjectStateIntoEditor: (params: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) => Promise<void>,
) => {
  const currentProjectId = get().projectId;
  if (currentProjectId && currentProjectId !== projectId) {
    await saveOpenProjectBranchSnapshot();
  }

  const branchIndex = ensureProjectBranches(projectId);
  let branchId = branchIndex.activeBranchId;
  let projectState = await loadProjectState(getProjectBranchStorageId(projectId, branchId));

  if (!projectState && branchId !== 'main') {
    branchId = 'main';
    setActiveProjectBranchId(projectId, branchId);
    projectState = await loadProjectState(projectId);
  }

  if (!projectState) return;

  await loadProjectStateIntoEditor({
    projectId,
    branchId,
    projectState,
    branches: getProjectBranches(projectId),
  });
};

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------

export const deleteProjectService = async (_get: GetState, projectId: string) => {
  const assetIds = new Set<string>();
  const galleryProtectedAssets = await collectGalleryProtectedAssets(projectId);
  const branches = getProjectBranches(projectId);

  const indexEntry = getProjectIndex().find((e) => e.id === projectId);
  if (indexEntry?.thumbnailAssetId) {
    assetIds.add(indexEntry.thumbnailAssetId);
  }

  for (const branch of branches) {
    const projectState = await loadProjectState(getProjectBranchStorageId(projectId, branch.id));
    if (projectState?.flows && projectState.rootFlowId) {
      const persistedNodes = getOrderedNodesFromFlow(
        getRootFlow(projectState.flows, projectState.rootFlowId),
      );
      protectGalleryGeneratedOutputs(
        galleryProtectedAssets.assetIds,
        persistedNodes,
        galleryProtectedAssets.targets,
      );
      collectNodeAssetIds(persistedNodes).forEach((assetId) => assetIds.add(assetId));
    }
  }

  galleryProtectedAssets.assetIds.forEach((assetId) => assetIds.delete(assetId));
  if (assetIds.size > 0) await deleteAssets(Array.from(assetIds));
  await Promise.all(
    branches
      .filter((branch) => branch.id !== 'main')
      .map((branch) => deleteProjectFromStorage(getProjectBranchStorageId(projectId, branch.id))),
  );
  await deleteProjectFromStorage(projectId);
  deleteProjectBranchRecords(projectId);
};
