import { useCallback, useMemo } from 'react';
import type { PaintLayer, PaintNode, PaintStroke } from '@blackboard/types';
import type { StandardClipboardHandlers } from '@/utils/standardClipboardHotkeys';
import {
  pasteClipboardItems,
  writeClipboard,
  readClipboard,
  type ClipboardTreeItem,
} from '@/utils/hierarchyClipboard';
import { getHierarchyItemKey } from '@/utils/hierarchyHelpers';
import {
  buildPaintHierarchy,
  deletePaintLayer,
  filterTopLevelPaintHierarchyItems,
  getNextPaintStackOrder,
  getPaintItemParentLayerId,
  type PaintHierarchyItem,
  type PaintHierarchyItemRef,
} from './paintLayers';

const PAINT_ITEMS_CLIPBOARD_VERSION = 1 as const;
export const PAINT_ITEMS_CLIPBOARD_KIND = 'paint-items';

export type PaintClipboardTreeItem = ClipboardTreeItem<PaintLayer, PaintStroke>;

interface UsePaintItemsClipboardParams {
  node: PaintNode | null;
  selectedLayerIds: string[];
  selectedStrokeIds: string[];
  updateNode: (nodeId: string, updates: Partial<PaintNode>, withHistory?: boolean) => void;
  onSetHierarchySelection: (layerIds: string[], itemIds: string[]) => void;
}

const createCopiedPaintId = (prefix: 'layer' | 'leaf'): string =>
  `${prefix === 'layer' ? 'paint_layer' : 'paint_stroke'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const paintHierarchyToClipboardItem = (item: PaintHierarchyItem): PaintClipboardTreeItem => {
  if (item.type === 'layer') {
    return {
      type: 'layer',
      layer: structuredClone(item.layer),
      children: item.children.map(paintHierarchyToClipboardItem),
    };
  }
  return {
    type: 'leaf',
    leaf: structuredClone(item.stroke),
  };
};

const buildSelectionRefs = (
  selectedLayerIds: readonly string[],
  selectedStrokeIds: readonly string[],
): PaintHierarchyItemRef[] => [
  ...selectedLayerIds.map((id) => ({ type: 'layer', id }) as const),
  ...selectedStrokeIds.map((id) => ({ type: 'stroke', id }) as const),
];

export const buildPaintItemsClipboardPayload = (
  node: PaintNode,
  selectedLayerIds: readonly string[],
  selectedStrokeIds: readonly string[],
): { items: PaintClipboardTreeItem[] } | null => {
  const selectedItems = filterTopLevelPaintHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedStrokeIds),
  );
  if (selectedItems.length === 0) return null;

  const selectedKeySet = new Set(selectedItems.map(getHierarchyItemKey));
  const hierarchy = buildPaintHierarchy(node);

  const collected: PaintClipboardTreeItem[] = [];
  const collectSelected = (items: readonly PaintHierarchyItem[]) => {
    items.forEach((item) => {
      const itemKey = getHierarchyItemKey({
        type: item.type,
        id: item.type === 'layer' ? item.layer.id : item.stroke.id,
      });

      if (selectedKeySet.has(itemKey)) {
        collected.push(paintHierarchyToClipboardItem(item));
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

const resolvePaintPasteTargetParent = (
  node: PaintNode,
  selectedLayerIds: readonly string[],
  selectedStrokeIds: readonly string[],
): string | null => {
  if (selectedLayerIds.length === 1 && selectedStrokeIds.length === 0) {
    return selectedLayerIds[0];
  }

  const selectedItems = filterTopLevelPaintHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedStrokeIds),
  );
  if (selectedItems.length === 0) return null;

  const firstParentLayerId = getPaintItemParentLayerId(node, selectedItems[0]);
  return selectedItems.every((item) => getPaintItemParentLayerId(node, item) === firstParentLayerId)
    ? firstParentLayerId
    : null;
};

export const pastePaintItemsClipboardPayload = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  payload: { items: PaintClipboardTreeItem[] },
  targetParentLayerId: string | null,
) => {
  const result = pasteClipboardItems(
    node.layers ?? [],
    node.strokes,
    payload.items,
    targetParentLayerId,
    createCopiedPaintId,
    getNextPaintStackOrder,
  );

  return {
    layers: result.layers as PaintLayer[],
    strokes: result.leaves as PaintStroke[],
    selectedLayerIds: result.selectedLayerIds,
    selectedStrokeIds: result.selectedLeafIds,
  };
};

const deleteSelectedPaintItems = (
  node: PaintNode,
  selectedLayerIds: readonly string[],
  selectedStrokeIds: readonly string[],
): Pick<PaintNode, 'layers' | 'strokes'> => {
  const selectedItems = filterTopLevelPaintHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedStrokeIds),
  );
  if (selectedItems.length === 0) {
    return { layers: node.layers ?? [], strokes: node.strokes };
  }

  let nextLayers = node.layers ?? [];
  let nextStrokes = node.strokes;
  const strokeIdsToDelete = new Set<string>();

  selectedItems.forEach((item) => {
    if (item.type === 'layer') {
      const result = deletePaintLayer(
        { ...node, layers: nextLayers, strokes: nextStrokes },
        item.id,
      );
      nextLayers = result.layers;
      nextStrokes = result.strokes;
      return;
    }
    strokeIdsToDelete.add(item.id);
  });

  if (strokeIdsToDelete.size > 0) {
    nextStrokes = nextStrokes.filter((stroke) => !strokeIdsToDelete.has(stroke.id));
  }

  return { layers: nextLayers, strokes: nextStrokes };
};

export const usePaintItemsClipboard = ({
  node,
  selectedLayerIds,
  selectedStrokeIds,
  updateNode,
  onSetHierarchySelection,
}: UsePaintItemsClipboardParams): StandardClipboardHandlers => {
  const onCopy = useCallback(() => {
    if (!node) return false;
    const payload = buildPaintItemsClipboardPayload(node, selectedLayerIds, selectedStrokeIds);
    if (!payload) return false;
    writeClipboard(PAINT_ITEMS_CLIPBOARD_KIND, PAINT_ITEMS_CLIPBOARD_VERSION, payload);
    return true;
  }, [node, selectedLayerIds, selectedStrokeIds]);

  const onCut = useCallback(() => {
    if (!node) return false;
    if (!onCopy()) return false;
    const updates = deleteSelectedPaintItems(node, selectedLayerIds, selectedStrokeIds);
    updateNode(node.id, updates, true);
    onSetHierarchySelection([], []);
    return true;
  }, [node, onCopy, selectedLayerIds, selectedStrokeIds, onSetHierarchySelection, updateNode]);

  const onPaste = useCallback(() => {
    if (!node) return false;
    const clipboard = readClipboard<
      typeof PAINT_ITEMS_CLIPBOARD_KIND,
      { items: PaintClipboardTreeItem[] }
    >(PAINT_ITEMS_CLIPBOARD_KIND);
    if (!clipboard || clipboard.payload.items.length === 0) return false;

    const pasteTargetParentLayerId = resolvePaintPasteTargetParent(
      node,
      selectedLayerIds,
      selectedStrokeIds,
    );
    const pastedItems = pastePaintItemsClipboardPayload(
      node,
      clipboard.payload,
      pasteTargetParentLayerId,
    );

    updateNode(
      node.id,
      {
        layers: [...pastedItems.layers, ...(node.layers ?? [])],
        strokes: [...pastedItems.strokes, ...node.strokes],
      },
      true,
    );
    onSetHierarchySelection(pastedItems.selectedLayerIds, pastedItems.selectedStrokeIds);
    return true;
  }, [node, selectedLayerIds, selectedStrokeIds, onSetHierarchySelection, updateNode]);

  return useMemo(() => ({ onCopy, onCut, onPaste }), [onCopy, onCut, onPaste]);
};
