import type { PaintLayer, PaintNode, PaintStroke } from '@blackboard/types';
import { isPaintLifetimeActiveAtFrame } from './paintLifetime';

export interface PaintHierarchyLayerItem {
  type: 'layer';
  layer: PaintLayer;
  depth: number;
  visible: boolean;
  activeAtFrame: boolean;
  children: PaintHierarchyItem[];
  strokeCount: number;
}

export interface PaintHierarchyStrokeItem {
  type: 'stroke';
  stroke: PaintStroke;
  depth: number;
  visible: boolean;
  activeAtFrame: boolean;
}

export type PaintHierarchyItem = PaintHierarchyLayerItem | PaintHierarchyStrokeItem;

export type PaintHierarchyItemRef =
  | {
      type: 'layer';
      id: string;
    }
  | {
      type: 'stroke';
      id: string;
    };

type PaintHierarchySource =
  | {
      type: 'layer';
      layer: PaintLayer;
      stackOrder: number | null;
      fallbackIndex: number;
    }
  | {
      type: 'stroke';
      stroke: PaintStroke;
      stackOrder: number | null;
      fallbackIndex: number;
    };

let lastPaintStackOrder = 0;

export const getNextPaintStackOrder = (): number => {
  const now = Date.now();
  lastPaintStackOrder = Math.max(now, lastPaintStackOrder + 1);
  return lastPaintStackOrder;
};

const createPaintLayerId = () =>
  `paint_layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getLegacyPaintStackOrder = (id: string): number | null => {
  const timestamp = id.match(/\d{6,}/g)?.at(-1);
  if (!timestamp) return null;

  const parsedTimestamp = Number(timestamp);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
};

const getPaintItemStackOrder = (
  item: Pick<PaintLayer, 'id' | 'stackOrder'> | Pick<PaintStroke, 'id' | 'stackOrder'>,
): number | null => item.stackOrder ?? getLegacyPaintStackOrder(item.id);

export const getPaintHierarchyItemKey = (item: PaintHierarchyItemRef): string =>
  `${item.type}:${item.id}`;

const isSamePaintHierarchyItem = (a: PaintHierarchyItemRef, b: PaintHierarchyItemRef): boolean =>
  a.type === b.type && a.id === b.id;

const normalizeLayerParentId = (
  layer: Pick<PaintLayer, 'id' | 'parentLayerId'>,
  validLayerIds: Set<string>,
): string | null => {
  const parentId = layer.parentLayerId ?? null;
  if (!parentId || parentId === layer.id || !validLayerIds.has(parentId)) {
    return null;
  }
  return parentId;
};

const normalizeStrokeParentId = (
  stroke: Pick<PaintStroke, 'parentLayerId'>,
  validLayerIds: Set<string>,
): string | null => {
  const parentId = stroke.parentLayerId ?? null;
  if (!parentId || !validLayerIds.has(parentId)) {
    return null;
  }
  return parentId;
};

const comparePaintHierarchySources = (a: PaintHierarchySource, b: PaintHierarchySource): number => {
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

const countHierarchyStrokes = (items: readonly PaintHierarchyItem[]): number =>
  items.reduce(
    (total, item) => total + (item.type === 'stroke' ? 1 : countHierarchyStrokes(item.children)),
    0,
  );

export const getPaintLayers = (node: Pick<PaintNode, 'layers'>): PaintLayer[] => {
  const rawLayers = Array.isArray(node.layers) ? node.layers : [];
  const validLayerIds = new Set(rawLayers.map((layer) => layer.id));

  return rawLayers.map((layer) => ({
    ...layer,
    parentLayerId: normalizeLayerParentId(layer, validLayerIds),
    visible: layer.visible !== false,
    expanded: layer.expanded !== false,
  }));
};

export const getPaintLayerMap = (node: Pick<PaintNode, 'layers'>): Map<string, PaintLayer> =>
  new Map(getPaintLayers(node).map((layer) => [layer.id, layer]));

export const getPaintStrokeParentLayerId = (
  node: Pick<PaintNode, 'layers'>,
  stroke: PaintStroke,
): string | null =>
  normalizeStrokeParentId(stroke, new Set(getPaintLayers(node).map((layer) => layer.id)));

export const isPaintLayerVisible = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string | null | undefined,
  prebuiltLayerMap?: Map<string, PaintLayer>,
): boolean => {
  if (!layerId) return true;

  const layerMap = prebuiltLayerMap ?? getPaintLayerMap(node);
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

export const isPaintLayerActiveAtFrame = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string | null | undefined,
  frame: number,
  prebuiltLayerMap?: Map<string, PaintLayer>,
): boolean => {
  if (!layerId) return true;

  const layerMap = prebuiltLayerMap ?? getPaintLayerMap(node);
  let currentLayerId: string | null = layerId;
  const visited = new Set<string>();

  while (currentLayerId && !visited.has(currentLayerId)) {
    visited.add(currentLayerId);
    const layer = layerMap.get(currentLayerId);
    if (!layer) return true;
    if (!isPaintLifetimeActiveAtFrame(layer.lifetime, frame)) return false;
    currentLayerId = layer.parentLayerId ?? null;
  }

  return true;
};

export const isPaintStrokeVisible = (
  node: Pick<PaintNode, 'layers'>,
  stroke: PaintStroke,
  prebuiltLayerMap?: Map<string, PaintLayer>,
): boolean => {
  if (stroke.visible === false) return false;
  return isPaintLayerVisible(node, getPaintStrokeParentLayerId(node, stroke), prebuiltLayerMap);
};

export const isPaintStrokeActiveAtFrame = (
  node: Pick<PaintNode, 'layers'>,
  stroke: PaintStroke,
  frame: number,
  prebuiltLayerMap?: Map<string, PaintLayer>,
): boolean => {
  if (!isPaintLifetimeActiveAtFrame(stroke.lifetime, frame)) return false;
  return isPaintLayerActiveAtFrame(
    node,
    getPaintStrokeParentLayerId(node, stroke),
    frame,
    prebuiltLayerMap,
  );
};

const getDescendantLayerIds = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string,
  visited: Set<string> = new Set(),
): Set<string> => {
  const descendantIds = new Set<string>();
  if (visited.has(layerId)) return descendantIds;

  visited.add(layerId);
  const layers = getPaintLayers(node);
  const directChildren = layers.filter((layer) => layer.parentLayerId === layerId);

  directChildren.forEach((layer) => {
    descendantIds.add(layer.id);
    getDescendantLayerIds(node, layer.id, visited).forEach((id) => descendantIds.add(id));
  });

  return descendantIds;
};

export const getPaintLayerStrokeIds = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  layerId: string,
): string[] => {
  const layerIds = getDescendantLayerIds(node, layerId);
  layerIds.add(layerId);

  return node.strokes
    .filter((stroke) => {
      const parentLayerId = getPaintStrokeParentLayerId(node, stroke);
      return !!parentLayerId && layerIds.has(parentLayerId);
    })
    .map((stroke) => stroke.id);
};

export const getCommonPaintParentLayerId = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  strokeIds: readonly string[],
): string | null => {
  const selectedStrokes = node.strokes.filter((stroke) => strokeIds.includes(stroke.id));
  if (selectedStrokes.length === 0) return null;

  const firstParentLayerId = getPaintStrokeParentLayerId(node, selectedStrokes[0]);
  return selectedStrokes.every(
    (stroke) => getPaintStrokeParentLayerId(node, stroke) === firstParentLayerId,
  )
    ? firstParentLayerId
    : null;
};

export const getPaintCreationParentLayerId = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  selectedLayerIds: readonly string[] = [],
  selectedStrokeIds: readonly string[] = [],
): string | null => {
  const layerMap = getPaintLayerMap(node);
  const validSelectedLayerIds = [...new Set(selectedLayerIds)].filter((layerId) =>
    layerMap.has(layerId),
  );

  if (validSelectedLayerIds.length === 1) {
    return validSelectedLayerIds[0];
  }

  return selectedStrokeIds.length > 0 ? getCommonPaintParentLayerId(node, selectedStrokeIds) : null;
};

export const getNextPaintLayerName = (node: Pick<PaintNode, 'layers'>): string => {
  const existingNames = new Set(getPaintLayers(node).map((layer) => layer.name.toLowerCase()));
  let index = 1;
  while (existingNames.has(`layer ${index}`)) {
    index += 1;
  }
  return `Layer ${index}`;
};

export const createPaintLayer = (
  name: string,
  parentLayerId: string | null = null,
): PaintLayer => ({
  id: createPaintLayerId(),
  name,
  parentLayerId,
  stackOrder: getNextPaintStackOrder(),
  visible: true,
  expanded: true,
});

export const togglePaintLayerExpanded = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string,
): Pick<PaintNode, 'layers'> => ({
  layers: getPaintLayers(node).map((layer) =>
    layer.id === layerId ? { ...layer, expanded: layer.expanded === false } : layer,
  ),
});

export const togglePaintLayerVisibility = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string,
): Pick<PaintNode, 'layers'> => ({
  layers: getPaintLayers(node).map((layer) =>
    layer.id === layerId ? { ...layer, visible: layer.visible === false } : layer,
  ),
});

export const assignPaintStrokesToLayer = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  strokeIds: readonly string[],
  targetLayerId: string | null,
): Pick<PaintNode, 'strokes'> => {
  const validTargetLayerId =
    targetLayerId && getPaintLayerMap(node).has(targetLayerId) ? targetLayerId : null;
  const strokeIdSet = new Set(strokeIds);

  return {
    strokes: node.strokes.map((stroke) =>
      strokeIdSet.has(stroke.id)
        ? {
            ...stroke,
            parentLayerId: validTargetLayerId,
          }
        : stroke,
    ),
  };
};

export const reorderPaintStrokes = (strokes: readonly PaintStroke[]): PaintStroke[] => {
  const stackOrderById = new Map<string, number>();

  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    stackOrderById.set(strokes[index].id, getNextPaintStackOrder());
  }

  return strokes.map((stroke) => {
    const stackOrder = stackOrderById.get(stroke.id);
    return stackOrder !== undefined && stroke.stackOrder !== stackOrder
      ? { ...stroke, stackOrder }
      : stroke;
  });
};

export const canMovePaintLayerToParent = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string,
  parentLayerId: string | null,
): boolean => {
  if (!parentLayerId) return true;
  if (layerId === parentLayerId) return false;

  const descendantIds = getDescendantLayerIds(node, layerId);
  return !descendantIds.has(parentLayerId);
};

export const movePaintLayer = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string,
  parentLayerId: string | null,
): Pick<PaintNode, 'layers'> => {
  const validLayerIds = new Set(getPaintLayers(node).map((layer) => layer.id));
  const nextParentLayerId =
    parentLayerId &&
    validLayerIds.has(parentLayerId) &&
    canMovePaintLayerToParent(node, layerId, parentLayerId)
      ? parentLayerId
      : null;

  return {
    layers: getPaintLayers(node).map((layer) =>
      layer.id === layerId ? { ...layer, parentLayerId: nextParentLayerId } : layer,
    ),
  };
};

export const getPaintItemParentLayerId = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  item: PaintHierarchyItemRef,
): string | null => {
  if (item.type === 'layer') {
    return getPaintLayerMap(node).get(item.id)?.parentLayerId ?? null;
  }

  const stroke = node.strokes.find((existingStroke) => existingStroke.id === item.id);
  return stroke ? getPaintStrokeParentLayerId(node, stroke) : null;
};

const getPaintOrderedSiblingItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  parentLayerId: string | null,
): PaintHierarchyItemRef[] => {
  const layers = getPaintLayers(node);
  const validLayerIds = new Set(layers.map((layer) => layer.id));
  const siblingSources = [
    ...layers
      .filter((layer) => (layer.parentLayerId ?? null) === parentLayerId)
      .map(
        (layer, fallbackIndex): PaintHierarchySource => ({
          type: 'layer',
          layer,
          stackOrder: getPaintItemStackOrder(layer),
          fallbackIndex,
        }),
      ),
    ...node.strokes
      .filter((stroke) => normalizeStrokeParentId(stroke, validLayerIds) === parentLayerId)
      .map(
        (stroke, fallbackIndex): PaintHierarchySource => ({
          type: 'stroke',
          stroke,
          stackOrder: getPaintItemStackOrder(stroke),
          fallbackIndex,
        }),
      ),
  ].sort(comparePaintHierarchySources);

  return siblingSources.map((source) =>
    source.type === 'layer'
      ? { type: 'layer', id: source.layer.id }
      : { type: 'stroke', id: source.stroke.id },
  );
};

export const getOrderedPaintSiblingItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  parentLayerId: string | null,
  excludeItem?: PaintHierarchyItemRef,
): PaintHierarchyItemRef[] =>
  getPaintOrderedSiblingItems(node, parentLayerId).filter((item) =>
    excludeItem ? !isSamePaintHierarchyItem(item, excludeItem) : true,
  );

export const filterTopLevelPaintHierarchyItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  items: readonly PaintHierarchyItemRef[],
): PaintHierarchyItemRef[] => {
  const layerMap = getPaintLayerMap(node);
  const selectedLayerIds = new Set(
    items
      .filter(
        (item): item is Extract<PaintHierarchyItemRef, { type: 'layer' }> => item.type === 'layer',
      )
      .map((item) => item.id),
  );

  return items.filter((item) => {
    let parentLayerId =
      item.type === 'layer'
        ? (layerMap.get(item.id)?.parentLayerId ?? null)
        : getPaintItemParentLayerId(node, item);

    while (parentLayerId) {
      if (selectedLayerIds.has(parentLayerId)) {
        return false;
      }
      parentLayerId = layerMap.get(parentLayerId)?.parentLayerId ?? null;
    }

    return true;
  });
};

const normalizePaintHierarchyItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  items: readonly PaintHierarchyItemRef[],
): PaintHierarchyItemRef[] => {
  const layerMap = getPaintLayerMap(node);

  return filterTopLevelPaintHierarchyItems(
    node,
    [...items].filter((item, index, collection) => {
      if (
        collection.findIndex((candidate) => isSamePaintHierarchyItem(candidate, item)) !== index
      ) {
        return false;
      }

      if (item.type === 'layer') {
        return layerMap.has(item.id);
      }

      return node.strokes.some((stroke) => stroke.id === item.id);
    }),
  );
};

const assignPaintSiblingStackOrders = (
  siblingItems: PaintHierarchyItemRef[],
  stackOrderByKey: Map<string, number>,
) => {
  for (let index = siblingItems.length - 1; index >= 0; index -= 1) {
    stackOrderByKey.set(getPaintHierarchyItemKey(siblingItems[index]), getNextPaintStackOrder());
  }
};

const arePaintSiblingOrdersEqual = (
  a: readonly PaintHierarchyItemRef[],
  b: readonly PaintHierarchyItemRef[],
): boolean =>
  a.length === b.length && a.every((item, index) => isSamePaintHierarchyItem(item, b[index]));

const flattenPaintHierarchyItemRefs = (
  items: readonly PaintHierarchyItem[],
  refs: PaintHierarchyItemRef[] = [],
): PaintHierarchyItemRef[] => {
  items.forEach((item) => {
    if (item.type === 'layer') {
      refs.push({ type: 'layer', id: item.layer.id });
      flattenPaintHierarchyItemRefs(item.children, refs);
      return;
    }

    refs.push({ type: 'stroke', id: item.stroke.id });
  });

  return refs;
};

const getOrderedPaintHierarchyItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  items: readonly PaintHierarchyItemRef[],
): PaintHierarchyItemRef[] => {
  const normalizedItems = normalizePaintHierarchyItems(node, items);
  if (normalizedItems.length <= 1) return normalizedItems;

  const indexByKey = new Map(
    flattenPaintHierarchyItemRefs(buildPaintHierarchy(node)).map((item, index) => [
      getPaintHierarchyItemKey(item),
      index,
    ]),
  );

  return [...normalizedItems].sort(
    (a, b) =>
      (indexByKey.get(getPaintHierarchyItemKey(a)) ?? Number.POSITIVE_INFINITY) -
      (indexByKey.get(getPaintHierarchyItemKey(b)) ?? Number.POSITIVE_INFINITY),
  );
};

export const movePaintHierarchyItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  items: readonly PaintHierarchyItemRef[],
  parentLayerId: string | null,
  siblingIndex: number,
): Pick<PaintNode, 'layers' | 'strokes'> => {
  const originalLayers = Array.isArray(node.layers) ? node.layers : [];
  const layers = getPaintLayers(node);
  const validLayerIds = new Set(layers.map((layer) => layer.id));
  const nextParentLayerId =
    parentLayerId && validLayerIds.has(parentLayerId) ? parentLayerId : null;

  const normalizedItems = getOrderedPaintHierarchyItems(node, items);
  if (normalizedItems.length === 0) {
    return { layers: originalLayers, strokes: node.strokes };
  }

  const draggedLayerIds = normalizedItems
    .filter(
      (item): item is Extract<PaintHierarchyItemRef, { type: 'layer' }> => item.type === 'layer',
    )
    .map((item) => item.id);

  if (
    draggedLayerIds.some((layerId) => !canMovePaintLayerToParent(node, layerId, nextParentLayerId))
  ) {
    return { layers: originalLayers, strokes: node.strokes };
  }

  const draggedItemKeySet = new Set(normalizedItems.map((item) => getPaintHierarchyItemKey(item)));
  const currentParentLayerIds = [
    ...new Set(normalizedItems.map((item) => getPaintItemParentLayerId(node, item))),
  ];
  const nextSiblingItems = getPaintOrderedSiblingItems(node, nextParentLayerId).filter(
    (existingItem) => !draggedItemKeySet.has(getPaintHierarchyItemKey(existingItem)),
  );
  const clampedSiblingIndex = Math.max(0, Math.min(nextSiblingItems.length, siblingIndex));
  nextSiblingItems.splice(clampedSiblingIndex, 0, ...normalizedItems);

  const proposedSiblingItemsByParent = new Map<string | null, PaintHierarchyItemRef[]>();
  proposedSiblingItemsByParent.set(nextParentLayerId, nextSiblingItems);

  currentParentLayerIds.forEach((currentParentLayerId) => {
    if (currentParentLayerId === nextParentLayerId) return;
    proposedSiblingItemsByParent.set(
      currentParentLayerId,
      getPaintOrderedSiblingItems(node, currentParentLayerId).filter(
        (existingItem) => !draggedItemKeySet.has(getPaintHierarchyItemKey(existingItem)),
      ),
    );
  });

  const didParentChange = normalizedItems.some(
    (item) => getPaintItemParentLayerId(node, item) !== nextParentLayerId,
  );
  const didSiblingOrderChange = [...proposedSiblingItemsByParent.entries()].some(
    ([affectedParentLayerId, proposedSiblingItems]) =>
      !arePaintSiblingOrdersEqual(
        getPaintOrderedSiblingItems(node, affectedParentLayerId),
        proposedSiblingItems,
      ),
  );

  if (!didParentChange && !didSiblingOrderChange) {
    return { layers: originalLayers, strokes: node.strokes };
  }

  const stackOrderByKey = new Map<string, number>();
  proposedSiblingItemsByParent.forEach((proposedSiblingItems) => {
    assignPaintSiblingStackOrders(proposedSiblingItems, stackOrderByKey);
  });

  let didChange = false;

  const nextLayers = layers.map((layer) => {
    const itemKey = getPaintHierarchyItemKey({ type: 'layer', id: layer.id });
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

  const nextStrokes = node.strokes.map((stroke) => {
    const itemKey = getPaintHierarchyItemKey({ type: 'stroke', id: stroke.id });
    const isDraggedStroke = draggedItemKeySet.has(itemKey);
    const nextStackOrder = stackOrderByKey.get(itemKey);
    const resolvedParentLayerId = getPaintStrokeParentLayerId(node, stroke);
    const shouldUpdateParent = isDraggedStroke && resolvedParentLayerId !== nextParentLayerId;
    const shouldUpdateStackOrder =
      nextStackOrder !== undefined && nextStackOrder !== stroke.stackOrder;

    if (!shouldUpdateParent && !shouldUpdateStackOrder) {
      return stroke;
    }

    didChange = true;
    return {
      ...stroke,
      ...(shouldUpdateParent ? { parentLayerId: nextParentLayerId } : {}),
      ...(shouldUpdateStackOrder ? { stackOrder: nextStackOrder } : {}),
    };
  });

  return didChange
    ? { layers: nextLayers, strokes: nextStrokes }
    : { layers: originalLayers, strokes: node.strokes };
};

export const deletePaintLayer = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  layerId: string,
): Pick<PaintNode, 'layers' | 'strokes'> => {
  const layers = getPaintLayers(node);

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
    strokes: node.strokes.filter((stroke) => {
      const parentId = getPaintStrokeParentLayerId(node, stroke);
      return !parentId || !removedIds.has(parentId);
    }),
  };
};

export const wrapPaintSelectionInNewLayer = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  strokeIds: readonly string[],
  parentLayerId: string | null = getCommonPaintParentLayerId(node, strokeIds),
): { layer: PaintLayer; updates: Pick<PaintNode, 'layers' | 'strokes'> } => {
  const layer = createPaintLayer(getNextPaintLayerName(node), parentLayerId);
  const nextLayers = [layer, ...getPaintLayers(node)];
  const nextNode = { ...node, layers: nextLayers };
  const updates = assignPaintStrokesToLayer(nextNode, strokeIds, layer.id);

  return {
    layer,
    updates: {
      layers: nextLayers,
      strokes: updates.strokes,
    },
  };
};

export const buildPaintHierarchy = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  frame?: number,
): PaintHierarchyItem[] => {
  const layers = getPaintLayers(node);
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const layersByParent = new Map<string | null, PaintLayer[]>();
  const strokesByParent = new Map<string | null, PaintStroke[]>();

  const pushToGroup = <T>(map: Map<string | null, T[]>, key: string | null, value: T) => {
    const current = map.get(key) ?? [];
    current.push(value);
    map.set(key, current);
  };

  layers.forEach((layer) => {
    pushToGroup(layersByParent, layer.parentLayerId ?? null, layer);
  });

  const validLayerIds = new Set(layerMap.keys());
  node.strokes.forEach((stroke) => {
    const parentLayerId = normalizeStrokeParentId(stroke, validLayerIds);
    pushToGroup(strokesByParent, parentLayerId, stroke);
  });

  const buildItems = (
    parentLayerId: string | null,
    depth: number,
    visitedLayerIds: Set<string>,
  ): PaintHierarchyItem[] => {
    const siblingSources = [
      ...(layersByParent.get(parentLayerId) ?? []).map(
        (layer, fallbackIndex): PaintHierarchySource => ({
          type: 'layer',
          layer,
          stackOrder: getPaintItemStackOrder(layer),
          fallbackIndex,
        }),
      ),
      ...(strokesByParent.get(parentLayerId) ?? []).map(
        (stroke, fallbackIndex): PaintHierarchySource => ({
          type: 'stroke',
          stroke,
          stackOrder: getPaintItemStackOrder(stroke),
          fallbackIndex,
        }),
      ),
    ].sort(comparePaintHierarchySources);

    const items: PaintHierarchyItem[] = [];

    siblingSources.forEach((source) => {
      if (source.type === 'stroke') {
        items.push({
          type: 'stroke',
          stroke: source.stroke,
          depth,
          visible: isPaintStrokeVisible(node, source.stroke, layerMap),
          activeAtFrame:
            frame === undefined
              ? true
              : isPaintStrokeActiveAtFrame(node, source.stroke, frame, layerMap),
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
        visible: isPaintLayerVisible(node, source.layer.id, layerMap),
        activeAtFrame:
          frame === undefined
            ? true
            : isPaintLayerActiveAtFrame(node, source.layer.id, frame, layerMap),
        children,
        strokeCount: countHierarchyStrokes(children),
      });
    });

    return items;
  };

  return buildItems(null, 0, new Set());
};

export const flattenPaintHierarchyStrokeItems = (
  items: readonly PaintHierarchyItem[],
  strokes: PaintHierarchyStrokeItem[] = [],
): PaintHierarchyStrokeItem[] => {
  items.forEach((item) => {
    if (item.type === 'layer') {
      flattenPaintHierarchyStrokeItems(item.children, strokes);
      return;
    }

    strokes.push(item);
  });

  return strokes;
};
