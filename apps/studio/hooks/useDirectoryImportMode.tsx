import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryImportMode } from '@blackboard/types';
import { DirectoryImportModeModal } from '@blackboard/ui';
import { usePreferences } from '@/state/preferencesContext';

type ModeResolver = (mode: DirectoryImportMode | null) => void;
type PromptConfig = {
  referenceEnabled: boolean;
  referenceDisabledReason?: string;
};

type RequestImportModeOptions = {
  referenceEnabled?: boolean;
  referenceDisabledReason?: string;
};

export const useDirectoryImportMode = () => {
  const { directoryImportModePreference, setPreferences } = usePreferences();
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [promptConfig, setPromptConfig] = useState<PromptConfig>({ referenceEnabled: true });
  const resolverRef = useRef<ModeResolver | null>(null);

  const finishPrompt = useCallback(
    (mode: DirectoryImportMode | null, rememberChoice: boolean) => {
      if (rememberChoice && mode) {
        setPreferences({ directoryImportModePreference: mode });
      }

      setIsPromptOpen(false);
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve?.(mode);
    },
    [setPreferences],
  );

  const requestImportMode = useCallback(
    async (options?: RequestImportModeOptions): Promise<DirectoryImportMode | null> => {
      const referenceEnabled = options?.referenceEnabled ?? true;
      const referenceDisabledReason = options?.referenceDisabledReason;

      if (directoryImportModePreference !== 'ask') {
        if (directoryImportModePreference === 'copy') {
          return 'copy';
        }
        if (referenceEnabled) {
          return directoryImportModePreference;
        }
      }

      return new Promise((resolve) => {
        if (resolverRef.current) {
          resolverRef.current(null);
        }
        resolverRef.current = resolve;
        setPromptConfig({ referenceEnabled, referenceDisabledReason });
        setIsPromptOpen(true);
      });
    },
    [directoryImportModePreference],
  );

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(null);
        resolverRef.current = null;
      }
    };
  }, []);

  const importModeDialog = useMemo(
    () => (
      <DirectoryImportModeModal
        isOpen={isPromptOpen}
        referenceEnabled={promptConfig.referenceEnabled}
        referenceDisabledReason={promptConfig.referenceDisabledReason}
        onClose={() => finishPrompt(null, false)}
        onSelect={(mode, rememberChoice) => finishPrompt(mode, rememberChoice)}
      />
    ),
    [
      finishPrompt,
      isPromptOpen,
      promptConfig.referenceDisabledReason,
      promptConfig.referenceEnabled,
    ],
  );

  return {
    requestImportMode,
    importModeDialog,
  };
};
