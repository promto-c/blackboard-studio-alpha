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
import { NodeType, type ColorConfigReference, type OcioFileTransformNode } from '@blackboard/types';
import { useEditorSelector } from '@/state/editorContext';
import { getAllProjectNodes } from '@/state/editor/flowModel';
import { getAsset } from '@/state/assetStorage';
import { refreshPwaCacheStatus } from '@/pwa/pwaLifecycle';
import {
  BUILTIN_ACES_CG_CONFIG_REFERENCE,
  colorManagementService,
  type ColorManagementRuntimeSnapshot,
  normalizeBuiltinConfigName,
} from '@/color-management';

interface OcioState extends ColorManagementRuntimeSnapshot {
  fileAssetRevision: number;
  fileAssetErrors: Readonly<Record<string, string>>;
  refresh: () => Promise<void>;
  resolveColorSpaceName: (value: string | undefined) => string;
  getViews: (
    display: string | undefined,
  ) => ColorManagementRuntimeSnapshot['viewsByDisplay'][string];
  getDefaultView: (display: string | undefined, colorSpace?: string) => string;
}

interface OcioFileAssetReference {
  assetId: string;
  fileName: string;
}

const OcioContext = createContext<OcioState | undefined>(undefined);

export function OcioProvider({
  children,
  activeConfig,
  loadingFallback = null,
  suspendChildrenUntilReady = false,
  fileTransformAssets = [],
}: {
  children: ReactNode;
  activeConfig: ColorConfigReference;
  loadingFallback?: ReactNode;
  suspendChildrenUntilReady?: boolean;
  fileTransformAssets?: readonly OcioFileAssetReference[];
}) {
  const [snapshot, setSnapshot] = useState<ColorManagementRuntimeSnapshot>(() =>
    colorManagementService.getSnapshot(),
  );
  const isMountedRef = useRef(true);
  const activeReferenceRef = useRef<ColorConfigReference>(activeConfig);
  const [fileAssetRevision, setFileAssetRevision] = useState(0);
  const [fileAssetErrors, setFileAssetErrors] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!snapshot.isInitialized || snapshot.error) return;
    if (fileTransformAssets.length === 0) {
      setFileAssetErrors({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      fileTransformAssets.map(async ({ assetId, fileName }) => {
        try {
          if (colorManagementService.isFileTransformAssetRegistered(assetId)) {
            return { assetId, loaded: false, error: null };
          }
          const asset = await getAsset(assetId);
          if (!asset) {
            throw new Error(`Could not load OCIO transform asset "${fileName}".`);
          }
          colorManagementService.registerFileTransformAsset(
            assetId,
            fileName,
            new Uint8Array(await asset.arrayBuffer()),
          );
          return { assetId, loaded: true, error: null };
        } catch (error) {
          return {
            assetId,
            loaded: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      if (results.some((result) => result.loaded)) {
        setFileAssetRevision((revision) => revision + 1);
      }
      setFileAssetErrors(
        Object.fromEntries(
          results
            .filter((result): result is typeof result & { error: string } => Boolean(result.error))
            .map((result) => [result.assetId, result.error]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [fileTransformAssets, snapshot.error, snapshot.isInitialized]);

  const value = useMemo<OcioState>(
    () => ({
      ...snapshot,
      fileAssetRevision,
      fileAssetErrors,
      refresh: () => loadConfig(activeReferenceRef.current),
      resolveColorSpaceName: (value) => colorManagementService.resolveColorSpaceName(value),
      getViews: (display) => colorManagementService.getViews(display),
      getDefaultView: (display, colorSpace) =>
        colorManagementService.getDefaultView(display, colorSpace),
    }),
    [fileAssetErrors, fileAssetRevision, loadConfig, snapshot],
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
  const flows = useEditorSelector((state) => state.flows);
  const fileTransformAssets = useMemo<OcioFileAssetReference[]>(() => {
    const references = new Map<string, OcioFileAssetReference>();
    getAllProjectNodes(flows)
      .filter(
        (node): node is OcioFileTransformNode =>
          node.type === NodeType.OCIO_FILE_TRANSFORM && Boolean(node.assetId && node.fileName),
      )
      .forEach((node) =>
        references.set(node.assetId!, { assetId: node.assetId!, fileName: node.fileName! }),
      );
    return Array.from(references.values());
  }, [flows]);
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
      fileTransformAssets={fileTransformAssets}
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
