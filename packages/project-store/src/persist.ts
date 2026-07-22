import {
  type PersistedProjectState,
  type ProjectIndexEntry,
  type ProjectStorageMode,
  type ProjectStorageWorkflow,
  validateRootFlow,
} from '@blackboard/types';
import {
  deleteProjectStateFromDB,
  listProjectStateIdsFromDB,
  loadProjectStateFromDB,
  saveProjectStateToDB,
} from './assetStorage';
import {
  BROWSER_STORAGE_MOUNT_ID,
  StorageMountPaths,
  deleteStorageFile,
  deleteStorageTree,
  getDefaultStorageMountId,
  getStorageMount,
  joinStorageMountPath,
  listStorageFiles,
  listStorageMounts,
  normalizeStorageMountPath,
  readStorageFile,
  writeStorageFile,
} from './storageMounts';

const PROJECT_INDEX_KEY = 'blackboard-studio-project-index';
const PROJECT_BINDINGS_KEY = 'blackboard-studio-project-storage-bindings';
const PROJECT_DEFAULT_WORKFLOW_KEY = 'blackboard-studio-project-storage-workflow';
const PROJECT_STORAGE_CHANGED_EVENT = 'blackboard-project-storage-changed';
const MOUNTED_PROJECT_FORMAT = 'blackboard-studio-mounted-project';
const MOUNTED_PROJECT_VERSION = 2;

export const SCHEMA_VERSION = 1;

export interface ProjectStorageBinding {
  projectId: string;
  mountId: string;
  rootPath: string;
  boundAt: number;
  mode: ProjectStorageMode;
  /** Last local document revision observed by push/pull. Clone mode only. */
  localRevision?: string;
  /** Local revision included by the most recent successful push or pull. */
  lastSyncedLocalRevision?: string;
  /** Upstream manifest revision observed by the most recent successful push or pull. */
  remoteRevision?: string;
  lastPulledAt?: number;
  lastPushedAt?: number;
}

interface MountedProjectManifest {
  format: typeof MOUNTED_PROJECT_FORMAT;
  version: typeof MOUNTED_PROJECT_VERSION;
  project: ProjectIndexEntry;
  states: string[];
  revision: string;
  parentRevision?: string;
  metadata?: unknown;
  updatedAt: number;
}

export interface ProjectStorageMetadataProvider {
  key: string;
  read(projectId: string): unknown;
  write(projectId: string, metadata: unknown): void;
}

export type ProjectSyncState =
  | 'browser-only'
  | 'direct'
  | 'up-to-date'
  | 'local-ahead'
  | 'remote-ahead'
  | 'diverged'
  | 'offline';

export interface ProjectSyncStatus {
  state: ProjectSyncState;
  binding: ProjectStorageBinding | null;
  localChanged: boolean;
  remoteChanged: boolean;
  remoteRevision?: string;
}

type StoredProjectState = PersistedProjectState;
type ProjectBindings = Record<string, ProjectStorageBinding>;

let memoryProjectIndex: ProjectIndexEntry[] = [];
let memoryBindings: ProjectBindings = {};
let memoryDefaultProjectWorkflow: ProjectStorageWorkflow = 'browser-only';
const manifestWriteQueues = new Map<string, Promise<string>>();
const projectSyncQueues = new Map<string, Promise<unknown>>();
const projectStorageMetadataProviders = new Map<string, ProjectStorageMetadataProvider>();

const canUseLocalStorage = (): boolean => typeof localStorage !== 'undefined';

const createRevision = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rev_${crypto.randomUUID()}`;
  }
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const emitProjectStorageChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PROJECT_STORAGE_CHANGED_EVENT));
  }
};

export const subscribeToProjectStorage = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PROJECT_STORAGE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PROJECT_STORAGE_CHANGED_EVENT, listener);
};

export const getDefaultProjectStorageWorkflow = (): ProjectStorageWorkflow => {
  if (!canUseLocalStorage()) return memoryDefaultProjectWorkflow;
  const value = localStorage.getItem(PROJECT_DEFAULT_WORKFLOW_KEY);
  return value === 'direct' || value === 'local-clone' ? value : 'browser-only';
};

export const setDefaultProjectStorageWorkflow = (workflow: ProjectStorageWorkflow): void => {
  memoryDefaultProjectWorkflow = workflow;
  if (canUseLocalStorage()) localStorage.setItem(PROJECT_DEFAULT_WORKFLOW_KEY, workflow);
  emitProjectStorageChanged();
};

export const registerProjectStorageMetadataProvider = (
  provider: ProjectStorageMetadataProvider,
): (() => void) => {
  if (!provider.key.trim()) throw new Error('Project storage metadata providers need a key.');
  projectStorageMetadataProviders.set(provider.key, provider);
  return () => {
    if (projectStorageMetadataProviders.get(provider.key) === provider) {
      projectStorageMetadataProviders.delete(provider.key);
    }
  };
};

const readProjectStorageMetadata = (projectId: string): unknown => {
  if (projectStorageMetadataProviders.size === 0) return undefined;
  return Object.fromEntries(
    Array.from(projectStorageMetadataProviders, ([key, provider]) => [
      key,
      provider.read(projectId),
    ]),
  );
};

const applyProjectStorageMetadata = (projectId: string, metadata: unknown): void => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return;
  projectStorageMetadataProviders.forEach((provider, key) => {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      provider.write(projectId, (metadata as Record<string, unknown>)[key]);
    }
  });
};

const runProjectSyncOperation = async <T>(projectId: string, operation: () => Promise<T>) => {
  const previous = projectSyncQueues.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  projectSyncQueues.set(projectId, next);
  try {
    return await next;
  } finally {
    if (projectSyncQueues.get(projectId) === next) projectSyncQueues.delete(projectId);
  }
};

const readRawProjectIndex = (): ProjectIndexEntry[] => {
  if (!canUseLocalStorage()) return memoryProjectIndex;
  try {
    const serializedIndex = localStorage.getItem(PROJECT_INDEX_KEY);
    if (!serializedIndex) return [];
    const index = JSON.parse(serializedIndex);
    return Array.isArray(index) ? index : [];
  } catch (error) {
    console.error('Could not load project index from localStorage', error);
    return [];
  }
};

const writeRawProjectIndex = (index: ProjectIndexEntry[]): void => {
  memoryProjectIndex = index;
  if (!canUseLocalStorage()) return;
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(index));
};

const readBindings = (): ProjectBindings => {
  if (!canUseLocalStorage()) return memoryBindings;
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_BINDINGS_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as ProjectBindings;
  } catch (error) {
    console.warn('Could not load project storage bindings.', error);
    return {};
  }
};

const writeBindings = (bindings: ProjectBindings): void => {
  memoryBindings = bindings;
  if (!canUseLocalStorage()) return;
  localStorage.setItem(PROJECT_BINDINGS_KEY, JSON.stringify(bindings));
};

const getBaseProjectId = (storageId: string): string => {
  if (!storageId.startsWith('project:')) return storageId;
  const branchMarker = ':branch:';
  const markerIndex = storageId.indexOf(branchMarker, 'project:'.length);
  return markerIndex < 0 ? storageId : storageId.slice('project:'.length, markerIndex);
};

const isProjectStorageId = (storageId: string, projectId: string): boolean =>
  storageId === projectId || storageId.startsWith(`project:${projectId}:branch:`);

const getDefaultProjectRootPath = (projectId: string): string =>
  joinStorageMountPath(StorageMountPaths.projects, encodeURIComponent(projectId));

const getProjectStatePath = (binding: ProjectStorageBinding, storageId: string): string =>
  joinStorageMountPath(binding.rootPath, 'states', `${encodeURIComponent(storageId)}.json`);

const getProjectManifestPath = (binding: ProjectStorageBinding): string =>
  joinStorageMountPath(binding.rootPath, 'project.json');

const stripSessionState = (state: StoredProjectState): StoredProjectState => {
  const { projectId: _projectId, ...documentState } = state as StoredProjectState & {
    projectId?: unknown;
  };
  return documentState;
};

const assertStoredProjectState = (projectId: string, state: StoredProjectState): void => {
  if (state.rootFlowId && state.flows && state.flows[state.rootFlowId]) {
    const issues = validateRootFlow(state.flows[state.rootFlowId]);
    if (issues.length > 0) {
      throw new Error(`Project ${projectId} failed flow validation: ${issues[0]?.message}`);
    }
  }
};

const parseMountedProjectManifest = (value: unknown): MountedProjectManifest | null => {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as MountedProjectManifest;
  if (
    manifest.format !== MOUNTED_PROJECT_FORMAT ||
    manifest.version !== MOUNTED_PROJECT_VERSION ||
    !manifest.project?.id ||
    !Array.isArray(manifest.states) ||
    typeof manifest.revision !== 'string'
  ) {
    return null;
  }
  return manifest;
};

const readMountedProjectManifest = async (
  binding: ProjectStorageBinding,
): Promise<MountedProjectManifest | null> => {
  const blob = await readStorageFile(binding.mountId, getProjectManifestPath(binding));
  if (!blob) return null;
  try {
    return parseMountedProjectManifest(JSON.parse(await blob.text()) as unknown);
  } catch {
    return null;
  }
};

const getProjectIndexEntry = (projectId: string): ProjectIndexEntry =>
  readRawProjectIndex().find((entry) => entry.id === projectId) ?? {
    id: projectId,
    name: 'Untitled Project',
    lastModified: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  };

const writeMountedProjectManifest = async (
  binding: ProjectStorageBinding,
  addedStorageIds: string[],
  removedStorageIds: string[] = [],
): Promise<string> => {
  const queueKey = `${binding.mountId}:${binding.rootPath}`;
  const previous = manifestWriteQueues.get(queueKey) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = await readMountedProjectManifest(binding);
      const project = getProjectIndexEntry(binding.projectId);
      const removed = new Set(removedStorageIds);
      const revision = createRevision();
      const manifest: MountedProjectManifest = {
        format: MOUNTED_PROJECT_FORMAT,
        version: MOUNTED_PROJECT_VERSION,
        project: {
          ...project,
          lastModified: Math.max(project.lastModified, Date.now()),
          storageMountId: binding.mountId,
          storagePath: binding.rootPath,
          storageMode: binding.mode,
        },
        states: Array.from(new Set([...(existing?.states ?? []), ...addedStorageIds])).filter(
          (storageId) => !removed.has(storageId),
        ),
        revision,
        parentRevision: existing?.revision,
        metadata: readProjectStorageMetadata(binding.projectId) ?? existing?.metadata,
        updatedAt: Date.now(),
      };
      await writeStorageFile(
        binding.mountId,
        getProjectManifestPath(binding),
        new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      );
      return revision;
    });
  manifestWriteQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (manifestWriteQueues.get(queueKey) === operation) manifestWriteQueues.delete(queueKey);
  }
};

const saveBinding = (binding: ProjectStorageBinding): void => {
  writeBindings({ ...readBindings(), [binding.projectId]: binding });
  const index = readRawProjectIndex();
  writeRawProjectIndex(
    index.map((entry) =>
      entry.id === binding.projectId
        ? {
            ...entry,
            storageMountId: binding.mountId,
            storagePath: binding.rootPath,
            storageMode: binding.mode,
          }
        : entry,
    ),
  );
  emitProjectStorageChanged();
};

const removeBinding = (projectId: string): void => {
  const bindings = readBindings();
  delete bindings[projectId];
  writeBindings(bindings);
  writeRawProjectIndex(
    readRawProjectIndex().map((entry) => {
      if (entry.id !== projectId) return entry;
      const {
        storageMountId: _mountId,
        storagePath: _storagePath,
        storageMode: _storageMode,
        ...browserEntry
      } = entry;
      return browserEntry;
    }),
  );
  emitProjectStorageChanged();
};

const resolveProjectBinding = (storageId: string): ProjectStorageBinding | null => {
  const projectId = getBaseProjectId(storageId);
  return readBindings()[projectId] ?? null;
};

// --- Project Index ---

export const getProjectIndex = (): ProjectIndexEntry[] => {
  const bindings = readBindings();
  return readRawProjectIndex().map((entry) => {
    const binding = bindings[entry.id];
    return binding
      ? {
          ...entry,
          storageMountId: binding.mountId,
          storagePath: binding.rootPath,
          storageMode: binding.mode,
        }
      : entry;
  });
};

export const saveProjectIndex = (index: ProjectIndexEntry[]): void => {
  try {
    const existingIds = new Set(readRawProjectIndex().map((entry) => entry.id));
    const bindings = readBindings();
    const defaultWorkflow = getDefaultProjectStorageWorkflow();
    const defaultMountId = getDefaultStorageMountId('projects');
    index.forEach((entry) => {
      if (bindings[entry.id]) return;
      const isNewProject = !existingIds.has(entry.id);
      const workflow = entry.storageMode ?? (isNewProject ? defaultWorkflow : 'browser-only');
      const mountId =
        entry.storageMountId ??
        (isNewProject && workflow !== 'browser-only' ? defaultMountId : BROWSER_STORAGE_MOUNT_ID);
      if (mountId === BROWSER_STORAGE_MOUNT_ID || workflow === 'browser-only') return;
      bindings[entry.id] = {
        projectId: entry.id,
        mountId,
        rootPath: entry.storagePath ?? getDefaultProjectRootPath(entry.id),
        boundAt: Date.now(),
        mode: workflow,
        localRevision: workflow === 'local-clone' ? createRevision() : undefined,
      };
    });
    writeBindings(bindings);
    writeRawProjectIndex(index);
  } catch (error) {
    console.error('Could not save project index to localStorage', error);
  }
};

export const getProjectStorageBinding = (projectId: string): ProjectStorageBinding | null =>
  readBindings()[projectId] ?? null;

const markCloneLocalChange = (binding: ProjectStorageBinding): ProjectStorageBinding => {
  if (binding.mode !== 'local-clone') return binding;
  const changedBinding = { ...binding, localRevision: createRevision() };
  saveBinding(changedBinding);
  return changedBinding;
};

// --- Individual Project State ---

export const saveProject = async (id: string, state: StoredProjectState): Promise<void> => {
  const documentState = stripSessionState(state);
  const binding = resolveProjectBinding(id);
  try {
    if (!binding || binding.mode === 'local-clone') {
      await saveProjectStateToDB(id, documentState);
      if (binding) {
        const changedBinding = markCloneLocalChange(binding);
        if (id === changedBinding.projectId && !changedBinding.remoteRevision) {
          try {
            await connectProjectRemote(changedBinding.projectId, changedBinding.mountId, {
              rootPath: changedBinding.rootPath,
            });
          } catch (error) {
            console.warn(
              'The local project was saved, but its default remote is not ready.',
              error,
            );
          }
        }
      }
      return;
    }
    await writeStorageFile(
      binding.mountId,
      getProjectStatePath(binding, id),
      new Blob([JSON.stringify(documentState)], { type: 'application/json' }),
    );
    await writeMountedProjectManifest(binding, [id]);
  } catch (error) {
    console.error(`Could not save project ${id}`, error);
    throw error;
  }
};

export const loadProjectState = async (id: string): Promise<StoredProjectState | null> => {
  try {
    const binding = resolveProjectBinding(id);
    const stored =
      binding?.mode === 'direct'
        ? await readStorageFile(binding.mountId, getProjectStatePath(binding, id)).then(
            async (blob) => (blob ? (JSON.parse(await blob.text()) as StoredProjectState) : null),
          )
        : await loadProjectStateFromDB(id);
    if (!stored) return null;

    const documentState = stripSessionState(stored);
    assertStoredProjectState(id, documentState);
    return documentState;
  } catch (error) {
    console.error(`Could not load project ${id}`, error);
    return null;
  }
};

export const deleteProject = async (id: string): Promise<void> => {
  try {
    const projectId = getBaseProjectId(id);
    const binding = resolveProjectBinding(id);
    if (binding?.mode === 'direct') {
      if (id === projectId) {
        const manifest = await readMountedProjectManifest(binding);
        const files = await listStorageFiles(binding.mountId, binding.rootPath);
        if (files.length > 0) {
          await deleteStorageTree(binding.mountId, binding.rootPath);
        } else {
          await Promise.all(
            (manifest?.states ?? [id]).map((storageId) =>
              deleteStorageFile(binding.mountId, getProjectStatePath(binding, storageId)),
            ),
          );
          await deleteStorageFile(binding.mountId, getProjectManifestPath(binding));
        }
        removeBinding(projectId);
      } else {
        await deleteStorageFile(binding.mountId, getProjectStatePath(binding, id));
        await writeMountedProjectManifest(binding, [], [id]);
      }
    } else if (binding?.mode === 'local-clone') {
      if (id === projectId) removeBinding(projectId);
      else markCloneLocalChange(binding);
    }
    await deleteProjectStateFromDB(id);

    if (id === projectId) {
      saveProjectIndex(getProjectIndex().filter((project) => project.id !== projectId));
    }
  } catch (error) {
    console.error(`Could not delete project ${id}`, error);
    throw error;
  }
};

/** Copy all known states to a mount, then make that mount authoritative. */
export const bindProjectToStorageMount = async (
  projectId: string,
  mountId: string,
  options: { rootPath?: string } = {},
): Promise<ProjectStorageBinding> => {
  if (mountId === BROWSER_STORAGE_MOUNT_ID) {
    await unbindProjectFromStorageMount(projectId);
    return {
      projectId,
      mountId,
      rootPath: '',
      boundAt: Date.now(),
      mode: 'local-clone',
    };
  }

  const mount = await getStorageMount(mountId);
  if (!mount?.connected || mount.readOnly || !mount.resources.includes('projects')) {
    throw new Error('The selected storage mount is not available for project writes.');
  }

  const currentBinding = resolveProjectBinding(projectId);
  const stateIds = new Set(
    (await listProjectStateIdsFromDB()).filter((id) => isProjectStorageId(id, projectId)),
  );
  if (currentBinding?.mode === 'direct') {
    const manifest = await readMountedProjectManifest(currentBinding);
    manifest?.states.forEach((id) => stateIds.add(id));
  }
  if (stateIds.size === 0) stateIds.add(projectId);

  const loadedStates = new Map<string, StoredProjectState>();
  for (const storageId of stateIds) {
    const state = await loadProjectState(storageId);
    if (state) loadedStates.set(storageId, state);
  }
  if (currentBinding && loadedStates.size === 0) {
    throw new Error('Could not read any states from the current project mount.');
  }

  const binding: ProjectStorageBinding = {
    projectId,
    mountId,
    rootPath: options.rootPath
      ? normalizeStorageMountPath(options.rootPath)
      : getDefaultProjectRootPath(projectId),
    boundAt: Date.now(),
    mode: 'direct',
  };
  const targetManifest = await readMountedProjectManifest(binding);
  if (targetManifest && targetManifest.project.id !== projectId) {
    throw new Error('The target project location belongs to a different project.');
  }
  for (const [storageId, state] of loadedStates) {
    await writeStorageFile(
      mountId,
      getProjectStatePath(binding, storageId),
      new Blob([JSON.stringify(stripSessionState(state))], { type: 'application/json' }),
    );
  }
  const loadedStateIds = Array.from(loadedStates.keys());
  const loadedStateIdSet = new Set(loadedStateIds);
  const removedStateIds = (targetManifest?.states ?? []).filter(
    (storageId) => !loadedStateIdSet.has(storageId),
  );
  await Promise.all(
    removedStateIds.map((storageId) =>
      deleteStorageFile(binding.mountId, getProjectStatePath(binding, storageId)),
    ),
  );
  await writeMountedProjectManifest(binding, loadedStateIds, removedStateIds);
  saveBinding(binding);
  return binding;
};

/** Copy mounted states back into IndexedDB before returning the project to browser storage. */
export const unbindProjectFromStorageMount = async (projectId: string): Promise<void> => {
  const binding = resolveProjectBinding(projectId);
  if (!binding) return;
  if (binding.mode === 'direct') {
    const manifest = await readMountedProjectManifest(binding);
    for (const storageId of manifest?.states ?? [projectId]) {
      const blob = await readStorageFile(binding.mountId, getProjectStatePath(binding, storageId));
      if (!blob) continue;
      const state = JSON.parse(await blob.text()) as StoredProjectState;
      assertStoredProjectState(storageId, state);
      await saveProjectStateToDB(storageId, stripSessionState(state));
    }
  }
  removeBinding(projectId);
};

const assertProjectMount = async (mountId: string, requireWrite: boolean): Promise<void> => {
  const mount = await getStorageMount(mountId);
  if (!mount?.connected || !mount.resources.includes('projects')) {
    throw new Error('The project storage mount is offline or unavailable.');
  }
  if (requireWrite && mount.readOnly) {
    throw new Error('The project storage mount is read-only.');
  }
};

const getLocalProjectStateIds = async (projectId: string): Promise<string[]> =>
  (await listProjectStateIdsFromDB()).filter((id) => isProjectStorageId(id, projectId));

const loadRemoteProjectStates = async (
  binding: ProjectStorageBinding,
  manifest: MountedProjectManifest,
): Promise<Map<string, StoredProjectState>> => {
  const states = new Map<string, StoredProjectState>();
  for (const storageId of manifest.states) {
    const blob = await readStorageFile(binding.mountId, getProjectStatePath(binding, storageId));
    if (!blob) throw new Error(`The remote project is missing state ${storageId}.`);
    const state = stripSessionState(JSON.parse(await blob.text()) as StoredProjectState);
    assertStoredProjectState(storageId, state);
    states.set(storageId, state);
  }
  return states;
};

const replaceLocalProjectStates = async (
  projectId: string,
  states: ReadonlyMap<string, StoredProjectState>,
): Promise<void> => {
  const remoteIds = new Set(states.keys());
  await Promise.all(
    (await getLocalProjectStateIds(projectId))
      .filter((storageId) => !remoteIds.has(storageId))
      .map((storageId) => deleteProjectStateFromDB(storageId)),
  );
  for (const [storageId, state] of states) {
    await saveProjectStateToDB(storageId, stripSessionState(state));
  }
};

const getLocalProjectStates = async (
  projectId: string,
): Promise<Map<string, StoredProjectState>> => {
  const states = new Map<string, StoredProjectState>();
  for (const storageId of await getLocalProjectStateIds(projectId)) {
    const state = await loadProjectStateFromDB(storageId);
    if (!state) continue;
    const documentState = stripSessionState(state as StoredProjectState);
    assertStoredProjectState(storageId, documentState);
    states.set(storageId, documentState);
  }
  if (states.size === 0) throw new Error('The local project has no saved state to push.');
  return states;
};

const writeRemoteProjectSnapshot = async ({
  binding,
  states,
  previousManifest,
}: {
  binding: ProjectStorageBinding;
  states: ReadonlyMap<string, StoredProjectState>;
  previousManifest: MountedProjectManifest | null;
}): Promise<MountedProjectManifest> => {
  for (const [storageId, state] of states) {
    await writeStorageFile(
      binding.mountId,
      getProjectStatePath(binding, storageId),
      new Blob([JSON.stringify(stripSessionState(state))], { type: 'application/json' }),
    );
  }

  const stateIds = Array.from(states.keys());
  const currentIds = new Set(stateIds);
  await Promise.all(
    (previousManifest?.states ?? [])
      .filter((storageId) => !currentIds.has(storageId))
      .map((storageId) =>
        deleteStorageFile(binding.mountId, getProjectStatePath(binding, storageId)),
      ),
  );

  const revision = createRevision();
  const project = getProjectIndexEntry(binding.projectId);
  const manifest: MountedProjectManifest = {
    format: MOUNTED_PROJECT_FORMAT,
    version: MOUNTED_PROJECT_VERSION,
    project: {
      ...project,
      storageMountId: binding.mountId,
      storagePath: binding.rootPath,
      storageMode: 'direct',
    },
    states: stateIds,
    revision,
    parentRevision: previousManifest?.revision,
    metadata: readProjectStorageMetadata(binding.projectId) ?? previousManifest?.metadata,
    updatedAt: Date.now(),
  };
  await writeStorageFile(
    binding.mountId,
    getProjectManifestPath(binding),
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  );
  return manifest;
};

/** Inspect local/upstream revisions without modifying either working copy. */
export const getProjectSyncStatus = async (projectId: string): Promise<ProjectSyncStatus> => {
  const binding = getProjectStorageBinding(projectId);
  if (!binding) {
    return {
      state: 'browser-only',
      binding: null,
      localChanged: false,
      remoteChanged: false,
    };
  }
  if (binding.mode === 'direct') {
    return { state: 'direct', binding, localChanged: false, remoteChanged: false };
  }

  const localChanged = binding.localRevision !== binding.lastSyncedLocalRevision;
  try {
    await assertProjectMount(binding.mountId, false);
    const remoteManifest = await readMountedProjectManifest(binding);
    const remoteRevision = remoteManifest?.revision;
    const remoteChanged = remoteRevision !== binding.remoteRevision;
    return {
      state: localChanged
        ? remoteChanged
          ? 'diverged'
          : 'local-ahead'
        : remoteChanged
          ? 'remote-ahead'
          : 'up-to-date',
      binding,
      localChanged,
      remoteChanged,
      remoteRevision,
    };
  } catch {
    return { state: 'offline', binding, localChanged, remoteChanged: false };
  }
};

/**
 * Publish a Browser project to an empty remote location while retaining the
 * Browser document as the editable working copy.
 */
export async function connectProjectRemote(
  projectId: string,
  mountId: string,
  options: { rootPath?: string } = {},
): Promise<ProjectStorageBinding> {
  return runProjectSyncOperation(projectId, async () => {
    await assertProjectMount(mountId, true);
    const previousBinding = getProjectStorageBinding(projectId);
    if (previousBinding?.mode === 'direct') {
      throw new Error('Convert the directly mounted project to a local clone first.');
    }
    if (
      previousBinding?.mountId === mountId &&
      previousBinding.mode === 'local-clone' &&
      previousBinding.remoteRevision
    ) {
      return previousBinding;
    }

    const binding: ProjectStorageBinding = {
      projectId,
      mountId,
      rootPath: options.rootPath
        ? normalizeStorageMountPath(options.rootPath)
        : (previousBinding?.rootPath ?? getDefaultProjectRootPath(projectId)),
      boundAt: previousBinding?.boundAt ?? Date.now(),
      mode: 'local-clone',
      localRevision: previousBinding?.localRevision ?? createRevision(),
    };
    const existing = await readMountedProjectManifest(binding);
    if (existing) {
      throw new Error(
        'A remote project already exists at this location. Open that project and clone it instead.',
      );
    }
    const states = await getLocalProjectStates(projectId);
    const manifest = await writeRemoteProjectSnapshot({ binding, states, previousManifest: null });
    const syncedBinding: ProjectStorageBinding = {
      ...binding,
      remoteRevision: manifest.revision,
      lastSyncedLocalRevision: binding.localRevision,
      lastPushedAt: Date.now(),
    };
    saveBinding(syncedBinding);
    return syncedBinding;
  });
}

/** Copy a directly mounted project into Browser storage and retain the mount as its upstream. */
export const cloneProjectToBrowser = async (projectId: string): Promise<ProjectStorageBinding> =>
  runProjectSyncOperation(projectId, async () => {
    const directBinding = getProjectStorageBinding(projectId);
    if (!directBinding || directBinding.mode !== 'direct') {
      throw new Error('The project is not opened directly from a remote mount.');
    }
    await assertProjectMount(directBinding.mountId, false);
    const manifest = await readMountedProjectManifest(directBinding);
    if (!manifest) throw new Error('The remote project manifest could not be read.');
    const states = await loadRemoteProjectStates(directBinding, manifest);
    await replaceLocalProjectStates(projectId, states);
    applyProjectStorageMetadata(projectId, manifest.metadata);
    const localRevision = createRevision();
    const binding: ProjectStorageBinding = {
      ...directBinding,
      mode: 'local-clone',
      localRevision,
      lastSyncedLocalRevision: localRevision,
      remoteRevision: manifest.revision,
      lastPulledAt: Date.now(),
    };
    saveBinding(binding);
    return binding;
  });

/** Push the complete local project snapshot if the upstream revision has not moved. */
export const pushProjectToRemote = async (
  projectId: string,
  options: { force?: boolean } = {},
): Promise<ProjectSyncStatus> =>
  runProjectSyncOperation(projectId, async () => {
    const binding = getProjectStorageBinding(projectId);
    if (!binding || binding.mode !== 'local-clone') {
      throw new Error('The project does not have a remote-tracking Browser clone.');
    }
    await assertProjectMount(binding.mountId, true);
    const remoteManifest = await readMountedProjectManifest(binding);
    if (remoteManifest && remoteManifest.project.id !== projectId) {
      throw new Error('The configured remote location belongs to a different project.');
    }
    if (!options.force && remoteManifest?.revision !== binding.remoteRevision) {
      throw new Error('The remote project changed. Pull before pushing, or force push explicitly.');
    }
    const states = await getLocalProjectStates(projectId);
    const manifest = await writeRemoteProjectSnapshot({
      binding,
      states,
      previousManifest: remoteManifest,
    });
    saveBinding({
      ...binding,
      remoteRevision: manifest.revision,
      lastSyncedLocalRevision: binding.localRevision,
      lastPushedAt: Date.now(),
    });
    return getProjectSyncStatus(projectId);
  });

/** Pull the complete upstream snapshot; dirty local work requires an explicit force pull. */
export const pullProjectFromRemote = async (
  projectId: string,
  options: { force?: boolean } = {},
): Promise<ProjectSyncStatus> =>
  runProjectSyncOperation(projectId, async () => {
    const binding = getProjectStorageBinding(projectId);
    if (!binding || binding.mode !== 'local-clone') {
      throw new Error('The project does not have a remote-tracking Browser clone.');
    }
    await assertProjectMount(binding.mountId, false);
    const localChanged = binding.localRevision !== binding.lastSyncedLocalRevision;
    if (localChanged && !options.force) {
      throw new Error('Local changes have not been pushed. Push them or force pull explicitly.');
    }
    const manifest = await readMountedProjectManifest(binding);
    if (!manifest) throw new Error('The remote project no longer exists.');
    if (manifest.project.id !== projectId) {
      throw new Error('The configured remote location belongs to a different project.');
    }
    const states = await loadRemoteProjectStates(binding, manifest);
    await replaceLocalProjectStates(projectId, states);
    applyProjectStorageMetadata(projectId, manifest.metadata);

    const index = readRawProjectIndex();
    writeRawProjectIndex(
      index.map((entry) =>
        entry.id === projectId
          ? {
              ...entry,
              ...manifest.project,
              storageMountId: binding.mountId,
              storagePath: binding.rootPath,
              storageMode: 'local-clone',
            }
          : entry,
      ),
    );
    const localRevision = createRevision();
    saveBinding({
      ...binding,
      localRevision,
      lastSyncedLocalRevision: localRevision,
      remoteRevision: manifest.revision,
      lastPulledAt: Date.now(),
    });
    return getProjectSyncStatus(projectId);
  });

/**
 * Discover project manifests on all connected mounts and merge them into the
 * local recent-project catalog. The mounted document remains authoritative.
 */
export const refreshMountedProjectIndex = async (): Promise<ProjectIndexEntry[]> => {
  const mounts = (await listStorageMounts()).filter(
    (mount) =>
      mount.id !== BROWSER_STORAGE_MOUNT_ID &&
      mount.connected &&
      mount.resources.includes('projects'),
  );
  const discovered = new Map<
    string,
    { entry: ProjectIndexEntry; binding: ProjectStorageBinding; metadata?: unknown }
  >();

  for (const mount of mounts) {
    const files = await listStorageFiles(mount.id, StorageMountPaths.projects);
    for (const file of files.filter((entry) => entry.path.endsWith('/project.json'))) {
      try {
        const blob = await readStorageFile(mount.id, file.path);
        if (!blob) continue;
        const manifest = parseMountedProjectManifest(JSON.parse(await blob.text()) as unknown);
        if (!manifest) continue;
        const rootPath = file.path.slice(0, -'/project.json'.length);
        const binding: ProjectStorageBinding = {
          projectId: manifest.project.id,
          mountId: mount.id,
          rootPath,
          boundAt: Date.now(),
          mode: 'direct',
        };
        const entry: ProjectIndexEntry = {
          ...manifest.project,
          lastModified: manifest.project.lastModified || manifest.updatedAt,
          storageMountId: mount.id,
          storagePath: rootPath,
          storageMode: 'direct',
        };
        const current = discovered.get(entry.id);
        if (!current || current.entry.lastModified < entry.lastModified) {
          discovered.set(entry.id, { entry, binding, metadata: manifest.metadata });
        }
      } catch (error) {
        console.warn(`Could not discover mounted project at ${file.path}.`, error);
      }
    }
  }

  if (discovered.size > 0) {
    const merged = new Map(getProjectIndex().map((entry) => [entry.id, entry]));
    discovered.forEach(({ entry, binding, metadata }) => {
      const existingBinding = getProjectStorageBinding(entry.id);
      if (existingBinding?.mode === 'local-clone') return;
      // A Browser-only project with the same id intentionally does not track
      // this remote (for example after disconnecting a local clone).
      if (!existingBinding && merged.has(entry.id)) return;
      applyProjectStorageMetadata(entry.id, metadata);
      saveBinding(binding);
      merged.set(entry.id, { ...merged.get(entry.id), ...entry });
    });
    saveProjectIndex(Array.from(merged.values()));
  }
  return getProjectIndex();
};
