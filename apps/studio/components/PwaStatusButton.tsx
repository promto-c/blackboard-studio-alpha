import React, { useEffect, useState } from 'react';
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

const formatVersion = (version: string | null) => (version ? `v${version}` : 'New version');

const formatCheckedTime = (timestamp: number | null) => {
  if (!timestamp) return 'Not checked';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
};

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return 'Pending';
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unitIndex;
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
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
      title: 'Desktop App Available',
      subtitle: 'Install once, launch anytime',
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
      subtitle: 'Core app cached',
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
  const {
    snapshot,
    install,
    checkForUpdate,
    applyUpdate,
    refreshCacheStatus,
    downloadAssetGroup,
    removeAssetGroup,
  } = usePwa();
  const [isOpen, setIsOpen] = useState(false);
  const status = getStatusView(snapshot);
  const Icon = status.Icon;

  useEffect(() => {
    if (!isOpen) return;
    void refreshCacheStatus({ silent: true });
  }, [isOpen, refreshCacheStatus]);

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

  const runDownloadAll = () => {
    void downloadAssetGroup();
  };

  const runRemoveAll = () => {
    void removeAssetGroup();
  };

  const runDownloadGroup = (groupId: string) => {
    void downloadAssetGroup(groupId);
  };

  const runRemoveGroup = (groupId: string) => {
    void removeAssetGroup(groupId);
  };

  const isDownloadingAssets = snapshot.assetOperationPhase === 'downloading';
  const isRemovingAssets = snapshot.assetOperationPhase === 'removing';
  const isOperatingAssets = isDownloadingAssets || isRemovingAssets;
  const isDownloadingAll = isDownloadingAssets && snapshot.operatingAssetGroupId === 'all';
  const isRemovingAll = isRemovingAssets && snapshot.operatingAssetGroupId === 'all';
  const canDownloadAssets =
    snapshot.serviceWorkerEnabled &&
    snapshot.offlineReady &&
    snapshot.isOnline &&
    !isOperatingAssets;
  const canRemoveAssets =
    snapshot.serviceWorkerEnabled && snapshot.offlineReady && !isOperatingAssets;
  const allOptionalCached =
    snapshot.onDemandBytes !== null &&
    snapshot.onDemandCachedBytes !== null &&
    snapshot.onDemandBytes > 0 &&
    snapshot.onDemandCachedBytes >= snapshot.onDemandBytes;
  const hasCachedOptionalAssets =
    snapshot.onDemandCachedBytes !== null && snapshot.onDemandCachedBytes > 0;
  const allButtonRemoves = allOptionalCached && hasCachedOptionalAssets;
  const allButtonIconOnly = allOptionalCached || isRemovingAll;
  const allOptionalCachedPercent =
    snapshot.onDemandBytes !== null &&
    snapshot.onDemandCachedBytes !== null &&
    snapshot.onDemandBytes > 0
      ? Math.min(100, Math.round((snapshot.onDemandCachedBytes / snapshot.onDemandBytes) * 100))
      : 0;
  const hasOnDemandAssets = snapshot.onDemandAssetGroups.length > 0;
  const headerMeta = [
    snapshot.isStandalone ? 'Installed' : 'Browser',
    `Checked ${formatCheckedTime(snapshot.lastCheckedAt)}`,
  ].join(' · ');
  const canCheckUpdates =
    !snapshot.checkingForUpdate &&
    !snapshot.updateInstalling &&
    !snapshot.applyingUpdate &&
    !snapshot.updateReady &&
    snapshot.isOnline &&
    snapshot.serviceWorkerEnabled;
  const detailBlocks = [
    {
      title: 'Connection',
      rows: [
        {
          label: 'Network',
          value: snapshot.isOnline ? 'Online' : 'Offline',
          valueClassName: snapshot.isOnline ? 'text-emerald-200' : 'text-red-200',
        },
        {
          label: 'Offline',
          value: snapshot.offlineReady ? 'Ready' : 'Preparing',
          valueClassName: snapshot.offlineReady ? 'text-emerald-200' : 'text-gray-300',
        },
      ],
    },
    {
      title: 'Storage',
      rows: [
        {
          label: 'Stored',
          value: formatBytes(snapshot.cachedBytes),
          valueClassName: 'text-gray-200',
        },
        {
          label: 'Shell',
          value: formatBytes(snapshot.offlineBytes),
          valueClassName: 'text-gray-200',
        },
      ],
    },
  ];

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      align="end"
      widthClass="w-96 max-w-[calc(100vw-2rem)]"
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
        <div className="space-y-2.5" data-text-selection-scope>
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-xs font-semibold text-gray-100">{status.title}</p>
                {snapshot.updateReady ? (
                  <button
                    type="button"
                    onClick={applyUpdate}
                    disabled={snapshot.applyingUpdate}
                    title={snapshot.applyingUpdate ? 'Restarting app' : 'Restart to update'}
                    aria-label={snapshot.applyingUpdate ? 'Restarting app' : 'Restart to update'}
                    className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-amber-300/35 bg-amber-300/10 px-1.5 text-[10px] font-medium text-amber-100 transition hover:border-amber-200/50 hover:bg-amber-300/15 disabled:cursor-wait disabled:opacity-70"
                  >
                    <Icons.Power className="h-3.5 w-3.5" />
                    {snapshot.applyingUpdate ? 'Restartinga' : 'Restart'}
                  </button>
                ) : null}
                {snapshot.canInstall ? (
                  <button
                    type="button"
                    onClick={runInstall}
                    disabled={snapshot.isInstalling}
                    title={snapshot.isInstalling ? 'Installing app' : 'Install app'}
                    aria-label={snapshot.isInstalling ? 'Installing app' : 'Install app'}
                    className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-1.5 text-[10px] font-medium text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-70"
                  >
                    <Icons.ArrowDownTray className="h-3.5 w-3.5" />
                    {snapshot.isInstalling ? 'Installing' : 'Install'}
                  </button>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-white/10 bg-black/20">
                <span className="px-1.5 py-1 font-mono text-[10px] text-gray-500">
                  v{snapshot.appVersion}
                </span>
                {!snapshot.updateReady ? (
                  <button
                    type="button"
                    onClick={runCheck}
                    disabled={!canCheckUpdates}
                    title={snapshot.checkingForUpdate ? 'Checking for updates' : 'Check updates'}
                    aria-label={
                      snapshot.checkingForUpdate ? 'Checking for updates' : 'Check updates'
                    }
                    className="flex h-6 w-6 items-center justify-center border-l border-white/10 text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icons.RotateLoop
                      className={`h-3.5 w-3.5 ${snapshot.checkingForUpdate ? 'animate-spin' : ''}`}
                    />
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">{headerMeta}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {detailBlocks.map((block) => (
              <div
                key={block.title}
                className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2"
              >
                <p className="text-[10px] font-medium text-gray-500">{block.title}</p>
                <div className="mt-1.5 space-y-1">
                  {block.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-2">
                      <p className="text-gray-500">{row.label}</p>
                      <p className={`truncate text-right ${row.valueClassName}`}>{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hasOnDemandAssets ? (
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.035] px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                    <Icons.Bundle className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-gray-200">On-demand assets</p>
                    <p className="truncate text-[10px] text-gray-500">
                      {formatBytes(snapshot.onDemandCachedBytes)} /{' '}
                      {formatBytes(snapshot.onDemandBytes)} cached
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={allButtonRemoves ? runRemoveAll : runDownloadAll}
                    disabled={
                      allButtonRemoves ? !canRemoveAssets : allOptionalCached || !canDownloadAssets
                    }
                    title={
                      allButtonRemoves
                        ? 'Remove cached on-demand assets'
                        : allOptionalCached
                          ? 'On-demand assets ready'
                          : 'Download on-demand assets'
                    }
                    aria-label={
                      allButtonRemoves
                        ? 'Remove cached on-demand assets'
                        : allOptionalCached
                          ? 'On-demand assets ready'
                          : 'Download on-demand assets'
                    }
                    className={`group relative flex h-7 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-white/10 bg-white/[0.04] text-[10px] font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                      allButtonIconOnly ? 'w-7 px-0' : 'px-2'
                    } ${
                      allButtonRemoves
                        ? 'hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-100 focus:border-red-300/30 focus:bg-red-500/10 focus:text-red-100'
                        : ''
                    }`}
                  >
                    {isDownloadingAll ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 bg-emerald-300/15 transition-[width]"
                        style={{ width: `${allOptionalCachedPercent}%` }}
                      />
                    ) : null}
                    {isRemovingAll ? (
                      <Icons.RotateLoop className="relative z-10 h-3.5 w-3.5 animate-spin" />
                    ) : isDownloadingAll ? (
                      <Icons.RotateLoop className="relative z-10 h-3.5 w-3.5 animate-spin" />
                    ) : allButtonRemoves ? (
                      <>
                        <Icons.Check className="relative z-10 h-3.5 w-3.5 group-hover:hidden group-focus:hidden" />
                        <Icons.Trash className="relative z-10 hidden h-3.5 w-3.5 group-hover:block group-focus:block" />
                      </>
                    ) : allOptionalCached ? (
                      <Icons.Check className="relative z-10 h-3.5 w-3.5" />
                    ) : (
                      <Icons.ArrowDownTray className="relative z-10 h-3.5 w-3.5" />
                    )}
                    {!allButtonIconOnly ? (
                      <span className="relative z-10">
                        {isDownloadingAll ? 'Downloading' : 'Download all'}
                      </span>
                    ) : null}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-white/10">
                {snapshot.onDemandAssetGroups.map((group) => {
                  const groupComplete = group.size > 0 && group.cachedBytes >= group.size;
                  const groupCached = group.cachedBytes > 0 || group.cachedAssetCount > 0;
                  const groupDownloading =
                    isDownloadingAssets &&
                    (snapshot.operatingAssetGroupId === group.id ||
                      snapshot.operatingAssetGroupId === 'all');
                  const groupRemoving =
                    isRemovingAssets &&
                    (snapshot.operatingAssetGroupId === group.id ||
                      snapshot.operatingAssetGroupId === 'all');
                  const cachedPercent =
                    group.size > 0
                      ? Math.min(100, Math.round((group.cachedBytes / group.size) * 100))
                      : 0;
                  const groupButtonRemoves = groupComplete && group.removable && groupCached;
                  const groupButtonIconOnly = groupComplete || groupRemoving;
                  return (
                    <div key={group.id} className="px-2.5 py-2 transition hover:bg-white/[0.025]">
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <p className="text-[11px] font-medium text-gray-200">{group.label}</p>
                              <p className="text-[10px] text-gray-500">
                                {formatBytes(group.cachedBytes)} / {formatBytes(group.size)}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                groupButtonRemoves
                                  ? runRemoveGroup(group.id)
                                  : runDownloadGroup(group.id)
                              }
                              disabled={
                                groupButtonRemoves
                                  ? !canRemoveAssets
                                  : !canDownloadAssets || groupComplete
                              }
                              title={
                                groupButtonRemoves
                                  ? `Remove ${group.label}`
                                  : groupComplete
                                    ? `${group.label} ready`
                                    : `Download ${group.label}`
                              }
                              aria-label={
                                groupButtonRemoves
                                  ? `Remove ${group.label}`
                                  : groupComplete
                                    ? `${group.label} ready`
                                    : `Download ${group.label}`
                              }
                              className={`group relative flex h-7 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-white/10 bg-white/[0.04] text-[10px] font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                                groupButtonIconOnly ? 'w-7 px-0' : 'min-w-[5.75rem] px-2'
                              } ${
                                groupButtonRemoves
                                  ? 'hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-100 focus:border-red-300/30 focus:bg-red-500/10 focus:text-red-100'
                                  : ''
                              }`}
                            >
                              {groupDownloading ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 bg-emerald-300/15 transition-[width]"
                                  style={{ width: `${cachedPercent}%` }}
                                />
                              ) : null}
                              {groupRemoving ? (
                                <Icons.RotateLoop className="relative z-10 h-3.5 w-3.5 animate-spin" />
                              ) : groupDownloading ? (
                                <Icons.RotateLoop className="relative z-10 h-3.5 w-3.5 animate-spin" />
                              ) : groupButtonRemoves ? (
                                <>
                                  <Icons.Check className="relative z-10 h-3.5 w-3.5 group-hover:hidden group-focus:hidden" />
                                  <Icons.Trash className="relative z-10 hidden h-3.5 w-3.5 group-hover:block group-focus:block" />
                                </>
                              ) : groupComplete ? (
                                <Icons.Check className="relative z-10 h-3.5 w-3.5" />
                              ) : (
                                <Icons.ArrowDownTray className="relative z-10 h-3.5 w-3.5" />
                              )}
                              {!groupButtonIconOnly ? (
                                <span className="relative z-10">
                                  {groupDownloading ? 'Downloading' : 'Download'}
                                </span>
                              ) : null}
                            </button>
                          </div>
                        </div>
                        <p className="text-[10px] leading-4 text-gray-500">{group.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {snapshot.assetOperationError ? (
            <div className="rounded-lg border border-amber-300/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
              {snapshot.assetOperationError}
            </div>
          ) : null}

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
