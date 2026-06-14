import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import type { RendererColorManagement } from '@blackboard/renderer';
import { usePreferences } from '@/state/preferencesContext';
import { ocioManager, OcioDefaults, type OcioRuntimeSnapshot } from '@/utils/ocio';

interface OcioState extends OcioRuntimeSnapshot {
  rendererColorManagement?: RendererColorManagement;
  refresh: () => Promise<void>;
  resolveColorSpaceName: (value: string | undefined) => string;
  getViews: (display: string | undefined) => OcioRuntimeSnapshot['viewsByDisplay'][string];
  getDefaultView: (display: string | undefined, colorSpace?: string) => string;
}

const OcioContext = createContext<OcioState | undefined>(undefined);

export function OcioProvider({ children }: { children: ReactNode }) {
  const { ocioConfigName } = usePreferences();
  const [snapshot, setSnapshot] = useState<OcioRuntimeSnapshot>(() => ocioManager.getSnapshot());

  useEffect(() => {
    let cancelled = false;
    setSnapshot({
      ...ocioManager.getSnapshot(),
      isLoading: true,
      configName: ocioConfigName || OcioDefaults.CONFIG,
      error: null,
    });

    void ocioManager.initialize(ocioConfigName || OcioDefaults.CONFIG).then((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ocioConfigName]);

  const value = useMemo<OcioState>(
    () => ({
      ...snapshot,
      rendererColorManagement: ocioManager.getRendererColorManagement(),
      refresh: async () => {
        const nextSnapshot = await ocioManager.initialize(snapshot.configName);
        setSnapshot(nextSnapshot);
      },
      resolveColorSpaceName: (value) => ocioManager.resolveColorSpaceName(value),
      getViews: (display) => ocioManager.getViews(display),
      getDefaultView: (display, colorSpace) => ocioManager.getDefaultView(display, colorSpace),
    }),
    [snapshot],
  );

  return <OcioContext.Provider value={value}>{children}</OcioContext.Provider>;
}

export const useOcio = () => {
  const context = useContext(OcioContext);
  if (!context) {
    throw new Error('useOcio must be used within an OcioProvider');
  }
  return context;
};
