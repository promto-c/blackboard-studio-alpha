import React from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import * as Icons from '@blackboard/icons';
import { ScrollArea } from '@blackboard/ui';
import { loadProjectState } from '@/state/persist';
import {
  getProjectBranchStorageId,
  MAIN_PROJECT_BRANCH_ID,
  type ProjectBranchRecord,
} from '@/state/projectBranches';
import type { PersistedProjectState } from '@blackboard/types';
import SubPanelHeader from './SubPanelHeader';
import { isNonEmptyString } from '@/utils/guards';

interface HistoryEntry {
  id: string;
  label: string;
  checkpointLabel?: string;
  createdAt?: number;
}

interface HistoryGroup {
  entries: HistoryEntry[];
  label: string;
  normalizedLabel: string;
  startIndex: number;
  currentIndexInGroup: number | null;
}

interface BranchHistoryPreview {
  branch: ProjectBranchRecord;
  entries: HistoryEntry[];
  forkIndex: number;
  forkLabel: string;
  hasSharedHistory: boolean;
  parentName: string | null;
}

type HistoryActionIcon = React.ComponentType<{ className?: string }>;

interface HistoryGroupHeaderProps {
  group: HistoryGroup;
  groupIndex: number;
  historyIndex: number;
  isDrawing: boolean;
  isExpanded: boolean;
  onJumpToHistoryState: (index: number) => void;
  onToggleCheckpoint: (index: number) => void;
  onToggleExpanded: (groupIndex: number) => void;
}

interface HistoryGroupItemsProps {
  group: HistoryGroup;
  historyIndex: number;
  isDrawing: boolean;
  onJumpToHistoryState: (index: number) => void;
  onToggleCheckpoint: (index: number) => void;
}

const HEADER_BUTTON_CLASS =
  'flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[11px] leading-4 disabled:cursor-not-allowed';

const GROUP_TOGGLE_BUTTON_CLASS =
  'mx-1 flex-shrink-0 self-center rounded-sm border border-white/10 bg-black/20 px-1 text-[10px] tabular-nums text-gray-400 transition hover:border-white/30 hover:bg-black/40 hover:text-gray-300 active:bg-black/50 active:text-gray-200 disabled:cursor-not-allowed';

const CHECKPOINT_BUTTON_CLASS =
  'flex w-7 flex-shrink-0 items-center justify-center border-l border-white/10 transition hover:bg-white/10 disabled:cursor-not-allowed';

const EXPANDED_ITEM_BUTTON_CLASS =
  'flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pl-2 pr-1.5 text-left text-[10px] leading-4 disabled:cursor-not-allowed';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function getCompactLabel(label: string) {
  return label.trim().replace(/\s+/g, ' ');
}

function getNormalizedLabel(label: string) {
  return getCompactLabel(label).toLowerCase();
}

function isCheckpointEntry(entry: HistoryEntry) {
  return isNonEmptyString(entry.checkpointLabel);
}

function isValidHistoryEntry(entry: unknown): entry is HistoryEntry {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const maybeEntry = entry as Partial<HistoryEntry>;
  return typeof maybeEntry.id === 'string' && typeof maybeEntry.label === 'string';
}

function getStoredHistoryEntries(projectState: PersistedProjectState | null): HistoryEntry[] {
  if (!projectState) {
    return [];
  }

  return (projectState.history ?? []).filter(isValidHistoryEntry).map((entry) => ({
    id: entry.id,
    label: entry.label,
    checkpointLabel: entry.checkpointLabel,
    createdAt: entry.createdAt,
  }));
}

function getMinimalBranchEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const latestEntry = entries[entries.length - 1];
  const checkpointEntries = entries
    .filter((entry) => entry.id !== latestEntry?.id && isCheckpointEntry(entry))
    .slice(-3);

  return latestEntry ? [...checkpointEntries, latestEntry] : checkpointEntries;
}

function getNearestSharedHistoryIndex(
  activeHistory: HistoryEntry[],
  branchHistory: HistoryEntry[],
) {
  const activeIndexById = new Map(activeHistory.map((entry, index) => [entry.id, index]));
  let nearestSharedIndex = -1;

  branchHistory.forEach((entry) => {
    const activeIndex = activeIndexById.get(entry.id);
    if (activeIndex !== undefined) {
      nearestSharedIndex = Math.max(nearestSharedIndex, activeIndex);
    }
  });

  return nearestSharedIndex;
}

function getGroupIndexForHistoryIndex(groups: HistoryGroup[], historyIndex: number) {
  if (groups.length === 0) {
    return -1;
  }

  if (historyIndex < 0) {
    return 0;
  }

  const groupIndex = groups.findIndex((group) => {
    const groupEndIndex = getGroupLastHistoryIndex(group);
    return historyIndex >= group.startIndex && historyIndex <= groupEndIndex;
  });

  return groupIndex >= 0 ? groupIndex : groups.length - 1;
}

function getHistoryActionIcon(label: string): HistoryActionIcon {
  const normalizedLabel = getNormalizedLabel(label);

  if (/\b(delete|remove|clear)\b/.test(normalizedLabel)) return Icons.Trash;
  if (/\b(copy|duplicate|clone)\b/.test(normalizedLabel)) return Icons.Copy;
  if (/\b(paste)\b/.test(normalizedLabel)) return Icons.Paste;
  if (/\b(add|create|new|import)\b/.test(normalizedLabel)) return Icons.DocumentPlus;
  if (/\b(move|nudge|drag|reorder)\b/.test(normalizedLabel)) return Icons.CursorArrow;
  if (/\b(auto.?arrange|arrange|layout)\b/.test(normalizedLabel)) {
    return Icons.ArrowsPointingOut;
  }
  if (/\b(transform|scale|rotate|resize|position)\b/.test(normalizedLabel)) {
    return Icons.Transform;
  }
  if (/\b(mask|paint|brush|stroke|path|roto|point|shape)\b/.test(normalizedLabel)) {
    return Icons.Brush;
  }
  if (/\b(run|generate|ai|comfy|refine|track)\b/.test(normalizedLabel)) {
    return Icons.Sparkles;
  }
  if (/\b(merge|blend|composite)\b/.test(normalizedLabel)) return Icons.Merge;
  if (/\b(view|viewer|zoom|pan)\b/.test(normalizedLabel)) return Icons.Eye;
  if (/\b(update|change|set|edit|adjust|grade|keyframe)\b/.test(normalizedLabel)) {
    return Icons.Cog;
  }

  return Icons.Bars4;
}

function getCurrentIndexInGroup(startIndex: number, length: number, historyIndex: number) {
  const endIndex = startIndex + length;

  if (historyIndex < startIndex || historyIndex >= endIndex) {
    return null;
  }

  return historyIndex - startIndex;
}

function createHistoryGroup(
  entries: HistoryEntry[],
  startIndex: number,
  historyIndex: number,
): HistoryGroup {
  const label = getCompactLabel(entries[0]?.label ?? '');
  const normalizedLabel = getNormalizedLabel(label);

  return {
    entries,
    label,
    normalizedLabel,
    startIndex,
    currentIndexInGroup: getCurrentIndexInGroup(startIndex, entries.length, historyIndex),
  };
}

function groupHistoryEntries(history: HistoryEntry[], historyIndex: number): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let currentEntries: HistoryEntry[] = [];
  let currentNormalizedLabel: string | null = null;
  let groupStartIndex = 0;

  const flushCurrentGroup = () => {
    if (currentEntries.length === 0) {
      return;
    }

    groups.push(createHistoryGroup(currentEntries, groupStartIndex, historyIndex));
    currentEntries = [];
    currentNormalizedLabel = null;
  };

  history.forEach((entry, index) => {
    const normalizedLabel = getNormalizedLabel(entry.label);

    if (isCheckpointEntry(entry)) {
      flushCurrentGroup();
      groups.push(createHistoryGroup([entry], index, historyIndex));
      return;
    }

    if (currentNormalizedLabel !== normalizedLabel) {
      flushCurrentGroup();
      currentEntries = [entry];
      currentNormalizedLabel = normalizedLabel;
      groupStartIndex = index;
      return;
    }

    currentEntries.push(entry);
  });

  flushCurrentGroup();

  return groups;
}

function getGroupLastHistoryIndex(group: HistoryGroup) {
  return group.startIndex + group.entries.length - 1;
}

function getGroupPositionLabel(group: HistoryGroup) {
  const currentPosition = (group.currentIndexInGroup ?? 0) + 1;
  const total = group.entries.length;
  const shouldShowPosition =
    group.currentIndexInGroup !== null && group.currentIndexInGroup !== total - 1;

  return shouldShowPosition ? `${currentPosition}/${total}` : `x${total}`;
}

function getHeaderBaseClass(group: HistoryGroup) {
  const isGroupCurrent = group.currentIndexInGroup !== null;
  const isLatestCurrent = group.currentIndexInGroup === group.entries.length - 1;
  const isCheckpoint = isCheckpointEntry(group.entries[0]);

  if (isGroupCurrent && isLatestCurrent) {
    return 'border-primary-500/50 bg-primary-900/50 text-white';
  }

  if (isGroupCurrent) {
    return 'border-primary-500/50 bg-primary-900/20 text-gray-100';
  }

  if (isCheckpoint) {
    return 'border-amber-400/15 text-amber-100 shadow-sm shadow-amber-400/10';
  }

  return 'border-transparent text-gray-300 hover:bg-gray-700/30';
}

function getActionIconClass(group: HistoryGroup) {
  const isGroupCurrent = group.currentIndexInGroup !== null;
  const isLatestCurrent = group.currentIndexInGroup === group.entries.length - 1;
  const isCheckpoint = isCheckpointEntry(group.entries[0]);

  if (isGroupCurrent && isLatestCurrent) {
    return 'text-gray-100';
  }

  if (isGroupCurrent) {
    return 'text-gray-300';
  }

  if (isCheckpoint) {
    return 'text-amber-200/80';
  }

  return 'text-gray-500';
}

function CheckpointHeaderOverlay({ group }: { group: HistoryGroup }) {
  const isGroupCurrent = group.currentIndexInGroup !== null;
  const isLatestCurrent = group.currentIndexInGroup === group.entries.length - 1;
  const isCheckpoint = isCheckpointEntry(group.entries[0]);

  return (
    <>
      <span
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-r from-primary-900/50 via-primary-900/50 to-amber-400/[0.12] transition-opacity duration-300',
          isCheckpoint && isGroupCurrent && isLatestCurrent ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/[0.03] to-amber-400/[0.10] transition-opacity duration-300 group-hover:from-primary-500/[0.10] group-hover:via-primary-500/[0.05] group-hover:to-amber-400/[0.15]',
          isCheckpoint && (!isGroupCurrent || !isLatestCurrent) ? 'opacity-100' : 'opacity-0',
        )}
      />
    </>
  );
}

function HistoryGraphRail({ group }: { group: HistoryGroup }) {
  const isGroupCurrent = group.currentIndexInGroup !== null;
  const isCheckpoint = isCheckpointEntry(group.entries[0]);

  return (
    <div className="relative flex w-6 flex-shrink-0 justify-center self-stretch">
      <span
        className={cn(
          'relative mt-2.5 flex h-2.5 w-2.5 items-center justify-center rounded-full border bg-gray-950 ring-2 ring-gray-900',
          isGroupCurrent
            ? 'border-primary-400'
            : isCheckpoint
              ? 'border-amber-300/50'
              : 'border-gray-500',
        )}
      >
        {isGroupCurrent ? <span className="h-1.5 w-1.5 rounded-full bg-primary-400" /> : null}
      </span>
    </div>
  );
}

function BranchPreviewEntry({ entry }: { entry: HistoryEntry }) {
  const isCheckpoint = isCheckpointEntry(entry);

  return (
    <div className="flex h-4 min-w-0 items-center gap-1.5">
      <span
        className={cn(
          'h-2.5 w-2.5 flex-shrink-0 rounded-full border bg-gray-950/80',
          isCheckpoint ? 'border-amber-300/35' : 'border-gray-500/70',
        )}
      />
      <span className="min-w-0 truncate text-gray-400">{entry.checkpointLabel || entry.label}</span>
    </div>
  );
}

function BranchPreviewEllipsis({
  id,
  hiddenEntries,
}: {
  id: string;
  hiddenEntries: HistoryEntry[];
}) {
  const hiddenCount = hiddenEntries.length;

  return (
    <div
      key={id}
      className="group/hidden relative flex h-8 min-w-0 items-center gap-1.5"
      aria-label={`${hiddenCount} hidden branch items`}
    >
      <span className="relative flex h-full w-2.5 flex-shrink-0 items-center justify-center">
        <span className="absolute left-1/2 top-1/2 flex h-7 w-3 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border border-white/10 bg-gray-900 shadow-sm">
          <span className="h-0.5 w-0.5 rounded-full bg-gray-500" />
          <span className="h-0.5 w-0.5 rounded-full bg-gray-500" />
          <span className="h-0.5 w-0.5 rounded-full bg-gray-500" />
        </span>
      </span>
      <span className="h-px w-2 flex-shrink-0 bg-white/20" />
      <span className="max-w-[8rem] truncate text-[10px] italic leading-4 text-gray-500/80">
        +{hiddenCount} more
      </span>
    </div>
  );
}

type BranchPreviewDisplayEntry =
  | { kind: 'entry'; entry: HistoryEntry }
  | { kind: 'ellipsis'; id: string; hiddenEntries: HistoryEntry[] };

function getPreviewDisplayEntries(entries: HistoryEntry[]): BranchPreviewDisplayEntry[] {
  const newestFirstEntries = entries.slice().reverse();
  const firstEntry = newestFirstEntries[0];
  const lastEntry = newestFirstEntries[newestFirstEntries.length - 1];

  if (!firstEntry) {
    return [];
  }

  if (!lastEntry || lastEntry.id === firstEntry.id) {
    return [{ kind: 'entry', entry: firstEntry }];
  }

  return [
    { kind: 'entry', entry: firstEntry },
    ...(newestFirstEntries.length > 2
      ? [
          {
            kind: 'ellipsis' as const,
            id: 'hidden',
            hiddenEntries: newestFirstEntries.slice(1, -1),
          },
        ]
      : []),
    { kind: 'entry', entry: lastEntry },
  ];
}

function BranchPreview({
  preview,
  isDrawing,
  onDeleteBranch,
  onSwitchBranch,
}: {
  preview: BranchHistoryPreview;
  isDrawing: boolean;
  onDeleteBranch: (branchId: string, branchName: string) => void;
  onSwitchBranch: (branchId: string) => void;
}) {
  const previewEntries = getPreviewDisplayEntries(preview.entries);
  const canDeleteBranch = preview.branch.id !== MAIN_PROJECT_BRANCH_ID;
  const handleSwitchBranch = () => {
    if (isDrawing) {
      return;
    }
    onSwitchBranch(preview.branch.id);
  };

  return (
    <div className="flex min-w-0 pb-3">
      <div className="relative flex w-6 flex-shrink-0 justify-center self-stretch">
        <svg
          className="absolute -bottom-8 left-3 h-14 w-6 overflow-visible"
          viewBox="0 0 24 56"
          aria-hidden="true"
        >
          <path
            d="M0 40 C0 30 23 34 23 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="text-gray-750"
          />
        </svg>
      </div>

      <div
        role="button"
        tabIndex={isDrawing ? -1 : 0}
        onClick={handleSwitchBranch}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          event.preventDefault();
          handleSwitchBranch();
        }}
        aria-disabled={isDrawing}
        className={cn(
          'group/branch relative min-w-0 flex-1 cursor-pointer rounded-md px-1.5 py-1 text-left text-[10px] leading-4 text-gray-400 transition hover:border-white/15 hover:bg-white/[0.05] hover:text-gray-300 focus:outline-none focus:ring-1 focus:ring-white/15',
          isDrawing && 'cursor-not-allowed opacity-50',
        )}
        title={`Switch to ${preview.branch.name}`}
        aria-label={`Switch to ${preview.branch.name}`}
      >
        <span className="pointer-events-none absolute bottom-3 left-[10px] top-3 w-[1.5px] bg-white/10" />
        <div className="relative space-y-px">
          {previewEntries.map((item) =>
            item.kind === 'entry' ? (
              <BranchPreviewEntry key={item.entry.id} entry={item.entry} />
            ) : (
              <BranchPreviewEllipsis
                key={item.id}
                id={item.id}
                hiddenEntries={item.hiddenEntries}
              />
            ),
          )}
        </div>
        <span className="pointer-events-none absolute bottom-1 right-1 max-w-[45%] truncate rounded-sm border border-white/10 bg-gray-950/90 px-1.5 py-px text-[9px] leading-3 text-gray-500 shadow-sm">
          {preview.branch.name}
        </span>
        {canDeleteBranch ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteBranch(preview.branch.id, preview.branch.name);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            disabled={isDrawing}
            className="absolute right-0.5 top-0 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition hover:bg-red-500/10 hover:text-red-200 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 group-hover/branch:opacity-100 disabled:cursor-not-allowed disabled:text-gray-700"
            title={`Delete branch ${preview.branch.name}`}
            aria-label={`Delete branch ${preview.branch.name}`}
          >
            <Icons.Trash className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HistoryGroupHeader({
  group,
  groupIndex,
  isDrawing,
  isExpanded,
  onJumpToHistoryState,
  onToggleCheckpoint,
  onToggleExpanded,
}: HistoryGroupHeaderProps) {
  const ActionIcon = getHistoryActionIcon(group.normalizedLabel);
  const isCheckpoint = isCheckpointEntry(group.entries[0]);
  const actionLabel = isExpanded ? 'Collapse' : 'Expand';
  const lastHistoryIndex = getGroupLastHistoryIndex(group);

  return (
    <div
      className={cn(
        'group relative flex min-h-7 w-full items-stretch overflow-hidden rounded-md border transition-colors duration-300',
        getHeaderBaseClass(group),
      )}
    >
      <CheckpointHeaderOverlay group={group} />

      <button
        onClick={() => onJumpToHistoryState(lastHistoryIndex)}
        onDoubleClick={() => group.entries.length > 1 && onToggleExpanded(groupIndex)}
        disabled={isDrawing}
        className={cn(HEADER_BUTTON_CLASS, 'relative z-10')}
      >
        <ActionIcon className={cn('h-3 w-3 flex-shrink-0', getActionIconClass(group))} />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
      </button>

      {group.entries.length > 1 && (
        <button
          onClick={() => onToggleExpanded(groupIndex)}
          disabled={isDrawing}
          className={cn(GROUP_TOGGLE_BUTTON_CLASS, 'relative z-10')}
          title={actionLabel}
          aria-label={actionLabel}
        >
          {getGroupPositionLabel(group)}
        </button>
      )}

      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggleCheckpoint(lastHistoryIndex);
        }}
        disabled={isDrawing}
        className={cn(
          CHECKPOINT_BUTTON_CLASS,
          'relative z-10',
          isCheckpoint
            ? 'text-amber-200/80'
            : 'text-gray-500 opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
        title={isCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
        aria-label={isCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
      >
        <Icons.Flag className="h-4 w-4" />
      </button>
    </div>
  );
}

function HistoryGroupItems({
  group,
  historyIndex,
  isDrawing,
  onJumpToHistoryState,
  onToggleCheckpoint,
}: HistoryGroupItemsProps) {
  if (group.entries.length <= 1) {
    return null;
  }

  return (
    <div className="ml-2 space-y-0.5 border-l border-white/5 py-1 pl-2">
      {group.entries
        .slice()
        .reverse()
        .map((entry, reverseIndex) => {
          const entryOffset = group.entries.length - 1 - reverseIndex;
          const entryIndex = group.startIndex + entryOffset;
          const isCurrentEntry = entryIndex === historyIndex;
          const isEntryCheckpoint = isCheckpointEntry(entry);

          return (
            <div
              key={entry.id}
              className={cn(
                'group/item flex min-h-6 w-full items-stretch rounded py-0.5 text-left text-[10px] leading-4 transition-colors',
                isCurrentEntry
                  ? 'border border-primary-500/50 bg-primary-900/50 text-white'
                  : 'border border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200',
                isDrawing && 'cursor-not-allowed',
              )}
              title={entry.label}
            >
              <button
                onClick={() => onJumpToHistoryState(entryIndex)}
                disabled={isDrawing}
                className={EXPANDED_ITEM_BUTTON_CLASS}
              >
                <span className="truncate">{entry.label}</span>
              </button>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCheckpoint(entryIndex);
                }}
                disabled={isDrawing}
                className={cn(
                  CHECKPOINT_BUTTON_CLASS,
                  'opacity-0 group-hover/item:opacity-100',
                  isEntryCheckpoint ? 'text-amber-300' : 'text-gray-500',
                )}
                title={isEntryCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
                aria-label={isEntryCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
              >
                <Icons.Flag className="h-4 w-4" />
              </button>
            </div>
          );
        })}
    </div>
  );
}

function HistoryTab() {
  const projectId = useEditorSelector((s) => s.projectId);
  const projectBranches = useEditorSelector((s) => s.projectBranches);
  const activeProjectBranchId = useEditorSelector((s) => s.activeProjectBranchId);
  const history = useEditorSelector((s) => s.history);
  const historyIndex = useEditorSelector((s) => s.historyIndex);
  const isDrawing = useEditorSelector((s) => s.isDrawing);
  const {
    undo,
    redo,
    deleteProjectBranch,
    jumpToHistoryState,
    toggleHistoryCheckpoint,
    switchProjectBranch,
  } = useEditorActions();

  const [expandedGroupIndex, setExpandedGroupIndex] = React.useState<number | null>(null);
  const [branchPreviews, setBranchPreviews] = React.useState<BranchHistoryPreview[]>([]);

  const groups = React.useMemo(
    () => groupHistoryEntries(history, historyIndex),
    [history, historyIndex],
  );

  const branchPreviewsByGroup = React.useMemo(() => {
    const previewsByGroup = new Map<number, BranchHistoryPreview[]>();

    branchPreviews.forEach((preview) => {
      const groupIndex = getGroupIndexForHistoryIndex(groups, preview.forkIndex);
      if (groupIndex < 0) {
        return;
      }

      const previews = previewsByGroup.get(groupIndex) ?? [];
      previews.push(preview);
      previewsByGroup.set(groupIndex, previews);
    });

    return previewsByGroup;
  }, [branchPreviews, groups]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  React.useEffect(() => {
    let isCancelled = false;

    const loadBranchPreviews = async () => {
      if (!projectId) {
        setBranchPreviews([]);
        return;
      }

      const inactiveBranches = projectBranches.filter(
        (branch) => branch.id !== activeProjectBranchId && branch.status !== 'archived',
      );

      if (inactiveBranches.length === 0) {
        setBranchPreviews([]);
        return;
      }

      const loadedPreviews = await Promise.all(
        inactiveBranches.map(async (branch) => {
          const projectState = await loadProjectState(
            getProjectBranchStorageId(projectId, branch.id),
          );
          const branchHistory = getStoredHistoryEntries(projectState);
          const entries = getMinimalBranchEntries(branchHistory);

          if (entries.length === 0) {
            return null;
          }

          const forkIndex = getNearestSharedHistoryIndex(history, branchHistory);
          const forkLabel =
            forkIndex >= 0 ? history[forkIndex]?.label || 'shared event' : 'shared event';
          const parentName =
            projectBranches.find((candidate) => candidate.id === branch.parentBranchId)?.name ??
            null;

          return {
            branch,
            entries,
            forkIndex,
            forkLabel,
            hasSharedHistory: forkIndex >= 0,
            parentName,
          } satisfies BranchHistoryPreview;
        }),
      );

      if (!isCancelled) {
        setBranchPreviews(
          loadedPreviews.filter((preview): preview is BranchHistoryPreview => preview !== null),
        );
      }
    };

    void loadBranchPreviews();

    return () => {
      isCancelled = true;
    };
  }, [activeProjectBranchId, history, projectBranches, projectId]);

  React.useEffect(() => {
    if (expandedGroupIndex !== null && expandedGroupIndex >= groups.length) {
      setExpandedGroupIndex(null);
    }
  }, [expandedGroupIndex, groups.length]);

  const handleToggleExpanded = React.useCallback((groupIndex: number) => {
    setExpandedGroupIndex((currentGroupIndex) =>
      currentGroupIndex === groupIndex ? null : groupIndex,
    );
  }, []);

  const handleSwitchBranch = React.useCallback(
    (branchId: string) => {
      void switchProjectBranch(branchId);
    },
    [switchProjectBranch],
  );

  const handleDeleteBranch = React.useCallback(
    (branchId: string, branchName: string) => {
      if (branchId === MAIN_PROJECT_BRANCH_ID) {
        return;
      }

      const confirmed = window.confirm(`Delete branch "${branchName}"? This cannot be undone.`);
      if (!confirmed) {
        return;
      }

      void deleteProjectBranch(branchId).catch((error) => {
        console.error('Could not delete project branch:', error);
        window.alert('Could not delete branch.');
      });
    },
    [deleteProjectBranch],
  );

  return (
    <ScrollArea fill axis="y" contentClassName="flex flex-col">
      <div data-text-selection-scope className="flex flex-col">
        <SubPanelHeader
          title="History"
          meta={
            <div className="truncate text-[10px] tabular-nums text-gray-500">
              {historyIndex + 1}/{history.length}
            </div>
          }
          actions={
            <div className="flex items-center gap-1">
              <div className="flex overflow-hidden rounded-md border border-white/10 bg-white/5 backdrop-blur-sm">
                <button
                  onClick={undo}
                  disabled={!canUndo || isDrawing}
                  className="flex h-6 w-6 items-center justify-center text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Undo"
                  aria-label="Undo last action"
                >
                  <Icons.ArrowUturnLeft className="h-3 w-3" />
                </button>

                <div className="w-px bg-white/10" />

                <button
                  onClick={redo}
                  disabled={!canRedo || isDrawing}
                  className="flex h-6 w-6 items-center justify-center text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Redo"
                  aria-label="Redo last action"
                >
                  <Icons.ArrowUturnRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          }
        />

        <div className="pr-2 py-2">
          {isDrawing && (
            <div className="mb-1 w-full truncate rounded-lg px-2 py-1 text-left text-[11px] leading-4 italic text-gray-500">
              Drawing Shape...
            </div>
          )}

          <div className="relative space-y-1">
            {groups.length > 0 ? (
              <span className="pointer-events-none absolute bottom-0 left-[11px] top-[20px] w-[1.5px] bg-white/10" />
            ) : null}

            {groups
              .slice()
              .reverse()
              .map((group, reverseIndex) => {
                const groupIndex = groups.length - 1 - reverseIndex;
                const isGroupExpanded = expandedGroupIndex === groupIndex;
                const groupBranchPreviews = branchPreviewsByGroup.get(groupIndex) ?? [];

                return (
                  <div
                    key={`history-group-${group.startIndex}-${group.entries.length}`}
                    className="min-w-0"
                  >
                    {groupBranchPreviews.length > 0 ? (
                      <div className="min-w-0">
                        {groupBranchPreviews.map((preview) => (
                          <BranchPreview
                            key={preview.branch.id}
                            preview={preview}
                            isDrawing={isDrawing}
                            onDeleteBranch={handleDeleteBranch}
                            onSwitchBranch={handleSwitchBranch}
                          />
                        ))}
                      </div>
                    ) : null}

                    <div className="flex min-w-0">
                      <HistoryGraphRail group={group} />

                      <div className="min-w-0 flex-1">
                        <HistoryGroupHeader
                          group={group}
                          groupIndex={groupIndex}
                          historyIndex={historyIndex}
                          isDrawing={isDrawing}
                          isExpanded={isGroupExpanded}
                          onJumpToHistoryState={jumpToHistoryState}
                          onToggleCheckpoint={toggleHistoryCheckpoint}
                          onToggleExpanded={handleToggleExpanded}
                        />

                        <div
                          className={cn(
                            'grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out',
                            isGroupExpanded
                              ? 'grid-rows-[1fr] opacity-100'
                              : 'grid-rows-[0fr] opacity-0',
                          )}
                        >
                          <div className="overflow-hidden">
                            <HistoryGroupItems
                              group={group}
                              historyIndex={historyIndex}
                              isDrawing={isDrawing}
                              onJumpToHistoryState={jumpToHistoryState}
                              onToggleCheckpoint={toggleHistoryCheckpoint}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

export default HistoryTab;
