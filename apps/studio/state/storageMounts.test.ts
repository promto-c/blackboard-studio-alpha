import { afterEach, describe, expect, it } from 'vitest';
import type { PersistedProjectState } from '@blackboard/types';
import {
  BROWSER_STORAGE_MOUNT_ID,
  addGalleryEntries,
  createMountedAssetId,
  createObjectStorageAdapter,
  connectProjectRemote,
  deleteProject,
  deleteAssets,
  getAsset,
  getDefaultProjectStorageWorkflow,
  getProjectIndex,
  getProjectStorageBinding,
  getProjectSyncStatus,
  joinStorageMountPath,
  listStorageFiles,
  loadGalleryEntries,
  loadProjectState,
  normalizeStorageMountPath,
  parseMountedAssetId,
  pullProjectFromRemote,
  pushProjectToRemote,
  registerProjectStorageMetadataProvider,
  refreshMountedProjectIndex,
  registerStorageMount,
  saveAssetToMount,
  saveProject,
  saveProjectIndex,
  setDefaultStorageMountId,
  setDefaultProjectStorageWorkflow,
  unbindProjectFromStorageMount,
  writePluginFile,
  writeWorkspaceFile,
  type StorageMountAdapter,
} from '@blackboard/project-store';

const cleanups: Array<() => void> = [];

afterEach(() => {
  setDefaultProjectStorageWorkflow('browser-only');
  setDefaultStorageMountId('projects', BROWSER_STORAGE_MOUNT_ID);
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

const createMemoryAdapter = () => {
  const files = new Map<string, Blob>();
  const adapter: StorageMountAdapter = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, value) => {
      files.set(path, value);
    },
    delete: async (path) => {
      files.delete(path);
    },
    list: async (prefix = '') =>
      Array.from(files, ([path, value]) => ({ path, size: value.size })).filter((file) =>
        file.path.startsWith(prefix),
      ),
  };
  return { adapter, files };
};

describe('storage mount paths', () => {
  it('normalizes relative paths and rejects traversal or host-absolute paths', () => {
    expect(normalizeStorageMountPath('workspace\\src//plugin.ts')).toBe('workspace/src/plugin.ts');
    expect(joinStorageMountPath('workspace', 'src', 'plugin.ts')).toBe('workspace/src/plugin.ts');
    expect(() => normalizeStorageMountPath('../outside')).toThrow(/cannot traverse/i);
    expect(() => normalizeStorageMountPath('/etc/passwd')).toThrow(/mount-relative/i);
    expect(() => normalizeStorageMountPath('C:\\Users\\file')).toThrow(/mount-relative/i);
  });

  it('round-trips mounted asset ids without exposing ambiguous path separators', () => {
    const id = createMountedAssetId('media source', 'assets/shots/hero plate.exr');
    expect(parseMountedAssetId(id)).toEqual({
      mountId: 'media source',
      path: 'assets/shots/hero plate.exr',
    });
    expect(parseMountedAssetId('asset_123')).toBeNull();
  });
});

describe('mounted assets', () => {
  it('uses the shared mount adapter for save, transparent reads, listing, and deletion', async () => {
    const { adapter, files } = createMemoryAdapter();
    cleanups.push(
      registerStorageMount(
        {
          id: 'test-assets',
          name: 'Test assets',
          kind: 'custom',
          resources: ['assets', 'workspace'],
          readOnly: false,
        },
        adapter,
      ),
    );

    const source = new Blob(['mounted image'], { type: 'image/png' });
    const assetId = await saveAssetToMount(source, {
      mountId: 'test-assets',
      path: 'workspace/media/image.png',
    });

    expect(await (await getAsset(assetId))?.text()).toBe('mounted image');
    expect(await listStorageFiles('test-assets', 'workspace')).toEqual([
      { path: 'workspace/media/image.png', size: source.size },
    ]);

    await writeWorkspaceFile('src/tool.ts', 'export {};', { mountId: 'test-assets' });
    await writePluginFile('example-plugin', 'settings.json', '{}', {
      mountId: 'test-assets',
    });
    expect(Array.from(files.keys())).toEqual(
      expect.arrayContaining(['workspace/src/tool.ts', 'plugins/example-plugin/settings.json']),
    );

    await deleteAssets([assetId]);
    expect(files.has('workspace/media/image.png')).toBe(false);
    expect(await getAsset(assetId)).toBeNull();
  });
});

describe('object storage adapter', () => {
  it('maps a mount prefix onto a provider-neutral object client', async () => {
    const objects = new Map<string, Blob>();
    const adapter = createObjectStorageAdapter(
      {
        getObject: async (key) => objects.get(key) ?? null,
        putObject: async (key, value) => {
          objects.set(key, value);
        },
        deleteObject: async (key) => {
          objects.delete(key);
        },
        listObjects: async (prefix) =>
          Array.from(objects, ([key, value]) => ({ key, size: value.size })).filter((item) =>
            item.key.startsWith(prefix),
          ),
      },
      { prefix: 'tenant/blackboard' },
    );

    await adapter.write('workspace/plugin.ts', new Blob(['export {};']));
    expect(objects.has('tenant/blackboard/workspace/plugin.ts')).toBe(true);
    expect(await adapter.list?.('workspace')).toEqual([
      { path: 'workspace/plugin.ts', size: 10, lastModified: undefined },
    ]);
  });
});

describe('mounted project and Gallery documents', () => {
  it('routes a project document and manifest to the configured project mount', async () => {
    const { adapter } = createMemoryAdapter();
    cleanups.push(
      registerStorageMount(
        {
          id: 'test-projects',
          name: 'Test projects',
          kind: 'custom',
          resources: ['projects'],
          readOnly: false,
        },
        adapter,
      ),
    );
    setDefaultStorageMountId('projects', BROWSER_STORAGE_MOUNT_ID);
    saveProjectIndex([{ id: 'existing-browser', name: 'Existing', lastModified: 50 }]);
    setDefaultStorageMountId('projects', 'test-projects');
    setDefaultProjectStorageWorkflow('direct');
    saveProjectIndex([
      { id: 'existing-browser', name: 'Existing', lastModified: 60 },
      { id: 'project-a', name: 'Project A', lastModified: 100 },
    ]);

    await saveProject('project-a', {} as PersistedProjectState);

    expect(getProjectStorageBinding('existing-browser')).toBeNull();
    expect(await loadProjectState('project-a')).toEqual({});
    expect(getProjectStorageBinding('project-a')).toMatchObject({
      mountId: 'test-projects',
      rootPath: '.blackboard-studio/projects/project-a',
    });
    expect((await listStorageFiles('test-projects')).map((file) => file.path).sort()).toEqual([
      '.blackboard-studio/projects/project-a/project.json',
      '.blackboard-studio/projects/project-a/states/project-a.json',
    ]);

    await deleteProject('project-a');
    expect(getProjectStorageBinding('project-a')).toBeNull();
    expect(await listStorageFiles('test-projects')).toEqual([]);

    setDefaultStorageMountId('projects', BROWSER_STORAGE_MOUNT_ID);
  });

  it('applies the app-level local clone workflow to newly saved projects', async () => {
    const { adapter, files } = createMemoryAdapter();
    cleanups.push(
      registerStorageMount(
        {
          id: 'default-project-remote',
          name: 'Default project remote',
          kind: 'custom',
          resources: ['projects'],
          readOnly: false,
        },
        adapter,
      ),
    );
    setDefaultStorageMountId('projects', 'default-project-remote');
    setDefaultProjectStorageWorkflow('local-clone');
    expect(getDefaultProjectStorageWorkflow()).toBe('local-clone');

    const projectId = 'project-default-clone';
    saveProjectIndex([
      ...getProjectIndex().filter((project) => project.id !== projectId),
      { id: projectId, name: 'Default Clone', lastModified: 100 },
    ]);
    expect(getProjectStorageBinding(projectId)).toMatchObject({
      mountId: 'default-project-remote',
      mode: 'local-clone',
    });

    await saveProject(projectId, { fps: 24 } as PersistedProjectState);
    expect(getProjectStorageBinding(projectId)?.remoteRevision).toMatch(/^rev_/);
    expect(files.has(`.blackboard-studio/projects/${projectId}/project.json`)).toBe(true);
    expect(await loadProjectState(projectId)).toEqual({ fps: 24 });

    await deleteProject(projectId);
  });

  it('stores and reads Gallery metadata from an explicit mount', async () => {
    const { adapter } = createMemoryAdapter();
    cleanups.push(
      registerStorageMount(
        {
          id: 'test-gallery',
          name: 'Test Gallery',
          kind: 'custom',
          resources: ['gallery'],
          readOnly: false,
        },
        adapter,
      ),
    );

    await addGalleryEntries(
      [
        {
          id: 'gallery-a',
          source: 'Comfy',
          assetId: 'asset-a',
          width: 1920,
          height: 1080,
          createdAt: 100,
          tags: [],
        },
      ],
      { mountId: 'test-gallery' },
    );

    expect(await loadGalleryEntries({ mountIds: ['test-gallery'] })).toEqual([
      expect.objectContaining({ id: 'gallery-a', storageMountId: 'test-gallery' }),
    ]);
  });

  it('keeps a Browser working copy and synchronizes it with revision conflict checks', async () => {
    const { adapter, files } = createMemoryAdapter();
    let restoredMetadata: unknown;
    cleanups.push(
      registerProjectStorageMetadataProvider({
        key: 'test.branches',
        read: () => ['main', 'review'],
        write: (_projectId, metadata) => {
          restoredMetadata = metadata;
        },
      }),
    );
    cleanups.push(
      registerStorageMount(
        {
          id: 'sync-projects',
          name: 'Sync projects',
          kind: 'custom',
          resources: ['projects'],
          readOnly: false,
        },
        adapter,
      ),
    );

    const projectId = 'project-sync';
    const root = `.blackboard-studio/projects/${projectId}`;
    const manifestPath = `${root}/project.json`;
    const statePath = `${root}/states/${projectId}.json`;
    setDefaultStorageMountId('projects', BROWSER_STORAGE_MOUNT_ID);
    saveProjectIndex([
      ...getProjectIndex().filter((project) => project.id !== projectId),
      { id: projectId, name: 'Sync Project', lastModified: 100 },
    ]);
    await saveProject(projectId, { fps: 24 } as PersistedProjectState);

    const binding = await connectProjectRemote(projectId, 'sync-projects');
    expect(binding.mode).toBe('local-clone');
    expect((await getProjectSyncStatus(projectId)).state).toBe('up-to-date');

    await saveProject(projectId, { fps: 25 } as PersistedProjectState);
    expect((await getProjectSyncStatus(projectId)).state).toBe('local-ahead');
    await pushProjectToRemote(projectId);
    expect((await getProjectSyncStatus(projectId)).state).toBe('up-to-date');

    const remoteManifest = JSON.parse(await files.get(manifestPath)!.text()) as Record<
      string,
      unknown
    >;
    expect(remoteManifest.metadata).toEqual({ 'test.branches': ['main', 'review'] });
    files.set(statePath, new Blob([JSON.stringify({ fps: 30 })]));
    files.set(
      manifestPath,
      new Blob([
        JSON.stringify({
          ...remoteManifest,
          revision: 'remote-revision-1',
          parentRevision: remoteManifest.revision,
          metadata: { 'test.branches': ['main', 'remote-review'] },
          updatedAt: 200,
        }),
      ]),
    );
    expect((await getProjectSyncStatus(projectId)).state).toBe('remote-ahead');
    await pullProjectFromRemote(projectId);
    expect(await loadProjectState(projectId)).toEqual({ fps: 30 });
    expect(restoredMetadata).toEqual(['main', 'remote-review']);

    await saveProject(projectId, { fps: 31 } as PersistedProjectState);
    const nextRemoteManifest = JSON.parse(await files.get(manifestPath)!.text()) as Record<
      string,
      unknown
    >;
    files.set(statePath, new Blob([JSON.stringify({ fps: 32 })]));
    files.set(
      manifestPath,
      new Blob([
        JSON.stringify({
          ...nextRemoteManifest,
          revision: 'remote-revision-2',
          parentRevision: nextRemoteManifest.revision,
          updatedAt: 300,
        }),
      ]),
    );

    expect((await getProjectSyncStatus(projectId)).state).toBe('diverged');
    await expect(pushProjectToRemote(projectId)).rejects.toThrow(/remote project changed/i);
    await expect(pullProjectFromRemote(projectId)).rejects.toThrow(/local changes/i);
    await pullProjectFromRemote(projectId, { force: true });
    expect(await loadProjectState(projectId)).toEqual({ fps: 32 });
    expect((await getProjectSyncStatus(projectId)).state).toBe('up-to-date');

    await unbindProjectFromStorageMount(projectId);
    await refreshMountedProjectIndex();
    expect(getProjectStorageBinding(projectId)).toBeNull();
    expect(await loadProjectState(projectId)).toEqual({ fps: 32 });

    await deleteProject(projectId);
    expect(files.has(manifestPath)).toBe(true);
  });
});
