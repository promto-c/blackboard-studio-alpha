import React, { useRef, useState, useEffect } from 'react';
import { ScrollArea } from '@blackboard/ui';
import { useEditorActions } from '@/state/editorContext';
import { getProjectIndex } from '@/state/persist';
import { getAsset } from '@/state/assetStorage';
import { ProjectIndexEntry } from '@blackboard/types';
import {
  formatStorageBytes,
  getCachedStorageResult,
  getProjectStorageSummary,
  shouldAutoCalculate,
  type ProjectStorageResult,
} from '@/state/projectStorage';
import { useDirectoryImportMode } from '@/hooks/useDirectoryImportMode';
import { getDirectoryPickerSupport } from '@/utils/directoryPickerSupport';
import { IMPORT_MEDIA_ACCEPT } from '@/utils/mediaFiles';
import {
  PROJECT_BUNDLE_ACCEPT,
  inspectProjectBundle,
  isProjectBundleFile,
  type ProjectBundleReferenceGroup,
} from '@/state/projectTransfer';
import NewProjectView from './NewProjectView';
import PreferencesView from './PreferencesView';
import ProjectReferenceImportModal from './ProjectReferenceImportModal';
import * as Icons from '@blackboard/icons';

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
};

type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
};

type PendingProjectImport = {
  file: File;
  projectName: string;
  referenceGroups: ProjectBundleReferenceGroup[];
  selectedDirectoriesByGroupId: Map<string, FileSystemDirectoryHandle>;
};

const WelcomeScreen: React.FC = () => {
  const {
    createNewProject,
    loadProject,
    deleteProject,
    importProjectFile,
    exportProjectFile,
    createNewProjectFromDimensions,
    createNewProjectFromFiles,
    createNewProjectFromDirectory,
  } = useEditorActions();
  const { requestImportMode, importModeDialog } = useDirectoryImportMode();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectIndexEntry[]>([]);
  const [projectStorageById, setProjectStorageById] = useState<
    Record<string, ProjectStorageResult | undefined>
  >({});
  const [calculatingProjectIds, setCalculatingProjectIds] = useState<Set<string>>(new Set());
  const [lazyThumbnails, setLazyThumbnails] = useState<Record<string, string>>({});
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const [view, setView] = useState<'main' | 'newProject' | 'preferences'>('main');
  const [isImportingProject, setIsImportingProject] = useState(false);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [pendingProjectImport, setPendingProjectImport] = useState<PendingProjectImport | null>(
    null,
  );
  const directoryPickerSupport = getDirectoryPickerSupport();

  useEffect(() => {
    const timer = setTimeout(() => {
      const projectList = getProjectIndex().sort((a, b) => b.lastModified - a.lastModified);
      const limitedProjects = projectList.slice(0, 25);

      const initialStorage: Record<string, ProjectStorageResult | undefined> = {};
      for (const project of limitedProjects) {
        const result = getCachedStorageResult(project);
        if (result) {
          initialStorage[project.id] = result;
        }
      }
      setProjectStorageById(initialStorage);

      setProjects(limitedProjects);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const CONCURRENCY = 4;
    const abortController = new AbortController();
    const objectUrls = objectUrlsRef.current;

    const loadThumbnails = async () => {
      const toLoad = projects.filter((p) => p.thumbnailAssetId && !p.thumbnail);
      for (let i = 0; i < toLoad.length; i += CONCURRENCY) {
        if (abortController.signal.aborted) return;
        const batch = toLoad.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (project) => {
            try {
              const blob = await getAsset(project.thumbnailAssetId!);
              if (!blob) return null;
              const url = URL.createObjectURL(blob);
              objectUrls.add(url);
              return { id: project.id, url };
            } catch {
              return null;
            }
          }),
        );
        for (const result of results) {
          if (result) {
            setLazyThumbnails((prev) => ({ ...prev, [result.id]: result.url }));
          }
        }
      }
    };

    void loadThumbnails();

    return () => {
      abortController.abort();
    };
  }, [projects]);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    const loadStorageSummaries = async () => {
      if (projects.length === 0) return;

      for (let i = 0; i < projects.length; i++) {
        if (abortController.signal.aborted) return;

        const project = projects[i];
        const autoCalc = shouldAutoCalculate(project, i);
        if (!autoCalc) continue;

        await new Promise((r) => setTimeout(r, 0));
        if (abortController.signal.aborted) return;

        const summary = await getProjectStorageSummary(project, abortController.signal);
        if (abortController.signal.aborted) return;

        setProjectStorageById((prev) => ({
          ...prev,
          [project.id]: { summary, isStale: false },
        }));
      }
    };

    void loadStorageSummaries();

    return () => abortController.abort();
  }, [projects]);

  const handleCalculateStorage = async (project: ProjectIndexEntry) => {
    if (calculatingProjectIds.has(project.id)) return;

    const abortController = new AbortController();
    setCalculatingProjectIds((prev) => new Set(prev).add(project.id));

    try {
      const summary = await getProjectStorageSummary(project, abortController.signal);
      if (!abortController.signal.aborted) {
        setProjectStorageById((prev) => ({
          ...prev,
          [project.id]: {
            summary,
            isStale: false,
          },
        }));
      }
    } finally {
      setCalculatingProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const handleOpenMediaClick = () => mediaInputRef.current?.click();
  const handleOpenProjectClick = () => projectInputRef.current?.click();

  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  const handleImportProject = async (
    file: File,
    referenceDirectoriesByGroupId?: ReadonlyMap<string, FileSystemDirectoryHandle>,
  ) => {
    setIsImportingProject(true);
    try {
      await importProjectFile(file, referenceDirectoriesByGroupId);
      setPendingProjectImport(null);
    } catch (error) {
      console.error('Failed to import project:', error);
      window.alert(getErrorMessage(error, 'Failed to import project.'));
    } finally {
      setIsImportingProject(false);
    }
  };

  const beginProjectImport = async (file: File) => {
    try {
      const bundle = await inspectProjectBundle(file);
      if (bundle.referenceGroups.length === 0) {
        await handleImportProject(file);
        return;
      }

      if (!directoryPickerSupport.canUseDirectoryPicker) {
        throw new Error(
          directoryPickerSupport.reason ||
            'This project uses external folder references, but folder relinking is not available in this browser.',
        );
      }

      setPendingProjectImport({
        file,
        projectName: bundle.projectName,
        referenceGroups: bundle.referenceGroups,
        selectedDirectoriesByGroupId: new Map(),
      });
    } catch (error) {
      console.error('Failed to inspect project bundle:', error);
      window.alert(getErrorMessage(error, 'Failed to inspect project bundle.'));
    }
  };

  const handleExportProject = async (event: React.MouseEvent, project: ProjectIndexEntry) => {
    event.stopPropagation();
    setExportingProjectId(project.id);
    try {
      await exportProjectFile(project.id);
    } catch (error) {
      console.error('Failed to export project:', error);
      window.alert(getErrorMessage(error, 'Failed to export project.'));
    } finally {
      setExportingProjectId((currentId) => (currentId === project.id ? null : currentId));
    }
  };

  const handleOpenFolderClick = async () => {
    const pickerSupport = getDirectoryPickerSupport();

    const importMode = await requestImportMode({
      referenceEnabled: pickerSupport.canUseDirectoryPicker,
      referenceDisabledReason: pickerSupport.reason,
    });
    if (!importMode) return;

    if (!pickerSupport.canUseDirectoryPicker) {
      folderInputRef.current?.click();
      return;
    }

    try {
      const directoryHandle = await (window as WindowWithDirectoryPicker).showDirectoryPicker?.({
        mode: 'read',
      });
      if (!directoryHandle) {
        folderInputRef.current?.click();
        return;
      }
      await createNewProjectFromDirectory(directoryHandle, importMode);
    } catch (error: unknown) {
      const errorName =
        error instanceof DOMException || error instanceof Error ? error.name : undefined;
      const errorMessage =
        error instanceof DOMException || error instanceof Error ? error.message : '';
      const isPickerBlocked =
        errorName === 'SecurityError' || errorMessage.includes('Cross origin sub frames');
      if (isPickerBlocked) {
        folderInputRef.current?.click();
        return;
      }
      if (errorName !== 'AbortError') {
        console.error('Failed to import folder:', error);
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) createNewProject(file);
    if (event.target) event.target.value = '';
  };

  const handleProjectFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file) return;
    await beginProjectImport(file);
  };

  const handleSelectProjectReferenceDirectory = async (group: ProjectBundleReferenceGroup) => {
    try {
      const directoryHandle = await (window as WindowWithDirectoryPicker).showDirectoryPicker?.({
        mode: 'read',
      });
      if (!directoryHandle) {
        return;
      }

      setPendingProjectImport((current) => {
        if (!current) {
          return current;
        }

        const nextSelectedDirectories = new Map(current.selectedDirectoriesByGroupId);
        nextSelectedDirectories.set(group.id, directoryHandle);
        return {
          ...current,
          selectedDirectoriesByGroupId: nextSelectedDirectories,
        };
      });
    } catch (error: unknown) {
      const errorName =
        error instanceof DOMException || error instanceof Error ? error.name : undefined;
      if (errorName === 'AbortError') {
        return;
      }

      console.error('Failed to select reference directory:', error);
      window.alert(getErrorMessage(error, 'Failed to select the reference folder.'));
    }
  };

  const handleConfirmProjectReferenceImport = async () => {
    if (!pendingProjectImport) {
      return;
    }

    await handleImportProject(
      pendingProjectImport.file,
      pendingProjectImport.selectedDirectoriesByGroupId,
    );
  };

  const handleFolderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) createNewProjectFromFiles(Array.from(files));
    if (event.target) event.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files) as File[];
      if (files.length === 1 && isProjectBundleFile(files[0])) {
        await beginProjectImport(files[0]);
      } else if (files.length === 1) {
        createNewProject(files[0]);
      } else {
        createNewProjectFromFiles(files);
      }
      e.dataTransfer.clearData();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (
      window.confirm('Are you sure you want to delete this project? This action cannot be undone.')
    ) {
      deleteProject(projectId);
      setProjects(projects.filter((p) => p.id !== projectId));
    }
  };

  const handleCreateProject = (name: string, width: number, height: number) =>
    createNewProjectFromDimensions(name, width, height);
  const isMainView = view === 'main';

  return (
    <ScrollArea
      className={`w-screen h-screen bg-gray-900 flex flex-col items-center text-gray-200 overflow-y-auto px-4 sm:px-6 lg:px-8 ${
        isMainView ? 'justify-center py-8' : 'justify-start py-6 sm:py-8'
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setView('preferences')}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors"
          title="Preferences"
        >
          <Icons.Cog className="w-6 h-6" />
        </button>
      </div>
      {view === 'main' ? (
        <div key="main" className="w-full max-w-3xl animate-[fadeIn_250ms_ease-in-out]">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-white">Blackboard Studio</h1>
            <p className="text-gray-400 mt-2">A modern, web-based media compositor.</p>
            <a
              href="https://github.com/promto-c"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 px-3 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors border border-gray-700"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              <span>promto-c</span>
            </a>
          </div>
          <div className="flex flex-wrap justify-center gap-6 mb-12">
            <button
              onClick={() => setView('newProject')}
              className="flex flex-col items-center justify-center w-40 h-40 bg-gray-800 rounded-lg shadow-lg hover:bg-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <Icons.DocumentPlus className="w-16 h-16 mb-2 text-primary-400" />
              <span className="text-lg font-semibold">New Project</span>
            </button>
            <button
              onClick={handleOpenProjectClick}
              disabled={isImportingProject}
              className="flex flex-col items-center justify-center w-40 h-40 bg-gray-800 rounded-lg shadow-lg hover:bg-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-wait disabled:opacity-60"
            >
              <Icons.ArrowUpTray className="w-16 h-16 mb-2 text-emerald-400" />
              <span className="text-lg font-semibold">
                {isImportingProject ? 'Importing...' : 'Import Project'}
              </span>
              <p className="text-[10px] text-gray-400 px-2 mt-1">Import a saved project bundle</p>
            </button>
            <button
              onClick={handleOpenMediaClick}
              className="flex flex-col items-center justify-center w-40 h-40 bg-gray-800 rounded-lg shadow-lg hover:bg-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <Icons.Photo className="w-16 h-16 mb-2 text-blue-400" />
              <span className="text-lg font-semibold">Import File</span>
            </button>
            <button
              onClick={handleOpenFolderClick}
              className="flex flex-col items-center justify-center w-40 h-40 bg-gray-800 rounded-lg shadow-lg hover:bg-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <Icons.FolderOpen className="w-16 h-16 mb-2 text-amber-400" />
              <span className="text-lg font-semibold">Import Folder</span>
              <p className="text-[10px] text-gray-400 px-2 mt-1">For Image Sequences</p>
            </button>
          </div>
          {projects.length > 0 && (
            <div className="w-full max-w-2xl mx-auto">
              <h2 className="text-lg font-semibold text-gray-300 mb-4 text-center">
                Recent Projects
              </h2>
              <ScrollArea
                fadeEdges
                className="bg-gray-800/50 rounded-lg p-2 space-y-2 max-h-64 overflow-y-auto"
              >
                {projects.map((project, projectIndex) => {
                  const storage = projectStorageById[project.id];
                  const isCalculating = calculatingProjectIds.has(project.id);
                  const canAutoCalc = shouldAutoCalculate(project, projectIndex);
                  const summary = storage?.summary;
                  const isStale = storage?.isStale ?? false;
                  const approxPrefix = isStale ? '~' : '';

                  return (
                    <div
                      key={project.id}
                      onClick={() => loadProject(project.id)}
                      className="group flex items-center p-3 rounded-md hover:bg-gray-700 cursor-pointer transition-colors"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-4">
                        {(() => {
                          const thumbSrc =
                            project.thumbnail ||
                            (project.thumbnailAssetId ? lazyThumbnails[project.id] : undefined);
                          return thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={project.name}
                              loading="lazy"
                              className="w-20 h-12 object-cover rounded bg-gray-700 flex-shrink-0"
                            />
                          ) : (
                            <div className="w-20 h-12 bg-gray-700 rounded flex-shrink-0 flex items-center justify-center text-gray-500">
                              <Icons.Photo className="w-6 h-6" />
                            </div>
                          );
                        })()}
                        <div className="overflow-hidden">
                          <p className="font-medium text-white truncate">{project.name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            Last modified: {new Date(project.lastModified).toLocaleString()}
                          </p>
                          {isCalculating ? (
                            <p className="mt-1 text-[10px] text-gray-500">
                              {isStale && summary
                                ? `Approx ${approxPrefix}${formatStorageBytes(summary.totalBytes)} — updating...`
                                : 'Calculating storage...'}
                            </p>
                          ) : storage === undefined ? (
                            canAutoCalc ? (
                              <p className="mt-1 text-[10px] text-gray-500">
                                Calculating storage...
                              </p>
                            ) : project.estimatedSize != null ? (
                              <p className="mt-1 text-[10px] text-gray-500">
                                Est. {formatStorageBytes(project.estimatedSize)}
                              </p>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCalculateStorage(project);
                                }}
                                className="mt-1 text-[10px] text-primary-400 hover:text-primary-300 transition-colors"
                              >
                                Calculate size
                              </button>
                            )
                          ) : summary ? (
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-gray-400">
                              <span
                                className={`font-medium ${
                                  isStale ? 'text-amber-400' : 'text-gray-200'
                                }`}
                              >
                                {isStale && 'Approx '}
                                {approxPrefix}Total {formatStorageBytes(summary.totalBytes)}
                              </span>
                              <span>
                                {approxPrefix}Assets {formatStorageBytes(summary.breakdown.assets)}
                              </span>
                              <span>
                                {approxPrefix}Renders{' '}
                                {formatStorageBytes(summary.breakdown.renders)}
                              </span>
                              <span>
                                {approxPrefix}Cache {formatStorageBytes(summary.breakdown.cache)}
                              </span>
                              <span>
                                {approxPrefix}Project data{' '}
                                {formatStorageBytes(summary.breakdown.projectData)}
                              </span>
                              <span>
                                {approxPrefix}Exports{' '}
                                {formatStorageBytes(summary.breakdown.exports)}
                              </span>
                              <span>
                                {approxPrefix}Temp {formatStorageBytes(summary.breakdown.temp)}
                              </span>
                            </div>
                          ) : (
                            <p className="mt-1 text-[10px] text-gray-500">Storage unavailable</p>
                          )}
                        </div>
                      </div>
                      <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={(e) => handleExportProject(e, project)}
                          disabled={exportingProjectId === project.id}
                          className="p-2 rounded-full text-gray-500 hover:text-emerald-300 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-all disabled:cursor-wait disabled:opacity-100"
                          title="Export Project"
                        >
                          <Icons.ArrowDownTray className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(e, project.id)}
                          className="p-2 rounded-full text-gray-500 hover:text-red-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete Project"
                        >
                          <Icons.Trash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </ScrollArea>
            </div>
          )}
        </div>
      ) : view === 'newProject' ? (
        <div key="newProject" className="w-full animate-[fadeIn_250ms_ease-in-out]">
          <NewProjectView onBack={() => setView('main')} onCreate={handleCreateProject} />
        </div>
      ) : (
        <div key="preferences" className="w-full animate-[fadeIn_250ms_ease-in-out]">
          <PreferencesView onBack={() => setView('main')} />
        </div>
      )}
      <ProjectReferenceImportModal
        isOpen={!!pendingProjectImport}
        projectName={pendingProjectImport?.projectName || 'Project'}
        referenceGroups={pendingProjectImport?.referenceGroups || []}
        selectedDirectoriesByGroupId={
          pendingProjectImport?.selectedDirectoriesByGroupId || new Map()
        }
        isImporting={isImportingProject}
        onSelectDirectory={handleSelectProjectReferenceDirectory}
        onConfirm={handleConfirmProjectReferenceImport}
        onClose={() => {
          if (!isImportingProject) {
            setPendingProjectImport(null);
          }
        }}
      />
      <input
        type="file"
        ref={mediaInputRef}
        onChange={handleFileChange}
        accept={IMPORT_MEDIA_ACCEPT}
        className="hidden"
      />
      <input
        type="file"
        ref={projectInputRef}
        onChange={handleProjectFileChange}
        accept={PROJECT_BUNDLE_ACCEPT}
        className="hidden"
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderChange}
        {...({ webkitdirectory: 'true' } as DirectoryInputProps)}
        className="hidden"
      />
      {importModeDialog}
    </ScrollArea>
  );
};

export default WelcomeScreen;
