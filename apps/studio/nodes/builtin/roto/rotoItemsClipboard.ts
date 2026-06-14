import { useCallback, useMemo } from 'react';
import type { RotoLayer, RotoNode, RotoPath, RotoPointRef } from '@blackboard/types';
import type { StandardClipboardHandlers } from '@/utils/standardClipboardHotkeys';
import {
  pasteClipboardItems,
  writeClipboard,
  readClipboard,
  type ClipboardTreeItem,
} from '@/utils/hierarchyClipboard';
import { getHierarchyItemKey } from '@/utils/hierarchyHelpers';
import {
  buildRotoHierarchy,
  deleteRotoLayer,
  filterTopLevelRotoHierarchyItems,
  getNextRotoStackOrder,
  getRotoItemParentLayerId,
  type RotoHierarchyItem,
  type RotoHierarchyItemRef,
} from '@/utils/rotoHierarchy';

const ROTO_ITEMS_CLIPBOARD_VERSION = 1 as const;
export const ROTO_ITEMS_CLIPBOARD_KIND = 'roto-items';

export type RotoClipboardTreeItem = ClipboardTreeItem<RotoLayer, RotoPath>;

interface UseRotoItemsClipboardParams {
  node: RotoNode | null;
  selectedLayerIds: string[];
  selectedPathIds: string[];
  selectedPointRefs?: RotoPointRef[];
  updateNode: (nodeId: string, updates: Partial<RotoNode>, withHistory?: boolean) => void;
  onSetHierarchySelection: (layerIds: string[], itemIds: string[]) => void;
  onInspectorLevelChange?: (level: string) => void;
}

const createCopiedRotoId = (prefix: 'layer' | 'leaf'): string =>
  `${prefix === 'layer' ? 'layer' : 'path'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Convert a RotoHierarchyItem to a ClipboardTreeItem for clipboard payload building
const rotoHierarchyToClipboardItem = (item: RotoHierarchyItem): RotoClipboardTreeItem => {
  if (item.type === 'layer') {
    return {
      type: 'layer',
      layer: structuredClone(item.layer),
      children: item.children.map(rotoHierarchyToClipboardItem),
    };
  }
  return {
    type: 'leaf',
    leaf: structuredClone(item.path),
  };
};

const buildSelectionRefs = (
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): RotoHierarchyItemRef[] => [
  ...selectedLayerIds.map((id) => ({ type: 'layer', id }) as const),
  ...selectedPathIds.map((id) => ({ type: 'path', id }) as const),
];

export const buildRotoItemsClipboardPayload = (
  node: RotoNode,
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): { items: RotoClipboardTreeItem[] } | null => {
  const selectedItems = filterTopLevelRotoHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedPathIds),
  );
  if (selectedItems.length === 0) return null;

  const selectedKeySet = new Set(selectedItems.map(getHierarchyItemKey));
  const hierarchy = buildRotoHierarchy(node);

  // Collect selected roots from hierarchy, converting to clipboard format
  // Need to handle the fact that buildClipboardPayload expects ClipboardTreeItem[]
  const collected: RotoClipboardTreeItem[] = [];
  const collectSelected = (items: readonly RotoHierarchyItem[]) => {
    items.forEach((item) => {
      const itemKey = getHierarchyItemKey({
        type: item.type,
        id: item.type === 'layer' ? item.layer.id : item.path.id,
      });

      if (selectedKeySet.has(itemKey)) {
        collected.push(rotoHierarchyToClipboardItem(item));
        return;
      }

      if (item.type === 'layer' && item.children.length > 0) {
        collectSelected(item.children);
      }
    });
  };

  collectSelected(hierarchy);
  return collected.length > 0 ? { items: collected } : null;
};

const resolveRotoPasteTargetParent = (
  node: RotoNode,
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): string | null => {
  if (selectedLayerIds.length === 1 && selectedPathIds.length === 0) {
    return selectedLayerIds[0];
  }

  const selectedItems = filterTopLevelRotoHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedPathIds),
  );
  if (selectedItems.length === 0) return null;

  const firstParentLayerId = getRotoItemParentLayerId(node, selectedItems[0]);
  return selectedItems.every((item) => getRotoItemParentLayerId(node, item) === firstParentLayerId)
    ? firstParentLayerId
    : null;
};

export const pasteRotoItemsClipboardPayload = (
  node: Pick<RotoNode, 'layers' | 'paths'>,
  payload: { items: RotoClipboardTreeItem[] },
  targetParentLayerId: string | null,
) => {
  const result = pasteClipboardItems(
    node.layers ?? [],
    node.paths,
    payload.items,
    targetParentLayerId,
    createCopiedRotoId,
    getNextRotoStackOrder,
  );

  return {
    layers: result.layers as RotoLayer[],
    paths: result.leaves as RotoPath[],
    selectedLayerIds: result.selectedLayerIds,
    selectedPathIds: result.selectedLeafIds,
  };
};

const deleteSelectedRotoItems = (
  node: RotoNode,
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): Pick<RotoNode, 'layers' | 'paths'> => {
  const selectedItems = filterTopLevelRotoHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedPathIds),
  );
  if (selectedItems.length === 0) {
    return { layers: node.layers ?? [], paths: node.paths };
  }

  let nextLayers = node.layers ?? [];
  let nextPaths = node.paths;
  const pathIdsToDelete = new Set<string>();

  selectedItems.forEach((item) => {
    if (item.type === 'layer') {
      const result = deleteRotoLayer({ ...node, layers: nextLayers }, item.id);
      nextLayers = result.layers;
      nextPaths = result.paths;
      return;
    }
    pathIdsToDelete.add(item.id);
  });

  if (pathIdsToDelete.size > 0) {
    nextPaths = nextPaths.filter((path) => !pathIdsToDelete.has(path.id));
  }

  return { layers: nextLayers, paths: nextPaths };
};

const getRotoInspectorLevel = (layerIds: readonly string[], pathIds: readonly string[]): string => {
  if (layerIds.length === 1 && pathIds.length === 0) return 'layer';
  if (layerIds.length === 0 && pathIds.length === 1) return 'shape';
  return 'node';
};

export const useRotoItemsClipboard = ({
  node,
  selectedLayerIds,
  selectedPathIds,
  selectedPointRefs = [],
  updateNode,
  onSetHierarchySelection,
  onInspectorLevelChange,
}: UseRotoItemsClipboardParams): StandardClipboardHandlers => {
  const hasPointSelection = selectedPointRefs.length > 0;

  const onCopy = useCallback(() => {
    if (!node || hasPointSelection) return false;
    const payload = buildRotoItemsClipboardPayload(node, selectedLayerIds, selectedPathIds);
    if (!payload) return false;
    writeClipboard(ROTO_ITEMS_CLIPBOARD_KIND, ROTO_ITEMS_CLIPBOARD_VERSION, payload);
    return true;
  }, [hasPointSelection, node, selectedLayerIds, selectedPathIds]);

  const onCut = useCallback(() => {
    if (!node) return false;
    if (!onCopy()) return false;
    const updates = deleteSelectedRotoItems(node, selectedLayerIds, selectedPathIds);
    updateNode(node.id, updates, true);
    onSetHierarchySelection([], []);
    onInspectorLevelChange?.('node');
    return true;
  }, [
    node,
    onCopy,
    onInspectorLevelChange,
    selectedLayerIds,
    selectedPathIds,
    onSetHierarchySelection,
    updateNode,
  ]);

  const onPaste = useCallback(() => {
    if (!node) return false;
    const clipboard = readClipboard<
      typeof ROTO_ITEMS_CLIPBOARD_KIND,
      { items: RotoClipboardTreeItem[] }
    >(ROTO_ITEMS_CLIPBOARD_KIND);
    if (!clipboard || clipboard.payload.items.length === 0) return false;

    const pasteTargetParentLayerId = resolveRotoPasteTargetParent(
      node,
      selectedLayerIds,
      selectedPathIds,
    );
    const pastedItems = pasteRotoItemsClipboardPayload(
      node,
      clipboard.payload,
      pasteTargetParentLayerId,
    );

    updateNode(
      node.id,
      {
        layers: [...pastedItems.layers, ...(node.layers ?? [])],
        paths: [...pastedItems.paths, ...node.paths],
      },
      true,
    );
    onSetHierarchySelection(pastedItems.selectedLayerIds, pastedItems.selectedPathIds);
    onInspectorLevelChange?.(
      getRotoInspectorLevel(pastedItems.selectedLayerIds, pastedItems.selectedPathIds),
    );
    return true;
  }, [
    node,
    onInspectorLevelChange,
    selectedLayerIds,
    selectedPathIds,
    onSetHierarchySelection,
    updateNode,
  ]);

  return useMemo(() => ({ onCopy, onCut, onPaste }), [onCopy, onCut, onPaste]);
};
