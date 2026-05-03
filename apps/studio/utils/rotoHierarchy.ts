import type { RotoLayer, RotoNode, RotoPath } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';

let lastRotoStackOrder = 0;

export const getNextRotoStackOrder = (): number => {
  const now = Date.now();
  lastRotoStackOrder = Math.max(now, lastRotoStackOrder + 1);
  return lastRotoStackOrder;
};

const getLegacyRotoStackOrder = (id: string): number | null => {
  const timestamp = id.match(/\d{6,}/g)?.at(-1);
  if (!timestamp) return null;

  const parsedTimestamp = Number(timestamp);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
};

const getRotoItemStackOrder = (item: Pick<RotoLayer, 'id' | 'stackOrder'>): number | null =>
  item.stackOrder ?? getLegacyRotoStackOrder(item.id);

const normalizeLayerParentId = (
  layer: Pick<RotoLayer, 'id' | 'parentLayerId'>,
  validLayerIds: Set<string>,
): string | null => {
  const parentId = layer.parentLayerId ?? null;
  if (!parentId || parentId === layer.id || !validLayerIds.has(parentId)) {
    return null;
  }
  return parentId;
};

const normalizePathParentId = (
  path: Pick<RotoPath, 'parentLayerId'>,
  validLayerIds: Set<string>,
): string | null => {
  const parentId = path.parentLayerId ?? null;
  if (!parentId || !validLayerIds.has(parentId)) {
    return null;
  }
  return parentId;
};

export const getRotoLayers = (node: RotoNode): RotoLayer[] => {
  const rawLayers = Array.isArray(node.layers) ? node.layers : [];
  const validLayerIds = new Set(rawLayers.map((layer) => layer.id));

  return rawLayers.map((layer) => ({
    ...layer,
    parentLayerId: normalizeLayerParentId(layer, validLayerIds),
    visible: layer.visible !== false,
    expanded: layer.expanded !== false,
  }));
};

export const getRotoLayerMap = (node: RotoNode): Map<string, RotoLayer> =>
  new Map(getRotoLayers(node).map((layer) => [layer.id, layer]));

export const getRotoPathParentLayerId = (node: RotoNode, path: RotoPath): string | null =>
  normalizePathParentId(path, new Set(getRotoLayers(node).map((layer) => layer.id)));

const getResolvedRotoLayerVisibilityMap = (
  layerMap: ReadonlyMap<string, RotoLayer>,
): Map<string, boolean> => {
  const visibilityMap = new Map<string, boolean>();

  const resolveLayerVisibility = (layerId: string | null | undefined): boolean => {
    if (!layerId) return true;
    if (visibilityMap.has(layerId)) return visibilityMap.get(layerId) ?? true;

    const layer = layerMap.get(layerId);
    if (!layer) return true;

    const isVisible =
      layer.visible !== false && resolveLayerVisibility(layer.parentLayerId ?? null);
    visibilityMap.set(layerId, isVisible);
    return isVisible;
  };

  layerMap.forEach((_, layerId) => {
    resolveLayerVisibility(layerId);
  });

  return visibilityMap;
};

export const getVisibleRotoPaths = (node: RotoNode): RotoPath[] => {
  const layerMap = getRotoLayerMap(node);
  const layerVisibilityMap = getResolvedRotoLayerVisibilityMap(layerMap);

  return node.paths.filter((path) => {
    if (path.visible === false) return false;

    const parentLayerId =
      path.parentLayerId && layerMap.has(path.parentLayerId) ? path.parentLayerId : null;
    return !parentLayerId || layerVisibilityMap.get(parentLayerId) !== false;
  });
};

export const getRotoHierarchyStructureSignature = (node: RotoNode): string => {
  const layers = getRotoLayers(node);

  return [
    layers
      .map((layer) =>
        [
          layer.id,
          layer.name,
          layer.parentLayerId ?? '',
          layer.visible === false ? '0' : '1',
          layer.expanded === false ? '0' : '1',
          layer.stackOrder ?? '',
        ].join('|'),
      )
      .join('||'),
    node.paths
      .map((path) =>
        [
          path.id,
          path.name,
          path.parentLayerId ?? '',
          path.visible === false ? '0' : '1',
          path.shapeType,
          path.stackOrder ?? '',
        ].join('|'),
      )
      .join('||'),
  ].join('###');
};

export const isRotoLayerVisible = (node: RotoNode, layerId: string | null | undefined): boolean => {
  if (!layerId) return true;

  const layerMap = getRotoLayerMap(node);
  let currentLayerId: string | null = layerId;
  const visited = new Set<string>();

  while (currentLayerId && !visited.has(currentLayerId)) {
    visited.add(currentLayerId);
    const layer = layerMap.get(currentLayerId);
    if (!layer) return true;
    if (layer.visible === false) return false;
    currentLayerId = layer.parentLayerId ?? null;
  }

  return true;
};

export const isRotoPathVisible = (node: RotoNode, path: RotoPath): boolean => {
  if (path.visible === false) return false;
  return isRotoLayerVisible(node, getRotoPathParentLayerId(node, path));
};

export const isRotoPathActiveAtFrame = (node: RotoNode, path: RotoPath, frame: number): boolean => {
  if (!isRotoPathVisible(node, path)) return false;
  return getValueAtFrame(path.opacity, frame) > 0;
};

const getDescendantLayerIds = (
  node: RotoNode,
  layerId: string,
  visited: Set<string> = new Set(),
): Set<string> => {
  const descendantIds = new Set<string>();
  if (visited.has(layerId)) return descendantIds;

  visited.add(layerId);
  const layers = getRotoLayers(node);
  const directChildren = layers.filter((layer) => layer.parentLayerId === layerId);
  directChildren.forEach((layer) => {
    descendantIds.add(layer.id);
    getDescendantLayerIds(node, layer.id, visited).forEach((id) => descendantIds.add(id));
  });

  return descendantIds;
};

export const getRotoLayerPathIds = (node: RotoNode, layerId: string): string[] => {
  const layerIds = getDescendantLayerIds(node, layerId);
  layerIds.add(layerId);

  return node.paths
    .filter((path) => {
      const parentLayerId = getRotoPathParentLayerId(node, path);
      return !!parentLayerId && layerIds.has(parentLayerId);
    })
    .map((path) => path.id);
};

export const getCommonRotoParentLayerId = (
  node: RotoNode,
  pathIds: readonly string[],
): string | null => {
  const selectedPaths = node.paths.filter((path) => pathIds.includes(path.id));
  if (selectedPaths.length === 0) return null;

  const firstParentLayerId = getRotoPathParentLayerId(node, selectedPaths[0]);
  return selectedPaths.every((path) => getRotoPathParentLayerId(node, path) === firstParentLayerId)
    ? firstParentLayerId
    : null;
};

export const getRotoCreationParentLayerId = (
  node: RotoNode,
  selectedLayerIds: readonly string[] = [],
  selectedPathIds: readonly string[] = [],
): string | null => {
  const layerMap = getRotoLayerMap(node);
  const validSelectedLayerIds = [...new Set(selectedLayerIds)].filter((layerId) =>
    layerMap.has(layerId),
  );

  if (validSelectedLayerIds.length === 1) {
    return validSelectedLayerIds[0];
  }

  return selectedPathIds.length > 0 ? getCommonRotoParentLayerId(node, selectedPathIds) : null;
};

const createRotoId = (prefix: 'layer') =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const getNextRotoLayerName = (node: RotoNode): string => {
  const existingNames = new Set(getRotoLayers(node).map((layer) => layer.name.toLowerCase()));
  let index = 1;
  while (existingNames.has(`layer ${index}`)) {
    index += 1;
  }
  return `Layer ${index}`;
};

export const createRotoLayer = (name: string, parentLayerId: string | null = null): RotoLayer => ({
  id: createRotoId('layer'),
  name,
  parentLayerId,
  stackOrder: getNextRotoStackOrder(),
  visible: true,
  expanded: true,
});

const createRotoHierarchyItemRefs = (
  type: RotoHierarchyItemRef['type'],
  ids: readonly string[],
): RotoHierarchyItemRef[] => ids.map((id) => ({ type, id }));

export const moveRotoPathsToLayer = (
  node: RotoNode,
  pathIds: readonly string[],
  parentLayerId: string | null,
): Pick<RotoNode, 'paths'> => {
  const validLayerIds = new Set(getRotoLayers(node).map((layer) => layer.id));
  const nextParentLayerId =
    parentLayerId && validLayerIds.has(parentLayerId) ? parentLayerId : null;
  const selectedPathIds = new Set(pathIds);

  return {
    paths: node.paths.map((path) =>
      selectedPathIds.has(path.id) ? { ...path, parentLayerId: nextParentLayerId } : path,
    ),
  };
};

export const createRotoLayerFromSelection = (
  node: RotoNode,
  pathIds: readonly string[],
  name: string = getNextRotoLayerName(node),
  parentLayerId: string | null = getCommonRotoParentLayerId(node, pathIds),
): { layer: RotoLayer; updates: Pick<RotoNode, 'layers' | 'paths'> } =>
  createRotoLayerFromHierarchySelection(
    node,
    createRotoHierarchyItemRefs('path', pathIds),
    name,
    parentLayerId,
  );

export const createRotoLayerFromLayerSelection = (
  node: RotoNode,
  layerIds: readonly string[],
  name: string = getNextRotoLayerName(node),
  parentLayerId: string | null = getCommonRotoHierarchyParentId(
    node,
    createRotoHierarchyItemRefs('layer', layerIds),
  ),
): { layer: RotoLayer; updates: Pick<RotoNode, 'layers'> } => {
  const layerRefs = createRotoHierarchyItemRefs('layer', layerIds);
  const { layer, updates } = createRotoLayerFromHierarchySelection(
    node,
    layerRefs,
    name,
    parentLayerId,
  );

  return {
    layer,
    updates: {
      layers: updates.layers,
    },
  };
};

const getCommonRotoHierarchyParentId = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
): string | null => {
  const normalizedItems = normalizeRotoHierarchyItems(node, items);
  if (normalizedItems.length === 0) return null;

  const firstParentLayerId = getRotoItemParentLayerId(node, normalizedItems[0]);
  return normalizedItems.every(
    (item) => getRotoItemParentLayerId(node, item) === firstParentLayerId,
  )
    ? firstParentLayerId
    : null;
};

export const createRotoLayerFromHierarchySelection = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
  name: string = getNextRotoLayerName(node),
  parentLayerId: string | null = getCommonRotoHierarchyParentId(node, items),
): { layer: RotoLayer; updates: Pick<RotoNode, 'layers' | 'paths'> } => {
  const layer = createRotoLayer(name, parentLayerId);
  const orderedItems = getOrderedRotoHierarchyItems(node, items);
  const nextNode: RotoNode = {
    ...node,
    layers: [layer, ...getRotoLayers(node)],
  };
  const updates = moveRotoHierarchyItems(nextNode, orderedItems, layer.id, 0);

  return {
    layer,
    updates,
  };
};

export const prependRotoPath = (node: RotoNode, path: RotoPath): Pick<RotoNode, 'paths'> => ({
  paths: [{ ...path, stackOrder: path.stackOrder ?? getNextRotoStackOrder() }, ...node.paths],
});

export const deleteRotoLayer = (
  node: RotoNode,
  layerId: string,
): Pick<RotoNode, 'layers' | 'paths'> => {
  const layers = getRotoLayers(node);

  const removedIds = new Set<string>([layerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const layer of layers) {
      if (!removedIds.has(layer.id) && layer.parentLayerId && removedIds.has(layer.parentLayerId)) {
        removedIds.add(layer.id);
        changed = true;
      }
    }
  }

  return {
    layers: layers.filter((item) => !removedIds.has(item.id)),
    paths: node.paths.filter((path) => {
      const parentId = getRotoPathParentLayerId(node, path);
      return !parentId || !removedIds.has(parentId);
    }),
  };
};

export const toggleRotoLayerExpanded = (
  node: RotoNode,
  layerId: string,
): Pick<RotoNode, 'layers'> => ({
  layers: getRotoLayers(node).map((layer) =>
    layer.id === layerId ? { ...layer, expanded: layer.expanded === false } : layer,
  ),
});

export const toggleRotoLayerVisibility = (
  node: RotoNode,
  layerId: string,
): Pick<RotoNode, 'layers'> => ({
  layers: getRotoLayers(node).map((layer) =>
    layer.id === layerId ? { ...layer, visible: layer.visible === false } : layer,
  ),
});

export const toggleRotoPathVisibility = (
  node: RotoNode,
  pathId: string,
): Pick<RotoNode, 'paths'> => ({
  paths: node.paths.map((path) =>
    path.id === pathId ? { ...path, visible: path.visible === false } : path,
  ),
});

export const canMoveRotoLayerToParent = (
  node: RotoNode,
  layerId: string,
  parentLayerId: string | null,
): boolean => {
  if (!parentLayerId) return true;
  if (layerId === parentLayerId) return false;

  const descendantIds = getDescendantLayerIds(node, layerId);
  return !descendantIds.has(parentLayerId);
};

export const moveRotoLayer = (
  node: RotoNode,
  layerId: string,
  parentLayerId: string | null,
): Pick<RotoNode, 'layers'> => {
  const validLayerIds = new Set(getRotoLayers(node).map((layer) => layer.id));
  const nextParentLayerId =
    parentLayerId &&
    validLayerIds.has(parentLayerId) &&
    canMoveRotoLayerToParent(node, layerId, parentLayerId)
      ? parentLayerId
      : null;

  return {
    layers: getRotoLayers(node).map((layer) =>
      layer.id === layerId ? { ...layer, parentLayerId: nextParentLayerId } : layer,
    ),
  };
};

export type RotoHierarchyItemRef =
  | {
      type: 'layer';
      id: string;
    }
  | {
      type: 'path';
      id: string;
    };

const getRotoHierarchyItemKey = (item: RotoHierarchyItemRef): string => `${item.type}:${item.id}`;

const isSameRotoHierarchyItem = (a: RotoHierarchyItemRef, b: RotoHierarchyItemRef): boolean =>
  a.type === b.type && a.id === b.id;

const getRotoOrderedSiblingItems = (
  node: RotoNode,
  parentLayerId: string | null,
): RotoHierarchyItemRef[] => {
  const layers = getRotoLayers(node);
  const validLayerIds = new Set(layers.map((layer) => layer.id));
  const siblingSources = [
    ...layers
      .filter((layer) => (layer.parentLayerId ?? null) === parentLayerId)
      .map(
        (layer, fallbackIndex): RotoHierarchySource => ({
          type: 'layer',
          layer,
          stackOrder: getRotoItemStackOrder(layer),
          fallbackIndex,
        }),
      ),
    ...node.paths
      .filter((path) => normalizePathParentId(path, validLayerIds) === parentLayerId)
      .map(
        (path, fallbackIndex): RotoHierarchySource => ({
          type: 'path',
          path,
          stackOrder: getRotoItemStackOrder(path),
          fallbackIndex,
        }),
      ),
  ].sort(compareRotoHierarchySources);

  return siblingSources.map((source) =>
    source.type === 'layer'
      ? { type: 'layer', id: source.layer.id }
      : { type: 'path', id: source.path.id },
  );
};

export const getRotoItemParentLayerId = (
  node: RotoNode,
  item: RotoHierarchyItemRef,
): string | null => {
  if (item.type === 'layer') {
    return getRotoLayerMap(node).get(item.id)?.parentLayerId ?? null;
  }

  const path = node.paths.find((existingPath) => existingPath.id === item.id);
  return path ? getRotoPathParentLayerId(node, path) : null;
};

export const getOrderedRotoSiblingItems = (
  node: RotoNode,
  parentLayerId: string | null,
  excludeItem?: RotoHierarchyItemRef,
): RotoHierarchyItemRef[] =>
  getRotoOrderedSiblingItems(node, parentLayerId).filter((item) =>
    excludeItem ? !isSameRotoHierarchyItem(item, excludeItem) : true,
  );

export const filterTopLevelRotoHierarchyItems = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
): RotoHierarchyItemRef[] => {
  const layerMap = getRotoLayerMap(node);
  const selectedLayerIds = new Set(
    items
      .filter(
        (item): item is Extract<RotoHierarchyItemRef, { type: 'layer' }> => item.type === 'layer',
      )
      .map((item) => item.id),
  );

  return items.filter((item) => {
    let parentLayerId =
      item.type === 'layer'
        ? (layerMap.get(item.id)?.parentLayerId ?? null)
        : getRotoItemParentLayerId(node, item);

    while (parentLayerId) {
      if (selectedLayerIds.has(parentLayerId)) {
        return false;
      }
      parentLayerId = layerMap.get(parentLayerId)?.parentLayerId ?? null;
    }

    return true;
  });
};

const normalizeRotoHierarchyItems = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
): RotoHierarchyItemRef[] => {
  const layerMap = getRotoLayerMap(node);

  return filterTopLevelRotoHierarchyItems(
    node,
    [...items].filter((item, index, collection) => {
      if (collection.findIndex((candidate) => isSameRotoHierarchyItem(candidate, item)) !== index) {
        return false;
      }

      if (item.type === 'layer') {
        return layerMap.has(item.id);
      }

      return node.paths.some((path) => path.id === item.id);
    }),
  );
};

const assignRotoSiblingStackOrders = (
  siblingItems: RotoHierarchyItemRef[],
  stackOrderByKey: Map<string, number>,
) => {
  for (let index = siblingItems.length - 1; index >= 0; index -= 1) {
    stackOrderByKey.set(getRotoHierarchyItemKey(siblingItems[index]), getNextRotoStackOrder());
  }
};

const areRotoSiblingOrdersEqual = (a: RotoHierarchyItemRef[], b: RotoHierarchyItemRef[]): boolean =>
  a.length === b.length && a.every((item, index) => isSameRotoHierarchyItem(item, b[index]));

export const moveRotoHierarchyItems = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
  parentLayerId: string | null,
  siblingIndex: number,
): Pick<RotoNode, 'layers' | 'paths'> => {
  const originalLayers = Array.isArray(node.layers) ? node.layers : [];
  const layers = getRotoLayers(node);
  const validLayerIds = new Set(layers.map((layer) => layer.id));
  const nextParentLayerId =
    parentLayerId && validLayerIds.has(parentLayerId) ? parentLayerId : null;

  const normalizedItems = normalizeRotoHierarchyItems(node, items);

  if (normalizedItems.length === 0) {
    return { layers: originalLayers, paths: node.paths };
  }

  const draggedLayerIds = normalizedItems
    .filter(
      (item): item is Extract<RotoHierarchyItemRef, { type: 'layer' }> => item.type === 'layer',
    )
    .map((item) => item.id);

  if (
    draggedLayerIds.some((layerId) => !canMoveRotoLayerToParent(node, layerId, nextParentLayerId))
  ) {
    return { layers: originalLayers, paths: node.paths };
  }

  const draggedItemKeySet = new Set(normalizedItems.map((item) => getRotoHierarchyItemKey(item)));
  const currentParentLayerIds = [
    ...new Set(normalizedItems.map((item) => getRotoItemParentLayerId(node, item))),
  ];
  const nextSiblingItems = getRotoOrderedSiblingItems(node, nextParentLayerId).filter(
    (existingItem) => !draggedItemKeySet.has(getRotoHierarchyItemKey(existingItem)),
  );
  const clampedSiblingIndex = Math.max(0, Math.min(nextSiblingItems.length, siblingIndex));
  nextSiblingItems.splice(clampedSiblingIndex, 0, ...normalizedItems);

  const proposedSiblingItemsByParent = new Map<string | null, RotoHierarchyItemRef[]>();
  proposedSiblingItemsByParent.set(nextParentLayerId, nextSiblingItems);

  currentParentLayerIds.forEach((currentParentLayerId) => {
    if (currentParentLayerId === nextParentLayerId) return;
    proposedSiblingItemsByParent.set(
      currentParentLayerId,
      getRotoOrderedSiblingItems(node, currentParentLayerId).filter(
        (existingItem) => !draggedItemKeySet.has(getRotoHierarchyItemKey(existingItem)),
      ),
    );
  });

  const didParentChange = normalizedItems.some(
    (item) => getRotoItemParentLayerId(node, item) !== nextParentLayerId,
  );
  const didSiblingOrderChange = [...proposedSiblingItemsByParent.entries()].some(
    ([affectedParentLayerId, proposedSiblingItems]) =>
      !areRotoSiblingOrdersEqual(
        getRotoOrderedSiblingItems(node, affectedParentLayerId),
        proposedSiblingItems,
      ),
  );

  if (!didParentChange && !didSiblingOrderChange) {
    return { layers: originalLayers, paths: node.paths };
  }

  const stackOrderByKey = new Map<string, number>();
  proposedSiblingItemsByParent.forEach((proposedSiblingItems) => {
    assignRotoSiblingStackOrders(proposedSiblingItems, stackOrderByKey);
  });

  let didChange = false;

  const nextLayers = layers.map((layer) => {
    const itemKey = getRotoHierarchyItemKey({ type: 'layer', id: layer.id });
    const isDraggedLayer = draggedItemKeySet.has(itemKey);
    const nextStackOrder = stackOrderByKey.get(itemKey);
    const resolvedParentLayerId = layer.parentLayerId ?? null;
    const shouldUpdateParent = isDraggedLayer && resolvedParentLayerId !== nextParentLayerId;
    const shouldUpdateStackOrder =
      nextStackOrder !== undefined && nextStackOrder !== layer.stackOrder;

    if (!shouldUpdateParent && !shouldUpdateStackOrder) {
      return layer;
    }

    didChange = true;
    return {
      ...layer,
      ...(shouldUpdateParent ? { parentLayerId: nextParentLayerId } : {}),
      ...(shouldUpdateStackOrder ? { stackOrder: nextStackOrder } : {}),
    };
  });

  const nextPaths = node.paths.map((path) => {
    const itemKey = getRotoHierarchyItemKey({ type: 'path', id: path.id });
    const isDraggedPath = draggedItemKeySet.has(itemKey);
    const nextStackOrder = stackOrderByKey.get(itemKey);
    const resolvedParentLayerId = getRotoPathParentLayerId(node, path);
    const shouldUpdateParent = isDraggedPath && resolvedParentLayerId !== nextParentLayerId;
    const shouldUpdateStackOrder =
      nextStackOrder !== undefined && nextStackOrder !== path.stackOrder;

    if (!shouldUpdateParent && !shouldUpdateStackOrder) {
      return path;
    }

    didChange = true;
    return {
      ...path,
      ...(shouldUpdateParent ? { parentLayerId: nextParentLayerId } : {}),
      ...(shouldUpdateStackOrder ? { stackOrder: nextStackOrder } : {}),
    };
  });

  return didChange
    ? { layers: nextLayers, paths: nextPaths }
    : { layers: originalLayers, paths: node.paths };
};

export const moveRotoHierarchyItem = (
  node: RotoNode,
  item: RotoHierarchyItemRef,
  parentLayerId: string | null,
  siblingIndex: number,
): Pick<RotoNode, 'layers' | 'paths'> =>
  moveRotoHierarchyItems(node, [item], parentLayerId, siblingIndex);

export type RotoHierarchyItem =
  | {
      type: 'layer';
      layer: RotoLayer;
      depth: number;
      pathCount: number;
      visible: boolean;
      children: RotoHierarchyItem[];
    }
  | {
      type: 'path';
      path: RotoPath;
      depth: number;
      visible: boolean;
    };

const countHierarchyPaths = (items: RotoHierarchyItem[]): number =>
  items.reduce(
    (total, item) => total + (item.type === 'path' ? 1 : countHierarchyPaths(item.children)),
    0,
  );

type RotoHierarchySource =
  | {
      type: 'layer';
      layer: RotoLayer;
      stackOrder: number | null;
      fallbackIndex: number;
    }
  | {
      type: 'path';
      path: RotoPath;
      stackOrder: number | null;
      fallbackIndex: number;
    };

const compareRotoHierarchySources = (a: RotoHierarchySource, b: RotoHierarchySource): number => {
  if (a.stackOrder !== null || b.stackOrder !== null) {
    const orderA = a.stackOrder ?? Number.NEGATIVE_INFINITY;
    const orderB = b.stackOrder ?? Number.NEGATIVE_INFINITY;
    if (orderA !== orderB) {
      return orderB - orderA;
    }
  }

  if (a.type !== b.type) {
    return a.type === 'layer' ? -1 : 1;
  }

  return a.fallbackIndex - b.fallbackIndex;
};

export const buildRotoHierarchy = (node: RotoNode): RotoHierarchyItem[] => {
  const layers = getRotoLayers(node);
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const validLayerIds = new Set(layerMap.keys());
  const layersByParent = new Map<string | null, RotoLayer[]>();
  const pathsByParent = new Map<string | null, RotoPath[]>();
  const layerVisibilityById = new Map<string, boolean>();
  const pathVisibilityById = new Map<string, boolean>();

  const pushToGroup = <T>(map: Map<string | null, T[]>, key: string | null, value: T) => {
    const current = map.get(key) ?? [];
    current.push(value);
    map.set(key, current);
  };

  const isLayerVisibleInHierarchy = (layerId: string | null | undefined): boolean => {
    if (!layerId) return true;

    const cachedVisibility = layerVisibilityById.get(layerId);
    if (cachedVisibility !== undefined) {
      return cachedVisibility;
    }

    const traversedLayerIds: string[] = [];
    const visitedLayerIds = new Set<string>();
    let currentLayerId: string | null = layerId;
    let isVisible = true;

    while (currentLayerId && !visitedLayerIds.has(currentLayerId)) {
      const cachedCurrentVisibility = layerVisibilityById.get(currentLayerId);
      if (cachedCurrentVisibility !== undefined) {
        isVisible = cachedCurrentVisibility;
        break;
      }

      visitedLayerIds.add(currentLayerId);
      traversedLayerIds.push(currentLayerId);

      const layer = layerMap.get(currentLayerId);
      if (!layer) {
        break;
      }

      if (layer.visible === false) {
        isVisible = false;
        break;
      }

      currentLayerId = layer.parentLayerId ?? null;
    }

    traversedLayerIds.forEach((visitedLayerId) => {
      layerVisibilityById.set(visitedLayerId, isVisible);
    });

    return isVisible;
  };

  layers.forEach((layer) => {
    pushToGroup(layersByParent, layer.parentLayerId ?? null, layer);
  });

  node.paths.forEach((path) => {
    const parentLayerId = normalizePathParentId(path, validLayerIds);
    pushToGroup(pathsByParent, parentLayerId, path);
    pathVisibilityById.set(
      path.id,
      path.visible !== false && isLayerVisibleInHierarchy(parentLayerId),
    );
  });

  const buildItems = (
    parentLayerId: string | null,
    depth: number,
    visitedLayerIds: Set<string>,
  ): RotoHierarchyItem[] => {
    const siblingSources = [
      ...(layersByParent.get(parentLayerId) ?? []).map(
        (layer, fallbackIndex): RotoHierarchySource => ({
          type: 'layer',
          layer,
          stackOrder: getRotoItemStackOrder(layer),
          fallbackIndex,
        }),
      ),
      ...(pathsByParent.get(parentLayerId) ?? []).map(
        (path, fallbackIndex): RotoHierarchySource => ({
          type: 'path',
          path,
          stackOrder: getRotoItemStackOrder(path),
          fallbackIndex,
        }),
      ),
    ].sort(compareRotoHierarchySources);

    const items: RotoHierarchyItem[] = [];

    siblingSources.forEach((source) => {
      if (source.type === 'path') {
        items.push({
          type: 'path',
          path: source.path,
          depth,
          visible: pathVisibilityById.get(source.path.id) ?? true,
        });
        return;
      }

      if (visitedLayerIds.has(source.layer.id)) {
        return;
      }

      const nextVisitedLayerIds = new Set(visitedLayerIds);
      nextVisitedLayerIds.add(source.layer.id);
      const children = buildItems(source.layer.id, depth + 1, nextVisitedLayerIds);

      items.push({
        type: 'layer',
        layer: source.layer,
        depth,
        pathCount: countHierarchyPaths(children),
        visible: isLayerVisibleInHierarchy(source.layer.id),
        children,
      });
    });

    return items;
  };

  return buildItems(null, 0, new Set());
};

const flattenRotoHierarchyItemRefs = (
  items: readonly RotoHierarchyItem[],
  refs: RotoHierarchyItemRef[] = [],
): RotoHierarchyItemRef[] => {
  items.forEach((item) => {
    if (item.type === 'layer') {
      refs.push({ type: 'layer', id: item.layer.id });
      flattenRotoHierarchyItemRefs(item.children, refs);
      return;
    }

    refs.push({ type: 'path', id: item.path.id });
  });

  return refs;
};

const getOrderedRotoHierarchyItems = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
): RotoHierarchyItemRef[] => {
  const normalizedItems = normalizeRotoHierarchyItems(node, items);
  if (normalizedItems.length <= 1) return normalizedItems;

  const indexByKey = new Map(
    flattenRotoHierarchyItemRefs(buildRotoHierarchy(node)).map((item, index) => [
      getRotoHierarchyItemKey(item),
      index,
    ]),
  );

  return [...normalizedItems].sort(
    (a, b) =>
      (indexByKey.get(getRotoHierarchyItemKey(a)) ?? Number.MAX_SAFE_INTEGER) -
      (indexByKey.get(getRotoHierarchyItemKey(b)) ?? Number.MAX_SAFE_INTEGER),
  );
};
