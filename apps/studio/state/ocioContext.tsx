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
import type { ColorConfigReference } from '@blackboard/types';
import { useEditorSelector } from '@/state/editorContext';
import { refreshPwaCacheStatus } from '@/pwa/pwaLifecycle';
import {
  BUILTIN_ACES_CG_CONFIG_REFERENCE,
  colorManagementService,
  type ColorManagementRuntimeSnapshot,
  normalizeBuiltinConfigName,
} from '@/color-management';

interface OcioState extends ColorManagementRuntimeSnapshot {
  refresh: () => Promise<void>;
  resolveColorSpaceName: (value: string | undefined) => string;
  getViews: (
    display: string | undefined,
  ) => ColorManagementRuntimeSnapshot['viewsByDisplay'][string];
  getDefaultView: (display: string | undefined, colorSpace?: string) => string;
}

const OcioContext = createContext<OcioState | undefined>(undefined);

export function OcioProvider({
  children,
  activeConfig,
  loadingFallback = null,
  suspendChildrenUntilReady = false,
}: {
  children: ReactNode;
  activeConfig: ColorConfigReference;
  loadingFallback?: ReactNode;
  suspendChildrenUntilReady?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ColorManagementRuntimeSnapshot>(() =>
    colorManagementService.getSnapshot(),
  );
  const isMountedRef = useRef(true);
  const activeReferenceRef = useRef<ColorConfigReference>(activeConfig);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadConfig = useCallback(async (reference: ColorConfigReference) => {
    const normalizedConfigName =
      reference.kind === 'builtin' ? normalizeBuiltinConfigName(reference.uri) : reference.uri;
    const currentSnapshot = colorManagementService.getSnapshot();
    if (
      currentSnapshot.isInitialized &&
      currentSnapshot.configName === normalizedConfigName &&
      !currentSnapshot.error
    ) {
      setSnapshot(currentSnapshot);
      return;
    }

    setSnapshot({
      ...currentSnapshot,
      isInitialized: false,
      isLoading: true,
      configName: normalizedConfigName,
      error: null,
    });

    activeReferenceRef.current =
      reference.kind === 'builtin' ? { ...reference, uri: normalizedConfigName } : { ...reference };
    const nextSnapshot = await colorManagementService.initializeConfig(activeReferenceRef.current);
    if (isMountedRef.current) {
      setSnapshot(nextSnapshot);
    }
    void refreshPwaCacheStatus({ silent: true });
  }, []);

  useEffect(() => {
    void refreshPwaCacheStatus({ silent: true });
  }, []);

  useEffect(() => {
    void loadConfig(activeConfig);
  }, [activeConfig, loadConfig]);

  const value = useMemo<OcioState>(
    () => ({
      ...snapshot,
      refresh: () => loadConfig(activeReferenceRef.current),
      resolveColorSpaceName: (value) => colorManagementService.resolveColorSpaceName(value),
      getViews: (display) => colorManagementService.getViews(display),
      getDefaultView: (display, colorSpace) =>
        colorManagementService.getDefaultView(display, colorSpace),
    }),
    [loadConfig, snapshot],
  );

  const requestedConfigName =
    activeConfig.kind === 'builtin'
      ? normalizeBuiltinConfigName(activeConfig.uri)
      : activeConfig.uri;
  const isRequestedConfigReady =
    snapshot.isInitialized &&
    !snapshot.error &&
    !snapshot.isLoading &&
    snapshot.configName === requestedConfigName;

  return (
    <OcioContext.Provider value={value}>
      {suspendChildrenUntilReady && !isRequestedConfigReady ? loadingFallback : children}
    </OcioContext.Provider>
  );
}

export const getProjectRuntimeOcioConfig = (
  projectId: string | null,
  projectConfig: ColorConfigReference,
): ColorConfigReference => (projectId ? projectConfig : { ...BUILTIN_ACES_CG_CONFIG_REFERENCE });

function ProjectOcioLoadStatus() {
  const ocio = useContext(OcioContext);
  const error = ocio?.error;

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gray-950 px-6 text-center text-sm text-gray-400"
      role="status"
    >
      {error
        ? `Could not load the project color configuration: ${error}`
        : 'Loading project color configuration…'}
    </div>
  );
}

export function ProjectOcioProvider({ children }: { children: ReactNode }) {
  const projectId = useEditorSelector((state) => state.projectId);
  const projectConfig = useEditorSelector((state) => state.colorManagement.config);
  // Preferences are copied into project state at creation; runtime activation is project-owned.
  const activeConfig = useMemo<ColorConfigReference>(
    () => getProjectRuntimeOcioConfig(projectId, projectConfig),
    [projectId, projectConfig],
  );
  return (
    <OcioProvider
      activeConfig={activeConfig}
      suspendChildrenUntilReady={Boolean(projectId)}
      loadingFallback={<ProjectOcioLoadStatus />}
    >
      {children}
    </OcioProvider>
  );
}

export const useOcio = () => {
  const context = useContext(OcioContext);
  if (!context) {
    throw new Error('useOcio must be used within an OcioProvider');
  }
  return context;
};
