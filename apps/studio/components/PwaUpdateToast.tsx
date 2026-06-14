import { useEffect, useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import { usePwa } from '@/pwa/usePwa';

const DISMISSED_UPDATE_KEY = 'blackboard-studio:pwa-dismissed-update';

const readDismissedUpdateKey = () => {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
};

const writeDismissedUpdateKey = (key: string) => {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_KEY, key);
  } catch {
    // Ignore storage failures; the toast can reappear on the next session.
  }
};

const getUpdateKey = (availableBuildId: string | null, availableVersion: string | null) =>
  availableBuildId ?? availableVersion ?? 'pending-update';

export function PwaUpdateToast() {
  const { snapshot, applyUpdate } = usePwa();
  const updateKey = useMemo(
    () => getUpdateKey(snapshot.availableBuildId, snapshot.availableVersion),
    [snapshot.availableBuildId, snapshot.availableVersion],
  );
  const [dismissedUpdateKey, setDismissedUpdateKey] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readDismissedUpdateKey(),
  );

  useEffect(() => {
    if (!snapshot.updateReady) return;
    setDismissedUpdateKey(readDismissedUpdateKey());
  }, [snapshot.updateReady, updateKey]);

  if (!snapshot.updateReady || dismissedUpdateKey === updateKey) return null;

  const dismiss = () => {
    writeDismissedUpdateKey(updateKey);
    setDismissedUpdateKey(updateKey);
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[130] flex justify-end sm:inset-x-4 sm:bottom-4">
      <div className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-amber-300/25 bg-gray-950/90 p-3 text-gray-100 shadow-2xl ring-1 ring-inset ring-white/10 backdrop-blur-xl">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/30 bg-amber-300/15 text-amber-100">
          <Icons.RotateLoop className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Update Ready</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {snapshot.availableVersion
              ? `Blackboard Studio v${snapshot.availableVersion}`
              : 'Blackboard Studio'}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={applyUpdate}
              disabled={snapshot.applyingUpdate}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/15 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:border-amber-200/50 hover:bg-amber-300/20 disabled:cursor-wait disabled:opacity-70"
            >
              <Icons.Power className="h-3.5 w-3.5" />
              {snapshot.applyingUpdate ? 'Restarting...' : 'Restart'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-gray-100"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50"
          title="Dismiss update"
          aria-label="Dismiss update"
        >
          <Icons.XMark className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
