import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type PreferencesSectionId =
  | 'appearance'
  | 'viewport'
  | 'colorManagement'
  | 'editing'
  | 'recovery'
  | 'storage'
  | 'integrations'
  | 'models'
  | 'rotoMotion'
  | 'performance'
  | 'debug';

export type PreferencesColorScope = 'application' | 'project';

export interface PreferencesTarget {
  section?: PreferencesSectionId;
  colorScope?: PreferencesColorScope;
}

export const getDefaultPreferencesColorScope = (
  projectId: string | null,
  requestedScope?: PreferencesColorScope,
): PreferencesColorScope => requestedScope ?? (projectId ? 'project' : 'application');

interface PreferencesNavigationState {
  isOpen: boolean;
  requestId: number;
  target: PreferencesTarget;
  openPreferences: (target?: PreferencesTarget) => void;
  closePreferences: () => void;
}

const PreferencesNavigationContext = createContext<PreferencesNavigationState | null>(null);

export function PreferencesNavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    requestId: number;
    target: PreferencesTarget;
  }>({
    isOpen: false,
    requestId: 0,
    target: {},
  });
  const openPreferences = useCallback((target: PreferencesTarget = {}) => {
    setState((current) => ({
      isOpen: true,
      requestId: current.requestId + 1,
      target,
    }));
  }, []);
  const closePreferences = useCallback(() => {
    setState((current) => ({
      ...current,
      isOpen: false,
    }));
  }, []);

  const value = useMemo<PreferencesNavigationState>(
    () => ({
      ...state,
      openPreferences,
      closePreferences,
    }),
    [closePreferences, openPreferences, state],
  );

  return (
    <PreferencesNavigationContext.Provider value={value}>
      {children}
    </PreferencesNavigationContext.Provider>
  );
}

export const usePreferencesNavigation = (): PreferencesNavigationState => {
  const context = useContext(PreferencesNavigationContext);
  if (!context) {
    throw new Error(
      'usePreferencesNavigation must be used within a PreferencesNavigationProvider.',
    );
  }
  return context;
};
