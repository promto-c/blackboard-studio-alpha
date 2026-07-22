import React from 'react';
import * as Icons from '@blackboard/icons';
import {
  BROWSER_STORAGE_MOUNT_ID,
  STORAGE_MOUNT_RESOURCES,
  bindProjectToStorageMount,
  cloneProjectToBrowser,
  connectProjectRemote,
  getDefaultProjectStorageWorkflow,
  getDefaultStorageMountId,
  getProjectSyncStatus,
  getProjectStorageBinding,
  listStorageMounts,
  mountDirectory,
  pullProjectFromRemote,
  pushProjectToRemote,
  requestStorageMountPermission,
  setDefaultStorageMountId,
  setDefaultProjectStorageWorkflow,
  subscribeToStorageMounts,
  subscribeToProjectStorage,
  unbindProjectFromStorageMount,
  unmountStorage,
  type StorageMountInfo,
  type StorageMountResource,
  type ProjectSyncStatus,
} from '@blackboard/project-store';
import type { ProjectStorageWorkflow } from '@blackboard/types';
import { Badge, StyledDropdown } from '@blackboard/ui';
import {
  PreferenceBentoCard,
  PreferenceBentoControl,
  PreferenceBentoEmptyState,
  SegmentedControl,
} from '@/components';
import {
  getDirectoryPickerSupport,
  type WindowWithDirectoryPicker,
} from '@/utils/directoryPickerSupport';
import { getErrorMessage } from '@/utils/guards';
import { useOptionalEditorActions } from '@/state/editorContext';
import { disconnectS3StorageMount } from '@/services/s3Storage';
import type { PreferencesColorScope } from './preferencesNavigation';
import S3StorageMountDialog from './S3StorageMountDialog';

const RESOURCE_LABELS: Record<StorageMountResource, string> = {
  projects: 'Projects',
  assets: 'New assets',
  gallery: 'Gallery',
  models: 'ONNX models',
  workspace: 'Workspace files',
  plugins: 'Plugin files',
};

const ACTION_CLASS =
  'inline-flex min-h-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] px-3 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 disabled:cursor-wait disabled:opacity-50';

const SYNC_STATUS_LABEL: Record<ProjectSyncStatus['state'], string> = {
  'browser-only': 'Browser only',
  direct: 'Direct',
  'up-to-date': 'Up to date',
  'local-ahead': 'Ready to push',
  'remote-ahead': 'Ready to pull',
  diverged: 'Changes on both sides',
  offline: 'Remote offline',
};

const getMountKindLabel = (mount: StorageMountInfo): string => {
  switch (mount.kind) {
    case 'browser':
      return 'Browser';
    case 'file-system':
      return 'Folder';
    case 'object-storage':
      return 'Object store';
    default:
      return 'Plugin';
  }
};

export default function StorageMountPreferences({
  projectId,
  scope,
  onScopeChange,
}: {
  projectId: string | null;
  scope: PreferencesColorScope;
  onScopeChange: (scope: PreferencesColorScope) => void;
}) {
  const [mounts, setMounts] = React.useState<StorageMountInfo[]>([]);
  const [syncStatus, setSyncStatus] = React.useState<ProjectSyncStatus | null>(null);
  const [projectWorkflow, setProjectWorkflow] =
    React.useState<ProjectStorageWorkflow>('browser-only');
  const [projectMountId, setProjectMountId] = React.useState<string>('');
  const [forceConfirmation, setForceConfirmation] = React.useState<'pull' | 'push' | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isS3DialogOpen, setIsS3DialogOpen] = React.useState(false);
  const editorActions = useOptionalEditorActions() as {
    flushProjectSave?: () => Promise<void>;
    loadProject?: (projectId: string) => Promise<void>;
  } | null;
  const pickerSupport = getDirectoryPickerSupport();
  const projectBinding = projectId ? getProjectStorageBinding(projectId) : null;
  const isProjectScope = scope === 'project' && Boolean(projectId);

  const reload = React.useCallback(async () => {
    try {
      const [nextMounts, nextSyncStatus] = await Promise.all([
        listStorageMounts(),
        projectId ? getProjectSyncStatus(projectId) : Promise.resolve(null),
      ]);
      setMounts(nextMounts);
      setSyncStatus(nextSyncStatus);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Could not load storage mounts.'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    const binding = projectId ? getProjectStorageBinding(projectId) : null;
    setProjectWorkflow(
      isProjectScope ? (binding?.mode ?? 'browser-only') : getDefaultProjectStorageWorkflow(),
    );
    const configuredMountId = isProjectScope
      ? binding?.mountId
      : getDefaultStorageMountId('projects');
    if (configuredMountId && configuredMountId !== BROWSER_STORAGE_MOUNT_ID) {
      setProjectMountId(configuredMountId);
    }
  }, [isProjectScope, projectId, projectBinding?.mode, projectBinding?.mountId]);

  React.useEffect(() => {
    if (projectMountId) return;
    setProjectMountId(
      mounts.find(
        (mount) =>
          mount.id !== BROWSER_STORAGE_MOUNT_ID &&
          mount.connected &&
          !mount.readOnly &&
          mount.resources.includes('projects'),
      )?.id ?? '',
    );
  }, [mounts, projectMountId]);

  React.useEffect(() => {
    setForceConfirmation(null);
  }, [isProjectScope, projectMountId, projectWorkflow]);

  React.useEffect(() => {
    void reload();
    const unsubscribeMounts = subscribeToStorageMounts(() => void reload());
    const unsubscribeProject = subscribeToProjectStorage(() => void reload());
    return () => {
      unsubscribeMounts();
      unsubscribeProject();
    };
  }, [reload]);

  const run = async (id: string, operation: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await operation();
      await reload();
    } catch (operationError) {
      setError(getErrorMessage(operationError, 'Storage operation failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleAddFolder = async () => {
    const showDirectoryPicker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (!showDirectoryPicker) return;
    await run('new-folder', async () => {
      const handle = await showDirectoryPicker({
        id: 'blackboard-storage-mount',
        mode: 'readwrite',
      });
      await mountDirectory(handle);
    });
  };

  const handleDefaultChange = (resource: StorageMountResource, mountId: string) => {
    const mount = mounts.find((candidate) => candidate.id === mountId);
    if (!mount?.connected) return;
    setDefaultStorageMountId(resource, mountId);
    void reload();
  };

  const writableMountsFor = (resource: StorageMountResource) =>
    mounts.filter((mount) => !mount.readOnly && mount.resources.includes(resource));

  const projectRemoteMounts = mounts.filter(
    (mount) =>
      mount.id !== BROWSER_STORAGE_MOUNT_ID &&
      mount.connected &&
      !mount.readOnly &&
      mount.resources.includes('projects'),
  );
  const hasWritableProjectMount = projectRemoteMounts.length > 0;
  const projectWorkflowOptions = [
    {
      value: 'browser-only',
      label: 'Browser',
      description: 'No remote',
      ariaLabel: 'Browser only, no remote',
    },
    {
      value: 'local-clone',
      label: 'Local + remote',
      description: 'Pull & push',
      ariaLabel: 'Local Browser copy with pull and push remote',
      disabled: !hasWritableProjectMount && projectWorkflow !== 'local-clone',
      title:
        hasWritableProjectMount || projectWorkflow === 'local-clone'
          ? 'Work locally and synchronize snapshots explicitly'
          : 'Connect a writable project mount first',
    },
    {
      value: 'direct',
      label: 'Direct mount',
      description: 'Autosave there',
      ariaLabel: 'Direct mounted project with remote autosave',
      disabled: !hasWritableProjectMount && projectWorkflow !== 'direct',
      title:
        hasWritableProjectMount || projectWorkflow === 'direct'
          ? 'Read and autosave directly on the selected mount'
          : 'Connect a writable project mount first',
    },
  ] satisfies Array<{
    value: ProjectStorageWorkflow;
    label: string;
    description: string;
    ariaLabel: string;
    disabled?: boolean;
    title?: string;
  }>;

  const flushProjectSave = async () => {
    await editorActions?.flushProjectSave?.();
  };

  const migrateProjectWorkflow = async () => {
    await run('project-workflow', async () => {
      if (!projectId) return;
      await flushProjectSave();
      const binding = getProjectStorageBinding(projectId);
      if (projectWorkflow === 'browser-only') {
        await unbindProjectFromStorageMount(projectId);
        return;
      }
      if (!projectMountId) throw new Error('Choose a connected project mount.');
      if (projectWorkflow === 'direct') {
        await bindProjectToStorageMount(projectId, projectMountId);
        return;
      }
      if (binding?.mode === 'direct' && binding.mountId === projectMountId) {
        await cloneProjectToBrowser(projectId);
        return;
      }
      if (binding?.mode === 'direct') {
        await unbindProjectFromStorageMount(projectId);
      }
      await connectProjectRemote(projectId, projectMountId);
    });
  };

  const configuredWorkflow = isProjectScope
    ? (projectBinding?.mode ?? 'browser-only')
    : getDefaultProjectStorageWorkflow();
  const configuredMountId = isProjectScope
    ? projectBinding?.mountId
    : getDefaultStorageMountId('projects');
  const isWorkflowConfigured =
    projectWorkflow === configuredWorkflow &&
    (projectWorkflow === 'browser-only' || projectMountId === configuredMountId);
  const canMigrateProjectWorkflow =
    projectWorkflow === 'browser-only' ||
    projectRemoteMounts.some((mount) => mount.id === projectMountId);

  const selectProjectWorkflow = (workflow: ProjectStorageWorkflow) => {
    setProjectWorkflow(workflow);
    if (isProjectScope) return;
    if (workflow !== 'browser-only' && projectMountId) {
      setDefaultStorageMountId('projects', projectMountId);
    }
    setDefaultProjectStorageWorkflow(workflow);
  };

  const selectProjectMount = (mountId: string) => {
    setProjectMountId(mountId);
    if (isProjectScope || projectWorkflow === 'browser-only') return;
    setDefaultStorageMountId('projects', mountId);
    setDefaultProjectStorageWorkflow(projectWorkflow);
  };

  const migrationLabel = (() => {
    if (projectWorkflow === 'browser-only') {
      return projectBinding?.mode === 'local-clone' ? 'Stop tracking remote' : 'Move to Browser';
    }
    if (projectWorkflow === 'local-clone') {
      if (projectBinding?.mode === 'direct' && projectBinding.mountId === projectMountId) {
        return 'Create Browser clone';
      }
      return projectBinding?.mode === 'local-clone' ? 'Change upstream' : 'Publish local clone';
    }
    return projectBinding?.mode === 'direct' ? 'Move to this mount' : 'Move project to mount';
  })();

  const migrationDescription = (() => {
    if (projectWorkflow === 'browser-only') {
      return projectBinding?.mode === 'direct'
        ? 'Copies every mounted project state into Browser storage, then edits continue locally.'
        : 'Keeps the Browser working copy and removes its upstream tracking configuration. The remote snapshot is not deleted.';
    }
    if (projectWorkflow === 'local-clone') {
      if (projectBinding?.mode === 'direct' && projectBinding.mountId === projectMountId) {
        return 'Copies the mounted project into Browser storage and keeps this mount as its upstream.';
      }
      if (projectBinding?.mode === 'local-clone') {
        return 'Publishes the current Browser working copy to the new upstream. The previous remote remains unchanged.';
      }
      return 'Keeps the project in Browser storage and publishes its first versioned snapshot to the selected upstream.';
    }
    return 'Copies the complete project to the selected mount. Future edits and autosaves write there directly.';
  })();

  const syncProject = async (direction: 'pull' | 'push', force = false) => {
    if (!projectId) return;
    await run(`project-${direction}`, async () => {
      await flushProjectSave();
      if (direction === 'push') {
        await pushProjectToRemote(projectId, { force });
      } else {
        await pullProjectFromRemote(projectId, { force });
        await editorActions?.loadProject?.(projectId);
      }
    });
  };

  return (
    <div className="grid items-start gap-3 lg:grid-cols-12">
      <PreferenceBentoCard
        title="Storage destinations"
        description="Choose application defaults for newly written data. Browser storage remains the default and keeps the static web app fully self-contained."
        icon={Icons.Stack}
        className="lg:col-span-12"
      >
        {STORAGE_MOUNT_RESOURCES.filter((resource) => resource !== 'projects').map((resource) => (
          <PreferenceBentoControl
            key={resource}
            title={RESOURCE_LABELS[resource]}
            description={
              resource === 'assets'
                ? 'New imported and generated blobs; existing mounted asset ids keep their own source.'
                : resource === 'models'
                  ? 'Downloaded ONNX graphs and external tensor data. Existing installs keep their current store.'
                  : resource === 'workspace'
                    ? 'Files exposed to future code and workspace views.'
                    : resource === 'plugins'
                      ? 'Plugin-managed files beneath the mount’s plugins directory.'
                      : `New ${RESOURCE_LABELS[resource].toLowerCase()} data.`
            }
          >
            <StyledDropdown
              value={getDefaultStorageMountId(resource)}
              options={writableMountsFor(resource).map((mount) => ({
                value: mount.id,
                label: mount.name,
                secondaryLabel: mount.connected ? getMountKindLabel(mount) : 'Reconnect required',
                badges: mount.connected ? undefined : ['Offline'],
                searchText: `${mount.name} ${getMountKindLabel(mount)} ${mount.detail ?? ''}`,
              }))}
              onChange={(mountId) => handleDefaultChange(resource, String(mountId))}
              density="compact"
              widthClass="w-full sm:w-56"
              popoverWidthClass="w-72 max-w-[calc(100vw-2rem)]"
              searchable={false}
            />
          </PreferenceBentoControl>
        ))}
      </PreferenceBentoCard>

      <PreferenceBentoCard
        title={isProjectScope ? 'Current project workflow' : 'New project workflow'}
        description={
          isProjectScope
            ? 'Override the application default for this project with Browser-only editing, a local working copy with pull/push, or direct mounted autosave.'
            : 'Choose the workflow copied into new projects. Existing projects keep their own configuration, and Browser-only remains the default.'
        }
        icon={Icons.Branch}
        headerAction={
          <SegmentedControl
            ariaLabel="Project workflow scope"
            className="!w-auto min-w-[13rem] shrink-0"
            value={isProjectScope ? 'project' : 'application'}
            options={[
              {
                value: 'application',
                label: 'App defaults',
                ariaLabel: 'New project application defaults',
              },
              {
                value: 'project',
                label: 'Current project',
                ariaLabel: 'Current project override',
                disabled: !projectId,
                title: projectId
                  ? 'Configure the current project'
                  : 'Open a project to configure its workflow',
              },
            ]}
            onChange={(value) => onScopeChange(value === 'project' ? 'project' : 'application')}
          />
        }
        className="lg:col-span-12"
      >
        <>
          <PreferenceBentoControl
            title="Where edits are saved"
            description={
              projectWorkflow === 'local-clone'
                ? 'Work from a Browser copy, then pull and push versioned snapshots to a remote.'
                : projectWorkflow === 'direct'
                  ? 'Read and autosave the working project on the selected mount. Browser is not the working copy.'
                  : 'Keep edits and recovery history in this browser. No mount or remote is required.'
            }
          >
            <SegmentedControl
              ariaLabel="Project storage workflow"
              value={projectWorkflow}
              options={projectWorkflowOptions}
              onChange={(value) => selectProjectWorkflow(value as ProjectStorageWorkflow)}
              className="w-full sm:w-96"
            />
          </PreferenceBentoControl>

          {projectWorkflow !== 'browser-only' && (
            <PreferenceBentoControl
              title={projectWorkflow === 'local-clone' ? 'Upstream remote' : 'Project location'}
              description={
                projectWorkflow === 'local-clone'
                  ? 'Choose where project snapshots are pulled from and pushed to. Media continues to follow the New assets setting.'
                  : 'Choose where the working project lives. Autosaves write to this mount immediately.'
              }
            >
              <div className="space-y-2">
                <StyledDropdown
                  value={projectMountId}
                  options={projectRemoteMounts.map((mount) => ({
                    value: mount.id,
                    label: mount.name,
                    secondaryLabel: getMountKindLabel(mount),
                    searchText: `${mount.name} ${getMountKindLabel(mount)} ${mount.detail ?? ''}`,
                  }))}
                  placeholder="Choose a mount"
                  onChange={(value) => selectProjectMount(String(value))}
                  density="compact"
                  widthClass="w-full sm:w-64"
                  popoverWidthClass="w-80 max-w-[calc(100vw-2rem)]"
                  searchable={false}
                />

                {isProjectScope &&
                  projectBinding?.mode === 'local-clone' &&
                  isWorkflowConfigured && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          size="sm"
                          variant={
                            syncStatus?.state === 'diverged' || syncStatus?.state === 'offline'
                              ? 'warning'
                              : syncStatus?.state === 'up-to-date'
                                ? 'success'
                                : 'neutral'
                          }
                        >
                          {syncStatus ? SYNC_STATUS_LABEL[syncStatus.state] : 'Checking…'}
                        </Badge>
                        <span className="truncate text-[10px] text-gray-600">Browser copy</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {syncStatus?.state === 'remote-ahead' && (
                          <button
                            type="button"
                            className={ACTION_CLASS}
                            disabled={busyId !== null}
                            onClick={() => void syncProject('pull')}
                          >
                            <Icons.ArrowDownTray className="mr-1.5 h-3.5 w-3.5" />
                            Pull
                          </button>
                        )}
                        {syncStatus?.state === 'local-ahead' && (
                          <button
                            type="button"
                            className={ACTION_CLASS}
                            disabled={busyId !== null}
                            onClick={() => void syncProject('push')}
                          >
                            <Icons.ArrowUpTray className="mr-1.5 h-3.5 w-3.5" />
                            Push
                          </button>
                        )}
                        {syncStatus?.state === 'diverged' && (
                          <>
                            <button
                              type="button"
                              className={`${ACTION_CLASS} text-amber-200`}
                              disabled={busyId !== null}
                              onClick={() => setForceConfirmation('pull')}
                              title="Replace unpushed local changes with the remote snapshot"
                            >
                              Force pull
                            </button>
                            <button
                              type="button"
                              className={`${ACTION_CLASS} text-amber-200`}
                              disabled={busyId !== null}
                              onClick={() => setForceConfirmation('push')}
                              title="Replace the current remote snapshot with this local working copy"
                            >
                              Force push
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </PreferenceBentoControl>
          )}

          {isProjectScope && !isWorkflowConfigured && (
            <div className="my-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-400/20 bg-primary-400/[0.055] p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-primary-100">Project migration required</p>
                <p className="mt-1 text-[11px] leading-5 text-gray-400">{migrationDescription}</p>
              </div>
              <button
                type="button"
                className={ACTION_CLASS}
                disabled={busyId !== null || !canMigrateProjectWorkflow}
                title={
                  canMigrateProjectWorkflow
                    ? migrationDescription
                    : 'Reconnect the selected project mount before migrating.'
                }
                onClick={() => void migrateProjectWorkflow()}
              >
                {migrationLabel}
              </button>
            </div>
          )}

          {isProjectScope && forceConfirmation && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-3">
              <p className="max-w-2xl text-xs leading-5 text-amber-100/80">
                {forceConfirmation === 'pull'
                  ? 'Force pull permanently replaces unpushed Browser project states with the remote snapshot.'
                  : 'Force push replaces the newer remote project snapshot with this Browser working copy.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={ACTION_CLASS}
                  disabled={busyId !== null}
                  onClick={() => setForceConfirmation(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${ACTION_CLASS} border-amber-300/25 text-amber-100`}
                  disabled={busyId !== null}
                  onClick={() => {
                    const direction = forceConfirmation;
                    setForceConfirmation(null);
                    void syncProject(direction, true);
                  }}
                >
                  Confirm force {forceConfirmation}
                </button>
              </div>
            </div>
          )}
        </>
      </PreferenceBentoCard>

      <PreferenceBentoCard
        title="Connected mounts"
        description="Connect browser folders or any S3-compatible object store. Every mount can serve projects, assets, Gallery items, models, workspaces, and plugin files."
        icon={Icons.FolderOpen}
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsS3DialogOpen(true)}
              disabled={busyId !== null}
              className={ACTION_CLASS}
              title="Connect an S3-compatible bucket"
            >
              <Icons.Plus className="mr-1.5 h-3.5 w-3.5" />
              Object storage
            </button>
            <button
              type="button"
              onClick={() => void handleAddFolder()}
              disabled={!pickerSupport.canUseDirectoryPicker || busyId === 'new-folder'}
              className={ACTION_CLASS}
              title={pickerSupport.reason ?? 'Mount a local folder'}
            >
              <Icons.Plus className="mr-1.5 h-3.5 w-3.5" />
              Mount folder
            </button>
          </div>
        }
        className="lg:col-span-12"
      >
        {!pickerSupport.canUseDirectoryPicker && (
          <PreferenceBentoEmptyState icon={Icons.ExclamationCircle}>
            {pickerSupport.reason} Browser and S3-compatible object storage remain available.
          </PreferenceBentoEmptyState>
        )}

        {isLoading ? (
          <PreferenceBentoEmptyState icon={Icons.RotateLoop}>
            Loading storage mounts…
          </PreferenceBentoEmptyState>
        ) : (
          mounts.map((mount) => {
            const isBrowserWorkingCopy =
              Boolean(projectId) &&
              mount.id === BROWSER_STORAGE_MOUNT_ID &&
              (!projectBinding || projectBinding.mode === 'local-clone');
            const isDirectProjectMount =
              projectBinding?.mode === 'direct' && projectBinding.mountId === mount.id;
            const isProjectUpstream =
              projectBinding?.mode === 'local-clone' && projectBinding.mountId === mount.id;
            const isProjectMount = isDirectProjectMount || isProjectUpstream;
            const isDefaultProjectMount =
              !isProjectScope &&
              getDefaultProjectStorageWorkflow() !== 'browser-only' &&
              getDefaultStorageMountId('projects') === mount.id;

            return (
              <div
                key={mount.id}
                className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-medium text-gray-100">{mount.name}</p>
                    <Badge size="sm" variant={mount.connected ? 'success' : 'warning'}>
                      {mount.connected ? 'Connected' : 'Permission needed'}
                    </Badge>
                    <Badge size="sm" variant="neutral">
                      {getMountKindLabel(mount)}
                    </Badge>
                    {isBrowserWorkingCopy && (
                      <Badge size="sm" variant="accent">
                        Working copy
                      </Badge>
                    )}
                    {isDirectProjectMount && (
                      <Badge size="sm" variant="accent">
                        Direct project
                      </Badge>
                    )}
                    {isProjectUpstream && (
                      <Badge size="sm" variant="accent">
                        Project remote
                      </Badge>
                    )}
                    {isDefaultProjectMount && (
                      <Badge size="sm" variant="accent">
                        New project default
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] leading-5 text-gray-500">
                    {mount.detail ?? mount.id}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-gray-600">
                    {mount.resources.map((resource) => RESOURCE_LABELS[resource]).join(' · ')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  {!mount.connected && mount.kind === 'file-system' && (
                    <button
                      type="button"
                      className={ACTION_CLASS}
                      disabled={busyId === mount.id}
                      onClick={() =>
                        void run(mount.id, async () => {
                          const granted = await requestStorageMountPermission(mount.id);
                          if (!granted) throw new Error('Folder permission was not granted.');
                        })
                      }
                    >
                      Reconnect
                    </button>
                  )}

                  {mount.id !== BROWSER_STORAGE_MOUNT_ID && (
                    <button
                      type="button"
                      className={`${ACTION_CLASS} text-gray-400 hover:text-red-200`}
                      disabled={busyId === mount.id || isProjectMount}
                      onClick={() =>
                        void run(mount.id, async () => {
                          if (mount.kind === 'object-storage') {
                            await disconnectS3StorageMount(mount.id);
                          } else {
                            await unmountStorage(mount.id);
                          }
                          if (isDefaultProjectMount) {
                            setDefaultProjectStorageWorkflow('browser-only');
                          }
                        })
                      }
                      title={
                        isProjectMount
                          ? 'Move the current project to another store before unmounting.'
                          : 'Disconnect this mount without deleting its files.'
                      }
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}

        {error && (
          <PreferenceBentoEmptyState icon={Icons.ExclamationCircle}>
            {error}
          </PreferenceBentoEmptyState>
        )}
      </PreferenceBentoCard>
      <S3StorageMountDialog
        isOpen={isS3DialogOpen}
        onClose={() => setIsS3DialogOpen(false)}
        onConnected={() => void reload()}
      />
    </div>
  );
}
