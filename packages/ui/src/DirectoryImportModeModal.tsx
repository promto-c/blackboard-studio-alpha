import React, { useEffect, useState } from 'react';
import type { DirectoryImportMode } from '@blackboard/types';
import { XMark } from '@blackboard/icons';

interface DirectoryImportModeModalProps {
  isOpen: boolean;
  referenceEnabled?: boolean;
  referenceDisabledReason?: string;
  onClose: () => void;
  onSelect: (mode: DirectoryImportMode, rememberChoice: boolean) => void;
}

const DirectoryImportModeModal: React.FC<DirectoryImportModeModalProps> = ({
  isOpen,
  referenceEnabled = true,
  referenceDisabledReason,
  onClose,
  onSelect,
}) => {
  const [rememberChoice, setRememberChoice] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRememberChoice(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-import-mode-title"
    >
      <div
        className="glass-component w-full max-w-xl rounded-xl border border-white/10 bg-gray-900/85 p-5 shadow-2xl ring-1 ring-inset ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="directory-import-mode-title" className="text-lg font-semibold text-white">
              Import Folder As
            </h2>
            <p className="mt-1 text-sm text-gray-300">
              Choose whether to copy files into the project or keep a live reference to the selected
              folder.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            aria-label="Close import mode dialog"
          >
            <XMark className="h-5 w-5" />
          </button>
        </div>

        {!referenceEnabled && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <p className="font-semibold">Reference import is unavailable in this environment.</p>
            {referenceDisabledReason && (
              <p className="mt-1 text-amber-100/90">{referenceDisabledReason}</p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onSelect('reference', rememberChoice)}
            disabled={!referenceEnabled}
            aria-disabled={!referenceEnabled}
            className={`rounded-lg border p-4 text-left transition-colors ${
              referenceEnabled
                ? 'border-primary-400/35 bg-primary-500/10 hover:border-primary-300/50 hover:bg-primary-500/15'
                : 'cursor-not-allowed border-gray-700/80 bg-gray-800/30 opacity-45'
            }`}
          >
            <p className="text-sm font-semibold text-white">Reference Import</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-300">
              Keeps media in place and stores only a permissioned folder handle in IndexedDB.
            </p>
          </button>

          <button
            type="button"
            onClick={() => onSelect('copy', rememberChoice)}
            className="rounded-lg border border-gray-600/70 bg-gray-800/70 p-4 text-left transition-colors hover:border-gray-500 hover:bg-gray-700/70"
          >
            <p className="text-sm font-semibold text-white">Copy Into Project</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-300">
              Imports and stores file contents in IndexedDB for fully self-contained projects.
            </p>
          </button>
        </div>

        <label className="mt-4 flex cursor-pointer select-none items-start gap-2 rounded-md border border-gray-700/60 bg-gray-800/50 p-3 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(event) => setRememberChoice(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-500 bg-gray-900 text-primary-500 focus:ring-primary-400"
          />
          <span>
            Remember this choice (do not ask again). You can change it later in Preferences →
            Editing.
          </span>
        </label>
      </div>
    </div>
  );
};

export default DirectoryImportModeModal;
