import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ColorConfigReference, ExternalColorConfigReference } from '@blackboard/types';
import { StyledDropdown } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import {
  BUILTIN_ACES_CG_CONFIG_REFERENCE,
  createExternalOcioConfigPackageFromFiles,
  registerExternalOcioConfigPackage,
} from '@/color-management';

export interface ExternalConfigReferenceFieldProps {
  value: ColorConfigReference;
  onChange: (value: ColorConfigReference) => void;
  scope?: 'application' | 'project';
  showLocate?: boolean;
  showReset?: boolean;
}

export interface ExternalConfigReferenceFieldHandle {
  locateDirectory: () => void;
  focusReference: () => void;
}

type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory: string;
};

export const createLocatedExternalConfigReference = (
  scope: 'application' | 'project',
  configRelativePath: string,
): ExternalColorConfigReference => ({
  kind: 'external',
  uri: `${scope === 'application' ? 'app' : 'project'}:///${configRelativePath}`,
});

export const ExternalConfigReferenceField = forwardRef<
  ExternalConfigReferenceFieldHandle,
  ExternalConfigReferenceFieldProps
>(function ExternalConfigReferenceField(
  { value, onChange, scope = 'project', showLocate = true, showReset = true },
  ref,
) {
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [referenceText, setReferenceText] = useState(value.kind === 'external' ? value.uri : '');
  const [directoryFiles, setDirectoryFiles] = useState<File[]>([]);
  const [configCandidates, setConfigCandidates] = useState<string[]>([]);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => setReferenceText(value.kind === 'external' ? value.uri : ''),
    [value.kind, value.uri],
  );

  useImperativeHandle(
    ref,
    () => ({
      locateDirectory: () => directoryInputRef.current?.click(),
      focusReference: () => referenceInputRef.current?.focus(),
    }),
    [],
  );

  const applyReference = () => {
    const uri = referenceText.trim();
    if (!uri) {
      setError('External OCIO config reference is required.');
      return;
    }
    setError(null);
    onChange({ kind: 'external', uri });
  };

  const activateDirectoryConfig = async (files: File[], configRelativePath: string) => {
    const reference = createLocatedExternalConfigReference(scope, configRelativePath);
    try {
      const source = await createExternalOcioConfigPackageFromFiles(
        reference,
        files,
        configRelativePath,
      );
      registerExternalOcioConfigPackage(reference, source);
      setError(null);
      onChange(reference);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const locateDirectory = async () => {
    if (!selectedConfig || directoryFiles.length === 0) return;
    await activateDirectoryConfig(directoryFiles, selectedConfig);
  };

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 gap-2">
        <input
          ref={referenceInputRef}
          value={referenceText}
          onChange={(event) => setReferenceText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyReference();
          }}
          aria-label="OCIO config reference"
          className="min-w-0 flex-1 rounded bg-gray-700/50 px-2 py-2 font-mono text-xs text-gray-200 outline-none focus:ring-1 focus:ring-primary-700"
        />
        <button
          type="button"
          onClick={applyReference}
          title="Use external config reference"
          aria-label="Use external config reference"
          className="grid h-9 w-9 shrink-0 place-items-center rounded text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <Icons.Check className="h-4 w-4" />
        </button>
        {showLocate ? (
          <button
            type="button"
            onClick={() => directoryInputRef.current?.click()}
            title="Locate OCIO config directory"
            aria-label="Locate OCIO config directory"
            className="grid h-9 w-9 shrink-0 place-items-center rounded text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <Icons.FolderOpen className="h-4 w-4" />
          </button>
        ) : null}
        {showReset ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              onChange({ ...BUILTIN_ACES_CG_CONFIG_REFERENCE });
            }}
            disabled={value.kind === 'builtin'}
            title="Remove external reference"
            aria-label="Remove external reference"
            className="grid h-9 w-9 shrink-0 place-items-center rounded text-gray-400 transition hover:bg-white/10 hover:text-white disabled:text-gray-700"
          >
            <Icons.Reset className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {configCandidates.length > 1 ? (
        <div className="flex min-w-0 gap-2">
          <StyledDropdown
            value={selectedConfig}
            options={configCandidates.map((path) => ({ value: path, label: path }))}
            onChange={(nextValue) => setSelectedConfig(String(nextValue))}
            searchable
            popoverWidthClass="w-96"
          />
          <button
            type="button"
            onClick={() => void locateDirectory()}
            title="Use located OCIO config"
            aria-label="Use located OCIO config"
            className="grid h-9 w-9 shrink-0 place-items-center rounded text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <Icons.Check className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {error ? <div className="text-xs text-red-200">{error}</div> : null}

      <input
        ref={directoryInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          const candidates = files
            .map((file) => file.webkitRelativePath || file.name)
            .filter((path) => path.toLowerCase().endsWith('.ocio'))
            .sort();
          setDirectoryFiles(files);
          setConfigCandidates(candidates);
          setSelectedConfig(candidates[0] ?? '');
          setError(candidates.length ? null : 'The selected directory has no .ocio config file.');
          event.currentTarget.value = '';
          if (candidates.length === 1) {
            void activateDirectoryConfig(files, candidates[0]);
          }
        }}
        {...({ webkitdirectory: 'true' } as DirectoryInputProps)}
      />
    </div>
  );
});
