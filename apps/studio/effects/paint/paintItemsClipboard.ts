import { useCallback, useMemo } from 'react';
import type { PaintLayer, PaintNode, PaintStroke } from '@blackboard/types';
import { readItemsClipboard, writeItemsClipboard } from '@/utils/itemsClipboard';
import type { StandardClipboardHandlers } from '@/utils/standardClipboardHotkeys';
import { createUniqueItemNameAssigner } from '@/utils/uniqueItemName';
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

export type PaintClipboardTreeItem =
  | {
      type: 'layer';
      layer: PaintLayer;
      children: PaintClipboardTreeItem[];
    }
  | {
      type: 'stroke';
      stroke: PaintStroke;
    };

export interface PaintItemsClipboardPayload {
  items: PaintClipboardTreeItem[];
}

interface PaintPasteResult {
  layers: PaintLayer[];
  strokes: PaintStroke[];
  selectedLayerIds: string[];
  selectedStrokeIds: string[];
}

interface UsePaintItemsClipboardParams {
  node: PaintNode | null;
  selectedLayerIds: string[];
  selectedStrokeIds: string[];
  updateNode: (nodeId: string, updates: Partial<PaintNode>, withHistory?: boolean) => void;
  setSelectedPaintLayerIds: (ids: string[]) => void;
  setSelectedPaintStrokeIds: (ids: string[]) => void;
}

const getPaintItemKey = (item: PaintHierarchyItemRef): string => `${item.type}:${item.id}`;

const createCopiedPaintId = (prefix: 'layer' | 'stroke'): string =>
  `paint_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const buildSelectionRefs = (
  selectedLayerIds: readonly string[],
  selectedStrokeIds: readonly string[],
): PaintHierarchyItemRef[] => [
  ...selectedLayerIds.map((id) => ({ type: 'layer', id }) as const),
  ...selectedStrokeIds.map((id) => ({ type: 'stroke', id }) as const),
];

const clonePaintClipboardTreeItem = (item: PaintHierarchyItem): PaintClipboardTreeItem =>
  item.type === 'layer'
    ? {
        type: 'layer',
        layer: structuredClone(item.layer),
        children: item.children.map(clonePaintClipboardTreeItem),
      }
    : {
        type: 'stroke',
        stroke: structuredClone(item.stroke),
      };

export const buildPaintItemsClipboardPayload = (
  node: PaintNode,
  selectedLayerIds: readonly string[],
  selectedStrokeIds: readonly string[],
): PaintItemsClipboardPayload | null => {
  const selectedItems = filterTopLevelPaintHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedStrokeIds),
  );
  if (selectedItems.length === 0) {
    return null;
  }

  const selectedKeySet = new Set(selectedItems.map(getPaintItemKey));
  const collectSelectedRoots = (items: readonly PaintHierarchyItem[]): PaintClipboardTreeItem[] => {
    const collected: PaintClipboardTreeItem[] = [];

    items.forEach((item) => {
      const itemRef =
        item.type === 'layer'
          ? ({ type: 'layer', id: item.layer.id } as const)
          : ({ type: 'stroke', id: item.stroke.id } as const);

      if (selectedKeySet.has(getPaintItemKey(itemRef))) {
        collected.push(clonePaintClipboardTreeItem(item));
        return;
      }

      if (item.type === 'layer' && item.children.length > 0) {
        collected.push(...collectSelectedRoots(item.children));
      }
    });

    return collected;
  };

  const items = collectSelectedRoots(buildPaintHierarchy(node));
  return items.length > 0 ? { items } : null;
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
  if (selectedItems.length === 0) {
    return null;
  }

  const firstParentLayerId = getPaintItemParentLayerId(node, selectedItems[0]);
  return selectedItems.every((item) => getPaintItemParentLayerId(node, item) === firstParentLayerId)
    ? firstParentLayerId
    : null;
};

export const pastePaintItemsClipboardPayload = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  payload: PaintItemsClipboardPayload,
  targetParentLayerId: string | null,
): PaintPasteResult => {
  const nextLayers: PaintLayer[] = [];
  const nextStrokes: PaintStroke[] = [];
  const layerById = new Map<string, PaintLayer>();
  const strokeById = new Map<string, PaintStroke>();
  const siblingGroups = new Map<string | null, PaintHierarchyItemRef[]>();
  const assignLayerName = createUniqueItemNameAssigner(
    (node.layers ?? []).map((layer) => layer.name),
  );
  const assignStrokeName = createUniqueItemNameAssigner(node.strokes.map((stroke) => stroke.name));

  const pushSibling = (parentLayerId: string | null, item: PaintHierarchyItemRef) => {
    const currentItems = siblingGroups.get(parentLayerId) ?? [];
    currentItems.push(item);
    siblingGroups.set(parentLayerId, currentItems);
  };

  const cloneItem = (
    item: PaintClipboardTreeItem,
    parentLayerId: string | null,
  ): PaintHierarchyItemRef => {
    if (item.type === 'layer') {
      const clonedLayer: PaintLayer = {
        ...item.layer,
        id: createCopiedPaintId('layer'),
        name: assignLayerName(item.layer.name),
        parentLayerId,
      };
      delete clonedLayer.stackOrder;
      nextLayers.push(clonedLayer);
      layerById.set(clonedLayer.id, clonedLayer);
      const layerRef = { type: 'layer', id: clonedLayer.id } as const;
      pushSibling(parentLayerId, layerRef);
      item.children.forEach((child) => {
        cloneItem(child, clonedLayer.id);
      });
      return layerRef;
    }

    const clonedStroke: PaintStroke = {
      ...item.stroke,
      id: createCopiedPaintId('stroke'),
      name: assignStrokeName(item.stroke.name),
      parentLayerId,
    };
    delete clonedStroke.stackOrder;
    nextStrokes.push(clonedStroke);
    strokeById.set(clonedStroke.id, clonedStroke);
    const strokeRef = { type: 'stroke', id: clonedStroke.id } as const;
    pushSibling(parentLayerId, strokeRef);
    return strokeRef;
  };

  const topLevelItems = payload.items.map((item) => cloneItem(item, targetParentLayerId));

  siblingGroups.forEach((items) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const sibling = items[index];
      const stackOrder = getNextPaintStackOrder();

      if (sibling.type === 'layer') {
        const layer = layerById.get(sibling.id);
        if (layer) {
          layer.stackOrder = stackOrder;
        }
        continue;
      }

      const stroke = strokeById.get(sibling.id);
      if (stroke) {
        stroke.stackOrder = stackOrder;
      }
    }
  });

  return {
    layers: nextLayers,
    strokes: nextStrokes,
    selectedLayerIds: topLevelItems
      .filter(
        (item): item is Extract<PaintHierarchyItemRef, { type: 'layer' }> => item.type === 'layer',
      )
      .map((item) => item.id),
    selectedStrokeIds: topLevelItems
      .filter(
        (item): item is Extract<PaintHierarchyItemRef, { type: 'stroke' }> =>
          item.type === 'stroke',
      )
      .map((item) => item.id),
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
    return {
      layers: node.layers ?? [],
      strokes: node.strokes,
    };
  }

  let nextNode: PaintNode = {
    ...node,
    layers: node.layers ?? [],
    strokes: node.strokes,
  };
  const strokeIdsToDelete = new Set<string>();

  selectedItems.forEach((item) => {
    if (item.type === 'layer') {
      nextNode = {
        ...nextNode,
        ...deletePaintLayer(nextNode, item.id),
      };
      return;
    }

    strokeIdsToDelete.add(item.id);
  });

  if (strokeIdsToDelete.size > 0) {
    nextNode = {
      ...nextNode,
      strokes: nextNode.strokes.filter((stroke) => !strokeIdsToDelete.has(stroke.id)),
    };
  }

  return {
    layers: nextNode.layers,
    strokes: nextNode.strokes,
  };
};

export const usePaintItemsClipboard = ({
  node,
  selectedLayerIds,
  selectedStrokeIds,
  updateNode,
  setSelectedPaintLayerIds,
  setSelectedPaintStrokeIds,
}: UsePaintItemsClipboardParams): StandardClipboardHandlers => {
  const onCopy = useCallback(() => {
    if (!node) {
      return false;
    }

    const payload = buildPaintItemsClipboardPayload(node, selectedLayerIds, selectedStrokeIds);
    if (!payload) {
      return false;
    }

    writeItemsClipboard({
      kind: PAINT_ITEMS_CLIPBOARD_KIND,
      version: PAINT_ITEMS_CLIPBOARD_VERSION,
      payload,
    });
    return true;
  }, [node, selectedLayerIds, selectedStrokeIds]);

  const onCut = useCallback(() => {
    if (!node) {
      return false;
    }

    if (!onCopy()) {
      return false;
    }

    const updates = deleteSelectedPaintItems(node, selectedLayerIds, selectedStrokeIds);
    updateNode(node.id, updates, true);
    setSelectedPaintLayerIds([]);
    setSelectedPaintStrokeIds([]);
    return true;
  }, [
    node,
    onCopy,
    selectedLayerIds,
    selectedStrokeIds,
    setSelectedPaintLayerIds,
    setSelectedPaintStrokeIds,
    updateNode,
  ]);

  const onPaste = useCallback(() => {
    if (!node) {
      return false;
    }

    const clipboard = readItemsClipboard<
      typeof PAINT_ITEMS_CLIPBOARD_KIND,
      PaintItemsClipboardPayload
    >(PAINT_ITEMS_CLIPBOARD_KIND);
    if (!clipboard || clipboard.payload.items.length === 0) {
      return false;
    }

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
    setSelectedPaintLayerIds(pastedItems.selectedLayerIds);
    setSelectedPaintStrokeIds(pastedItems.selectedStrokeIds);
    return true;
  }, [
    node,
    selectedLayerIds,
    selectedStrokeIds,
    setSelectedPaintLayerIds,
    setSelectedPaintStrokeIds,
    updateNode,
  ]);

  return useMemo(
    () => ({
      onCopy,
      onCut,
      onPaste,
    }),
    [onCopy, onCut, onPaste],
  );
};
