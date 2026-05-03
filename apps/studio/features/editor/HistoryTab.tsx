import React from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import * as Icons from '@blackboard/icons';
import { ScrollArea } from '@blackboard/ui';
import SubPanelHeader from './SubPanelHeader';

interface HistoryEntry {
  id: string;
  label: string;
  checkpointLabel?: string;
}

interface HistoryGroup {
  entries: HistoryEntry[];
  label: string;
  normalizedLabel: string;
  startIndex: number;
  currentIndexInGroup: number | null;
}

type HistoryActionIcon = React.FC<{ className?: string }>;

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

const PIN_BUTTON_CLASS =
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
  return typeof entry.checkpointLabel === 'string' && entry.checkpointLabel.trim().length > 0;
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
          PIN_BUTTON_CLASS,
          'relative z-10',
          isCheckpoint
            ? 'text-amber-200/80'
            : 'text-gray-500 opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
        title={isCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
        aria-label={isCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
      >
        <Icons.Pin className="h-3 w-3" />
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
                  PIN_BUTTON_CLASS,
                  'opacity-0 group-hover/item:opacity-100',
                  isEntryCheckpoint ? 'text-amber-300' : 'text-gray-500',
                )}
                title={isEntryCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
                aria-label={isEntryCheckpoint ? 'Remove checkpoint' : 'Add checkpoint'}
              >
                <Icons.Pin className="h-3 w-3" />
              </button>
            </div>
          );
        })}
    </div>
  );
}

const HistoryTab: React.FC = () => {
  const history = useEditorSelector((s) => s.history);
  const historyIndex = useEditorSelector((s) => s.historyIndex);
  const isDrawing = useEditorSelector((s) => s.isDrawing);
  const { undo, redo, jumpToHistoryState, toggleHistoryCheckpoint } = useEditorActions();

  const [expandedGroupIndex, setExpandedGroupIndex] = React.useState<number | null>(null);

  const groups = React.useMemo(
    () => groupHistoryEntries(history, historyIndex),
    [history, historyIndex],
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

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

        <div className="space-y-1 px-2 pb-2 pt-2">
          {isDrawing && (
            <div className="w-full truncate rounded-lg px-2 py-1 text-left text-[11px] leading-4 italic text-gray-500">
              Drawing Shape...
            </div>
          )}

          {groups
            .slice()
            .reverse()
            .map((group, reverseIndex) => {
              const groupIndex = groups.length - 1 - reverseIndex;
              const isGroupExpanded = expandedGroupIndex === groupIndex;

              return (
                <div key={`history-group-${group.startIndex}-${group.entries.length}`}>
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

                  {isGroupExpanded && (
                    <HistoryGroupItems
                      group={group}
                      historyIndex={historyIndex}
                      isDrawing={isDrawing}
                      onJumpToHistoryState={jumpToHistoryState}
                      onToggleCheckpoint={toggleHistoryCheckpoint}
                    />
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </ScrollArea>
  );
};

export default HistoryTab;
