import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import type { RendererColorManagement } from '@blackboard/renderer';
import { usePreferences } from '@/state/preferencesContext';
import { downloadPwaAssetGroup, refreshPwaCacheStatus } from '@/pwa/pwaLifecycle';
import { ocioManager, OcioDefaults, type OcioRuntimeSnapshot } from '@/utils/ocio';

interface OcioState extends OcioRuntimeSnapshot {
  rendererColorManagement?: RendererColorManagement;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  resolveColorSpaceName: (value: string | undefined) => string;
  getViews: (display: string | undefined) => OcioRuntimeSnapshot['viewsByDisplay'][string];
  getDefaultView: (display: string | undefined, colorSpace?: string) => string;
}

const OcioContext = createContext<OcioState | undefined>(undefined);

export function OcioProvider({ children }: { children: ReactNode }) {
  const { ocioConfigName } = usePreferences();
  const [snapshot, setSnapshot] = useState<OcioRuntimeSnapshot>(() => ocioManager.getSnapshot());
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadOcio = useCallback(
    async (configName = ocioConfigName || OcioDefaults.CONFIG) => {
      setSnapshot({
        ...ocioManager.getSnapshot(),
        isLoading: true,
        configName,
        error: null,
      });

      if (import.meta.env.PROD) {
        await downloadPwaAssetGroup('color-management');
      }

      const nextSnapshot = await ocioManager.initialize(configName);
      if (isMountedRef.current) {
        setSnapshot(nextSnapshot);
      }
      void refreshPwaCacheStatus({ silent: true });
    },
    [ocioConfigName],
  );

  useEffect(() => {
    const configName = ocioConfigName || OcioDefaults.CONFIG;
    const currentSnapshot = ocioManager.getSnapshot();
    if (!currentSnapshot.isInitialized && !currentSnapshot.isLoading) {
      setSnapshot((prev) => ({
        ...prev,
        configName,
        error: null,
      }));
      return;
    }

    void loadOcio(configName);
  }, [loadOcio, ocioConfigName]);

  const value = useMemo<OcioState>(
    () => ({
      ...snapshot,
      rendererColorManagement: ocioManager.getRendererColorManagement(),
      load: () => loadOcio(snapshot.configName),
      refresh: () => loadOcio(snapshot.configName),
      resolveColorSpaceName: (value) => ocioManager.resolveColorSpaceName(value),
      getViews: (display) => ocioManager.getViews(display),
      getDefaultView: (display, colorSpace) => ocioManager.getDefaultView(display, colorSpace),
    }),
    [loadOcio, snapshot],
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
