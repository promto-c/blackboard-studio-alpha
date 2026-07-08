import React from 'react';
import type { HistoryEntry, PersistedProjectState, ProjectIndexEntry } from '@blackboard/types';
import { Badge, ScrollArea } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { ExecuteButton } from '@/components';
import {
  getActiveProjectBranchId,
  getProjectBranches,
  getProjectBranchStorageId,
  loadProjectState,
  type ProjectBranchRecord,
} from '@/state/persist';
import type { ProjectOpenTarget } from '@/state/editor/services/projectManagement';

type BranchVersion = {
  branch: ProjectBranchRecord;
  state: PersistedProjectState | null;
};

type BranchTreeItem = BranchVersion & {
  childCount: number;
  depth: number;
  parentName: string | null;
};

interface ProjectVersionDialogProps {
  project: ProjectIndexEntry;
  onClose: () => void;
  onOpen: (projectId: string, target: ProjectOpenTarget) => Promise<void>;
}

const isValidHistoryEntry = (entry: unknown): entry is HistoryEntry => {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<HistoryEntry>;
  return (
    typeof candidate.id === 'string' && typeof candidate.label === 'string' && !!candidate.state
  );
};

const formatVersionTime = (timestamp?: number) =>
  typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : 'Time unavailable';

const getBranchKindLabel = (kind: ProjectBranchRecord['kind']) => {
  if (kind === 'autosave') return 'Autosave';
  if (kind === 'agent') return 'Agent';
  if (kind === 'review') return 'Review';
  if (kind === 'main') return 'Main';
  return 'User';
};

const getBranchHistoryCount = (version: BranchVersion) =>
  (version.state?.history ?? []).filter(isValidHistoryEntry).length + (version.state ? 1 : 0);

export const getOrderedBranchVersions = (versions: BranchVersion[]): BranchTreeItem[] => {
  const versionById = new Map(versions.map((version) => [version.branch.id, version]));
  const childrenByParentId = new Map<string, BranchVersion[]>();

  versions.forEach((version) => {
    if (version.branch.id === 'main') return;
    const parentId = version.branch.parentBranchId;
    if (!parentId || parentId === version.branch.id || !versionById.has(parentId)) return;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(version);
    childrenByParentId.set(parentId, children);
  });

  const sortVersions = (items: BranchVersion[]) =>
    [...items].sort((first, second) => {
      if (first.branch.id === 'main') return -1;
      if (second.branch.id === 'main') return 1;
      return second.branch.updatedAt - first.branch.updatedAt;
    });

  const roots = sortVersions(
    versions.filter((version) => {
      if (version.branch.id === 'main') return true;
      const parentId = version.branch.parentBranchId;
      return !parentId || parentId === version.branch.id || !versionById.has(parentId);
    }),
  );
  const result: BranchTreeItem[] = [];
  const visited = new Set<string>();

  const visit = (version: BranchVersion, depth: number) => {
    if (visited.has(version.branch.id)) return;
    visited.add(version.branch.id);
    const children = sortVersions(childrenByParentId.get(version.branch.id) ?? []);
    const parent =
      version.branch.id !== 'main' && version.branch.parentBranchId
        ? versionById.get(version.branch.parentBranchId)
        : null;
    result.push({
      ...version,
      childCount: children.length,
      depth,
      parentName: parent?.branch.name ?? null,
    });
    children.forEach((child) => visit(child, depth + 1));
  };

  roots.forEach((root) => visit(root, 0));
  sortVersions(versions.filter((version) => !visited.has(version.branch.id))).forEach((version) =>
    visit(version, 0),
  );

  return result;
};

export const getBranchAncestry = (
  branchId: string,
  versions: BranchVersion[],
): ProjectBranchRecord[] => {
  const branchById = new Map(versions.map(({ branch }) => [branch.id, branch]));
  const ancestry: ProjectBranchRecord[] = [];
  const visited = new Set<string>();
  let current = branchById.get(branchId);

  while (current && !visited.has(current.id)) {
    ancestry.unshift(current);
    visited.add(current.id);
    current =
      current.id !== 'main' && current.parentBranchId
        ? branchById.get(current.parentBranchId)
        : undefined;
  }

  return ancestry;
};

function ProjectVersionDialog({ project, onClose, onOpen }: ProjectVersionDialogProps) {
  const titleId = React.useId();
  const [versions, setVersions] = React.useState<BranchVersion[]>([]);
  const [activeBranchId, setActiveBranchId] = React.useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = React.useState<string | null>(null);
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isOpening, setIsOpening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isOpening) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpening, onClose]);

  React.useEffect(() => {
    let cancelled = false;

    const loadVersions = async () => {
      setIsLoading(true);
      setError(null);
      const branches = getProjectBranches(project.id);
      const nextActiveBranchId = getActiveProjectBranchId(project.id);
      const loaded = await Promise.all(
        branches.map(async (branch) => {
          try {
            const state = await loadProjectState(getProjectBranchStorageId(project.id, branch.id));
            return { branch, state };
          } catch (branchError) {
            console.warn(`Could not load project branch "${branch.name}".`, branchError);
            return { branch, state: null };
          }
        }),
      );

      if (cancelled) return;
      setVersions(loaded);
      setActiveBranchId(nextActiveBranchId);
      const selected =
        loaded.find((version) => version.branch.id === nextActiveBranchId && version.state) ??
        loaded.find((version) => version.state) ??
        null;
      setSelectedBranchId(selected?.branch.id ?? null);
      setSelectedHistoryEntryId(null);
      setIsLoading(false);
    };

    void loadVersions().catch((loadError) => {
      if (cancelled) return;
      console.error('Could not load project versions:', loadError);
      setError('Could not read this project’s saved versions.');
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const orderedVersions = React.useMemo(() => getOrderedBranchVersions(versions), [versions]);
  const selectedVersion =
    versions.find((version) => version.branch.id === selectedBranchId) ?? null;
  const selectedAncestry = selectedBranchId ? getBranchAncestry(selectedBranchId, versions) : [];
  const historyEntries = (selectedVersion?.state?.history ?? [])
    .filter(isValidHistoryEntry)
    .map((entry, index) => ({ entry, index }))
    .reverse();
  const selectedHistoryEntry = historyEntries.find(
    ({ entry }) => entry.id === selectedHistoryEntryId,
  )?.entry;
  const selectedBranchHistoryCount = selectedVersion ? getBranchHistoryCount(selectedVersion) : 0;

  const handleOpen = async () => {
    if (!selectedVersion?.state || isOpening) return;
    setIsOpening(true);
    setError(null);
    try {
      await onOpen(project.id, {
        branchId: selectedVersion.branch.id,
        historyEntryId: selectedHistoryEntryId ?? undefined,
        createRecoveryBranch: !!selectedHistoryEntryId,
      });
    } catch (openError) {
      console.error('Could not open project version:', openError);
      setError(
        openError instanceof Error && openError.message
          ? openError.message
          : 'Could not open the selected project version.',
      );
      setIsOpening(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-md animate-[fadeIn_150ms_ease-out] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={() => {
        if (!isOpening) onClose();
      }}
    >
      <div
        className="flex max-h-[min(860px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-gray-900/95 shadow-[0_32px_100px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/[0.06]"
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className="relative flex shrink-0 items-start justify-between gap-5 overflow-hidden border-b border-white/[0.08] px-5 py-5 sm:px-6"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary-400/[0.055] to-transparent" />
          <div className="relative min-w-0">
            <div className="flex items-center gap-2">
              <Icons.Branch className="h-4 w-4 text-primary-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-300">
                Version control
              </p>
            </div>
            <h2
              id={titleId}
              className="mt-2 truncate text-xl font-semibold tracking-tight text-white sm:text-2xl"
            >
              Open {project.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isOpening}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:border-white/15 hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-primary-300/40 disabled:opacity-40"
            aria-label="Close version picker"
          >
            <Icons.XMark className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col border-b border-white/[0.08] bg-gray-950/20 md:border-b-0 md:border-r">
            <div className="border-b border-white/[0.07] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-100">Branch map</h3>
                  <p className="mt-1 text-xs text-gray-500">Select a line of work</p>
                </div>
                <Badge
                  variant="neutral"
                  size="lg"
                  className="border-white/[0.08] bg-gray-950/40 text-gray-500"
                >
                  {versions.length} {versions.length === 1 ? 'branch' : 'branches'}
                </Badge>
              </div>
            </div>

            <ScrollArea fill axis="y" className="min-h-[180px] px-2.5 py-3">
              {isLoading ? (
                <div className="space-y-2 px-1" aria-label="Loading branches">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-16 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.025]"
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {orderedVersions.map(({ branch, state, depth, parentName, childCount }) => {
                    const isSelected = branch.id === selectedBranchId;
                    const isCurrent = branch.id === activeBranchId;
                    const nodeOffset = 12 + Math.min(depth, 4) * 14;
                    const version = versions.find((candidate) => candidate.branch.id === branch.id);
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        disabled={!state}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedBranchId(branch.id);
                          setSelectedHistoryEntryId(null);
                          setError(null);
                        }}
                        className={`group relative flex w-full items-center gap-2 overflow-hidden rounded-xl border py-2.5 pr-3 text-left transition focus-visible:ring-2 focus-visible:ring-primary-300/40 ${
                          isSelected
                            ? 'border-primary-300/45 bg-primary-400/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                            : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.035]'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        style={{ paddingLeft: nodeOffset }}
                      >
                        {depth > 0 ? (
                          <>
                            <span
                              className="absolute top-0 h-1/2 w-px bg-white/10"
                              style={{ left: nodeOffset - 6 }}
                            />
                            <span
                              className="absolute top-1/2 h-px w-2 bg-white/10"
                              style={{ left: nodeOffset - 6 }}
                            />
                          </>
                        ) : null}
                        <span
                          className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                            isSelected
                              ? 'border-primary-300/30 bg-primary-300/10 text-primary-200'
                              : 'border-white/[0.07] bg-gray-950/45 text-gray-500 group-hover:text-gray-300'
                          }`}
                        >
                          <Icons.Branch className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={`truncate text-xs font-semibold ${
                                isSelected ? 'text-primary-100' : 'text-gray-200'
                              }`}
                            >
                              {branch.name}
                            </span>
                            {isCurrent ? (
                              <Badge
                                size="sm"
                                uppercase
                                shrink
                                noBorder
                                className="font-semibold tracking-wider !bg-primary-300/10 !text-primary-300"
                              >
                                Current
                              </Badge>
                            ) : null}
                          </span>
                          <span className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-gray-600">
                            <span className="truncate">
                              {parentName
                                ? `From ${parentName}`
                                : branch.parentBranchId
                                  ? 'Source unavailable'
                                  : 'Root branch'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">
                              {version ? getBranchHistoryCount(version) : 0} states
                            </span>
                            {childCount > 0 ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="shrink-0">
                                  {childCount} {childCount === 1 ? 'child' : 'children'}
                                </span>
                              </>
                            ) : null}
                          </span>
                          {!state ? (
                            <span className="mt-1 block text-[10px] text-rose-300">
                              Snapshot unavailable
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
              {selectedVersion ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-gray-500"
                        aria-label="Branch ancestry"
                      >
                        {selectedAncestry.map((branch, index) => (
                          <React.Fragment key={branch.id}>
                            {index > 0 ? (
                              <Icons.ChevronRight className="h-3 w-3 shrink-0 text-gray-700" />
                            ) : null}
                            <span
                              className={
                                index === selectedAncestry.length - 1
                                  ? 'font-medium text-primary-300'
                                  : ''
                              }
                            >
                              {branch.name}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                      <h3 className="mt-1 truncate text-base font-semibold text-white">
                        {selectedVersion.branch.name}
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">
                        Updated {formatVersionTime(selectedVersion.branch.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <Badge
                        variant="neutral"
                        className="border-white/[0.08] bg-white/[0.035] text-gray-400"
                      >
                        {getBranchKindLabel(selectedVersion.branch.kind)}
                      </Badge>
                      <Badge
                        className={`capitalize ${
                          selectedVersion.branch.status === 'active'
                            ? '!border-emerald-300/15 !bg-emerald-400/[0.07] !text-emerald-300'
                            : '!border-white/[0.08] !bg-white/[0.035] !text-gray-500'
                        }`}
                      >
                        {selectedVersion.branch.status}
                      </Badge>
                      <Badge
                        variant="neutral"
                        className="border-white/[0.08] bg-gray-950/30 text-gray-500"
                      >
                        {selectedBranchHistoryCount}{' '}
                        {selectedBranchHistoryCount === 1 ? 'state' : 'states'}
                      </Badge>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-16 animate-pulse rounded-xl bg-white/[0.025]" />
              )}
            </div>

            <ScrollArea fill axis="y" className="min-h-[280px] px-3 py-3 sm:px-4">
              {isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="h-16 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.025]"
                    />
                  ))}
                </div>
              ) : selectedVersion?.state ? (
                <div>
                  <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                    Version timeline
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedHistoryEntryId(null)}
                    aria-pressed={selectedHistoryEntryId === null}
                    className={`group flex w-full items-stretch rounded-xl border text-left transition focus-visible:ring-2 focus-visible:ring-primary-300/40 ${
                      selectedHistoryEntryId === null
                        ? 'border-primary-300/45 bg-primary-400/[0.085] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                        : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.035]'
                    }`}
                  >
                    <span className="relative flex w-12 shrink-0 items-center justify-center">
                      <span className="absolute bottom-0 left-1/2 top-1/2 w-px bg-primary-300/20" />
                      <span className="relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border border-primary-300/35 bg-primary-300/15 text-primary-200 shadow-[0_0_16px_rgba(45,212,191,0.12)]">
                        <Icons.Check className="h-3 w-3" />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 py-3 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-gray-100">
                          Current branch tip
                        </span>
                        <Badge
                          size="sm"
                          uppercase
                          shrink
                          noBorder
                          className="font-semibold tracking-wider !bg-primary-300/10 !text-primary-300"
                        >
                          Latest
                        </Badge>
                      </span>
                      <span className="mt-1 block text-[10px] text-gray-500">
                        Saved{' '}
                        {formatVersionTime(
                          selectedVersion.branch.updatedAt > 0
                            ? selectedVersion.branch.updatedAt
                            : project.lastModified,
                        )}
                      </span>
                    </span>
                  </button>

                  {historyEntries.map(({ entry, index }, timelineIndex) => {
                    const isSelected = entry.id === selectedHistoryEntryId;
                    const isSavedHead = index === selectedVersion.state?.historyIndex;
                    const isLast = timelineIndex === historyEntries.length - 1;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedHistoryEntryId(entry.id)}
                        aria-pressed={isSelected}
                        className={`group flex w-full items-stretch rounded-xl border text-left transition focus-visible:ring-2 focus-visible:ring-amber-300/35 ${
                          isSelected
                            ? 'border-amber-300/35 bg-amber-400/[0.075]'
                            : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.035]'
                        }`}
                      >
                        <span className="relative flex w-12 shrink-0 items-center justify-center">
                          <span
                            className={`absolute left-1/2 top-0 w-px ${
                              isLast ? 'h-1/2' : 'h-full'
                            } ${isSelected ? 'bg-amber-300/25' : 'bg-white/[0.09]'}`}
                          />
                          <span
                            className={`relative z-[1] flex h-5 w-5 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-amber-300/45 bg-amber-300/15 text-amber-200'
                                : entry.checkpointLabel
                                  ? 'border-amber-300/20 bg-gray-900 text-amber-300/80'
                                  : 'border-white/10 bg-gray-900 text-gray-600 group-hover:text-gray-400'
                            }`}
                          >
                            {entry.checkpointLabel ? (
                              <Icons.Flag className="h-2.5 w-2.5" />
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            )}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1 py-2.5 pr-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`truncate text-xs font-medium ${
                                isSelected ? 'text-amber-100' : 'text-gray-200'
                              }`}
                            >
                              {entry.checkpointLabel || entry.label}
                            </span>
                            {entry.checkpointLabel ? (
                              <Badge
                                size="sm"
                                uppercase
                                shrink
                                noBorder
                                className="font-semibold tracking-wider !bg-amber-300/10 !text-amber-300/80"
                              >
                                Checkpoint
                              </Badge>
                            ) : null}
                            {isSavedHead ? (
                              <Badge
                                size="sm"
                                uppercase
                                shrink
                                noBorder
                                className="font-semibold tracking-wider !bg-white/[0.06] !text-gray-500"
                              >
                                Opened
                              </Badge>
                            ) : null}
                          </span>
                          {entry.checkpointLabel ? (
                            <span className="mt-0.5 block truncate text-[10px] text-gray-600">
                              {entry.label}
                            </span>
                          ) : null}
                          <span className="mt-1 block text-[10px] text-gray-600">
                            {formatVersionTime(entry.createdAt)}
                          </span>
                        </span>
                      </button>
                    );
                  })}

                  {historyEntries.length === 0 ? (
                    <div className="mx-2 mt-3 rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
                      <Icons.Bars4 className="mx-auto h-5 w-5 text-gray-700" />
                      <p className="mt-2 text-xs text-gray-500">
                        This branch has no earlier saved history.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mx-2 rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center">
                  <Icons.ExclamationCircle className="mx-auto h-6 w-6 text-gray-700" />
                  <p className="mt-2 text-sm text-gray-500">Select an available branch.</p>
                </div>
              )}
            </ScrollArea>
          </section>
        </div>

        <footer className="shrink-0 border-t border-white/[0.08] bg-gray-950/30 px-4 py-3.5 sm:px-5">
          {error ? (
            <p className="mb-3 rounded-lg border border-rose-300/20 bg-rose-400/[0.08] px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                  selectedHistoryEntry
                    ? 'border-amber-300/20 bg-amber-300/10 text-amber-300'
                    : 'border-primary-300/20 bg-primary-300/10 text-primary-300'
                }`}
              >
                {selectedHistoryEntry ? (
                  <Icons.ArrowUturnLeft className="h-3.5 w-3.5" />
                ) : (
                  <Icons.Branch className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-gray-200">
                  {selectedHistoryEntry
                    ? `Recover “${selectedHistoryEntry.checkpointLabel || selectedHistoryEntry.label}”`
                    : selectedVersion
                      ? `Open ${selectedVersion.branch.name}`
                      : 'Choose a branch'}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-gray-500">
                  {selectedHistoryEntry
                    ? `Creates a new recovery branch from ${selectedVersion?.branch.name}; newer edits stay safe.`
                    : 'Opens the selected branch at its latest saved state.'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isOpening}
                className="rounded-lg px-3.5 py-2 text-xs font-medium text-gray-400 transition hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-primary-300/30 disabled:opacity-40"
              >
                Cancel
              </button>
              <ExecuteButton
                onClick={handleOpen}
                disabled={!selectedVersion?.state || isLoading || isOpening}
                variant="prominent"
                icon={false}
                trailingIcon={
                  !isOpening ? <Icons.ChevronRight className="h-3.5 w-3.5 shrink-0" /> : undefined
                }
                className="min-w-44"
                actionClassName="justify-between"
              >
                <span className="min-w-0 text-left">
                  <span className="block text-xs font-semibold">
                    {isOpening
                      ? 'Opening…'
                      : selectedHistoryEntry
                        ? 'Open recovery'
                        : 'Open branch'}
                  </span>
                  <span className="mt-0.5 block text-[9px] font-normal text-primary-200/65 group-disabled/action:text-gray-700">
                    {selectedHistoryEntry ? 'Create a safe branch' : 'Use latest saved state'}
                  </span>
                </span>
              </ExecuteButton>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default ProjectVersionDialog;
