import { useCallback, useMemo } from 'react';
import type { RotoLayer, RotoNode, RotoPath, RotoPointRef } from '@blackboard/types';
import { readItemsClipboard, writeItemsClipboard } from '@/utils/itemsClipboard';
import type { StandardClipboardHandlers } from '@/utils/standardClipboardHotkeys';
import { createUniqueItemNameAssigner } from '@/utils/uniqueItemName';
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

export type RotoClipboardTreeItem =
  | {
      type: 'layer';
      layer: RotoLayer;
      children: RotoClipboardTreeItem[];
    }
  | {
      type: 'path';
      path: RotoPath;
    };

export interface RotoItemsClipboardPayload {
  items: RotoClipboardTreeItem[];
}

interface RotoPasteResult {
  layers: RotoLayer[];
  paths: RotoPath[];
  selectedLayerIds: string[];
  selectedPathIds: string[];
}

interface UseRotoItemsClipboardParams {
  node: RotoNode | null;
  selectedLayerIds: string[];
  selectedPathIds: string[];
  selectedPointRefs?: RotoPointRef[];
  updateNode: (nodeId: string, updates: Partial<RotoNode>, withHistory?: boolean) => void;
  setSelectedRotoSelection: (selection: {
    layerIds: string[];
    pathIds: string[];
    pointRefs?: RotoPointRef[];
  }) => void;
  onInspectorLevelChange?: (level: string) => void;
}

const getRotoItemKey = (item: RotoHierarchyItemRef): string => `${item.type}:${item.id}`;

const createCopiedRotoId = (prefix: 'layer' | 'path'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const buildSelectionRefs = (
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): RotoHierarchyItemRef[] => [
  ...selectedLayerIds.map((id) => ({ type: 'layer', id }) as const),
  ...selectedPathIds.map((id) => ({ type: 'path', id }) as const),
];

const cloneRotoClipboardTreeItem = (item: RotoHierarchyItem): RotoClipboardTreeItem =>
  item.type === 'layer'
    ? {
        type: 'layer',
        layer: structuredClone(item.layer),
        children: item.children.map(cloneRotoClipboardTreeItem),
      }
    : {
        type: 'path',
        path: structuredClone(item.path),
      };

export const buildRotoItemsClipboardPayload = (
  node: RotoNode,
  selectedLayerIds: readonly string[],
  selectedPathIds: readonly string[],
): RotoItemsClipboardPayload | null => {
  const selectedItems = filterTopLevelRotoHierarchyItems(
    node,
    buildSelectionRefs(selectedLayerIds, selectedPathIds),
  );
  if (selectedItems.length === 0) {
    return null;
  }

  const selectedKeySet = new Set(selectedItems.map(getRotoItemKey));
  const collectSelectedRoots = (items: readonly RotoHierarchyItem[]): RotoClipboardTreeItem[] => {
    const collected: RotoClipboardTreeItem[] = [];

    items.forEach((item) => {
      const itemRef =
        item.type === 'layer'
          ? ({ type: 'layer', id: item.layer.id } as const)
          : ({ type: 'path', id: item.path.id } as const);

      if (selectedKeySet.has(getRotoItemKey(itemRef))) {
        collected.push(cloneRotoClipboardTreeItem(item));
        return;
      }

      if (item.type === 'layer' && item.children.length > 0) {
        collected.push(...collectSelectedRoots(item.children));
      }
    });

    return collected;
  };

  const items = collectSelectedRoots(buildRotoHierarchy(node));
  return items.length > 0 ? { items } : null;
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
  if (selectedItems.length === 0) {
    return null;
  }

  const firstParentLayerId = getRotoItemParentLayerId(node, selectedItems[0]);
  return selectedItems.every((item) => getRotoItemParentLayerId(node, item) === firstParentLayerId)
    ? firstParentLayerId
    : null;
};

export const pasteRotoItemsClipboardPayload = (
  node: Pick<RotoNode, 'layers' | 'paths'>,
  payload: RotoItemsClipboardPayload,
  targetParentLayerId: string | null,
): RotoPasteResult => {
  const nextLayers: RotoLayer[] = [];
  const nextPaths: RotoPath[] = [];
  const layerById = new Map<string, RotoLayer>();
  const pathById = new Map<string, RotoPath>();
  const siblingGroups = new Map<string | null, RotoHierarchyItemRef[]>();
  const assignLayerName = createUniqueItemNameAssigner(
    (node.layers ?? []).map((layer) => layer.name),
  );
  const assignPathName = createUniqueItemNameAssigner(node.paths.map((path) => path.name));

  const pushSibling = (parentLayerId: string | null, item: RotoHierarchyItemRef) => {
    const currentItems = siblingGroups.get(parentLayerId) ?? [];
    currentItems.push(item);
    siblingGroups.set(parentLayerId, currentItems);
  };

  const cloneItem = (
    item: RotoClipboardTreeItem,
    parentLayerId: string | null,
  ): RotoHierarchyItemRef => {
    if (item.type === 'layer') {
      const clonedLayer: RotoLayer = {
        ...item.layer,
        id: createCopiedRotoId('layer'),
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

    const clonedPath: RotoPath = {
      ...item.path,
      id: createCopiedRotoId('path'),
      name: assignPathName(item.path.name),
      parentLayerId,
    };
    delete clonedPath.stackOrder;
    nextPaths.push(clonedPath);
    pathById.set(clonedPath.id, clonedPath);
    const pathRef = { type: 'path', id: clonedPath.id } as const;
    pushSibling(parentLayerId, pathRef);
    return pathRef;
  };

  const topLevelItems = payload.items.map((item) => cloneItem(item, targetParentLayerId));

  siblingGroups.forEach((items) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const sibling = items[index];
      const stackOrder = getNextRotoStackOrder();

      if (sibling.type === 'layer') {
        const layer = layerById.get(sibling.id);
        if (layer) {
          layer.stackOrder = stackOrder;
        }
        continue;
      }

      const path = pathById.get(sibling.id);
      if (path) {
        path.stackOrder = stackOrder;
      }
    }
  });

  return {
    layers: nextLayers,
    paths: nextPaths,
    selectedLayerIds: topLevelItems
      .filter(
        (item): item is Extract<RotoHierarchyItemRef, { type: 'layer' }> => item.type === 'layer',
      )
      .map((item) => item.id),
    selectedPathIds: topLevelItems
      .filter(
        (item): item is Extract<RotoHierarchyItemRef, { type: 'path' }> => item.type === 'path',
      )
      .map((item) => item.id),
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
    return {
      layers: node.layers ?? [],
      paths: node.paths,
    };
  }

  let nextNode: RotoNode = {
    ...node,
    layers: node.layers ?? [],
    paths: node.paths,
  };
  const pathIdsToDelete = new Set<string>();

  selectedItems.forEach((item) => {
    if (item.type === 'layer') {
      nextNode = {
        ...nextNode,
        ...deleteRotoLayer(nextNode, item.id),
      };
      return;
    }

    pathIdsToDelete.add(item.id);
  });

  if (pathIdsToDelete.size > 0) {
    nextNode = {
      ...nextNode,
      paths: nextNode.paths.filter((path) => !pathIdsToDelete.has(path.id)),
    };
  }

  return {
    layers: nextNode.layers,
    paths: nextNode.paths,
  };
};

const getRotoInspectorLevel = (layerIds: readonly string[], pathIds: readonly string[]): string => {
  if (layerIds.length === 1 && pathIds.length === 0) {
    return 'layer';
  }

  if (layerIds.length === 0 && pathIds.length === 1) {
    return 'shape';
  }

  return 'node';
};

export const useRotoItemsClipboard = ({
  node,
  selectedLayerIds,
  selectedPathIds,
  selectedPointRefs = [],
  updateNode,
  setSelectedRotoSelection,
  onInspectorLevelChange,
}: UseRotoItemsClipboardParams): StandardClipboardHandlers => {
  const hasPointSelection = selectedPointRefs.length > 0;

  const onCopy = useCallback(() => {
    if (!node || hasPointSelection) {
      return false;
    }

    const payload = buildRotoItemsClipboardPayload(node, selectedLayerIds, selectedPathIds);
    if (!payload) {
      return false;
    }

    writeItemsClipboard({
      kind: ROTO_ITEMS_CLIPBOARD_KIND,
      version: ROTO_ITEMS_CLIPBOARD_VERSION,
      payload,
    });
    return true;
  }, [hasPointSelection, node, selectedLayerIds, selectedPathIds]);

  const onCut = useCallback(() => {
    if (!node) {
      return false;
    }

    if (!onCopy()) {
      return false;
    }

    const updates = deleteSelectedRotoItems(node, selectedLayerIds, selectedPathIds);
    updateNode(node.id, updates, true);
    setSelectedRotoSelection({ layerIds: [], pathIds: [] });
    onInspectorLevelChange?.('node');
    return true;
  }, [
    node,
    onCopy,
    onInspectorLevelChange,
    selectedLayerIds,
    selectedPathIds,
    setSelectedRotoSelection,
    updateNode,
  ]);

  const onPaste = useCallback(() => {
    if (!node) {
      return false;
    }

    const clipboard = readItemsClipboard<
      typeof ROTO_ITEMS_CLIPBOARD_KIND,
      RotoItemsClipboardPayload
    >(ROTO_ITEMS_CLIPBOARD_KIND);
    if (!clipboard || clipboard.payload.items.length === 0) {
      return false;
    }

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
    setSelectedRotoSelection({
      layerIds: pastedItems.selectedLayerIds,
      pathIds: pastedItems.selectedPathIds,
    });
    onInspectorLevelChange?.(
      getRotoInspectorLevel(pastedItems.selectedLayerIds, pastedItems.selectedPathIds),
    );
    return true;
  }, [
    node,
    onInspectorLevelChange,
    selectedLayerIds,
    selectedPathIds,
    setSelectedRotoSelection,
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
