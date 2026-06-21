type InstallOutcome = 'accepted' | 'dismissed' | null;
type ServiceWorkerState = 'disabled' | 'error' | 'ready' | 'registering' | 'unsupported';
type PwaUpdatePhase = 'applying' | 'checking' | 'downloading' | 'error' | 'idle' | 'ready';
type PwaAssetOperation = 'install' | 'remove';
type PwaAssetOperationPhase = 'downloading' | 'error' | 'idle' | 'removing';

interface BeforeInstallPromptChoice {
  outcome: 'accepted' | 'dismissed';
  platform: string;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<BeforeInstallPromptChoice>;
  prompt: () => Promise<void>;
}

interface ServiceWorkerVersionMessage {
  type: 'BLACKBOARD_STUDIO_SW_VERSION';
  appName: string;
  appVersion: string;
  cacheVersion: string;
  assetCount: number;
  precacheAssetCount?: number;
  runtimeAssetCount?: number;
  precacheBytes?: number;
  runtimeBytes?: number;
  runtimeAssetGroups?: PwaAssetGroupSnapshot[];
}

export interface PwaAssetGroupSnapshot {
  id: string;
  label: string;
  description: string;
  source: 'bundle' | 'marketplace';
  removable: boolean;
  assetCount: number;
  size: number;
  cachedAssetCount: number;
  cachedBytes: number;
}

interface PwaCacheStatusMessage extends Omit<ServiceWorkerVersionMessage, 'type'> {
  type: 'BLACKBOARD_STUDIO_SW_CACHE_STATUS';
  precacheCachedAssetCount?: number;
  precacheCachedBytes?: number;
  runtimeCachedAssetCount?: number;
  runtimeCachedBytes?: number;
  totalCachedBytes?: number;
  error?: string;
}

interface PwaCacheResultMessage {
  type: 'BLACKBOARD_STUDIO_SW_CACHE_RESULT';
  ok: boolean;
  operation?: PwaAssetOperation;
  groupId: string | null;
  cacheStatus?: PwaCacheStatusMessage;
  error?: string;
}

export interface PwaSnapshot {
  appVersion: string;
  buildId: string;
  availableVersion: string | null;
  availableBuildId: string | null;
  serviceWorkerEnabled: boolean;
  serviceWorkerSupported: boolean;
  serviceWorkerState: ServiceWorkerState;
  isStandalone: boolean;
  canInstall: boolean;
  isInstalling: boolean;
  installOutcome: InstallOutcome;
  isOnline: boolean;
  offlineReady: boolean;
  checkingForUpdate: boolean;
  applyingUpdate: boolean;
  updateAvailable: boolean;
  updateInstalling: boolean;
  updateReady: boolean;
  updatePhase: PwaUpdatePhase;
  lastCheckedAt: number | null;
  lastUpdateFoundAt: number | null;
  cachedBytes: number | null;
  offlineAssetCount: number | null;
  offlineBytes: number | null;
  onDemandAssetCount: number | null;
  onDemandBytes: number | null;
  onDemandCachedAssetCount: number | null;
  onDemandCachedBytes: number | null;
  onDemandAssetGroups: PwaAssetGroupSnapshot[];
  assetOperationPhase: PwaAssetOperationPhase;
  operatingAssetGroupId: string | null;
  assetOperationError: string | null;
  error: string | null;
}

type PwaListener = (snapshot: PwaSnapshot) => void;

const AUTO_UPDATE_CHECK_DELAY_MS = 8_000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const VERSION_RESPONSE_TIMEOUT_MS = 1_000;
const CACHE_STATUS_RESPONSE_TIMEOUT_MS = 2_500;
const CACHE_DOWNLOAD_RESPONSE_TIMEOUT_MS = 15 * 60 * 1_000;

let installPromptEvent: BeforeInstallPromptEvent | null = null;
let registrationPromise: Promise<void> | null = null;
let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let reloadWhenControllerChanges = false;
let lifecycleListenersAttached = false;
let autoCheckDelayId: number | null = null;
let autoCheckIntervalId: number | null = null;

const listeners = new Set<PwaListener>();

const canUseDom = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const isNativeDesktopRuntime = () => canUseDom() && Boolean(__BLACKBOARD_STUDIO_DESKTOP__);

const getDefinedString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value : fallback;

const getAppVersion = () =>
  getDefinedString(
    typeof __BLACKBOARD_STUDIO_VERSION__ === 'undefined'
      ? undefined
      : __BLACKBOARD_STUDIO_VERSION__,
    '0.0.0',
  );

const getBuildId = () =>
  getDefinedString(
    typeof __BLACKBOARD_STUDIO_BUILD_ID__ === 'undefined'
      ? undefined
      : __BLACKBOARD_STUDIO_BUILD_ID__,
    getAppVersion(),
  );

const getStandaloneStatus = () => {
  if (!canUseDom()) return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigatorWithStandalone.standalone === true
  );
};

const getOnlineStatus = () => (canUseDom() ? navigator.onLine : true);

const getServiceWorkerSupport = () => canUseDom() && 'serviceWorker' in navigator;

let snapshot: PwaSnapshot = {
  appVersion: getAppVersion(),
  buildId: getBuildId(),
  availableVersion: null,
  availableBuildId: null,
  serviceWorkerEnabled: false,
  serviceWorkerSupported: getServiceWorkerSupport(),
  serviceWorkerState:
    isNativeDesktopRuntime() || getServiceWorkerSupport() ? 'disabled' : 'unsupported',
  isStandalone: getStandaloneStatus(),
  canInstall: false,
  isInstalling: false,
  installOutcome: null,
  isOnline: getOnlineStatus(),
  offlineReady: false,
  checkingForUpdate: false,
  applyingUpdate: false,
  updateAvailable: false,
  updateInstalling: false,
  updateReady: false,
  updatePhase: 'idle',
  lastCheckedAt: null,
  lastUpdateFoundAt: null,
  cachedBytes: null,
  offlineAssetCount: null,
  offlineBytes: null,
  onDemandAssetCount: null,
  onDemandBytes: null,
  onDemandCachedAssetCount: null,
  onDemandCachedBytes: null,
  onDemandAssetGroups: [],
  assetOperationPhase: 'idle',
  operatingAssetGroupId: null,
  assetOperationError: null,
  error: null,
};

const emit = () => {
  listeners.forEach((listener) => listener(snapshot));
};

const patchSnapshot = (updates: Partial<PwaSnapshot>) => {
  const isStandalone = getStandaloneStatus();
  snapshot = {
    ...snapshot,
    ...updates,
    appVersion: getAppVersion(),
    buildId: getBuildId(),
    isStandalone,
    isOnline: getOnlineStatus(),
    serviceWorkerSupported: getServiceWorkerSupport(),
    canInstall: Boolean(installPromptEvent) && !isStandalone,
  };
  emit();
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const requestWorkerMessage = <T>(
  worker: ServiceWorker,
  message: Record<string, unknown>,
  timeoutMs: number,
): Promise<T | null> =>
  new Promise((resolve) => {
    if (!canUseDom()) {
      resolve(null);
      return;
    }

    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, timeoutMs);

    channel.port1.onmessage = (event: MessageEvent<T>) => {
      window.clearTimeout(timeoutId);
      channel.port1.close();
      resolve(event.data ?? null);
    };

    worker.postMessage(message, [channel.port2]);
  });

const readWorkerVersion = (worker: ServiceWorker): Promise<ServiceWorkerVersionMessage | null> =>
  requestWorkerMessage<ServiceWorkerVersionMessage>(
    worker,
    { type: 'BLACKBOARD_STUDIO_GET_VERSION' },
    VERSION_RESPONSE_TIMEOUT_MS,
  ).then((message) => (message?.type === 'BLACKBOARD_STUDIO_SW_VERSION' ? message : null));

const isFiniteSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const normalizeAssetGroups = (groups: unknown): PwaAssetGroupSnapshot[] => {
  if (!Array.isArray(groups)) return [];

  return groups
    .map((group) => {
      if (!group || typeof group !== 'object') return null;
      const candidate = group as Partial<PwaAssetGroupSnapshot>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.label !== 'string' ||
        !isFiniteSize(candidate.assetCount) ||
        !isFiniteSize(candidate.size)
      ) {
        return null;
      }

      return {
        id: candidate.id,
        label: candidate.label,
        description:
          typeof candidate.description === 'string' && candidate.description.trim()
            ? candidate.description
            : 'Optional files cached when the related feature is used.',
        source:
          candidate.source === 'bundle' || candidate.source === 'marketplace'
            ? candidate.source
            : 'bundle',
        removable: candidate.removable !== false,
        assetCount: candidate.assetCount,
        size: candidate.size,
        cachedAssetCount: isFiniteSize(candidate.cachedAssetCount) ? candidate.cachedAssetCount : 0,
        cachedBytes: isFiniteSize(candidate.cachedBytes) ? candidate.cachedBytes : 0,
      };
    })
    .filter((group): group is PwaAssetGroupSnapshot => Boolean(group));
};

const applyVersionMetadata = (version: ServiceWorkerVersionMessage | null) => {
  if (!version) return;

  patchSnapshot({
    offlineAssetCount: isFiniteSize(version.precacheAssetCount)
      ? version.precacheAssetCount
      : isFiniteSize(version.assetCount)
        ? version.assetCount
        : snapshot.offlineAssetCount,
    offlineBytes: isFiniteSize(version.precacheBytes) ? version.precacheBytes : null,
    onDemandAssetCount: isFiniteSize(version.runtimeAssetCount) ? version.runtimeAssetCount : null,
    onDemandBytes: isFiniteSize(version.runtimeBytes) ? version.runtimeBytes : null,
    onDemandAssetGroups: normalizeAssetGroups(version.runtimeAssetGroups),
  });
};

const applyCacheStatus = (status: PwaCacheStatusMessage | null) => {
  if (!status || status.type !== 'BLACKBOARD_STUDIO_SW_CACHE_STATUS') return;
  if (status.error) {
    patchSnapshot({ assetOperationError: status.error });
    return;
  }

  applyVersionMetadata({
    ...status,
    type: 'BLACKBOARD_STUDIO_SW_VERSION',
  });

  patchSnapshot({
    cachedBytes: isFiniteSize(status.totalCachedBytes) ? status.totalCachedBytes : null,
    offlineAssetCount: isFiniteSize(status.precacheCachedAssetCount)
      ? status.precacheCachedAssetCount
      : snapshot.offlineAssetCount,
    offlineBytes: isFiniteSize(status.precacheCachedBytes)
      ? status.precacheCachedBytes
      : snapshot.offlineBytes,
    onDemandCachedAssetCount: isFiniteSize(status.runtimeCachedAssetCount)
      ? status.runtimeCachedAssetCount
      : null,
    onDemandCachedBytes: isFiniteSize(status.runtimeCachedBytes) ? status.runtimeCachedBytes : null,
    onDemandAssetGroups: normalizeAssetGroups(status.runtimeAssetGroups),
  });
};

const getActiveServiceWorker = (): ServiceWorker | null =>
  serviceWorkerRegistration?.active ?? navigator.serviceWorker.controller ?? null;

const refreshPwaCacheStatusInternal = async ({
  silent = true,
}: { silent?: boolean } = {}): Promise<void> => {
  if (!canUseDom() || !getServiceWorkerSupport()) return;

  const worker = getActiveServiceWorker();
  if (!worker) {
    if (!silent) {
      patchSnapshot({
        assetOperationError: 'Offline app support is still starting.',
      });
    }
    return;
  }

  try {
    const status = await requestWorkerMessage<PwaCacheStatusMessage>(
      worker,
      { type: 'BLACKBOARD_STUDIO_GET_CACHE_STATUS' },
      CACHE_STATUS_RESPONSE_TIMEOUT_MS,
    );
    applyCacheStatus(status);
  } catch (error) {
    if (!silent) {
      patchSnapshot({
        assetOperationError: getErrorMessage(error, 'Could not read offline asset storage.'),
      });
    }
  }
};

const markUpdateReady = (worker: ServiceWorker) => {
  waitingWorker = worker;
  patchSnapshot({
    availableVersion: null,
    availableBuildId: null,
    checkingForUpdate: false,
    updateAvailable: true,
    updateInstalling: false,
    updateReady: true,
    updatePhase: 'ready',
    lastUpdateFoundAt: Date.now(),
    error: null,
  });

  void readWorkerVersion(worker).then((version) => {
    if (!version || waitingWorker !== worker) return;
    applyVersionMetadata(version);
    patchSnapshot({
      availableVersion: version.appVersion,
      availableBuildId: version.cacheVersion,
    });
  });
};

const markOfflineReady = () => {
  patchSnapshot({
    offlineReady: true,
    serviceWorkerState: 'ready',
    updateInstalling: false,
    updatePhase: snapshot.updateReady ? 'ready' : 'idle',
    error: null,
  });
};

const handleWorkerStateChange = (
  worker: ServiceWorker,
  registration: ServiceWorkerRegistration,
) => {
  if (worker.state === 'installed') {
    if (navigator.serviceWorker.controller) {
      markUpdateReady(registration.waiting ?? worker);
      return;
    }

    markOfflineReady();
    return;
  }

  if (worker.state === 'activated') {
    markOfflineReady();
    return;
  }

  if (worker.state === 'redundant') {
    patchSnapshot({
      checkingForUpdate: false,
      updateInstalling: false,
      updatePhase: snapshot.updateReady ? 'ready' : 'idle',
    });
  }
};

const watchRegistration = (registration: ServiceWorkerRegistration) => {
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;

    patchSnapshot({
      checkingForUpdate: false,
      updateAvailable: true,
      updateInstalling: true,
      updatePhase: 'downloading',
      lastUpdateFoundAt: Date.now(),
      error: null,
    });

    worker.addEventListener('statechange', () => handleWorkerStateChange(worker, registration));
  });

  if (registration.waiting && navigator.serviceWorker.controller) {
    markUpdateReady(registration.waiting);
  }

  if (registration.active) {
    markOfflineReady();
    void readWorkerVersion(registration.active).then(applyVersionMetadata);
    void refreshPwaCacheStatusInternal();
  }
};

const scheduleAutoUpdateChecks = () => {
  if (!canUseDom()) return;

  if (autoCheckDelayId === null) {
    autoCheckDelayId = window.setTimeout(() => {
      autoCheckDelayId = null;
      void checkForPwaUpdate({ silent: true });
    }, AUTO_UPDATE_CHECK_DELAY_MS);
  }

  if (autoCheckIntervalId === null) {
    autoCheckIntervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void checkForPwaUpdate({ silent: true });
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);
  }
};

const attachLifecycleListeners = () => {
  if (!canUseDom() || lifecycleListenersAttached) return;
  lifecycleListenersAttached = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPromptEvent = event as BeforeInstallPromptEvent;
    patchSnapshot({ installOutcome: null, error: null });
  });

  window.addEventListener('appinstalled', () => {
    installPromptEvent = null;
    patchSnapshot({
      installOutcome: 'accepted',
      isInstalling: false,
      error: null,
    });
  });

  window.addEventListener('online', () => {
    patchSnapshot({ error: null });
    void checkForPwaUpdate({ silent: true });
    void refreshPwaCacheStatusInternal();
  });

  window.addEventListener('offline', () => {
    patchSnapshot({});
  });

  window
    .matchMedia('(display-mode: standalone)')
    .addEventListener('change', () => patchSnapshot({}));
  window
    .matchMedia('(display-mode: window-controls-overlay)')
    .addEventListener('change', () => patchSnapshot({}));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void checkForPwaUpdate({ silent: true });
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      markOfflineReady();
      if (navigator.serviceWorker.controller) {
        void readWorkerVersion(navigator.serviceWorker.controller).then(applyVersionMetadata);
        void refreshPwaCacheStatusInternal();
      }
      if (reloadWhenControllerChanges) {
        reloadWhenControllerChanges = false;
        window.location.reload();
      }
    });

    navigator.serviceWorker.addEventListener(
      'message',
      (event: MessageEvent<ServiceWorkerVersionMessage | PwaCacheStatusMessage>) => {
        if (event.data?.type === 'BLACKBOARD_STUDIO_SW_CACHE_STATUS') {
          applyCacheStatus(event.data);
          return;
        }
        if (event.data?.type !== 'BLACKBOARD_STUDIO_SW_VERSION') return;
        applyVersionMetadata(event.data);
        patchSnapshot({
          offlineReady: true,
          serviceWorkerState: 'ready',
          error: null,
        });
      },
    );
  }
};

const registerServiceWorker = async () => {
  try {
    const registration = await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
      {
        scope: import.meta.env.BASE_URL,
      },
    );

    serviceWorkerRegistration = registration;
    watchRegistration(registration);
    patchSnapshot({
      serviceWorkerEnabled: true,
      serviceWorkerState: 'ready',
      error: null,
    });

    void navigator.serviceWorker.ready.then((readyRegistration) => {
      serviceWorkerRegistration = readyRegistration;
      markOfflineReady();
      void refreshPwaCacheStatusInternal();
    });
    scheduleAutoUpdateChecks();
  } catch (error) {
    patchSnapshot({
      serviceWorkerState: 'error',
      checkingForUpdate: false,
      updateInstalling: false,
      updatePhase: 'error',
      error: getErrorMessage(error, 'Could not enable offline app support.'),
    });
  }
};

export const getPwaSnapshot = () => snapshot;

export const subscribeToPwa = (listener: PwaListener) => {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
};

export const registerPwa = () => {
  if (!canUseDom()) return;
  attachLifecycleListeners();

  if (isNativeDesktopRuntime()) {
    patchSnapshot({
      serviceWorkerEnabled: false,
      serviceWorkerState: 'disabled',
      offlineReady: true,
      error: null,
    });
    return;
  }

  if (!import.meta.env.PROD) {
    patchSnapshot({
      serviceWorkerEnabled: false,
      serviceWorkerState: getServiceWorkerSupport() ? 'disabled' : 'unsupported',
    });
    return;
  }

  if (!getServiceWorkerSupport()) {
    patchSnapshot({
      serviceWorkerEnabled: false,
      serviceWorkerState: 'unsupported',
    });
    return;
  }

  if (registrationPromise) return;

  patchSnapshot({
    serviceWorkerEnabled: true,
    serviceWorkerState: 'registering',
    error: null,
  });
  registrationPromise = registerServiceWorker();
};

export const refreshPwaCacheStatus = async ({ silent = false }: { silent?: boolean } = {}) => {
  registerPwa();
  await refreshPwaCacheStatusInternal({ silent });
};

const getPwaAssetOperationMessageType = (operation: PwaAssetOperation) =>
  operation === 'remove'
    ? 'BLACKBOARD_STUDIO_DELETE_RUNTIME_ASSETS'
    : 'BLACKBOARD_STUDIO_CACHE_RUNTIME_ASSETS';

const getPwaAssetOperationFallback = (operation: PwaAssetOperation) =>
  operation === 'remove'
    ? 'Could not remove offline assets.'
    : 'Could not download offline assets.';

const runPwaAssetGroupOperation = async (
  operation: PwaAssetOperation,
  groupId?: string,
): Promise<boolean> => {
  registerPwa();

  if (!canUseDom() || !getServiceWorkerSupport()) {
    patchSnapshot({
      assetOperationPhase: 'error',
      operatingAssetGroupId: null,
      assetOperationError: 'Offline pack management is unavailable in this browser.',
    });
    return false;
  }

  if (operation === 'install' && !navigator.onLine) {
    patchSnapshot({
      assetOperationPhase: 'error',
      operatingAssetGroupId: null,
      assetOperationError: 'Download offline packs when the network is online.',
    });
    return false;
  }

  const worker = getActiveServiceWorker();
  if (!worker) {
    patchSnapshot({
      assetOperationPhase: 'error',
      operatingAssetGroupId: null,
      assetOperationError: 'Offline app support is still starting.',
    });
    return false;
  }

  const targetGroupId = groupId ?? 'all';
  patchSnapshot({
    assetOperationPhase: operation === 'remove' ? 'removing' : 'downloading',
    operatingAssetGroupId: targetGroupId,
    assetOperationError: null,
    error: null,
  });

  try {
    const fallback = getPwaAssetOperationFallback(operation);
    const result = await requestWorkerMessage<PwaCacheResultMessage>(
      worker,
      {
        type: getPwaAssetOperationMessageType(operation),
        groupId,
      },
      CACHE_DOWNLOAD_RESPONSE_TIMEOUT_MS,
    );

    if (!result || result.type !== 'BLACKBOARD_STUDIO_SW_CACHE_RESULT') {
      throw new Error(
        operation === 'remove'
          ? 'Offline asset removal did not respond.'
          : 'Offline asset download did not respond.',
      );
    }
    if (!result.ok) {
      throw new Error(result.error || fallback);
    }

    applyCacheStatus(result.cacheStatus ?? null);
    patchSnapshot({
      assetOperationPhase: 'idle',
      operatingAssetGroupId: null,
      assetOperationError: null,
    });
    return true;
  } catch (error) {
    patchSnapshot({
      assetOperationPhase: 'error',
      operatingAssetGroupId: null,
      assetOperationError: getErrorMessage(error, getPwaAssetOperationFallback(operation)),
    });
    return false;
  }
};

export const downloadPwaAssetGroup = async (groupId?: string): Promise<boolean> =>
  runPwaAssetGroupOperation('install', groupId);

export const removePwaAssetGroup = async (groupId?: string): Promise<boolean> =>
  runPwaAssetGroupOperation('remove', groupId);

export const requestPwaInstall = async (): Promise<InstallOutcome> => {
  registerPwa();
  if (!installPromptEvent) return null;

  const promptEvent = installPromptEvent;
  installPromptEvent = null;
  patchSnapshot({
    isInstalling: true,
    installOutcome: null,
    error: null,
  });

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    patchSnapshot({
      isInstalling: false,
      installOutcome: choice.outcome,
    });
    return choice.outcome;
  } catch (error) {
    patchSnapshot({
      isInstalling: false,
      error: getErrorMessage(error, 'Could not start the app install prompt.'),
    });
    return null;
  }
};

export const checkForPwaUpdate = async ({ silent = false }: { silent?: boolean } = {}) => {
  registerPwa();
  if (!serviceWorkerRegistration) {
    if (!silent && import.meta.env.PROD) {
      patchSnapshot({
        updatePhase: 'error',
        error: 'Offline app support is still starting.',
      });
    }
    return;
  }

  if (!navigator.onLine) {
    if (!silent) {
      patchSnapshot({
        updatePhase: snapshot.updateReady ? 'ready' : 'error',
        error: 'Updates are unavailable while offline.',
      });
    }
    return;
  }

  patchSnapshot({
    checkingForUpdate: !silent,
    updatePhase: silent ? snapshot.updatePhase : 'checking',
    error: null,
  });

  try {
    await serviceWorkerRegistration.update();
    const waiting = serviceWorkerRegistration.waiting;
    if (waiting && navigator.serviceWorker.controller) {
      markUpdateReady(waiting);
    }

    patchSnapshot({
      checkingForUpdate: false,
      lastCheckedAt: Date.now(),
      updatePhase: snapshot.updateReady ? 'ready' : 'idle',
      error: null,
    });
  } catch (error) {
    if (!silent) {
      patchSnapshot({
        checkingForUpdate: false,
        updatePhase: 'error',
        error: getErrorMessage(error, 'Could not check for updates.'),
      });
    } else {
      patchSnapshot({ checkingForUpdate: false });
    }
  }
};

export const applyPwaUpdate = () => {
  registerPwa();
  const worker = waitingWorker ?? serviceWorkerRegistration?.waiting;
  if (!worker) {
    window.location.reload();
    return;
  }

  reloadWhenControllerChanges = true;
  patchSnapshot({
    applyingUpdate: true,
    updatePhase: 'applying',
    error: null,
  });
  worker.postMessage({ type: 'BLACKBOARD_STUDIO_SKIP_WAITING' });

  window.setTimeout(() => {
    if (reloadWhenControllerChanges) {
      reloadWhenControllerChanges = false;
      window.location.reload();
    }
  }, 4_000);
};
