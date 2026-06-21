import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComfyNode, EditorTab, NodeType } from '@blackboard/types';
import { ScrollArea } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';

import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { getAsset } from '@/state/assetStorage';
import {
  createComfyWorkflowFromImage,
  createDefaultComfyWorkflowControls,
  hashComfyWorkflowSource,
} from '@/nodes/ai/comfy/comfyWorkflowImport';
import {
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyOutputActivationUpdates,
  getComfyOutputActivationRegionId,
} from '@/nodes/ai/comfy/comfyOutputActivation';
import { getComfyGeneratedOutputsForGalleryScope } from '@/nodes/ai/comfy/comfyOutputLayers';
import { getComfyOutputTransform } from '@/nodes/ai/comfy/comfyOutputTransform';
import { createScene3DSettingsWithAsset } from '@/nodes/builtin/scene_3d/scene3d';
import {
  type GalleryEntry,
  type GallerySelection,
  GalleryCard,
  getTagValue,
  hasTag,
} from './galleryShared';
import {
  loadGalleryEntries,
  softDeleteGalleryEntries,
  restoreGalleryEntries,
  permanentDeleteGalleryEntries,
} from '@blackboard/project-store';

type GalleryScope = 'app' | 'project' | 'branch' | 'node' | 'region' | 'recycle';

const baseScopeOptions: { value: GalleryScope; label: string }[] = [
  { value: 'app', label: 'App' },
  { value: 'project', label: 'Project' },
  { value: 'branch', label: 'Branch' },
  { value: 'node', label: 'Node' },
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

function GalleryTab() {
  const projectId = useEditorSelector((state) => state.projectId);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const galleryUpdatedAt = useEditorSelector((state) => state.galleryUpdatedAt);
  const selectedNodeId = useEditorSelector((state) => state.selectedNodeId);
  const nodes = useEditorSelector((state) => state.nodes);
  const hierarchySelection = useEditorSelector((state) =>
    selectedNodeId ? state.hierarchySelections[selectedNodeId] : undefined,
  );
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((node) => node.type === NodeType.SCENE),
  );
  const {
    selectNode,
    addNodeWithProps,
    updateNode,
    setActiveTab,
    setSubPanelVisible,
    switchProjectBranch,
    syncComfyGeneratedOutputsWithGalleryEntries,
  } = useEditorActions();
  const { comfyEndpoint } = usePreferences();

  const selectedComfyNode = nodes.find(
    (node): node is ComfyNode => node.id === selectedNodeId && node.type === NodeType.COMFY,
  );
  const selectedGalleryRegionId =
    selectedComfyNode &&
    hierarchySelection?.layerIds.length === 1 &&
    hierarchySelection.itemIds.length === 0 &&
    selectedComfyNode.viewportPromptRegions?.some(
      (region) => region.id === hierarchySelection.layerIds[0],
    )
      ? hierarchySelection.layerIds[0]
      : null;
  const regionOutputIds = useMemo(
    () =>
      new Set(
        selectedComfyNode
          ? getComfyGeneratedOutputsForGalleryScope(selectedComfyNode, selectedGalleryRegionId).map(
              (output) => output.id,
            )
          : [],
      ),
    [selectedComfyNode, selectedGalleryRegionId],
  );
  const scopeOptions = useMemo(
    () => [
      ...baseScopeOptions,
      ...(selectedGalleryRegionId ? [{ value: 'region' as const, label: 'Region' }] : []),
    ],
    [selectedGalleryRegionId],
  );

  const [allEntries, setAllEntries] = useState<GalleryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<GalleryScope>(selectedGalleryRegionId ? 'region' : 'project');
  const [selection, setSelection] = useState<GallerySelection>(() => new Map());
  const selectionAnchorIdRef = useRef<string | null>(null);
  const [paramsImportEntryId, setParamsImportEntryId] = useState<string | null>(null);
  const [galleryNotice, setGalleryNotice] = useState<{
    tone: 'info' | 'error';
    message: string;
  } | null>(null);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    const entries = await loadGalleryEntries();
    setAllEntries(entries);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (galleryUpdatedAt > 0) void loadEntries();
  }, [galleryUpdatedAt, loadEntries]);

  useEffect(() => {
    setScope((currentScope) => {
      if (selectedGalleryRegionId) return 'region';
      return currentScope === 'region' ? 'node' : currentScope;
    });
  }, [selectedGalleryRegionId]);

  const projectTag = projectId ? `project:${projectId}` : null;
  const branchTag = activeProjectBranchId ? `branch:${activeProjectBranchId}` : null;

  const visibleEntries = useMemo(() => {
    if (!allEntries.length) return [];

    let filtered = allEntries;

    if (scope === 'recycle') {
      filtered = filtered.filter((e) => !!e.deletedAt);
    } else {
      filtered = filtered.filter((e) => !e.deletedAt);

      if (scope === 'project' && projectTag) {
        filtered = filtered.filter((e) => hasTag(e.tags, projectTag!));
      } else if (scope === 'branch' && branchTag && projectTag) {
        filtered = filtered.filter(
          (e) => hasTag(e.tags, projectTag!) && hasTag(e.tags, branchTag!),
        );
      } else if (scope === 'node' && selectedNodeId) {
        filtered = filtered.filter((e) => hasTag(e.tags, `node:${selectedNodeId}`));
      } else if (scope === 'region' && selectedNodeId && selectedGalleryRegionId) {
        filtered = filtered.filter(
          (entry) =>
            hasTag(entry.tags, `node:${selectedNodeId}`) &&
            Boolean(entry.outputId && regionOutputIds.has(entry.outputId)),
        );
      }
    }

    return filtered;
  }, [
    allEntries,
    scope,
    projectTag,
    branchTag,
    selectedNodeId,
    selectedGalleryRegionId,
    regionOutputIds,
  ]);

  const selectableEntries = useMemo(
    () => visibleEntries.filter((entry) => !!entry.assetId),
    [visibleEntries],
  );

  const selectedEntries = useMemo(() => Array.from(selection.values()), [selection]);
  const selectedCount = selectedEntries.length;

  useEffect(() => {
    const validIds = new Set(selectableEntries.map((entry) => entry.id));
    if (selectionAnchorIdRef.current && !validIds.has(selectionAnchorIdRef.current)) {
      selectionAnchorIdRef.current = null;
    }
    setSelection((current) => {
      const next: GallerySelection = new Map();
      current.forEach((entry, entryId) => {
        if (validIds.has(entryId)) next.set(entryId, entry);
      });
      return next.size === current.size ? current : next;
    });
  }, [selectableEntries]);

  const toggleEntrySelection = (entry: GalleryEntry) => {
    if (!entry.assetId) return;
    selectionAnchorIdRef.current = entry.id;
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.set(entry.id, entry);
      return next;
    });
  };

  const selectEntryRange = (entry: GalleryEntry, preserveExisting: boolean) => {
    if (!entry.assetId) return;

    const anchorId = selectionAnchorIdRef.current;
    const targetIndex = visibleEntries.findIndex((candidate) => candidate.id === entry.id);
    const anchorIndex = anchorId
      ? visibleEntries.findIndex((candidate) => candidate.id === anchorId)
      : -1;

    if (targetIndex < 0 || anchorIndex < 0) {
      selectionAnchorIdRef.current = entry.id;
      setSelection((current) => {
        const next = preserveExisting ? new Map(current) : new Map<string, GalleryEntry>();
        next.set(entry.id, entry);
        return next;
      });
      return;
    }

    const [startIndex, endIndex] =
      anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    const rangeEntries = visibleEntries
      .slice(startIndex, endIndex + 1)
      .filter((candidate) => !!candidate.assetId);

    setSelection((current) => {
      const next = preserveExisting ? new Map(current) : new Map<string, GalleryEntry>();
      rangeEntries.forEach((candidate) => next.set(candidate.id, candidate));
      return next;
    });
  };

  const handleEntrySelectionClick = (
    entry: GalleryEntry,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!entry.assetId) return;

    if (event.shiftKey) {
      selectEntryRange(entry, event.metaKey || event.ctrlKey);
      return;
    }

    toggleEntrySelection(entry);
  };

  const selectVisibleEntries = () => {
    setSelection((current) => {
      const next = new Map(current);
      selectableEntries.forEach((entry) => next.set(entry.id, entry));
      return next;
    });
    selectionAnchorIdRef.current = selectableEntries[0]?.id ?? null;
  };

  const clearSelection = () => {
    selectionAnchorIdRef.current = null;
    setSelection(new Map());
  };

  const handleSoftDeleteSelected = async () => {
    if (selectedEntries.length === 0) return;
    const ids = selectedEntries.map((e) => e.id);
    const deletedAt = Date.now();
    await softDeleteGalleryEntries(ids);
    await syncComfyGeneratedOutputsWithGalleryEntries({
      entries: selectedEntries,
      mode: 'soft-delete',
      deletedAt,
    });
    clearSelection();
    await loadEntries();
  };

  const handleRestoreSelected = async () => {
    if (selectedEntries.length === 0) return;
    const ids = selectedEntries.map((e) => e.id);
    await restoreGalleryEntries(ids);
    await syncComfyGeneratedOutputsWithGalleryEntries({
      entries: selectedEntries,
      mode: 'restore',
    });
    clearSelection();
    await loadEntries();
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedEntries.length === 0) return;

    const confirmed = window.confirm(
      `Permanently delete ${selectedEntries.length} gallery item${selectedEntries.length === 1 ? '' : 's'}? This removes them from the recycle bin. This cannot be undone safely.`,
    );
    if (!confirmed) return;

    const ids = selectedEntries.map((e) => e.id);

    await permanentDeleteGalleryEntries(ids);
    await syncComfyGeneratedOutputsWithGalleryEntries({
      entries: selectedEntries,
      mode: 'permanent-delete',
    });
    clearSelection();

    await loadEntries();
  };

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
      if (scope === 'recycle' || (event.key === 'Delete' && event.shiftKey)) {
        void handlePermanentDeleteSelected();
        return;
      }
      void handleSoftDeleteSelected();
    }
  };

  const handleActivate = async (entry: GalleryEntry) => {
    if (entry.deletedAt) return;

    const nodeId = getTagValue(entry.tags, 'node:');
    if (!nodeId) return;

    const entryBranchId = getTagValue(entry.tags, 'branch:');
    if (entryBranchId && entryBranchId !== activeProjectBranchId) {
      await switchProjectBranch(entryBranchId);
    }

    if (entry.mediaKind === 'model_3d' && entry.scene3dAsset) {
      addNodeWithProps(
        NodeType.SCENE_3D,
        {
          viewportMode: 'scene3d',
          scene3d: createScene3DSettingsWithAsset(
            entry.scene3dAsset,
            sceneNode?.width,
            sceneNode?.height,
          ),
        },
        { name: entry.label || entry.scene3dAsset.fileName },
      );
      return;
    }

    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;

    if (node.type === NodeType.COMFY && entry.outputId) {
      const comfyNode = node as ComfyNode;
      const output = comfyNode.generatedOutputs?.find((o) => o.id === entry.outputId);
      if (!output) return;

      const transform = getComfyOutputTransform({
        node: comfyNode,
        output,
        sceneNode:
          sceneNode && 'width' in sceneNode && 'height' in sceneNode
            ? { width: sceneNode.width, height: sceneNode.height }
            : null,
      });
      const nextGeneratedOutputs = getComfyGeneratedOutputsForGalleryActivation(comfyNode, output);

      updateNode(
        nodeId,
        {
          ...getComfyOutputActivationUpdates(output),
          transform,
          generatedOutputs: nextGeneratedOutputs,
          selectedViewportPromptRegionId: getComfyOutputActivationRegionId(comfyNode, output),
        },
        true,
      );
      selectNode(nodeId);
    }
  };

  const handleCardClick = (entry: GalleryEntry, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      handleEntrySelectionClick(entry, event);
      return;
    }

    if (entry.deletedAt) return;
    void handleActivate(entry);
  };

  const handleLoadOutputParams = async (entry: GalleryEntry) => {
    if (entry.source !== 'Comfy' || !entry.assetId) return;

    const nodeId = getTagValue(entry.tags, 'node:');
    if (!nodeId) return;

    const node = nodes.find(
      (candidate): candidate is ComfyNode =>
        candidate.id === nodeId && candidate.type === NodeType.COMFY,
    );
    if (!node) return;

    setParamsImportEntryId(entry.id);
    setGalleryNotice(null);

    try {
      const blob = await getAsset(entry.assetId);
      if (!blob) throw new Error('Could not read the selected output asset.');

      const workflow = await createComfyWorkflowFromImage({
        endpoint: comfyEndpoint,
        image: blob,
        id: `comfy_workflow_output_${hashComfyWorkflowSource(entry.id)}`,
        name: `${entry.label || entry.nodeName || 'Output'} params`,
        createdAt: entry.createdAt || Date.now(),
        preferPrompt: true,
      });
      const nextWorkflowControls = createDefaultComfyWorkflowControls(workflow);

      const workflows = node.workflows.some((candidate) => candidate.id === workflow.id)
        ? node.workflows.map((candidate) => (candidate.id === workflow.id ? workflow : candidate))
        : [...node.workflows, workflow];

      updateNode(
        node.id,
        {
          workflows,
          selectedWorkflowId: workflow.id,
          workflowControls: [
            ...(node.workflowControls ?? []).filter(
              (control) => control.workflowId !== workflow.id,
            ),
            ...nextWorkflowControls,
          ],
          lastError: undefined,
        },
        true,
      );
      selectNode(node.id);
      setActiveTab(EditorTab.Props);
      setSubPanelVisible(true);
      setGalleryNotice({
        tone: 'info',
        message: `Loaded params from ${entry.label || 'Comfy output'}.`,
      });
    } catch (error) {
      setGalleryNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Could not load Comfy params from this output.',
      });
    } finally {
      setParamsImportEntryId(null);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col focus:outline-none"
      tabIndex={0}
      onKeyDown={handleGalleryKeyDown}
    >
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icons.Photo className="h-4 w-4 text-primary-200" />
          <h2 className="truncate text-sm font-semibold text-gray-100">Gallery</h2>
        </div>
        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
          {visibleEntries.length}
        </span>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-rose-300/20 bg-rose-300/[0.06] px-2 py-2">
          <button
            type="button"
            onClick={clearSelection}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-100/70 transition hover:bg-white/[0.06] hover:text-rose-50"
            title="Clear selection"
            aria-label="Clear selection"
          >
            <Icons.XMark className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-rose-100">
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={
              scope === 'recycle'
                ? () => void handlePermanentDeleteSelected()
                : () => void handleSoftDeleteSelected()
            }
            className="inline-flex items-center gap-1 rounded-md border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-100 transition hover:border-rose-200/50 hover:bg-rose-500/20"
          >
            <Icons.Trash className="h-3.5 w-3.5" />
            {scope === 'recycle' ? 'Delete forever' : 'Delete'}
          </button>
          {scope === 'recycle' && (
            <button
              type="button"
              onClick={() => void handleRestoreSelected()}
              className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] font-medium text-emerald-100 transition hover:border-emerald-200/40 hover:bg-emerald-300/15"
            >
              Restore
            </button>
          )}
        </div>
      )}

      <div className="flex flex-shrink-0 gap-1 border-b border-white/10 px-2 py-2">
        <div className="flex min-w-0 flex-1 gap-1">
          {scopeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setScope(option.value)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
                scope === option.value
                  ? 'bg-primary-300/15 text-primary-100 ring-1 ring-primary-300/30'
                  : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setScope('recycle')}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
            scope === 'recycle'
              ? 'bg-rose-300/15 text-rose-100 ring-1 ring-rose-300/30'
              : 'text-gray-500 hover:bg-white/[0.06] hover:text-gray-200'
          }`}
          title="Recycle Bin"
          aria-label="Recycle Bin"
        >
          <Icons.Trash className="h-3.5 w-3.5" />
        </button>
      </div>

      {galleryNotice ? (
        <div
          className={`border-b px-3 py-2 text-[11px] leading-4 ${
            galleryNotice.tone === 'error'
              ? 'border-red-300/20 bg-red-500/10 text-red-100'
              : 'border-primary-300/20 bg-primary-300/10 text-primary-100'
          }`}
        >
          {galleryNotice.message}
        </div>
      ) : null}

      {selectableEntries.length > 0 && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">
            Batch
          </span>
          <button
            type="button"
            onClick={selectVisibleEntries}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition hover:bg-white/[0.05] hover:text-gray-100"
          >
            Select visible
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Icons.CubeTransparent className="h-7 w-7 animate-pulse text-primary-300" />
        </div>
      ) : visibleEntries.length > 0 ? (
        <ScrollArea fill axis="y" contentClassName="grid grid-cols-2 gap-2 p-2">
          {visibleEntries.map((entry) => (
            <GalleryCard
              key={entry.id}
              entry={entry}
              selected={selection.has(entry.id)}
              selectable={!!entry.assetId}
              onToggleSelected={(event) => handleEntrySelectionClick(entry, event)}
              onCardClick={(event) => handleCardClick(entry, event)}
              onLoadParams={() => void handleLoadOutputParams(entry)}
              loadingParams={paramsImportEntryId === entry.id}
            />
          ))}
        </ScrollArea>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Icons.CubeTransparent className="h-7 w-7 text-gray-600" />
          <p className="text-sm font-medium text-gray-300">No generated outputs</p>
          <p className="max-w-48 text-xs leading-5 text-gray-500">
            Run Comfy, then select an output here to make it active.
          </p>
        </div>
      )}
    </div>
  );
}

export default GalleryTab;
