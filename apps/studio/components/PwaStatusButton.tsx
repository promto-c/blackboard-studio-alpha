import React, { useState } from 'react';
import * as Icons from '@blackboard/icons';
import { Popover } from '@blackboard/ui';
import { usePwa } from '@/pwa/usePwa';
import type { PwaSnapshot } from '@/pwa/pwaLifecycle';

interface PwaStatusButtonProps {
  className?: string;
}

type StatusTone = 'amber' | 'cyan' | 'emerald' | 'gray' | 'red';

interface StatusView {
  title: string;
  subtitle: string;
  tone: StatusTone;
  Icon: React.ComponentType<{ className?: string }>;
}

const toneClassName: Record<StatusTone, string> = {
  amber: 'border-amber-300/30 bg-amber-300/15 text-amber-100',
  cyan: 'border-cyan-300/30 bg-cyan-300/15 text-cyan-100',
  emerald: 'border-emerald-300/30 bg-emerald-300/15 text-emerald-100',
  gray: 'border-white/10 bg-white/10 text-gray-200',
  red: 'border-red-300/30 bg-red-500/15 text-red-100',
};

const formatVersion = (version: string | null) => (version ? `v${version}` : 'New version');

const formatCheckedTime = (timestamp: number | null) => {
  if (!timestamp) return 'Not checked';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
};

const getStatusView = (snapshot: PwaSnapshot): StatusView => {
  if (snapshot.updateReady) {
    return {
      title: 'Update Ready',
      subtitle: `${formatVersion(snapshot.availableVersion)} downloaded`,
      tone: 'amber',
      Icon: Icons.RotateLoop,
    };
  }

  if (!snapshot.isOnline) {
    return {
      title: 'Offline',
      subtitle: snapshot.offlineReady ? 'Workspace available' : 'Network unavailable',
      tone: snapshot.offlineReady ? 'emerald' : 'red',
      Icon: snapshot.offlineReady ? Icons.Check : Icons.ExclamationCircle,
    };
  }

  if (snapshot.canInstall) {
    return {
      title: 'Install App',
      subtitle: 'Desktop mode available',
      tone: 'cyan',
      Icon: Icons.ArrowDownTray,
    };
  }

  if (snapshot.checkingForUpdate || snapshot.updateInstalling) {
    return {
      title: snapshot.updateInstalling ? 'Downloading Update' : 'Checking Updates',
      subtitle: formatVersion(snapshot.appVersion),
      tone: 'cyan',
      Icon: Icons.RotateLoop,
    };
  }

  if (snapshot.offlineReady) {
    return {
      title: 'Offline Ready',
      subtitle: formatVersion(snapshot.appVersion),
      tone: 'emerald',
      Icon: snapshot.isStandalone ? Icons.ComputerDesktop : Icons.Check,
    };
  }

  return {
    title: snapshot.serviceWorkerState === 'error' ? 'App Support Issue' : 'App Status',
    subtitle: formatVersion(snapshot.appVersion),
    tone: snapshot.serviceWorkerState === 'error' ? 'red' : 'gray',
    Icon: snapshot.serviceWorkerState === 'error' ? Icons.ExclamationCircle : Icons.ComputerDesktop,
  };
};

const shouldRenderButton = (snapshot: PwaSnapshot) =>
  snapshot.canInstall ||
  snapshot.isStandalone ||
  snapshot.offlineReady ||
  snapshot.updateReady ||
  snapshot.updateInstalling ||
  snapshot.checkingForUpdate ||
  snapshot.serviceWorkerEnabled ||
  snapshot.serviceWorkerState === 'error' ||
  !snapshot.isOnline;

export function PwaStatusButton({ className = '' }: PwaStatusButtonProps) {
  const { snapshot, install, checkForUpdate, applyUpdate } = usePwa();
  const [isOpen, setIsOpen] = useState(false);
  const status = getStatusView(snapshot);
  const Icon = status.Icon;

  if (!shouldRenderButton(snapshot)) return null;

  const buttonClassName =
    className ||
    'interactive-glow glass-component relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-gray-950/55 text-gray-300 shadow-2xl backdrop-blur-xl ring-1 ring-inset ring-white/10 transition hover:border-white/20 hover:bg-gray-900/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60';

  const runCheck = () => {
    void checkForUpdate();
  };

  const runInstall = () => {
    void install();
  };

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      align="end"
      widthClass="w-80 max-w-[calc(100vw-2rem)]"
      trigger={
        <button
          type="button"
          className={buttonClassName}
          title={status.title}
          aria-label={status.title}
        >
          <Icon
            className={`h-5 w-5 ${
              snapshot.checkingForUpdate || snapshot.updateInstalling ? 'animate-spin' : ''
            }`}
          />
          {snapshot.updateReady || snapshot.canInstall || !snapshot.isOnline ? (
            <span
              className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ${
                snapshot.updateReady
                  ? 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.7)]'
                  : !snapshot.isOnline
                    ? 'bg-red-300 shadow-[0_0_10px_rgba(252,165,165,0.7)]'
                    : 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.7)]'
              }`}
            />
          ) : null}
        </button>
      }
    >
      {() => (
        <div className="space-y-3" data-text-selection-scope>
          <div className="flex items-start gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${toneClassName[status.tone]}`}
            >
              <Icon
                className={`h-[18px] w-[18px] ${
                  snapshot.checkingForUpdate || snapshot.updateInstalling ? 'animate-spin' : ''
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-gray-100">{status.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-gray-500">{status.subtitle}</p>
            </div>
            <span className="shrink-0 rounded-md border border-white/10 bg-black/20 px-1.5 py-1 font-mono text-[10px] text-gray-400">
              v{snapshot.appVersion}
            </span>
          </div>

          <div className="space-y-2">
            {snapshot.updateReady ? (
              <button
                type="button"
                onClick={applyUpdate}
                disabled={snapshot.applyingUpdate}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:border-amber-200/50 hover:bg-amber-300/20 disabled:cursor-wait disabled:opacity-70"
              >
                <Icons.Power className="h-4 w-4" />
                {snapshot.applyingUpdate ? 'Restarting...' : 'Restart to Update'}
              </button>
            ) : null}

            {snapshot.canInstall ? (
              <button
                type="button"
                onClick={runInstall}
                disabled={snapshot.isInstalling}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/15 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:border-cyan-200/50 hover:bg-cyan-300/20 disabled:cursor-wait disabled:opacity-70"
              >
                <Icons.ArrowDownTray className="h-4 w-4" />
                {snapshot.isInstalling ? 'Installing...' : 'Install App'}
              </button>
            ) : null}

            <button
              type="button"
              onClick={runCheck}
              disabled={
                snapshot.checkingForUpdate ||
                snapshot.updateInstalling ||
                snapshot.applyingUpdate ||
                !snapshot.isOnline ||
                !snapshot.serviceWorkerEnabled
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icons.RotateLoop
                className={`h-4 w-4 ${snapshot.checkingForUpdate ? 'animate-spin' : ''}`}
              />
              {snapshot.checkingForUpdate ? 'Checking...' : 'Check for Updates'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
              <p className="text-gray-500">Network</p>
              <p className={snapshot.isOnline ? 'text-emerald-200' : 'text-red-200'}>
                {snapshot.isOnline ? 'Online' : 'Offline'}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
              <p className="text-gray-500">Offline</p>
              <p className={snapshot.offlineReady ? 'text-emerald-200' : 'text-gray-300'}>
                {snapshot.offlineReady ? 'Ready' : 'Preparing'}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
              <p className="text-gray-500">Mode</p>
              <p className="text-gray-200">{snapshot.isStandalone ? 'Installed' : 'Browser'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
              <p className="text-gray-500">Checked</p>
              <p className="text-gray-200">{formatCheckedTime(snapshot.lastCheckedAt)}</p>
            </div>
          </div>

          {snapshot.error ? (
            <div className="rounded-lg border border-red-300/25 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-100">
              {snapshot.error}
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
