import { createContext, useContext, useState, ReactNode, useCallback, useMemo } from 'react';
import { colors, applyTheme, applyUiStyle } from '@/utils/colors';
import { loadPreferences, savePreferencesToStorage, type Preferences } from '@/state/preferences';

interface PreferencesContextType extends Preferences {
  availableColors: string[];
  setPreferences: (prefs: Partial<Preferences>) => void;
  incrementToolUsage: (toolName: string) => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<Preferences>(loadPreferences);

  const setPreferences = useCallback((prefs: Partial<Preferences>) => {
    setPreferencesState((currentPrefs) => {
      const newPrefs = { ...currentPrefs, ...prefs };
      savePreferencesToStorage(newPrefs);

      if (prefs.primaryColor && prefs.primaryColor !== currentPrefs.primaryColor) {
        applyTheme(prefs.primaryColor);
      }

      if (prefs.uiStyle && prefs.uiStyle !== currentPrefs.uiStyle) {
        applyUiStyle(prefs.uiStyle);
      }

      return newPrefs;
    });
  }, []);

  const incrementToolUsage = useCallback((toolName: string) => {
    setPreferencesState((currentPrefs) => {
      const currentCount = currentPrefs.toolUsageCounts[toolName] || 0;
      const newPrefs = {
        ...currentPrefs,
        toolUsageCounts: {
          ...currentPrefs.toolUsageCounts,
          [toolName]: currentCount + 1,
        },
      };
      savePreferencesToStorage(newPrefs);
      return newPrefs;
    });
  }, []);

  const value = useMemo<PreferencesContextType>(
    () => ({
      ...preferences,
      availableColors: Object.keys(colors),
      setPreferences,
      incrementToolUsage,
    }),
    [preferences, setPreferences, incrementToolUsage],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
