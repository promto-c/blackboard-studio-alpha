import React from 'react';
import type { ProjectBundleReferenceGroup } from '@/state/projectTransfer';
import * as Icons from '@blackboard/icons';

interface ProjectReferenceImportModalProps {
  isOpen: boolean;
  projectName: string;
  referenceGroups: ProjectBundleReferenceGroup[];
  selectedDirectoriesByGroupId: ReadonlyMap<string, FileSystemDirectoryHandle>;
  isImporting: boolean;
  onSelectDirectory: (group: ProjectBundleReferenceGroup) => void;
  onConfirm: () => void;
  onClose: () => void;
}

const ProjectReferenceImportModal: React.FC<ProjectReferenceImportModalProps> = ({
  isOpen,
  projectName,
  referenceGroups,
  selectedDirectoriesByGroupId,
  isImporting,
  onSelectDirectory,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  const isReady = referenceGroups.every((group) => selectedDirectoriesByGroupId.has(group.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-reference-import-title"
    >
      <div
        className="glass-component w-full max-w-2xl rounded-xl border border-white/10 bg-gray-900/85 p-5 shadow-2xl ring-1 ring-inset ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="project-reference-import-title" className="text-lg font-semibold text-white">
              Relink Referenced Folders
            </h2>
            <p className="mt-1 text-sm text-gray-300">
              <span className="font-medium text-white">{projectName}</span> contains external folder
              references. Select each source folder to import the project without copying media into
              the bundle.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            aria-label="Close project import dialog"
            disabled={isImporting}
          >
            <Icons.XMark className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          {referenceGroups.map((group) => {
            const selectedDirectory = selectedDirectoriesByGroupId.get(group.id);
            const expectedDirectoryName = group.directoryName || 'Folder';
            const hasNameMismatch =
              !!selectedDirectory &&
              !!group.directoryName &&
              selectedDirectory.name !== group.directoryName;

            return (
              <div
                key={group.id}
                className="rounded-lg border border-gray-700/70 bg-gray-800/70 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{expectedDirectoryName}</p>
                    <p className="mt-1 text-xs text-gray-300">
                      {group.fileCount} referenced file{group.fileCount === 1 ? '' : 's'}
                    </p>
                    {group.sampleRelativePath && (
                      <p className="mt-1 truncate text-xs text-gray-400">
                        Example: <span className="font-mono">{group.sampleRelativePath}</span>
                      </p>
                    )}
                    {selectedDirectory ? (
                      <p className="mt-2 text-xs text-emerald-300">
                        Selected: <span className="font-medium">{selectedDirectory.name}</span>
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-amber-200">No folder selected yet.</p>
                    )}
                    {hasNameMismatch && (
                      <p className="mt-1 text-xs text-amber-200">
                        The selected folder name does not match the exported source folder name.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectDirectory(group)}
                    disabled={isImporting}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-primary-400/35 bg-primary-500/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:border-primary-300/50 hover:bg-primary-500/15 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Icons.FolderOpen className="h-4 w-4" />
                    <span>{selectedDirectory ? 'Change Folder' : 'Select Folder'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="rounded-md border border-gray-600/70 bg-gray-800/70 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700/70 disabled:cursor-wait disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isReady || isImporting}
            className="rounded-md border border-emerald-400/35 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-emerald-300/50 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? 'Importing...' : 'Import Project'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectReferenceImportModal;
