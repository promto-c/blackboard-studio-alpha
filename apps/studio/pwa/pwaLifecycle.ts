type InstallOutcome = 'accepted' | 'dismissed' | null;
type ServiceWorkerState = 'disabled' | 'error' | 'ready' | 'registering' | 'unsupported';
type PwaUpdatePhase = 'applying' | 'checking' | 'downloading' | 'error' | 'idle' | 'ready';

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
  error: string | null;
}

type PwaListener = (snapshot: PwaSnapshot) => void;

const AUTO_UPDATE_CHECK_DELAY_MS = 8_000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const VERSION_RESPONSE_TIMEOUT_MS = 1_000;

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

const readWorkerVersion = (worker: ServiceWorker): Promise<ServiceWorkerVersionMessage | null> =>
  new Promise((resolve) => {
    if (!canUseDom()) {
      resolve(null);
      return;
    }

    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, VERSION_RESPONSE_TIMEOUT_MS);

    channel.port1.onmessage = (event: MessageEvent<ServiceWorkerVersionMessage>) => {
      window.clearTimeout(timeoutId);
      channel.port1.close();
      resolve(event.data?.type === 'BLACKBOARD_STUDIO_SW_VERSION' ? event.data : null);
    };

    worker.postMessage({ type: 'BLACKBOARD_STUDIO_GET_VERSION' }, [channel.port2]);
  });

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
      if (reloadWhenControllerChanges) {
        reloadWhenControllerChanges = false;
        window.location.reload();
      }
    });

    navigator.serviceWorker.addEventListener(
      'message',
      (event: MessageEvent<ServiceWorkerVersionMessage>) => {
        if (event.data?.type !== 'BLACKBOARD_STUDIO_SW_VERSION') return;
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

    void navigator.serviceWorker.ready.then(() => markOfflineReady());
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
