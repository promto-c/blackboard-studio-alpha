import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnyNode, ComfyNode, GeneratedOutput, ImageNode, NodeType } from '@blackboard/types';
import { ScrollArea } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';

import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { deleteAssets, getAsset } from '@/state/assetStorage';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { isBackgroundJobActive, type BackgroundJob } from '@/state/editor/services/backgroundJobs';
import {
  createComfyWorkflowFromImage,
  createDefaultComfyWorkflowControls,
  hashComfyWorkflowSource,
} from '@/effects/comfy/comfyWorkflowImport';

type GalleryScope = 'app' | 'project' | 'scene' | 'node' | 'recycle';

type GalleryEntry = {
  id: string;
  source: 'Comfy' | 'AI';
  nodeId: string;
  nodeName: string;
  src?: string;
  width?: number;
  height?: number;
  createdAt: number;
  prompt?: string;
  label?: string;
  detail?: string;
  deletedAt?: number;
  isActive: boolean;
  pending?: boolean;
  pendingActive?: boolean;
  variantIndex?: number;
  outputId?: string;
};

type GallerySelection = Map<string, GalleryEntry>;

const scopeOptions: { value: GalleryScope; label: string }[] = [
  { value: 'app', label: 'App' },
  { value: 'project', label: 'Project' },
  { value: 'scene', label: 'Scene' },
  { value: 'node', label: 'Node' },
];

const formatGalleryTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const isAiImageNode = (node: AnyNode): node is ImageNode =>
  node.type === NodeType.IMAGE && !!(node as ImageNode).aiMetadata;

const isComfyNode = (node: AnyNode): node is ComfyNode => node.type === NodeType.COMFY;

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

const getLatestOutput = (outputs: GeneratedOutput[]): GeneratedOutput | undefined =>
  [...outputs].filter((output) => !output.deletedAt).sort((a, b) => b.createdAt - a.createdAt)[0];

const getReferencedAssetIds = (nodes: AnyNode[]): Set<string> => {
  const refs = new Set<string>();

  nodes.forEach((node) => {
    if (isComfyNode(node)) {
      if (node.src) refs.add(node.src);
      node.generatedOutputs?.forEach((output) => {
        if (output.src) refs.add(output.src);
      });
      return;
    }

    if (isAiImageNode(node)) {
      if (node.src) refs.add(node.src);
      node.aiMetadata?.variants.forEach((variant) => {
        if (variant.src) refs.add(variant.src);
      });
      return;
    }

    if ('src' in node && typeof node.src === 'string' && node.src) {
      refs.add(node.src);
    }

    if ('frames' in node && Array.isArray(node.frames)) {
      node.frames.forEach((frame) => {
        if (typeof frame === 'string' && frame) refs.add(frame);
      });
    }
  });

  return refs;
};

const useAssetObjectUrl = (assetId: string | null) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadAsset = async () => {
      if (!assetId) {
        setUrl(null);
        return;
      }
      try {
        const blob = await getAsset(assetId);
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (error) {
        console.error(`Failed to load gallery asset ${assetId}`, error);
      }
    };

    setUrl(null);
    void loadAsset();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  return url;
};

const getGalleryEntries = (nodes: AnyNode[]): GalleryEntry[] =>
  nodes
    .flatMap((node): GalleryEntry[] => {
      if (isComfyNode(node)) {
        const outputs = node.generatedOutputs ?? [];
        const outputEntries: GalleryEntry[] = outputs
          .filter((output) => !!output.src)
          .map((output) => ({
            id: `comfy:${node.id}:${output.id}`,
            source: 'Comfy',
            nodeId: node.id,
            nodeName: node.name,
            src: output.src,
            width: output.width,
            height: output.height,
            createdAt: output.createdAt,
            prompt: output.prompt,
            label: output.label ?? output.workflowName,
            deletedAt: output.deletedAt,
            isActive: node.activeGeneratedOutputId
              ? node.activeGeneratedOutputId === output.id
              : node.src === output.src,
            outputId: output.id,
          }));

        if (node.src && !outputs.some((output) => output.src === node.src)) {
          outputEntries.push({
            id: `comfy:${node.id}:current`,
            source: 'Comfy',
            nodeId: node.id,
            nodeName: node.name,
            src: node.src,
            width: node.width,
            height: node.height,
            createdAt: node.lastRunAt ?? 0,
            label: 'Current output',
            isActive: true,
          });
        }

        return outputEntries;
      }

      if (isAiImageNode(node) && node.aiMetadata) {
        return node.aiMetadata.variants
          .map((variant, index): GalleryEntry | null => {
            if (!variant.src || variant.status) return null;
            return {
              id: `ai:${node.id}:${index}`,
              source: 'AI',
              nodeId: node.id,
              nodeName: node.name,
              src: variant.src,
              width: variant.width,
              height: variant.height,
              createdAt: variant.createdAt ?? index,
              deletedAt: variant.deletedAt,
              prompt: variant.prompt,
              label: `Variant ${index + 1}`,
              isActive: node.aiMetadata?.activeVariantIndex === index,
              variantIndex: index,
            };
          })
          .filter((entry): entry is GalleryEntry => entry !== null);
      }

      return [];
    })
    .sort((a, b) => b.createdAt - a.createdAt);

const getPendingComfyEntries = (jobs: BackgroundJob[], nodes: AnyNode[]): GalleryEntry[] =>
  jobs.flatMap((job): GalleryEntry[] => {
    if (job.type !== 'comfy' || !isBackgroundJobActive(job)) return [];

    const nodeId = job.source?.nodeId;
    const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : null;
    if (!nodeId || !node) return [];

    const runCount = job.source?.runCount ?? 0;
    if (runCount <= 0) return [];

    const runIndex = Math.max(1, Math.min(runCount, job.source?.runIndex ?? 1));
    const completedCount = Math.max(
      0,
      Math.min(runCount, job.source?.completedCount ?? runIndex - 1),
    );

    return Array.from({ length: Math.max(0, runCount - completedCount) }, (_, index) => {
      const slot = completedCount + index + 1;
      const pendingActive = slot === runIndex && job.status !== 'queued';
      return {
        id: `pending-comfy:${job.id}:${slot}`,
        source: 'Comfy',
        nodeId,
        nodeName: node.name,
        createdAt: job.updatedAt + slot / 100,
        label: pendingActive ? 'Generating' : `Queued ${slot}`,
        detail: `Run ${slot}/${runCount}`,
        isActive: false,
        pending: true,
        pendingActive,
      };
    });
  });

const GalleryCard: React.FC<{
  entry: GalleryEntry;
  onLoadParams?: () => void;
  selected: boolean;
  selectable: boolean;
  onCardClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSelected: (event: React.MouseEvent<HTMLButtonElement>) => void;
  loadingParams?: boolean;
}> = ({
  entry,
  onLoadParams,
  selected,
  selectable,
  onCardClick,
  onToggleSelected,
  loadingParams = false,
}) => {
  const imageUrl = useAssetObjectUrl(entry.src ?? null);
  const dimensions = entry.width && entry.height ? `${entry.width} x ${entry.height}` : null;
  const canLoadParams =
    entry.source === 'Comfy' && !!entry.src && !entry.pending && !entry.deletedAt;

  return (
    <div
      className={`group overflow-hidden rounded-lg border bg-gray-950/60 text-left transition ${
        selected
          ? 'border-rose-300/70 ring-1 ring-rose-300/40'
          : entry.pendingActive
            ? 'border-primary-300/50 bg-primary-300/[0.06]'
            : entry.isActive
              ? 'border-primary-300/70 ring-1 ring-primary-300/40'
              : 'border-white/10 hover:border-white/25 hover:bg-white/[0.04]'
      }`}
      title={entry.detail || entry.prompt || entry.label || entry.nodeName}
    >
      <button
        type="button"
        onClick={onCardClick}
        disabled={entry.pending}
        aria-pressed={entry.isActive}
        className="block w-full text-left disabled:cursor-default"
      >
        <div className="relative aspect-square bg-gray-800">
          {entry.pending ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-primary-100/80">
              <Icons.CubeTransparent
                className={`h-7 w-7 ${entry.pendingActive ? 'animate-pulse' : ''}`}
              />
              <span className="text-[11px] font-medium">{entry.label}</span>
            </div>
          ) : imageUrl ? (
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500">
              <Icons.Photo className="h-6 w-6" />
            </div>
          )}
          <div className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200">
            {entry.source}
          </div>
          {entry.isActive ? (
            <div className="absolute right-1.5 top-1.5 rounded-full bg-primary-300 p-1 text-gray-950">
              <Icons.Check className="h-3 w-3" />
            </div>
          ) : null}
          {entry.deletedAt ? (
            <div className="absolute right-1.5 top-1.5 rounded bg-rose-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-950">
              Bin
            </div>
          ) : null}
          {selectable ? (
            <span
              className={`absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded border ${
                selected
                  ? 'border-rose-200 bg-rose-300 text-gray-950'
                  : 'border-white/20 bg-black/60 text-transparent group-hover:text-gray-300'
              }`}
            >
              <Icons.Check className="h-3 w-3" />
            </span>
          ) : null}
        </div>
        <div className="space-y-1 p-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-gray-200">{entry.nodeName}</span>
            <span className="shrink-0 text-[10px] text-gray-500">
              {formatGalleryTime(entry.createdAt)}
            </span>
          </div>
          <p className="line-clamp-2 min-h-8 text-[11px] leading-4 text-gray-400">
            {entry.detail || entry.prompt || entry.label || 'Generated output'}
          </p>
          {dimensions ? <p className="font-mono text-[10px] text-gray-600">{dimensions}</p> : null}
        </div>
      </button>
      {selectable || canLoadParams ? (
        <div className="flex border-t border-white/10">
          {canLoadParams ? (
            <button
              type="button"
              onClick={onLoadParams}
              disabled={loadingParams}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-primary-100/70 transition hover:bg-primary-300/10 hover:text-primary-50 disabled:cursor-wait disabled:opacity-60"
              title="Load workflow params from image metadata"
            >
              <Icons.Cog className={`h-3.5 w-3.5 ${loadingParams ? 'animate-spin' : ''}`} />
              <span className="truncate">{loadingParams ? 'Loading' : 'Params'}</span>
            </button>
          ) : null}
          {selectable ? (
            <button
              type="button"
              onClick={onToggleSelected}
              className={`min-w-0 flex-1 px-2 py-1 text-[11px] font-medium text-gray-400 transition hover:bg-white/[0.04] hover:text-gray-100 ${
                canLoadParams ? 'border-l border-white/10' : ''
              }`}
            >
              {selected ? 'Selected' : 'Select'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const GalleryTab: React.FC = () => {
  const nodes = useEditorSelector((state) => state.nodes);
  const selectedNodeId = useEditorSelector((state) => state.selectedNodeId);
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const { comfyEndpoint } = usePreferences();
  const sceneNode = useMemo(() => nodes.find((node) => node.type === NodeType.SCENE), [nodes]);
  const { selectNode, setActiveVariant, updateNode } = useEditorActions();
  const [scope, setScope] = useState<GalleryScope>('project');
  const [selection, setSelection] = useState<GallerySelection>(() => new Map());
  const selectionAnchorIdRef = useRef<string | null>(null);
  const [paramsImportEntryId, setParamsImportEntryId] = useState<string | null>(null);
  const [galleryNotice, setGalleryNotice] = useState<{
    tone: 'info' | 'error';
    message: string;
  } | null>(null);

  const allEntries = useMemo(
    () =>
      [...getPendingComfyEntries(backgroundJobs, nodes), ...getGalleryEntries(nodes)].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [backgroundJobs, nodes],
  );
  const visibleEntries = useMemo(() => {
    if (scope === 'recycle') {
      return allEntries.filter((entry) => !!entry.deletedAt);
    }

    const activeEntries = allEntries.filter((entry) => !entry.deletedAt);

    if (scope === 'node') {
      return selectedNodeId ? activeEntries.filter((entry) => entry.nodeId === selectedNodeId) : [];
    }

    if (scope === 'scene') {
      const visibleNodeIds = new Set(
        nodes.filter((node) => node.visible !== false).map((node) => node.id),
      );
      return activeEntries.filter((entry) => visibleNodeIds.has(entry.nodeId));
    }

    return activeEntries;
  }, [allEntries, nodes, scope, selectedNodeId]);
  const selectableEntries = useMemo(
    () => visibleEntries.filter((entry) => !entry.pending && !!entry.src),
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
    if (entry.pending || !entry.src) return;
    selectionAnchorIdRef.current = entry.id;
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.set(entry.id, entry);
      return next;
    });
  };

  const selectEntryRange = (entry: GalleryEntry, preserveExisting: boolean) => {
    if (entry.pending || !entry.src) return;

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
      .filter((candidate) => !candidate.pending && !!candidate.src);

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
    if (entry.pending || !entry.src) return;

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

  const getSelectedEntriesByNode = () => {
    const entriesByNode = new Map<string, GalleryEntry[]>();
    selectedEntries.forEach((entry) => {
      if (entry.pending) return;
      entriesByNode.set(entry.nodeId, [...(entriesByNode.get(entry.nodeId) ?? []), entry]);
    });
    return entriesByNode;
  };

  const commitNodeChanges = (nextNodes: AnyNode[]) => {
    const changedNodes = nextNodes.filter((nextNode, index) => nextNode !== nodes[index]);
    changedNodes.forEach((nextNode) => {
      updateNode(nextNode.id, nextNode as Partial<AnyNode>, true);
    });
  };

  const handleSoftDeleteSelected = () => {
    if (selectedEntries.length === 0) return;

    const deletedAt = Date.now();
    const entriesByNode = getSelectedEntriesByNode();

    const nextNodes = nodes.map((node) => {
      const entries = entriesByNode.get(node.id) ?? [];
      if (entries.length === 0) return node;

      if (isComfyNode(node)) {
        const selectedOutputIds = new Set(
          entries.map((entry) => entry.outputId).filter((id): id is string => !!id),
        );
        const selectedSrcs = new Set(
          entries.map((entry) => entry.src).filter((src): src is string => !!src),
        );
        const selectedCurrentOutput = entries.some((entry) => !entry.outputId);
        const currentRecycleOutputs: GeneratedOutput[] = entries
          .filter((entry) => !entry.outputId && entry.src)
          .map((entry) => ({
            id: `deleted_current_${deletedAt}_${Math.random().toString(36).slice(2, 8)}`,
            src: entry.src!,
            width: entry.width ?? node.width,
            height: entry.height ?? node.height,
            createdAt: entry.createdAt || deletedAt,
            deletedAt,
            label: entry.label ?? 'Deleted output',
            prompt: entry.prompt,
          }));
        const nextOutputs = [
          ...(node.generatedOutputs ?? []).map((output) =>
            selectedOutputIds.has(output.id) ? { ...output, deletedAt } : output,
          ),
          ...currentRecycleOutputs,
        ];
        const removedActiveOutput =
          (!!node.activeGeneratedOutputId && selectedOutputIds.has(node.activeGeneratedOutputId)) ||
          selectedCurrentOutput ||
          (!!node.src && selectedSrcs.has(node.src));
        const fallback = removedActiveOutput ? getLatestOutput(nextOutputs) : undefined;

        return {
          ...node,
          generatedOutputs: nextOutputs,
          ...(removedActiveOutput
            ? fallback
              ? {
                  src: fallback.src,
                  width: fallback.width,
                  height: fallback.height,
                  activeGeneratedOutputId: fallback.id,
                  lastPromptId: fallback.promptId,
                  lastRunAt: fallback.createdAt,
                }
              : {
                  src: '',
                  width: 0,
                  height: 0,
                  activeGeneratedOutputId: undefined,
                  lastPromptId: undefined,
                  lastRunAt: undefined,
                }
            : {}),
        } as ComfyNode;
      }

      if (isAiImageNode(node) && node.aiMetadata) {
        const selectedVariantIndexes = new Set(
          entries
            .map((entry) => entry.variantIndex)
            .filter((index): index is number => typeof index === 'number'),
        );
        const variants = node.aiMetadata.variants;
        const nextVariants = variants.map((variant, index) =>
          selectedVariantIndexes.has(index) ? { ...variant, deletedAt } : variant,
        );
        const activeIndex = node.aiMetadata.activeVariantIndex;
        const activeWasDeleted = selectedVariantIndexes.has(activeIndex);
        const nextActiveIndex = activeWasDeleted
          ? nextVariants.reduce(
              (bestIndex, variant, index) =>
                !variant.deletedAt &&
                (bestIndex === -1 ||
                  (variant.createdAt ?? index) > (nextVariants[bestIndex].createdAt ?? bestIndex))
                  ? index
                  : bestIndex,
              -1,
            )
          : activeIndex;
        const nextActiveVariant = nextActiveIndex >= 0 ? nextVariants[nextActiveIndex] : undefined;

        return {
          ...node,
          src: nextActiveVariant?.src ?? '',
          width: nextActiveVariant?.width ?? node.width,
          height: nextActiveVariant?.height ?? node.height,
          aiMetadata: {
            ...node.aiMetadata,
            variants: nextVariants,
            activeVariantIndex: nextActiveIndex,
            prompt: nextActiveVariant?.prompt ?? node.aiMetadata.prompt,
          },
        } as ImageNode;
      }

      return node;
    });

    commitNodeChanges(nextNodes);
    clearSelection();
  };

  const handleRestoreSelected = () => {
    if (selectedEntries.length === 0) return;

    const entriesByNode = getSelectedEntriesByNode();
    const nextNodes = nodes.map((node) => {
      const entries = entriesByNode.get(node.id) ?? [];
      if (entries.length === 0) return node;

      if (isComfyNode(node)) {
        const selectedOutputIds = new Set(
          entries.map((entry) => entry.outputId).filter((id): id is string => !!id),
        );
        return {
          ...node,
          generatedOutputs: (node.generatedOutputs ?? []).map((output) =>
            selectedOutputIds.has(output.id) ? { ...output, deletedAt: undefined } : output,
          ),
        } as ComfyNode;
      }

      if (isAiImageNode(node) && node.aiMetadata) {
        const selectedVariantIndexes = new Set(
          entries
            .map((entry) => entry.variantIndex)
            .filter((index): index is number => typeof index === 'number'),
        );
        return {
          ...node,
          aiMetadata: {
            ...node.aiMetadata,
            variants: node.aiMetadata.variants.map((variant, index) =>
              selectedVariantIndexes.has(index) ? { ...variant, deletedAt: undefined } : variant,
            ),
          },
        } as ImageNode;
      }

      return node;
    });

    commitNodeChanges(nextNodes);
    clearSelection();
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedEntries.length === 0) return;

    const confirmed = window.confirm(
      `Permanently delete ${selectedEntries.length} gallery item${
        selectedEntries.length === 1 ? '' : 's'
      }? This removes them from the recycle bin and deletes unreferenced assets. This cannot be undone safely.`,
    );
    if (!confirmed) return;

    const entriesByNode = getSelectedEntriesByNode();
    const nextNodes = nodes.map((node) => {
      const entries = entriesByNode.get(node.id) ?? [];
      if (entries.length === 0) return node;

      if (isComfyNode(node)) {
        const selectedOutputIds = new Set(
          entries.map((entry) => entry.outputId).filter((id): id is string => !!id),
        );
        const selectedSrcs = new Set(
          entries.map((entry) => entry.src).filter((src): src is string => !!src),
        );
        const selectedCurrentOutput = entries.some((entry) => !entry.outputId);
        const remainingOutputs = (node.generatedOutputs ?? []).filter(
          (output) => !selectedOutputIds.has(output.id),
        );
        const removedActiveOutput =
          (!!node.activeGeneratedOutputId && selectedOutputIds.has(node.activeGeneratedOutputId)) ||
          selectedCurrentOutput ||
          (!!node.src && selectedSrcs.has(node.src));
        const fallback = removedActiveOutput ? getLatestOutput(remainingOutputs) : undefined;

        return {
          ...node,
          generatedOutputs: remainingOutputs,
          ...(removedActiveOutput
            ? fallback
              ? {
                  src: fallback.src,
                  width: fallback.width,
                  height: fallback.height,
                  activeGeneratedOutputId: fallback.id,
                  lastPromptId: fallback.promptId,
                  lastRunAt: fallback.createdAt,
                }
              : {
                  src: '',
                  width: 0,
                  height: 0,
                  activeGeneratedOutputId: undefined,
                  lastPromptId: undefined,
                  lastRunAt: undefined,
                }
            : {}),
        } as ComfyNode;
      }

      if (isAiImageNode(node) && node.aiMetadata) {
        const selectedVariantIndexes = new Set(
          entries
            .map((entry) => entry.variantIndex)
            .filter((index): index is number => typeof index === 'number'),
        );
        const variants = node.aiMetadata.variants;
        const activeVariant = variants[node.aiMetadata.activeVariantIndex];
        const remainingVariants = variants.filter((_, index) => !selectedVariantIndexes.has(index));
        const nextActiveIndex = activeVariant
          ? remainingVariants.findIndex((variant) => variant === activeVariant)
          : -1;
        const fallbackIndex =
          nextActiveIndex >= 0
            ? nextActiveIndex
            : remainingVariants.reduce(
                (bestIndex, variant, index) =>
                  !variant.deletedAt &&
                  (bestIndex === -1 ||
                    (variant.createdAt ?? index) >
                      (remainingVariants[bestIndex].createdAt ?? bestIndex))
                    ? index
                    : bestIndex,
                -1,
              );
        const nextActiveVariant = fallbackIndex >= 0 ? remainingVariants[fallbackIndex] : undefined;

        return {
          ...node,
          src: nextActiveVariant?.src ?? '',
          width: nextActiveVariant?.width ?? node.width,
          height: nextActiveVariant?.height ?? node.height,
          aiMetadata: {
            ...node.aiMetadata,
            variants: remainingVariants,
            activeVariantIndex: fallbackIndex,
            prompt: nextActiveVariant?.prompt ?? node.aiMetadata.prompt,
          },
        } as ImageNode;
      }

      return node;
    });

    const remainingAssetRefs = getReferencedAssetIds(nextNodes);
    const candidateAssetIds = selectedEntries
      .map((entry) => entry.src)
      .filter((src): src is string => !!src);
    const assetIdsToDelete = Array.from(
      new Set<string>(candidateAssetIds.filter((assetId) => !remainingAssetRefs.has(assetId))),
    );

    commitNodeChanges(nextNodes);

    if (assetIdsToDelete.length > 0) {
      await deleteAssets(assetIdsToDelete);
    }

    clearSelection();
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
      handleSoftDeleteSelected();
    }
  };

  const handleActivate = (entry: GalleryEntry) => {
    if (entry.deletedAt) return;
    const node = nodes.find((candidate) => candidate.id === entry.nodeId);
    if (!node) return;

    if (entry.source === 'AI' && entry.variantIndex !== undefined) {
      setActiveVariant(entry.nodeId, entry.variantIndex);
      selectNode(entry.nodeId);
      return;
    }

    if (isComfyNode(node) && !entry.outputId) {
      selectNode(entry.nodeId);
      return;
    }

    if (isComfyNode(node) && entry.outputId) {
      const output = node.generatedOutputs?.find((candidate) => candidate.id === entry.outputId);
      if (!output) return;

      const transform =
        sceneNode && 'width' in sceneNode && 'height' in sceneNode
          ? {
              ...node.transform,
              ...calculateTransformForFitMode(
                { width: output.width, height: output.height },
                { width: sceneNode.width, height: sceneNode.height },
                node.transform.fitMode,
              ),
              x: 0,
              y: 0,
            }
          : node.transform;

      updateNode(
        entry.nodeId,
        {
          src: output.src,
          width: output.width,
          height: output.height,
          transform,
          activeGeneratedOutputId: output.id,
          lastPromptId: output.promptId,
          lastRunAt: output.createdAt,
        },
        true,
      );
      selectNode(entry.nodeId);
    }
  };

  const handleCardClick = (entry: GalleryEntry, event: React.MouseEvent<HTMLButtonElement>) => {
    if (entry.pending) return;

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      handleEntrySelectionClick(entry, event);
      return;
    }

    if (entry.deletedAt) return;

    handleActivate(entry);
  };

  const handleLoadOutputParams = async (entry: GalleryEntry) => {
    if (entry.source !== 'Comfy' || !entry.src) return;

    const node = nodes.find((candidate): candidate is ComfyNode => {
      return candidate.id === entry.nodeId && isComfyNode(candidate);
    });
    if (!node) return;

    setParamsImportEntryId(entry.id);
    setGalleryNotice(null);

    try {
      const blob = await getAsset(entry.src);
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
      const restoredOutput: GeneratedOutput | null =
        entry.outputId || !entry.src
          ? null
          : {
              id: `comfy_output_gallery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              src: entry.src,
              width: entry.width ?? node.width,
              height: entry.height ?? node.height,
              createdAt: entry.createdAt || Date.now(),
              label: entry.label ?? 'Gallery output',
              prompt: entry.prompt,
              workflowId: workflow.id,
              workflowName: workflow.name,
            };
      const workflows = node.workflows.some((candidate) => candidate.id === workflow.id)
        ? node.workflows.map((candidate) => (candidate.id === workflow.id ? workflow : candidate))
        : [...node.workflows, workflow];
      const generatedOutputs = restoredOutput
        ? [...(node.generatedOutputs ?? []), restoredOutput]
        : node.generatedOutputs;

      updateNode(
        node.id,
        {
          workflows,
          selectedWorkflowId: workflow.id,
          ...(restoredOutput
            ? {
                generatedOutputs,
                activeGeneratedOutputId:
                  node.src === entry.src ? restoredOutput.id : node.activeGeneratedOutputId,
              }
            : {}),
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
      setGalleryNotice({
        tone: 'info',
        message: restoredOutput
          ? `Loaded params from ${entry.label || 'Comfy output'} and added it to this node gallery.`
          : `Loaded params from ${entry.label || 'Comfy output'}.`,
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
                : handleSoftDeleteSelected
            }
            className="inline-flex items-center gap-1 rounded-md border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-100 transition hover:border-rose-200/50 hover:bg-rose-500/20"
          >
            <Icons.Trash className="h-3.5 w-3.5" />
            {scope === 'recycle' ? 'Delete forever' : 'Delete'}
          </button>
          {scope === 'recycle' && (
            <button
              type="button"
              onClick={handleRestoreSelected}
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

      {visibleEntries.length > 0 ? (
        <ScrollArea fill axis="y" contentClassName="grid grid-cols-2 gap-2 p-2">
          {visibleEntries.map((entry) => (
            <GalleryCard
              key={entry.id}
              entry={entry}
              selected={selection.has(entry.id)}
              selectable={!entry.pending && !!entry.src}
              onToggleSelected={(event) => handleEntrySelectionClick(entry, event)}
              onCardClick={(event) => handleCardClick(entry, event)}
              onLoadParams={() => void handleLoadOutputParams(entry)}
              loadingParams={paramsImportEntryId === entry.id}
            />
          ))}
        </ScrollArea>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Icons.Sparkles className="h-7 w-7 text-gray-600" />
          <p className="text-sm font-medium text-gray-300">No generated outputs</p>
          <p className="max-w-48 text-xs leading-5 text-gray-500">
            Run Comfy or AI generation, then select an output here to make it active.
          </p>
        </div>
      )}
    </div>
  );
};

export default GalleryTab;
