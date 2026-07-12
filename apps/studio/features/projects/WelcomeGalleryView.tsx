import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, ScrollArea } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import {
  loadGalleryEntries,
  getTagValue,
  softDeleteGalleryEntries,
  restoreGalleryEntries,
  permanentDeleteGalleryEntries,
} from '@blackboard/project-store';
import { useEditorActions } from '@/state/editorContext';
import { GalleryCard } from '@/features/editor/galleryShared';
import type { GalleryEntry, GallerySelection } from '@/features/editor/galleryShared';
import { getGallerySelectionAfterClick } from '@/features/editor/gallerySelection';
import { AssetViewer, type AssetViewerMedia } from '@/components';
import { beginAssetPreviewProfile, markAssetPreviewMilestone } from '@/services/assetPreview';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';

type GalleryScope = 'app' | 'recycle';

const GALLERY_SCOPE_OPTIONS: SlidingSegmentedControlOption<GalleryScope>[] = [
  { value: 'app', label: 'Items', Icon: Icons.Photo, title: 'Gallery items' },
  { value: 'recycle', label: 'Bin', Icon: Icons.Trash, title: 'Recycle Bin' },
];

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  );
};

interface WelcomeGalleryViewProps {
  onBack: () => void;
}

const loadEntries = async (): Promise<GalleryEntry[]> => {
  const all = await loadGalleryEntries();
  return all;
};

function WelcomeGalleryView({ onBack }: WelcomeGalleryViewProps) {
  const { loadProject, switchProjectBranch, syncComfyGeneratedOutputsWithGalleryEntries } =
    useEditorActions();
  const [allEntries, setAllEntries] = useState<GalleryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [scope, setScope] = useState<GalleryScope>('app');
  const [selection, setSelection] = useState<GallerySelection>(
    () => new Map<string, GalleryEntry>(),
  );
  const selectionAnchorIdRef = useRef<string | null>(null);

  useEffect(() => {
    const load = async () => {
      beginAssetPreviewProfile();
      setIsLoading(true);
      setSelection(new Map<string, GalleryEntry>());
      const all = await loadEntries();
      setAllEntries(all);
      const firstVisible =
        scope === 'app'
          ? all.find((e) => !e.deletedAt && !!e.assetId)
          : all.find((e) => e.deletedAt);
      setActiveEntryId(firstVisible?.id ?? null);
      setIsLoading(false);
    };
    void load();
  }, [scope]);

  useEffect(() => {
    if (!isLoading) markAssetPreviewMilestone('metadataInteractiveMs');
  }, [isLoading]);

  const visibleEntries = useMemo(() => {
    if (scope === 'recycle') return allEntries.filter((e) => !!e.deletedAt);
    return allEntries.filter((e) => !e.deletedAt && !!e.assetId);
  }, [allEntries, scope]);

  const selectableEntries = useMemo(
    () => visibleEntries.filter((entry) => !!entry.assetId),
    [visibleEntries],
  );

  const activeEntry = useMemo(
    () => visibleEntries.find((e) => e.id === activeEntryId) ?? visibleEntries[0] ?? null,
    [activeEntryId, visibleEntries],
  );

  const activeMedia = useMemo<AssetViewerMedia | null>(() => {
    if (!activeEntry) return null;
    return {
      id: activeEntry.id,
      assetId: activeEntry.assetId,
      mediaKind: activeEntry.mediaKind,
      frames: activeEntry.frames,
      width: activeEntry.width,
      height: activeEntry.height,
      duration: activeEntry.duration,
      fps: activeEntry.fps,
      label: activeEntry.label || activeEntry.nodeName,
      detail: activeEntry.detail || activeEntry.prompt,
      source: activeEntry.source,
      createdAt: activeEntry.createdAt,
      mediaColorManagement: activeEntry.mediaColorManagement,
      scene3dAsset: activeEntry.scene3dAsset,
    };
  }, [activeEntry]);

  const openEntryProject = useCallback(
    async (entry: GalleryEntry | null) => {
      if (!entry) return;
      const projectId = getTagValue(entry.tags, 'project:');
      const branchId = getTagValue(entry.tags, 'branch:');
      if (!projectId) return;
      await loadProject(projectId);
      if (branchId) {
        await switchProjectBranch(branchId);
      }
    },
    [loadProject, switchProjectBranch],
  );

  const clearSelection = useCallback(() => {
    selectionAnchorIdRef.current = null;
    setSelection(new Map<string, GalleryEntry>());
  }, []);

  const selectVisibleEntries = useCallback(() => {
    setSelection(new Map<string, GalleryEntry>(selectableEntries.map((e) => [e.id, e])));
    selectionAnchorIdRef.current = selectableEntries[0]?.id ?? null;
  }, [selectableEntries]);

  const selectedCount = selection.size;

  const handleSoftDelete = async () => {
    const selectedEntries = Array.from(selection.values()) as GalleryEntry[];
    if (selectedEntries.length === 0) return;
    const ids = selectedEntries.map((entry) => entry.id);
    const deletedAt = Date.now();
    await softDeleteGalleryEntries(ids);
    await syncComfyGeneratedOutputsWithGalleryEntries({
      entries: selectedEntries,
      mode: 'soft-delete',
      deletedAt,
    });
    const updated = await loadEntries();
    setAllEntries(updated);
    clearSelection();
    if (activeEntry && ids.includes(activeEntry.id)) {
      setActiveEntryId(updated.find((e) => !e.deletedAt && !!e.assetId)?.id ?? null);
    }
  };

  const handleRestore = async () => {
    const selectedEntries = Array.from(selection.values()) as GalleryEntry[];
    if (selectedEntries.length === 0) return;
    const ids = selectedEntries.map((entry) => entry.id);
    await restoreGalleryEntries(ids);
    await syncComfyGeneratedOutputsWithGalleryEntries({
      entries: selectedEntries,
      mode: 'restore',
    });
    const updated = await loadEntries();
    setAllEntries(updated);
    clearSelection();
    if (activeEntry && ids.includes(activeEntry.id)) {
      const restored = updated.find((e) => e.id === activeEntry.id);
      if (!restored || restored.deletedAt) {
        setActiveEntryId(updated.find((e) => e.deletedAt)?.id ?? null);
      }
    }
  };

  const handlePermanentDelete = async () => {
    const selectedEntries = Array.from(selection.values()) as GalleryEntry[];
    if (selectedEntries.length === 0) return;
    const ids = selectedEntries.map((entry) => entry.id);
    const confirmed = window.confirm(
      `Permanently delete ${ids.length} gallery item${ids.length === 1 ? '' : 's'}? This removes them from the recycle bin. This cannot be undone.`,
    );
    if (!confirmed) return;
    await permanentDeleteGalleryEntries(ids);
    await syncComfyGeneratedOutputsWithGalleryEntries({
      entries: selectedEntries,
      mode: 'permanent-delete',
    });
    const updated = await loadEntries();
    setAllEntries(updated);
    clearSelection();
    setActiveEntryId(updated.find((e) => e.deletedAt)?.id ?? null);
  };

  const handleCardClick = useCallback(
    (entry: GalleryEntry, event: React.MouseEvent<HTMLButtonElement>) => {
      if (!entry.assetId) return;
      setActiveEntryId(entry.id);
      setSelection((current) => {
        const result = getGallerySelectionAfterClick({
          entry,
          visibleEntries,
          currentSelection: current,
          anchorId: selectionAnchorIdRef.current,
          shiftKey: event.shiftKey,
          additive: event.metaKey || event.ctrlKey,
        });
        selectionAnchorIdRef.current = result.anchorId;
        return result.selection;
      });
    },
    [visibleEntries],
  );

  const isRecycle = scope === 'recycle';
  const hasEntries = visibleEntries.length > 0;

  const handleGalleryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableKeyboardTarget(event.target)) return;

    if (event.key === 'Escape' && selectedCount > 0) {
      event.preventDefault();
      clearSelection();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      if (selectableEntries.length === 0) return;
      event.preventDefault();
      selectVisibleEntries();
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCount > 0) {
      event.preventDefault();
      if (isRecycle || (event.key === 'Delete' && event.shiftKey)) {
        void handlePermanentDelete();
        return;
      }
      void handleSoftDelete();
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 w-full max-w-7xl mx-auto animate-[fadeIn_250ms_ease-in-out] flex-col overflow-hidden focus:outline-none"
      tabIndex={0}
      onKeyDown={handleGalleryKeyDown}
    >
      <div className="mb-5 flex items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-100"
          >
            <Icons.ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">Gallery</h1>
            <p className="text-sm text-gray-400">Browse generated outputs across all projects</p>
          </div>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-primary-300/15 bg-primary-300/[0.06] px-3 py-2 text-xs">
          <span className="font-medium text-primary-50">{selectedCount} selected</span>
          <span className="text-primary-300/35">|</span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-primary-100/65 transition hover:text-primary-50"
          >
            Clear
          </button>
          {isRecycle ? (
            <>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleRestore}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-gray-200 transition hover:bg-white/[0.08]"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={handlePermanentDelete}
                className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-red-200 transition hover:bg-red-400/20"
              >
                Delete permanently
              </button>
            </>
          ) : (
            <>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleSoftDelete}
                className="rounded border border-rose-300/30 bg-rose-300/10 px-2 py-1 text-rose-200 transition hover:bg-rose-300/20"
              >
                Move to Bin
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-1">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-gray-950/55">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <SlidingSegmentedControl<GalleryScope>
                options={GALLERY_SCOPE_OPTIONS}
                value={scope}
                onChange={setScope}
                ariaLabel="Gallery scope"
                activeWidth={84}
                inactiveWidth={30}
                padding={6}
                selectionRadius={6}
                height={34}
                className="!rounded-lg !border-white/[0.06] !bg-gray-950/45"
                itemClassName="!rounded-md !px-1.5 !text-xs !font-medium !tracking-normal"
                iconClassName="h-3.5 w-3.5"
                activeIconClassName={isRecycle ? 'text-rose-300' : 'text-primary-300'}
                inactiveIconClassName="text-gray-600"
                labelMaxWidthClassName="max-w-20"
              />
              <Badge
                size="sm"
                variant="neutral"
                shrink
                noBorder
                className="!bg-white/5 font-mono !text-gray-400"
              >
                {visibleEntries.length}
              </Badge>
            </div>
            <span className="text-[11px] text-gray-500">
              {selectedCount > 0
                ? `${selectedCount} selected`
                : isRecycle
                  ? 'Deleted items'
                  : 'Click to preview'}
            </span>
          </div>
          {isLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Icons.CubeTransparent className="h-7 w-7 animate-pulse text-primary-300" />
              <p className="text-xs text-gray-500">Loading items…</p>
            </div>
          ) : hasEntries ? (
            <ScrollArea fill axis="y" contentClassName="grid grid-cols-2 gap-2 p-2">
              {visibleEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg">
                  <GalleryCard
                    entry={entry}
                    selected={selection.has(entry.id)}
                    selectable={!!entry.assetId}
                    onCardClick={(event) => handleCardClick(entry, event)}
                  />
                </div>
              ))}
            </ScrollArea>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Icons.Photo className="h-7 w-7 text-gray-700" />
              <p className="text-xs font-medium text-gray-400">
                {isRecycle ? 'Recycle bin is empty' : 'No gallery items'}
              </p>
            </div>
          )}
        </div>
        {hasEntries ? (
          <AssetViewer
            media={activeMedia}
            onOpenProject={
              activeEntry && !activeEntry.deletedAt
                ? () => void openEntryProject(activeEntry)
                : undefined
            }
            className="min-h-[24rem] lg:min-h-0"
          />
        ) : (
          <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-gray-950/35 p-8 text-center lg:min-h-0">
            <Icons.Photo className="h-10 w-10 text-gray-600" />
            <p className="text-base font-medium text-gray-300">
              {isRecycle ? 'Recycle bin is empty' : 'No gallery items found'}
            </p>
            <p className="max-w-md text-sm leading-6 text-gray-500">
              {isRecycle
                ? 'Deleted items will appear here. You can restore them or permanently delete them.'
                : 'Generated Comfy or AI outputs will appear here across all your projects. Open a project and run a generation to get started.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default WelcomeGalleryView;
