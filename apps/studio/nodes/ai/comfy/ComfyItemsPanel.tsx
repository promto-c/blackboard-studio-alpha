import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AnyNode, ComfyNode, GeneratedOutput, ViewportPromptRegion } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { loadGalleryEntries, softDeleteGalleryEntries } from '@blackboard/project-store';
import {
  FloatingMenu,
  HEADER_SELECTION_CHIP_CLASS,
  HEADER_SELECTION_ICON_BUTTON_CLASS,
  ItemsHierarchyRenderer,
  ItemsPanelLayout,
  ItemsTreeView,
  LayerPlusIcon,
  LayerRowShell,
  LeafItemRowShell,
  MenuButton,
  MenuSectionLabel,
  MoveMenuSection,
  countLabel,
  type LayerOption,
} from '@/components';
import {
  flattenHierarchy,
  useTreePanelState,
  type FlatTreeRow,
} from '@/components/useTreeItemsPanel';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import type { StandardClipboardHandlers } from '@/utils/standardClipboardHotkeys';
import { getHierarchyItemKey } from '@/utils/hierarchyHelpers';
import { readClipboard, writeClipboard } from '@/utils/hierarchyClipboard';
import { getLayerOptions } from '@/utils/itemsHierarchy';
import {
  createComfyViewportPromptRegionDeleteUpdate,
  createComfyViewportPromptRegion,
  getComfyViewportPromptRegionLabel,
} from './comfyViewportBindings';
import { getComfyInputPortName } from '../../portMapping';
import { getSelectedComfyWorkflowInputCandidates } from './comfyInputs';
import { getComfyGalleryEntriesForOutputDelete } from './comfyGalleryDeletion';

interface ComfyItemsPanelProps {
  node: AnyNode;
}

type ComfyHierarchyItemRef = { type: 'layer'; id: string } | { type: 'output'; id: string };

type ComfyHierarchyItem =
  | {
      type: 'layer';
      depth: number;
      layer: ViewportPromptRegion & { name: string };
      region: ViewportPromptRegion;
      children: ComfyHierarchyItem[];
    }
  | {
      type: 'output';
      depth: number;
      output: GeneratedOutput;
    };

type Row = FlatTreeRow<ComfyHierarchyItemRef> & {
  region?: ViewportPromptRegion;
  output?: GeneratedOutput;
};

type ComfyClipboardItem =
  | { type: 'region'; region: ViewportPromptRegion; outputs: GeneratedOutput[] }
  | { type: 'output'; output: GeneratedOutput };

const COMFY_ITEMS_CLIPBOARD_KIND = 'comfy-items';
const COMFY_ITEMS_CLIPBOARD_VERSION = 1 as const;
const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_REGIONS: ViewportPromptRegion[] = [];
const EMPTY_OUTPUTS: GeneratedOutput[] = [];
const ROW_CONTROL_DATA_ATTR = { 'data-comfy-row-control': 'true' };

const getOrderValue = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;

const createCopiedId = (prefix: 'region' | 'output'): string =>
  `comfy_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getOutputDisplayName = (output: GeneratedOutput): string =>
  output.label ?? (output.mediaKind === 'video' ? 'Comfy Video' : 'Comfy Output');

const formatRect = (region: ViewportPromptRegion): string =>
  `${Math.round(region.rect.width)} x ${Math.round(region.rect.height)} at ${Math.round(
    region.rect.x,
  )}, ${Math.round(region.rect.y)}`;

const getOutputPlacementLabel = (output: GeneratedOutput): string => {
  if (output.regionLabel) return output.regionLabel;
  if (output.regionRect) return 'Stored region';
  return 'Scene';
};

const shiftRect = (rect: ViewportPromptRegion['rect']): ViewportPromptRegion['rect'] => ({
  ...rect,
  x: rect.x + 16,
  y: rect.y + 16,
});

const getFallbackRegionRect = (node: ComfyNode): ViewportPromptRegion['rect'] => {
  const selectedRegion = (node.viewportPromptRegions ?? []).find(
    (region) => region.id === node.selectedViewportPromptRegionId,
  );
  if (selectedRegion) return shiftRect(selectedRegion.rect);

  const activeOutput = (node.generatedOutputs ?? []).find(
    (output) => output.id === node.activeGeneratedOutputId,
  );
  if (activeOutput?.regionRect) return shiftRect(activeOutput.regionRect);
  const firstRegion = node.viewportPromptRegions?.[0];
  if (firstRegion) return shiftRect(firstRegion.rect);
  return {
    x: 0,
    y: 0,
    width: Math.max(8, node.width || 512),
    height: Math.max(8, node.height || 512),
  };
};

const sortOutputs = (outputs: readonly GeneratedOutput[], allOutputs: readonly GeneratedOutput[]) =>
  [...outputs].sort((a, b) => {
    const aIndex = allOutputs.findIndex((output) => output.id === a.id);
    const bIndex = allOutputs.findIndex((output) => output.id === b.id);
    return (
      getOrderValue(a.stackOrder, aIndex < 0 ? 0 : aIndex) -
      getOrderValue(b.stackOrder, bIndex < 0 ? 0 : bIndex)
    );
  });

const getRootItems = (
  node: ComfyNode,
): Array<
  | { type: 'layer'; id: string; region: ViewportPromptRegion; stackOrder: number; index: number }
  | { type: 'output'; id: string; output: GeneratedOutput; stackOrder: number; index: number }
> => {
  const regions = node.viewportPromptRegions ?? [];
  const outputs = node.generatedOutputs ?? [];
  const liveRegionIds = new Set(regions.map((region) => region.id));

  return [
    ...regions.map((region, index) => ({
      type: 'layer' as const,
      id: region.id,
      region,
      stackOrder: getOrderValue(region.stackOrder, index),
      index,
    })),
    ...outputs
      .filter(
        (output) => !output.deletedAt && (!output.regionId || !liveRegionIds.has(output.regionId)),
      )
      .map((output, index) => ({
        type: 'output' as const,
        id: output.id,
        output,
        stackOrder: getOrderValue(output.stackOrder, regions.length + index),
        index: regions.length + index,
      })),
  ].sort((a, b) => a.stackOrder - b.stackOrder || a.index - b.index);
};

const getRegionOutputs = (node: ComfyNode, regionId: string): GeneratedOutput[] =>
  sortOutputs(
    (node.generatedOutputs ?? []).filter(
      (output) => !output.deletedAt && output.regionId === regionId,
    ),
    node.generatedOutputs ?? [],
  );

const buildComfyHierarchy = (node: ComfyNode): ComfyHierarchyItem[] =>
  getRootItems(node).map((item): ComfyHierarchyItem => {
    if (item.type === 'output') {
      return {
        type: 'output',
        depth: 0,
        output: item.output,
      };
    }

    const children = getRegionOutputs(node, item.region.id).map((output): ComfyHierarchyItem => {
      return {
        type: 'output',
        depth: 1,
        output,
      };
    });

    return {
      type: 'layer',
      depth: 0,
      layer: {
        ...item.region,
        name: getComfyViewportPromptRegionLabel(node.viewportPromptRegions, item.region.id),
      },
      region: item.region,
      children,
    };
  });

const getComfySiblingItems = (
  node: ComfyNode,
  parentRegionId: string | null,
): ComfyHierarchyItemRef[] => {
  if (parentRegionId === null) {
    return getRootItems(node).map((item) => ({ type: item.type, id: item.id }));
  }
  return getRegionOutputs(node, parentRegionId).map((output) => ({
    type: 'output',
    id: output.id,
  }));
};

const filterTopLevelRefs = (
  node: ComfyNode,
  refs: readonly ComfyHierarchyItemRef[],
): ComfyHierarchyItemRef[] => {
  const selectedRegionIds = new Set(
    refs.filter((ref) => ref.type === 'layer').map((ref) => ref.id),
  );
  return refs.filter((ref) => {
    if (ref.type === 'layer') return true;
    const output = (node.generatedOutputs ?? []).find((candidate) => candidate.id === ref.id);
    return !output?.regionId || !selectedRegionIds.has(output.regionId);
  });
};

const sameRef = (a: ComfyHierarchyItemRef, b: ComfyHierarchyItemRef): boolean =>
  a.type === b.type && a.id === b.id;

const includesRef = (refs: readonly ComfyHierarchyItemRef[], ref: ComfyHierarchyItemRef): boolean =>
  refs.some((candidate) => sameRef(candidate, ref));

const getRegionLabelForId = (regions: readonly ViewportPromptRegion[], regionId: string): string =>
  getComfyViewportPromptRegionLabel(regions, regionId);

const moveComfyHierarchyItems = (
  node: ComfyNode,
  items: readonly ComfyHierarchyItemRef[],
  targetRegionId: string | null,
  siblingIndex: number,
): Partial<ComfyNode> => {
  const movingRefs = filterTopLevelRefs(node, items);
  if (movingRefs.length === 0) return {};
  if (targetRegionId !== null && movingRefs.some((item) => item.type === 'layer')) return {};

  const regions = [...(node.viewportPromptRegions ?? [])];
  const outputs = (node.generatedOutputs ?? []).map((output) => ({ ...output }));
  const region = targetRegionId
    ? regions.find((candidate) => candidate.id === targetRegionId)
    : null;

  const updateOutputForParent = (output: GeneratedOutput, parentId: string | null) => {
    if (parentId === null) {
      output.regionId = undefined;
      output.regionLabel = undefined;
      output.regionRect = undefined;
      return;
    }

    const targetRegion = regions.find((candidate) => candidate.id === parentId);
    if (!targetRegion) return;
    output.regionId = targetRegion.id;
    output.regionLabel = getRegionLabelForId(regions, targetRegion.id);
    output.regionRect = targetRegion.rect;
  };

  if (targetRegionId === null) {
    const siblings = getComfySiblingItems(node, null).filter(
      (ref) => !includesRef(movingRefs, ref),
    );
    siblings.splice(Math.min(Math.max(0, siblingIndex), siblings.length), 0, ...movingRefs);
    siblings.forEach((ref, index) => {
      if (ref.type === 'layer') {
        const target = regions.find((candidate) => candidate.id === ref.id);
        if (target) target.stackOrder = index;
        return;
      }
      const target = outputs.find((candidate) => candidate.id === ref.id);
      if (target) {
        updateOutputForParent(target, null);
        target.stackOrder = index;
      }
    });
    return { viewportPromptRegions: regions, generatedOutputs: outputs };
  }

  if (!region) return {};
  const siblings = getComfySiblingItems(node, targetRegionId).filter(
    (ref) => !includesRef(movingRefs, ref),
  );
  const outputRefs = movingRefs.filter(
    (ref): ref is Extract<ComfyHierarchyItemRef, { type: 'output' }> => ref.type === 'output',
  );
  siblings.splice(Math.min(Math.max(0, siblingIndex), siblings.length), 0, ...outputRefs);
  siblings.forEach((ref, index) => {
    const target = outputs.find((candidate) => candidate.id === ref.id);
    if (!target) return;
    updateOutputForParent(target, targetRegionId);
    target.stackOrder = index;
  });
  return { viewportPromptRegions: regions, generatedOutputs: outputs };
};

const getOutputParentRegionId = (node: ComfyNode, output: GeneratedOutput): string | null => {
  if (!output.regionId) return null;
  return (node.viewportPromptRegions ?? []).some((region) => region.id === output.regionId)
    ? output.regionId
    : null;
};

function ComfyItemsPanel({ node: anyNode }: ComfyItemsPanelProps) {
  const node = anyNode as ComfyNode;
  const { updateNode, setHierarchySelection, syncComfyGeneratedOutputsWithGalleryEntries } =
    useEditorActions();
  const projectId = useEditorSelector((state) => state.projectId);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const selection = useEditorSelector((state) => state.hierarchySelections[node.id]);
  const selectedRegionIds = selection?.layerIds ?? EMPTY_STRING_ARRAY;
  const selectedOutputIds = selection?.itemIds ?? EMPTY_STRING_ARRAY;
  const selectedRegionIdSet = useMemo(() => new Set(selectedRegionIds), [selectedRegionIds]);
  const selectedOutputIdSet = useMemo(() => new Set(selectedOutputIds), [selectedOutputIds]);
  const regions = node.viewportPromptRegions ?? EMPTY_REGIONS;
  const outputs = useMemo(
    () => (node.generatedOutputs ?? EMPTY_OUTPUTS).filter((output) => !output.deletedAt),
    [node.generatedOutputs],
  );
  const workflow =
    node.workflows.find((candidate) => candidate.id === node.selectedWorkflowId) ??
    node.workflows[0] ??
    null;

  // Input port items — both connected and unconnected ports shown as locked items
  const inputPortItems = useMemo(() => {
    if (!workflow) {
      // No workflow selected: show any connected inputs from node.inputs
      if (!node.inputs) return [];
      return Object.entries(node.inputs)
        .filter(([portName]) => portName !== 'pipe')
        .map(([portName]) => ({
          id: portName,
          label: portName.charAt(0).toUpperCase() + portName.slice(1),
          portName,
          isConnected: true,
        }));
    }
    const inputCandidates = getSelectedComfyWorkflowInputCandidates(workflow);
    return inputCandidates.map((candidate) => {
      const portName = getComfyInputPortName(
        workflow.id,
        candidate,
        Object.keys(node.inputs ?? {}),
        { allowSingleReservedPort: inputCandidates.length === 1 },
      );
      const isConnected = !!node.inputs?.[portName] || !!node.workflowInputImages?.[portName];
      return {
        id: candidate.id,
        label: candidate.label,
        portName,
        isConnected,
      };
    });
  }, [node.inputs, node.workflowInputImages, workflow]);

  const connectedPortCount = useMemo(
    () => inputPortItems.filter((p) => p.isConnected).length,
    [inputPortItems],
  );

  const applyNodeUpdate = useCallback(
    (updates: Partial<ComfyNode>, withHistory = true) => {
      updateNode(node.id, updates as Record<string, unknown>, withHistory);
    },
    [node.id, updateNode],
  );

  const setSelection = useCallback(
    (nextSelection: { regionIds: string[]; outputIds: string[] }) => {
      setHierarchySelection(node.id, nextSelection.regionIds, nextSelection.outputIds);
    },
    [node.id, setHierarchySelection],
  );

  // Tracks which connected input port rows are hidden (locked items — show/hide but can't delete)
  // Stored on the node data so viewport rendering can respect the visibility state.
  const hiddenPortIds = useMemo(
    () => node.hiddenInputPortIds ?? EMPTY_STRING_ARRAY,
    [node.hiddenInputPortIds],
  );
  const prevWorkflowIdRef = useRef<string | undefined>(undefined);

  // Initialize port visibility: first connected port shown by default, rest hidden
  // Unconnected ports are always visible (dimmed) so users can see what's available
  useEffect(() => {
    const workflowId = workflow?.id;
    const connectedPorts = inputPortItems.filter((p) => p.isConnected);
    if (!connectedPorts.length) return;
    if (prevWorkflowIdRef.current !== workflowId) {
      prevWorkflowIdRef.current = workflowId;
      const initialHiddenPortIds: string[] = [];
      if (connectedPorts.length > 1) {
        initialHiddenPortIds.push(...connectedPorts.slice(1).map((p) => p.portName));
      }
      applyNodeUpdate({ hiddenInputPortIds: initialHiddenPortIds }, false);
    }
  }, [applyNodeUpdate, workflow?.id, inputPortItems]);

  const toggleInputPortVisibility = useCallback(
    (portName: string) => {
      const nextHidden = hiddenPortIds.includes(portName)
        ? hiddenPortIds.filter((id) => id !== portName)
        : [...hiddenPortIds, portName];
      applyNodeUpdate({ hiddenInputPortIds: nextHidden }, false);
    },
    [hiddenPortIds, applyNodeUpdate],
  );

  const hierarchy = useMemo(() => buildComfyHierarchy(node), [node]);
  const layerOptions = useMemo<LayerOption[]>(() => getLayerOptions(hierarchy), [hierarchy]);
  const { rows: flatHierarchy, keys: flatHierarchyKeys } = useMemo(
    () =>
      flattenHierarchy<ComfyHierarchyItemRef>(
        hierarchy,
        'output',
        (item: unknown): { id: string; name: string } | null => {
          const typed = item as ComfyHierarchyItem;
          return typed.type === 'output'
            ? { id: typed.output.id, name: getOutputDisplayName(typed.output) }
            : null;
        },
      ),
    [hierarchy],
  );
  const flatRows = useMemo<Row[]>(
    () =>
      flatHierarchy.map((row) => ({
        ...row,
        region:
          row.item.type === 'layer'
            ? regions.find((region) => region.id === row.item.id)
            : undefined,
        output:
          row.item.type === 'output'
            ? outputs.find((output) => output.id === row.item.id)
            : undefined,
      })),
    [flatHierarchy, outputs, regions],
  );
  const flatRowByKey = useMemo(() => new Map(flatRows.map((row) => [row.key, row])), [flatRows]);

  const selectedRegions = useMemo(
    () => regions.filter((region) => selectedRegionIdSet.has(region.id)),
    [regions, selectedRegionIdSet],
  );
  const selectedOutputs = useMemo(
    () => outputs.filter((output) => selectedOutputIdSet.has(output.id)),
    [outputs, selectedOutputIdSet],
  );
  const selectedItems = useMemo(
    () => [...selectedRegions, ...selectedOutputs],
    [selectedOutputs, selectedRegions],
  );
  const selectedItemCount = selectedItems.length;
  const selectedRegion =
    selectedRegions.length === 1 && selectedOutputs.length === 0 ? selectedRegions[0] : null;
  const hasItems = regions.length > 0 || outputs.length > 0 || inputPortItems.length > 0;

  const clearSelection = useCallback(() => {
    setSelection({ regionIds: [], outputIds: [] });
    applyNodeUpdate({ selectedViewportPromptRegionId: undefined }, false);
  }, [applyNodeUpdate, setSelection]);

  const handleSelectAll = useCallback(() => {
    setSelection({
      regionIds: regions.map((region) => region.id),
      outputIds: outputs.map((output) => output.id),
    });
  }, [outputs, regions, setSelection]);

  const selectRegion = useCallback(
    (regionId: string, extendSelection: boolean) => {
      if (extendSelection) {
        const nextRegionIds = selectedRegionIdSet.has(regionId)
          ? selectedRegionIds.filter((id) => id !== regionId)
          : [...selectedRegionIds, regionId];
        setSelection({ regionIds: nextRegionIds, outputIds: selectedOutputIds });
        applyNodeUpdate(
          { selectedViewportPromptRegionId: nextRegionIds[nextRegionIds.length - 1] },
          false,
        );
        return;
      }
      setSelection({ regionIds: [regionId], outputIds: [] });
      applyNodeUpdate({ selectedViewportPromptRegionId: regionId }, false);
    },
    [applyNodeUpdate, selectedOutputIds, selectedRegionIdSet, selectedRegionIds, setSelection],
  );

  const selectOutput = useCallback(
    (outputId: string, extendSelection: boolean) => {
      const output = outputs.find((candidate) => candidate.id === outputId);
      if (!output) return;
      if (extendSelection) {
        const nextOutputIds = selectedOutputIdSet.has(outputId)
          ? selectedOutputIds.filter((id) => id !== outputId)
          : [...selectedOutputIds, outputId];
        setSelection({ regionIds: selectedRegionIds, outputIds: nextOutputIds });
      } else {
        setSelection({
          regionIds: [],
          outputIds: [outputId],
        });
      }
      applyNodeUpdate(
        {
          activeGeneratedOutputId: output.id,
          selectedViewportPromptRegionId: output.regionId,
        },
        false,
      );
    },
    [
      applyNodeUpdate,
      outputs,
      selectedOutputIdSet,
      selectedOutputIds,
      selectedRegionIds,
      setSelection,
    ],
  );

  const rangeAnchorRef = useRef<string | null>(null);
  const handleItemSelect = useCallback(
    (rowKey: string, shiftKey: boolean, toggleKey: boolean) => {
      const separator = rowKey.indexOf(':');
      const type = rowKey.slice(0, separator);
      const id = rowKey.slice(separator + 1);

      if (shiftKey && rangeAnchorRef.current) {
        const start = flatHierarchyKeys.indexOf(rangeAnchorRef.current);
        const end = flatHierarchyKeys.indexOf(rowKey);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          const range = flatRows.slice(from, to + 1);
          setSelection({
            regionIds: range.filter((row) => row.item.type === 'layer').map((row) => row.item.id),
            outputIds: range.filter((row) => row.item.type === 'output').map((row) => row.item.id),
          });
          applyNodeUpdate(
            {
              selectedViewportPromptRegionId:
                range.find((row) => row.item.type === 'layer')?.item.id ?? undefined,
            },
            false,
          );
          return;
        }
      }

      rangeAnchorRef.current = rowKey;
      if (type === 'layer') selectRegion(id, toggleKey);
      if (type === 'output') selectOutput(id, toggleKey);
    },
    [applyNodeUpdate, flatHierarchyKeys, flatRows, selectOutput, selectRegion, setSelection],
  );

  const buildRegionLayer = useCallback(
    (rect?: ViewportPromptRegion['rect']) => {
      const nextRect = rect ?? getFallbackRegionRect(node);
      return {
        ...createComfyViewportPromptRegion(workflow, nextRect, node.viewportPromptRegionDefaults),
        visible: true,
        expanded: true,
        stackOrder: Math.max(-1, ...getRootItems(node).map((item) => item.stackOrder)) + 1,
      };
    },
    [node, workflow],
  );

  const createRegionLayer = useCallback(
    (rect?: ViewportPromptRegion['rect']) => {
      const region = buildRegionLayer(rect);
      applyNodeUpdate({
        viewportPromptRegions: [...regions, region],
        selectedViewportPromptRegionId: region.id,
      });
      setSelection({ regionIds: [region.id], outputIds: [] });
      return region;
    },
    [applyNodeUpdate, buildRegionLayer, regions, setSelection],
  );

  const moveOutputToRegion = useCallback(
    (outputId: string, regionId: string | null) => {
      const output = outputs.find((candidate) => candidate.id === outputId);
      if (!output) return;
      const updates = moveComfyHierarchyItems(
        node,
        [{ type: 'output', id: outputId }],
        regionId,
        getComfySiblingItems(node, regionId).length,
      );
      applyNodeUpdate(updates);
    },
    [applyNodeUpdate, node, outputs],
  );

  const moveOutputsToGalleryBin = useCallback(
    async (deletedOutputs: GeneratedOutput[], deletedAt: number) => {
      if (!projectId || deletedOutputs.length === 0) return;

      const entries = getComfyGalleryEntriesForOutputDelete({
        entries: await loadGalleryEntries(),
        outputs: deletedOutputs,
        scope: {
          projectId,
          branchId: activeProjectBranchId,
          nodeId: node.id,
        },
      });
      if (entries.length === 0) return;

      await softDeleteGalleryEntries(entries.map((entry) => entry.id));
      await syncComfyGeneratedOutputsWithGalleryEntries({
        entries,
        mode: 'soft-delete',
        deletedAt,
      });
    },
    [activeProjectBranchId, node.id, projectId, syncComfyGeneratedOutputsWithGalleryEntries],
  );

  const requestMoveOutputsToGalleryBin = useCallback(
    (deletedOutputs: GeneratedOutput[], deletedAt: number) => {
      void moveOutputsToGalleryBin(deletedOutputs, deletedAt).catch((error) => {
        console.warn('Could not move Comfy output gallery entries to the bin.', error);
      });
    },
    [moveOutputsToGalleryBin],
  );

  const deleteRegion = useCallback(
    (regionId: string) => {
      const update = createComfyViewportPromptRegionDeleteUpdate(node, [regionId]);
      if (!update) return;
      const deletedOutputs = outputs.filter((output) => output.regionId === regionId);
      clearSelection();
      applyNodeUpdate(update);
      requestMoveOutputsToGalleryBin(deletedOutputs, Date.now());
    },
    [applyNodeUpdate, clearSelection, node, outputs, requestMoveOutputsToGalleryBin],
  );

  const deleteOutput = useCallback(
    (outputId: string) => {
      const deletedAt = Date.now();
      const deletedOutput = outputs.find((output) => output.id === outputId);
      clearSelection();
      applyNodeUpdate({
        generatedOutputs: (node.generatedOutputs ?? []).map((output) =>
          output.id === outputId ? { ...output, deletedAt } : output,
        ),
        activeGeneratedOutputId:
          node.activeGeneratedOutputId === outputId ? undefined : node.activeGeneratedOutputId,
      });
      if (deletedOutput) requestMoveOutputsToGalleryBin([deletedOutput], deletedAt);
    },
    [
      applyNodeUpdate,
      clearSelection,
      node.activeGeneratedOutputId,
      node.generatedOutputs,
      outputs,
      requestMoveOutputsToGalleryBin,
    ],
  );

  const deleteSelected = useCallback(() => {
    if (selectedItemCount === 0) return;
    const selectedRegionIds = selectedRegions.map((region) => region.id);
    const deletedRegionIdSet = new Set(selectedRegionIds);
    const outputIdSet = new Set(selectedOutputs.map((output) => output.id));
    const deletedGalleryOutputs = outputs.filter(
      (output) =>
        outputIdSet.has(output.id) ||
        Boolean(output.regionId && deletedRegionIdSet.has(output.regionId)),
    );
    const regionDeleteUpdate = createComfyViewportPromptRegionDeleteUpdate(node, selectedRegionIds);
    const nextRegions = regionDeleteUpdate?.viewportPromptRegions ?? regions;
    const nextGeneratedOutputs =
      regionDeleteUpdate?.generatedOutputs ?? node.generatedOutputs ?? [];
    const nextActiveGeneratedOutputId =
      regionDeleteUpdate?.activeGeneratedOutputId ?? node.activeGeneratedOutputId;
    const now = Date.now();
    clearSelection();
    applyNodeUpdate({
      viewportPromptRegions: nextRegions,
      generatedOutputs: nextGeneratedOutputs.map((output) =>
        outputIdSet.has(output.id) ? { ...output, deletedAt: now } : output,
      ),
      selectedViewportPromptRegionId:
        regionDeleteUpdate?.selectedViewportPromptRegionId ?? node.selectedViewportPromptRegionId,
      activeGeneratedOutputId: outputIdSet.has(nextActiveGeneratedOutputId ?? '')
        ? undefined
        : nextActiveGeneratedOutputId,
    });
    requestMoveOutputsToGalleryBin(deletedGalleryOutputs, now);
  }, [
    applyNodeUpdate,
    clearSelection,
    node,
    outputs,
    requestMoveOutputsToGalleryBin,
    regions,
    selectedItemCount,
    selectedOutputs,
    selectedRegions,
  ]);

  const toggleRegionVisibility = useCallback(
    (regionId: string) => {
      const selectedTarget =
        selectedItemCount > 1 && selectedRegionIdSet.has(regionId)
          ? selectedRegions
          : regions.filter((region) => region.id === regionId);
      const nextVisible =
        selectedTarget.length > 0 && selectedTarget.every((region) => region.visible === false);
      applyNodeUpdate({
        viewportPromptRegions: regions.map((region) =>
          selectedTarget.some((target) => target.id === region.id)
            ? { ...region, visible: nextVisible }
            : region,
        ),
      });
    },
    [applyNodeUpdate, regions, selectedItemCount, selectedRegionIdSet, selectedRegions],
  );

  const toggleOutputVisibility = useCallback(
    (outputId: string) => {
      const selectedTarget =
        selectedItemCount > 1 && selectedOutputIdSet.has(outputId)
          ? selectedOutputs
          : outputs.filter((output) => output.id === outputId);
      const nextVisible =
        selectedTarget.length > 0 && selectedTarget.every((output) => output.visible === false);
      applyNodeUpdate({
        generatedOutputs: (node.generatedOutputs ?? []).map((output) =>
          selectedTarget.some((target) => target.id === output.id)
            ? { ...output, visible: nextVisible }
            : output,
        ),
      });
    },
    [
      applyNodeUpdate,
      node.generatedOutputs,
      outputs,
      selectedItemCount,
      selectedOutputIdSet,
      selectedOutputs,
    ],
  );

  const toggleSelectedVisibility = useCallback(() => {
    const nextVisible =
      selectedItems.length > 0 && selectedItems.every((item) => item.visible === false);
    applyNodeUpdate({
      viewportPromptRegions: regions.map((region) =>
        selectedRegionIdSet.has(region.id) ? { ...region, visible: nextVisible } : region,
      ),
      generatedOutputs: (node.generatedOutputs ?? []).map((output) =>
        selectedOutputIdSet.has(output.id) ? { ...output, visible: nextVisible } : output,
      ),
    });
  }, [
    applyNodeUpdate,
    node.generatedOutputs,
    regions,
    selectedItems,
    selectedOutputIdSet,
    selectedRegionIdSet,
  ]);

  const wrapSelectedOutputsInRegion = useCallback(() => {
    if (selectedOutputs.length === 0) return;
    const sourceRect = selectedOutputs[0].regionRect ?? getFallbackRegionRect(node);
    const region = buildRegionLayer(sourceRect);
    const updates = moveComfyHierarchyItems(
      { ...node, viewportPromptRegions: [...regions, region] },
      selectedOutputs.map((output) => ({ type: 'output', id: output.id })),
      region.id,
      0,
    );
    applyNodeUpdate({
      ...updates,
      selectedViewportPromptRegionId: region.id,
    });
    setSelection({ regionIds: [region.id], outputIds: [] });
  }, [applyNodeUpdate, buildRegionLayer, node, regions, selectedOutputs, setSelection]);

  const getDragItemsForRow = useCallback(
    (row: FlatTreeRow<ComfyHierarchyItemRef>) => {
      const isSelected =
        row.item.type === 'layer'
          ? selectedRegionIdSet.has(row.item.id)
          : selectedOutputIdSet.has(row.item.id);
      if (!isSelected || selectedItemCount <= 1) return [row.item];
      return filterTopLevelRefs(node, [
        ...selectedRegionIds.map((id) => ({ type: 'layer' as const, id })),
        ...selectedOutputIds.map((id) => ({ type: 'output' as const, id })),
      ]);
    },
    [
      node,
      selectedItemCount,
      selectedOutputIdSet,
      selectedOutputIds,
      selectedRegionIdSet,
      selectedRegionIds,
    ],
  );

  const {
    scrollViewportRef,
    treeContentRef,
    rowRefs,
    dropTarget,
    activeDraggedItemKeySet,
    activeDropHighlightLayerId,
    treeGuideSegments,
    handleRowPointerDown,
    handlePrimaryRowClick,
  } = useTreePanelState<ComfyHierarchyItemRef>({
    leafTypeName: 'output',
    hierarchy,
    flatHierarchy: flatRows,
    flatHierarchyKeys,
    getDragItemsForRow,
    getSiblingItems: (parentRegionId) => getComfySiblingItems(node, parentRegionId),
    canDropItemsToParent: (items, parentRegionId) =>
      parentRegionId === null || items.every((item) => item.type === 'output'),
    isContainerItem: (item) => item.type === 'layer',
    getContainerItemId: (item) => (item.type === 'layer' ? item.id : null),
    onHierarchyDrop: (items, target) => {
      applyNodeUpdate(
        moveComfyHierarchyItems(node, items, target.parentLayerId, target.siblingIndex),
      );
    },
    getHierarchyItemDepth: (item) => (item as ComfyHierarchyItem).depth,
    getHierarchyItemChildren: (item) =>
      (item as ComfyHierarchyItem).type === 'layer'
        ? (item as Extract<ComfyHierarchyItem, { type: 'layer' }>).children
        : [],
    isHierarchyItemExpanded: (item) =>
      (item as ComfyHierarchyItem).type !== 'layer' ||
      (item as Extract<ComfyHierarchyItem, { type: 'layer' }>).region.expanded !== false,
    getLeafId: (item) =>
      (item as ComfyHierarchyItem).type === 'output'
        ? (item as Extract<ComfyHierarchyItem, { type: 'output' }>).output.id
        : '',
    rowControlSelector: '[data-comfy-row-control="true"]',
  });

  const selectedVisibilityToggleLabel =
    selectedItems.length > 0 && selectedItems.every((item) => item.visible === false)
      ? 'Show Selected'
      : 'Hide Selected';

  const selectedOutputMoveTarget = useMemo(() => {
    if (selectedOutputs.length === 0) return undefined;
    const firstParent = getOutputParentRegionId(node, selectedOutputs[0]);
    return selectedOutputs.every((output) => getOutputParentRegionId(node, output) === firstParent)
      ? firstParent
      : undefined;
  }, [node, selectedOutputs]);

  const moveSelectedOutputs = useCallback(
    (targetRegionId: string | null) => {
      if (selectedOutputIds.length === 0) return;
      const updates = moveComfyHierarchyItems(
        node,
        selectedOutputIds.map((id) => ({ type: 'output', id })),
        targetRegionId,
        getComfySiblingItems(node, targetRegionId).length,
      );
      applyNodeUpdate(updates);
    },
    [applyNodeUpdate, node, selectedOutputIds],
  );

  const clipboardHotkeys = useMemo<StandardClipboardHandlers>(() => {
    const buildClipboardItems = (): ComfyClipboardItem[] => {
      const refs = filterTopLevelRefs(node, [
        ...selectedRegionIds.map((id) => ({ type: 'layer' as const, id })),
        ...selectedOutputIds.map((id) => ({ type: 'output' as const, id })),
      ]);
      return refs.flatMap((ref): ComfyClipboardItem[] => {
        if (ref.type === 'layer') {
          const region = regions.find((candidate) => candidate.id === ref.id);
          if (!region) return [];
          return [
            {
              type: 'region',
              region: structuredClone(region),
              outputs: getRegionOutputs(node, region.id).map((output) => structuredClone(output)),
            },
          ];
        }

        const output = outputs.find((candidate) => candidate.id === ref.id);
        return output ? [{ type: 'output', output: structuredClone(output) }] : [];
      });
    };

    const copy = () => {
      const items = buildClipboardItems();
      if (items.length === 0) return false;
      writeClipboard(COMFY_ITEMS_CLIPBOARD_KIND, COMFY_ITEMS_CLIPBOARD_VERSION, { items });
      return true;
    };

    const cut = () => {
      if (!copy()) return false;
      deleteSelected();
      return true;
    };

    const paste = () => {
      const clipboard = readClipboard<
        typeof COMFY_ITEMS_CLIPBOARD_KIND,
        { items: ComfyClipboardItem[] }
      >(COMFY_ITEMS_CLIPBOARD_KIND);
      if (!clipboard || clipboard.payload.items.length === 0) return false;

      const targetRegionId =
        selectedRegionIds.length === 1 && selectedOutputIds.length === 0
          ? selectedRegionIds[0]
          : selectedOutputMoveTarget === undefined
            ? null
            : selectedOutputMoveTarget;
      const nextRegions = [...regions];
      const nextOutputs = [...(node.generatedOutputs ?? [])];
      const selectedPastedRegionIds: string[] = [];
      const selectedPastedOutputIds: string[] = [];

      clipboard.payload.items.forEach((item, itemIndex) => {
        if (item.type === 'region') {
          const region = {
            ...structuredClone(item.region),
            id: createCopiedId('region'),
            rect: shiftRect(item.region.rect),
            visible: item.region.visible ?? true,
            expanded: true,
            stackOrder:
              Math.max(
                -1,
                ...getRootItems({ ...node, viewportPromptRegions: nextRegions }).map(
                  (entry) => entry.stackOrder,
                ),
              ) +
              1 +
              itemIndex,
          };
          nextRegions.push(region);
          selectedPastedRegionIds.push(region.id);
          item.outputs.forEach((output, outputIndex) => {
            const pastedOutput = {
              ...structuredClone(output),
              id: createCopiedId('output'),
              visible: output.visible ?? true,
              deletedAt: undefined,
              regionId: region.id,
              regionLabel: getRegionLabelForId(nextRegions, region.id),
              regionRect: region.rect,
              stackOrder: outputIndex,
            };
            nextOutputs.push(pastedOutput);
          });
          return;
        }

        const outputTargetRegion = targetRegionId
          ? nextRegions.find((region) => region.id === targetRegionId)
          : null;
        const pastedOutput = {
          ...structuredClone(item.output),
          id: createCopiedId('output'),
          visible: item.output.visible ?? true,
          deletedAt: undefined,
          regionId: outputTargetRegion?.id,
          regionLabel: outputTargetRegion
            ? getRegionLabelForId(nextRegions, outputTargetRegion.id)
            : undefined,
          regionRect: outputTargetRegion?.rect,
          stackOrder: getComfySiblingItems(
            { ...node, viewportPromptRegions: nextRegions, generatedOutputs: nextOutputs },
            outputTargetRegion?.id ?? null,
          ).length,
        };
        nextOutputs.push(pastedOutput);
        selectedPastedOutputIds.push(pastedOutput.id);
      });

      applyNodeUpdate({
        viewportPromptRegions: nextRegions,
        generatedOutputs: nextOutputs,
        selectedViewportPromptRegionId: selectedPastedRegionIds[0] ?? targetRegionId ?? undefined,
      });
      setSelection({ regionIds: selectedPastedRegionIds, outputIds: selectedPastedOutputIds });
      return true;
    };

    return { onCopy: copy, onCut: cut, onPaste: paste };
  }, [
    applyNodeUpdate,
    deleteSelected,
    node,
    outputs,
    regions,
    selectedOutputIds,
    selectedOutputMoveTarget,
    selectedRegionIds,
    setSelection,
  ]);

  const renderHierarchyItem = useCallback(
    (item: ComfyHierarchyItem, children: React.ReactNode | null) => {
      if (item.type === 'layer') {
        const rowKey = getHierarchyItemKey({ type: 'layer', id: item.region.id });
        const row = flatRowByKey.get(rowKey);
        const selectedChildCount = getRegionOutputs(node, item.region.id).filter((output) =>
          selectedOutputIdSet.has(output.id),
        ).length;
        return (
          <LayerRowShell
            layerName={getComfyViewportPromptRegionLabel(regions, item.region.id)}
            rowKey={rowKey}
            depth={item.depth}
            isSelected={selectedRegionIdSet.has(item.region.id)}
            selectedChildCount={selectedChildCount}
            isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
            isDropInsideTarget={activeDropHighlightLayerId === item.region.id}
            isVisible={item.region.visible !== false}
            isExpanded={item.region.expanded !== false}
            hasChildren={item.children.length > 0}
            itemCount={item.children.length}
            labelExtra={
              <span className="truncate text-[10px] text-gray-500">{formatRect(item.region)}</span>
            }
            createChildLayerLabel="New Region"
            showMoveMenu={false}
            rowControlDataAttr={ROW_CONTROL_DATA_ATTR}
            layerParentOptions={[]}
            parentLayerId={null}
            onToggleExpand={() =>
              applyNodeUpdate(
                {
                  viewportPromptRegions: regions.map((region) =>
                    region.id === item.region.id
                      ? { ...region, expanded: region.expanded === false }
                      : region,
                  ),
                },
                false,
              )
            }
            onSelectLayer={(extend) => selectRegion(item.region.id, extend)}
            onToggleVisibility={() => toggleRegionVisibility(item.region.id)}
            onCreateChildLayer={() => createRegionLayer(shiftRect(item.region.rect))}
            onMove={() => undefined}
            onDelete={() => deleteRegion(item.region.id)}
            onPointerDown={(event) => row && handleRowPointerDown(event, row)}
            onPrimaryClick={(event) =>
              row &&
              handlePrimaryRowClick(event, rowKey, (shiftKey, toggleKey) =>
                handleItemSelect(rowKey, shiftKey, toggleKey),
              )
            }
            rowRef={(element) => {
              if (element) rowRefs.current.set(rowKey, element);
              else rowRefs.current.delete(rowKey);
            }}
          >
            {children}
          </LayerRowShell>
        );
      }

      const rowKey = getHierarchyItemKey({ type: 'output', id: item.output.id });
      const row = flatRowByKey.get(rowKey);
      const parentRegionId = getOutputParentRegionId(node, item.output);
      return (
        <LeafItemRowShell
          itemName={getOutputDisplayName(item.output)}
          rowKey={rowKey}
          depth={item.depth}
          isSelected={selectedOutputIdSet.has(item.output.id)}
          isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
          isVisible={item.output.visible !== false}
          leadingIcon={<Icons.Photo className="h-3.5 w-3.5 flex-shrink-0" />}
          labelExtra={
            <span className="truncate text-[10px] text-gray-500">
              {Math.round(item.output.width)} x {Math.round(item.output.height)} ·{' '}
              {getOutputPlacementLabel(item.output)}
            </span>
          }
          rowControlDataAttr={ROW_CONTROL_DATA_ATTR}
          layerOptions={layerOptions}
          currentParentLayerId={parentRegionId}
          onSelect={(extend) => selectOutput(item.output.id, extend)}
          onToggleVisibility={() => toggleOutputVisibility(item.output.id)}
          onMove={(targetId) => moveOutputToRegion(item.output.id, targetId)}
          onDelete={() => deleteOutput(item.output.id)}
          onPointerDown={(event) => row && handleRowPointerDown(event, row)}
          onPrimaryClick={(event) =>
            row &&
            handlePrimaryRowClick(event, rowKey, (shiftKey, toggleKey) =>
              handleItemSelect(rowKey, shiftKey, toggleKey),
            )
          }
          rowRef={(element) => {
            if (element) rowRefs.current.set(rowKey, element);
            else rowRefs.current.delete(rowKey);
          }}
        />
      );
    },
    [
      activeDraggedItemKeySet,
      activeDropHighlightLayerId,
      applyNodeUpdate,
      createRegionLayer,
      deleteOutput,
      deleteRegion,
      flatRowByKey,
      handleItemSelect,
      handlePrimaryRowClick,
      handleRowPointerDown,
      layerOptions,
      moveOutputToRegion,
      node,
      regions,
      rowRefs,
      selectOutput,
      selectRegion,
      selectedOutputIdSet,
      selectedRegionIdSet,
      toggleOutputVisibility,
      toggleRegionVisibility,
    ],
  );

  return (
    <ItemsPanelLayout
      title="Items"
      subtitle={
        <>
          {countLabel(regions.length, 'region', 'regions')} /{' '}
          {countLabel(outputs.length, 'output', 'outputs')}
        </>
      }
      hasItems={hasItems}
      clipboardHotkeys={clipboardHotkeys}
      onDeleteSelected={selectedItemCount > 0 ? deleteSelected : undefined}
      onSelectAll={hasItems ? handleSelectAll : undefined}
      emptyState={
        <div className="max-w-[220px] rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-4 text-center text-xs text-gray-500">
          <p className="font-medium text-gray-300">No Comfy regions yet</p>
          <p className="mt-1">Use the crop tool to create regions, then run outputs into them.</p>
        </div>
      }
      headerActions={
        selectedItemCount > 0 ? (
          <div className={HEADER_SELECTION_CHIP_CLASS}>
            <button
              type="button"
              onClick={clearSelection}
              className={HEADER_SELECTION_ICON_BUTTON_CLASS}
              title="Clear selection"
              aria-label="Clear selection"
            >
              <Icons.XMark className="h-3 w-3" />
            </button>
            <div className="min-w-0 px-0.5 text-left">
              <div className="truncate font-medium text-gray-100">{selectedItemCount} selected</div>
            </div>
            {selectedOutputs.length > 0 ? (
              <button
                type="button"
                onClick={wrapSelectedOutputsInRegion}
                className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                title="Wrap selection in a new region"
                aria-label="Wrap selection in a new region"
              >
                <Icons.Bundle className="h-3 w-3" />
              </button>
            ) : null}
            <FloatingMenu
              widthClass="w-64"
              trigger={
                <button
                  type="button"
                  className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                  title="Selection actions"
                  aria-label="Selection actions"
                >
                  <Icons.EllipsisVertical className="h-3.5 w-3.5" />
                </button>
              }
            >
              {(close) => (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <MenuSectionLabel>Selection</MenuSectionLabel>
                    <MenuButton
                      icon={
                        selectedVisibilityToggleLabel === 'Show Selected' ? (
                          <Icons.Eye className="h-4 w-4" />
                        ) : (
                          <Icons.EyeSlash className="h-4 w-4" />
                        )
                      }
                      label={selectedVisibilityToggleLabel}
                      onClick={() => {
                        toggleSelectedVisibility();
                        close();
                      }}
                    />
                    {selectedRegion ? (
                      <MenuButton
                        icon={<LayerPlusIcon />}
                        label="New Region"
                        onClick={() => {
                          createRegionLayer(shiftRect(selectedRegion.rect));
                          close();
                        }}
                      />
                    ) : null}
                    {selectedOutputs.length > 0 ? (
                      <MenuButton
                        icon={<Icons.Bundle className="h-4 w-4" />}
                        label="Wrap In New Region"
                        onClick={() => {
                          wrapSelectedOutputsInRegion();
                          close();
                        }}
                      />
                    ) : null}
                  </div>
                  {selectedOutputs.length > 0 ? (
                    <>
                      <div className="h-px bg-white/10" />
                      <MoveMenuSection
                        label="Move Outputs To"
                        options={layerOptions}
                        currentValue={selectedOutputMoveTarget}
                        onMove={(targetId) => {
                          moveSelectedOutputs(targetId);
                          close();
                        }}
                        close={close}
                      />
                    </>
                  ) : null}
                  <div className="h-px bg-white/10" />
                  <MenuButton
                    icon={<Icons.Trash className="h-4 w-4" />}
                    label="Delete Selected"
                    danger
                    onClick={() => {
                      deleteSelected();
                      close();
                    }}
                  />
                </div>
              )}
            </FloatingMenu>
          </div>
        ) : (
          <div className="flex overflow-hidden rounded-md border border-white/10 bg-white/5 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => createRegionLayer()}
              className="flex items-center justify-center px-1.5 py-1 text-gray-300 transition hover:bg-white/10"
              title="Create region"
              aria-label="Create region"
            >
              <LayerPlusIcon />
            </button>
          </div>
        )
      }
    >
      {' '}
      <ItemsTreeView
        scrollViewportRef={scrollViewportRef}
        contentRef={treeContentRef}
        guideSegments={treeGuideSegments}
        dropIndicator={
          dropTarget ? { depth: dropTarget.indicatorDepth, top: dropTarget.indicatorTop } : null
        }
        onBackgroundClick={clearSelection}
      >
        <ItemsHierarchyRenderer
          items={hierarchy}
          getKey={(item: ComfyHierarchyItem) =>
            item.type === 'layer'
              ? getHierarchyItemKey({ type: 'layer', id: item.region.id })
              : getHierarchyItemKey({ type: 'output', id: item.output.id })
          }
          getChildren={(item: ComfyHierarchyItem) => (item.type === 'layer' ? item.children : [])}
          isExpanded={(item: ComfyHierarchyItem) =>
            item.type !== 'layer' || item.region.expanded !== false
          }
          renderItem={renderHierarchyItem}
        />
      </ItemsTreeView>
      {/* Input port items — locked: show/hide connected ports but can't delete */}
      {inputPortItems.length > 0 && (
        <div className="px-1 pb-1">
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Input Ports
            </span>
            <span className="text-[10px] text-gray-600">
              {connectedPortCount} / {inputPortItems.length} connected
            </span>
          </div>
          <div className="space-y-0.5">
            {inputPortItems.map((port) => {
              const isHidden = hiddenPortIds.includes(port.portName);
              const isDimmed = !port.isConnected;
              return (
                <div
                  key={port.id}
                  className={`group relative flex h-7 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition-all animate-[fadeIn_150ms_ease-out] ${
                    isHidden ? 'opacity-40' : isDimmed ? 'opacity-40' : ''
                  } text-gray-300 hover:bg-white/[0.04]`}
                  style={{ paddingLeft: '6px' }}
                >
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${
                      isDimmed ? 'text-gray-600' : 'text-gray-400'
                    }`}
                  >
                    <Icons.Link className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left">
                    <span
                      className={`truncate font-medium tracking-[0.01em] ${
                        isDimmed ? 'text-gray-500' : ''
                      }`}
                    >
                      {port.label}
                    </span>
                    {!port.isConnected && (
                      <span className="shrink-0 text-[10px] text-gray-600">empty</span>
                    )}
                  </div>
                  {port.isConnected ? (
                    <button
                      type="button"
                      onClick={() => toggleInputPortVisibility(port.portName)}
                      className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
                      title={isHidden ? `Show ${port.label}` : `Hide ${port.label}`}
                      aria-label={isHidden ? `Show ${port.label}` : `Hide ${port.label}`}
                    >
                      {isHidden ? (
                        <Icons.EyeSlash className="h-3.5 w-3.5" />
                      ) : (
                        <Icons.Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <div className="w-[22px]" />
                  )}
                  <div className="rounded-md p-1 text-gray-500" title="Locked — cannot be deleted">
                    <Icons.LockClosed className="h-3 w-3" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ItemsPanelLayout>
  );
}

export default ComfyItemsPanel;
