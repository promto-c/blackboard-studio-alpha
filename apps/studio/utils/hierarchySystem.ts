import { normalizeParentId, getHierarchyItemKey, isSameHierarchyItem } from './hierarchyHelpers';

interface HLayer {
  id: string;
  name: string;
  parentLayerId?: string | null;
  stackOrder?: number | null;
  visible?: boolean;
  expanded?: boolean;
}

interface HChild {
  id: string;
  parentLayerId?: string | null;
  stackOrder?: number | null;
  visible?: boolean;
}

interface HItemRef {
  type: string;
  id: string;
}

type HierarchySource<TLayer, TChild> =
  | { type: 'layer'; item: TLayer; fallbackIndex: number }
  | { type: 'child'; item: TChild; fallbackIndex: number };

function compareSources<TLayer extends HLayer, TChild extends HChild>(
  a: HierarchySource<TLayer, TChild>,
  b: HierarchySource<TLayer, TChild>,
): number {
  const stackOrderA = a.item.stackOrder;
  const stackOrderB = b.item.stackOrder;
  if (stackOrderA != null || stackOrderB != null) {
    const orderA = stackOrderA ?? Number.NEGATIVE_INFINITY;
    const orderB = stackOrderB ?? Number.NEGATIVE_INFINITY;
    if (orderA !== orderB) {
      return orderB - orderA;
    }
  }

  if (a.type !== b.type) {
    return a.type === 'layer' ? -1 : 1;
  }

  return a.fallbackIndex - b.fallbackIndex;
}

interface HierarchySystemConfig<
  TNode,
  TLayer extends HLayer,
  TChild extends HChild,
  TItemRef extends HItemRef,
  THierarchyItem extends { type: string; depth: number; visible: boolean },
> {
  childTypeName: TItemRef['type'];
  getLayers: (node: TNode) => TLayer[];
  getChildren: (node: TNode) => TChild[];
  getChildParentLayerId: (node: TNode, child: TChild) => string | null;
  getItemParentLayerId: (node: TNode, item: TItemRef) => string | null;
  getNextStackOrder: () => number;
  createLayerId: () => string;
  buildLayerItem: (
    layer: TLayer,
    depth: number,
    children: THierarchyItem[],
    node: TNode,
    frame?: number,
  ) => THierarchyItem;
  buildChildItem: (child: TChild, depth: number, node: TNode, frame?: number) => THierarchyItem;
  countHierarchyChildren: (items: THierarchyItem[]) => number;
  deleteLayer: (node: TNode, layerId: string) => { layers: TLayer[]; children: TChild[] };
  getHierarchyItemId: (item: THierarchyItem) => string;
  getHierarchyItemChildren: (item: THierarchyItem) => readonly THierarchyItem[] | undefined;
}

interface HierarchySystem<
  TNode,
  TLayer extends HLayer,
  TChild extends HChild,
  TItemRef extends HItemRef,
  THierarchyItem extends { type: string; depth: number; visible: boolean },
> {
  getLayers: (node: TNode) => TLayer[];
  getLayerMap: (node: TNode) => Map<string, TLayer>;
  getChildParentLayerId: (node: TNode, child: TChild) => string | null;
  isLayerVisible: (node: TNode, layerId: string | null | undefined) => boolean;
  isChildVisible: (node: TNode, child: TChild) => boolean;
  getLayerChildIds: (node: TNode, layerId: string) => string[];
  getCommonParentLayerId: (node: TNode, childIds: readonly string[]) => string | null;
  getCreationParentLayerId: (
    node: TNode,
    selectedLayerIds?: readonly string[],
    selectedChildIds?: readonly string[],
  ) => string | null;
  getNextLayerName: (node: TNode) => string;
  createLayer: (name: string, parentLayerId?: string | null) => TLayer;
  toggleLayerExpanded: (node: TNode, layerId: string) => { layers: TLayer[] };
  toggleLayerVisibility: (node: TNode, layerId: string) => { layers: TLayer[] };
  toggleChildVisibility: (node: TNode, childId: string) => { children: TChild[] };
  canMoveLayerToParent: (node: TNode, layerId: string, parentLayerId: string | null) => boolean;
  moveLayer: (node: TNode, layerId: string, parentLayerId: string | null) => { layers: TLayer[] };
  getItemParentLayerId: (node: TNode, item: TItemRef) => string | null;
  getOrderedSiblingItems: (node: TNode, parentLayerId: string | null) => TItemRef[];
  getOrderedSiblingItemsExcluding: (
    node: TNode,
    parentLayerId: string | null,
    excludeItem?: TItemRef,
  ) => TItemRef[];
  filterTopLevelItems: (node: TNode, items: readonly TItemRef[]) => TItemRef[];
  normalizeItems: (node: TNode, items: readonly TItemRef[]) => TItemRef[];
  assignSiblingStackOrders: (
    siblingItems: TItemRef[],
    stackOrderByKey: Map<string, number>,
  ) => void;
  areSiblingOrdersEqual: (a: readonly TItemRef[], b: readonly TItemRef[]) => boolean;
  flattenItemRefs: (items: readonly THierarchyItem[]) => TItemRef[];
  getOrderedItems: (node: TNode, items: readonly TItemRef[]) => TItemRef[];
  moveHierarchyItems: (
    node: TNode,
    items: readonly TItemRef[],
    parentLayerId: string | null,
    siblingIndex: number,
  ) => { layers: TLayer[]; children: TChild[] };
  moveHierarchyItem: (
    node: TNode,
    item: TItemRef,
    parentLayerId: string | null,
    siblingIndex: number,
  ) => { layers: TLayer[]; children: TChild[] };
  deleteLayer: (node: TNode, layerId: string) => { layers: TLayer[]; children: TChild[] };
  buildHierarchy: (node: TNode, frame?: number) => THierarchyItem[];
  getCommonHierarchyParentId: (node: TNode, items: readonly TItemRef[]) => string | null;
  getResolvedLayerVisibilityMap: (node: TNode) => Map<string, boolean>;
}

export function createHierarchySystem<
  TNode extends { layers?: TLayer[] },
  TLayer extends HLayer,
  TChild extends HChild,
  TItemRef extends HItemRef,
  THierarchyItem extends { type: string; depth: number; visible: boolean },
>(
  config: HierarchySystemConfig<TNode, TLayer, TChild, TItemRef, THierarchyItem>,
): HierarchySystem<TNode, TLayer, TChild, TItemRef, THierarchyItem> {
  const getResolvedLayerVisibilityMap = (node: TNode): Map<string, boolean> => {
    const layerMap = new Map(getLayers(node).map((l) => [l.id, l]));
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

  const getLayers = (node: TNode): TLayer[] => config.getLayers(node);

  const getLayerMap = (node: TNode): Map<string, TLayer> =>
    new Map(getLayers(node).map((layer) => [layer.id, layer]));

  const getChildParentLayerId = (node: TNode, child: TChild): string | null =>
    config.getChildParentLayerId(node, child);

  const isLayerVisible = (node: TNode, layerId: string | null | undefined): boolean => {
    if (!layerId) return true;

    const layerMap = getLayerMap(node);
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

  const isChildVisible = (node: TNode, child: TChild): boolean => {
    if (child.visible === false) return false;
    return isLayerVisible(node, getChildParentLayerId(node, child));
  };

  const getDescendantLayerIds = (
    node: TNode,
    layerId: string,
    visited: Set<string> = new Set(),
  ): Set<string> => {
    const descendantIds = new Set<string>();
    if (visited.has(layerId)) return descendantIds;

    visited.add(layerId);
    const layers = getLayers(node);
    const directChildren = layers.filter((layer) => layer.parentLayerId === layerId);
    directChildren.forEach((layer) => {
      descendantIds.add(layer.id);
      getDescendantLayerIds(node, layer.id, visited).forEach((id) => descendantIds.add(id));
    });

    return descendantIds;
  };

  const getLayerChildIds = (node: TNode, layerId: string): string[] => {
    const layerIds = getDescendantLayerIds(node, layerId);
    layerIds.add(layerId);

    return config
      .getChildren(node)
      .filter((child) => {
        const parentLayerId = getChildParentLayerId(node, child);
        return !!parentLayerId && layerIds.has(parentLayerId);
      })
      .map((child) => child.id);
  };

  const getCommonParentLayerId = (node: TNode, childIds: readonly string[]): string | null => {
    const children = config.getChildren(node);
    const selectedChildren = children.filter((child) => childIds.includes(child.id));
    if (selectedChildren.length === 0) return null;

    const firstParentLayerId = getChildParentLayerId(node, selectedChildren[0]);
    return selectedChildren.every(
      (child) => getChildParentLayerId(node, child) === firstParentLayerId,
    )
      ? firstParentLayerId
      : null;
  };

  const getCreationParentLayerId = (
    node: TNode,
    selectedLayerIds: readonly string[] = [],
    selectedChildIds: readonly string[] = [],
  ): string | null => {
    const layerMap = getLayerMap(node);
    const validSelectedLayerIds = [...new Set(selectedLayerIds)].filter((layerId) =>
      layerMap.has(layerId),
    );

    if (validSelectedLayerIds.length === 1) {
      return validSelectedLayerIds[0];
    }

    return selectedChildIds.length > 0 ? getCommonParentLayerId(node, selectedChildIds) : null;
  };

  const getNextLayerName = (node: TNode): string => {
    const existingNames = new Set(getLayers(node).map((layer) => layer.name.toLowerCase()));
    let index = 1;
    while (existingNames.has(`layer ${index}`)) {
      index += 1;
    }
    return `Layer ${index}`;
  };

  const createLayer = (name: string, parentLayerId: string | null = null): TLayer =>
    ({
      id: config.createLayerId(),
      name,
      parentLayerId,
      stackOrder: config.getNextStackOrder(),
      visible: true,
      expanded: true,
    }) as unknown as TLayer;

  const toggleLayerExpanded = (node: TNode, layerId: string): { layers: TLayer[] } => ({
    layers: getLayers(node).map((layer) =>
      layer.id === layerId ? { ...layer, expanded: layer.expanded === false } : layer,
    ),
  });

  const toggleLayerVisibility = (node: TNode, layerId: string): { layers: TLayer[] } => ({
    layers: getLayers(node).map((layer) =>
      layer.id === layerId ? { ...layer, visible: layer.visible === false } : layer,
    ),
  });

  const toggleChildVisibility = (node: TNode, childId: string): { children: TChild[] } => ({
    children: config
      .getChildren(node)
      .map((child) =>
        child.id === childId ? { ...child, visible: child.visible === false } : child,
      ),
  });

  const canMoveLayerToParent = (
    node: TNode,
    layerId: string,
    parentLayerId: string | null,
  ): boolean => {
    if (!parentLayerId) return true;
    if (layerId === parentLayerId) return false;

    const descendantIds = getDescendantLayerIds(node, layerId);
    return !descendantIds.has(parentLayerId);
  };

  const moveLayer = (
    node: TNode,
    layerId: string,
    parentLayerId: string | null,
  ): { layers: TLayer[] } => {
    const validLayerIds = new Set(getLayers(node).map((layer) => layer.id));
    const nextParentLayerId =
      parentLayerId &&
      validLayerIds.has(parentLayerId) &&
      canMoveLayerToParent(node, layerId, parentLayerId)
        ? parentLayerId
        : null;

    return {
      layers: getLayers(node).map((layer) =>
        layer.id === layerId ? { ...layer, parentLayerId: nextParentLayerId } : layer,
      ),
    };
  };

  const getItemParentLayerId = (node: TNode, item: TItemRef): string | null =>
    config.getItemParentLayerId(node, item);

  const getOrderedSiblingItems = (node: TNode, parentLayerId: string | null): TItemRef[] => {
    const layers = getLayers(node);
    const validLayerIds = new Set(layers.map((layer) => layer.id));
    const siblingSources: HierarchySource<TLayer, TChild>[] = [
      ...layers
        .filter((layer) => (layer.parentLayerId ?? null) === parentLayerId)
        .map(
          (layer, fallbackIndex): HierarchySource<TLayer, TChild> => ({
            type: 'layer',
            item: layer,
            fallbackIndex,
          }),
        ),
      ...config
        .getChildren(node)
        .filter((child) => normalizeParentId(child, validLayerIds) === parentLayerId)
        .map(
          (child, fallbackIndex): HierarchySource<TLayer, TChild> => ({
            type: 'child',
            item: child,
            fallbackIndex,
          }),
        ),
    ].sort(compareSources);

    return siblingSources.map((source) => {
      if (source.type === 'layer') {
        return { type: 'layer', id: source.item.id } as TItemRef;
      }
      return { type: config.childTypeName, id: source.item.id } as TItemRef;
    });
  };

  const getOrderedSiblingItemsExcluding = (
    node: TNode,
    parentLayerId: string | null,
    excludeItem?: TItemRef,
  ): TItemRef[] =>
    getOrderedSiblingItems(node, parentLayerId).filter((item) =>
      excludeItem ? !isSameHierarchyItem(item, excludeItem) : true,
    );

  const getCommonHierarchyParentId = (node: TNode, items: readonly TItemRef[]): string | null => {
    const normalizedItems = normalizeItems(node, items);
    if (normalizedItems.length === 0) return null;

    const firstParentLayerId = getItemParentLayerId(node, normalizedItems[0]);
    return normalizedItems.every((item) => getItemParentLayerId(node, item) === firstParentLayerId)
      ? firstParentLayerId
      : null;
  };

  const filterTopLevelItems = (node: TNode, items: readonly TItemRef[]): TItemRef[] => {
    const layerMap = getLayerMap(node);
    const selectedLayerIds = new Set(
      items
        .filter((item): item is Extract<TItemRef, { type: 'layer' }> => item.type === 'layer')
        .map((item) => item.id),
    );

    return items.filter((item) => {
      let parentLayerId = getItemParentLayerId(node, item);

      while (parentLayerId) {
        if (selectedLayerIds.has(parentLayerId)) {
          return false;
        }
        parentLayerId = layerMap.get(parentLayerId)?.parentLayerId ?? null;
      }

      return true;
    });
  };

  const normalizeItems = (node: TNode, items: readonly TItemRef[]): TItemRef[] => {
    const layerMap = getLayerMap(node);

    return filterTopLevelItems(
      node,
      [...items].filter((item, index, collection) => {
        if (collection.findIndex((candidate) => isSameHierarchyItem(candidate, item)) !== index) {
          return false;
        }

        if (item.type === 'layer') {
          return layerMap.has(item.id);
        }

        return config.getChildren(node).some((child) => child.id === item.id);
      }),
    );
  };

  const assignSiblingStackOrders = (
    siblingItems: TItemRef[],
    stackOrderByKey: Map<string, number>,
  ) => {
    for (let index = siblingItems.length - 1; index >= 0; index -= 1) {
      stackOrderByKey.set(getHierarchyItemKey(siblingItems[index]), config.getNextStackOrder());
    }
  };

  const areSiblingOrdersEqual = (a: readonly TItemRef[], b: readonly TItemRef[]): boolean =>
    a.length === b.length && a.every((item, index) => isSameHierarchyItem(item, b[index]));

  const flattenItemRefs = (items: readonly THierarchyItem[], refs: TItemRef[] = []): TItemRef[] => {
    items.forEach((item) => {
      const children = config.getHierarchyItemChildren(item);
      if (children) {
        refs.push({ type: 'layer', id: config.getHierarchyItemId(item) } as TItemRef);
        flattenItemRefs(children, refs);
        return;
      }

      refs.push({ type: config.childTypeName, id: config.getHierarchyItemId(item) } as TItemRef);
    });

    return refs;
  };

  const getOrderedItems = (node: TNode, items: readonly TItemRef[]): TItemRef[] => {
    const normalizedItems = normalizeItems(node, items);
    if (normalizedItems.length <= 1) return normalizedItems;

    const indexByKey = new Map(
      flattenItemRefs(buildHierarchy(node)).map((item, index) => [
        getHierarchyItemKey(item),
        index,
      ]),
    );

    return [...normalizedItems].sort(
      (a, b) =>
        (indexByKey.get(getHierarchyItemKey(a)) ?? Number.MAX_SAFE_INTEGER) -
        (indexByKey.get(getHierarchyItemKey(b)) ?? Number.MAX_SAFE_INTEGER),
    );
  };

  const moveHierarchyItems = (
    node: TNode,
    items: readonly TItemRef[],
    parentLayerId: string | null,
    siblingIndex: number,
  ): { layers: TLayer[]; children: TChild[] } => {
    const originalLayers = Array.isArray(node.layers) ? node.layers : [];
    const layers = getLayers(node);
    const validLayerIds = new Set(layers.map((layer) => layer.id));
    const nextParentLayerId =
      parentLayerId && validLayerIds.has(parentLayerId) ? parentLayerId : null;

    const normalizedItems = getOrderedItems(node, items);

    if (normalizedItems.length === 0) {
      return { layers: originalLayers, children: config.getChildren(node) };
    }

    const draggedLayerIds = normalizedItems
      .filter((item): item is Extract<TItemRef, { type: 'layer' }> => item.type === 'layer')
      .map((item) => item.id);

    if (
      draggedLayerIds.some((layerId) => !canMoveLayerToParent(node, layerId, nextParentLayerId))
    ) {
      return { layers: originalLayers, children: config.getChildren(node) };
    }

    const draggedItemKeySet = new Set(normalizedItems.map((item) => getHierarchyItemKey(item)));
    const currentParentLayerIds = [
      ...new Set(normalizedItems.map((item) => getItemParentLayerId(node, item))),
    ];
    const nextSiblingItems = getOrderedSiblingItems(node, nextParentLayerId).filter(
      (existingItem) => !draggedItemKeySet.has(getHierarchyItemKey(existingItem)),
    );
    const clampedSiblingIndex = Math.max(0, Math.min(nextSiblingItems.length, siblingIndex));
    nextSiblingItems.splice(clampedSiblingIndex, 0, ...normalizedItems);

    const proposedSiblingItemsByParent = new Map<string | null, TItemRef[]>();
    proposedSiblingItemsByParent.set(nextParentLayerId, nextSiblingItems);

    currentParentLayerIds.forEach((currentParentLayerId) => {
      if (currentParentLayerId === nextParentLayerId) return;
      proposedSiblingItemsByParent.set(
        currentParentLayerId,
        getOrderedSiblingItems(node, currentParentLayerId).filter(
          (existingItem) => !draggedItemKeySet.has(getHierarchyItemKey(existingItem)),
        ),
      );
    });

    const didParentChange = normalizedItems.some(
      (item) => getItemParentLayerId(node, item) !== nextParentLayerId,
    );
    const didSiblingOrderChange = [...proposedSiblingItemsByParent.entries()].some(
      ([affectedParentLayerId, proposedSiblingItems]) =>
        !areSiblingOrdersEqual(
          getOrderedSiblingItems(node, affectedParentLayerId),
          proposedSiblingItems,
        ),
    );

    if (!didParentChange && !didSiblingOrderChange) {
      return { layers: originalLayers, children: config.getChildren(node) };
    }

    const stackOrderByKey = new Map<string, number>();
    proposedSiblingItemsByParent.forEach((proposedSiblingItems) => {
      assignSiblingStackOrders(proposedSiblingItems, stackOrderByKey);
    });

    let didChange = false;

    const nextLayers = layers.map((layer) => {
      const itemKey = getHierarchyItemKey({ type: 'layer', id: layer.id });
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

    const nextChildren = config.getChildren(node).map((child) => {
      const itemKey = getHierarchyItemKey({ type: config.childTypeName, id: child.id } as TItemRef);
      const isDraggedChild = draggedItemKeySet.has(itemKey);
      const nextStackOrder = stackOrderByKey.get(itemKey);
      const resolvedParentLayerId = getChildParentLayerId(node, child);
      const shouldUpdateParent = isDraggedChild && resolvedParentLayerId !== nextParentLayerId;
      const shouldUpdateStackOrder =
        nextStackOrder !== undefined && nextStackOrder !== child.stackOrder;

      if (!shouldUpdateParent && !shouldUpdateStackOrder) {
        return child;
      }

      didChange = true;
      return {
        ...child,
        ...(shouldUpdateParent ? { parentLayerId: nextParentLayerId } : {}),
        ...(shouldUpdateStackOrder ? { stackOrder: nextStackOrder } : {}),
      };
    });

    return didChange
      ? { layers: nextLayers, children: nextChildren }
      : { layers: originalLayers, children: config.getChildren(node) };
  };

  const moveHierarchyItem = (
    node: TNode,
    item: TItemRef,
    parentLayerId: string | null,
    siblingIndex: number,
  ): { layers: TLayer[]; children: TChild[] } =>
    moveHierarchyItems(node, [item], parentLayerId, siblingIndex);

  const deleteLayer = (node: TNode, layerId: string): { layers: TLayer[]; children: TChild[] } =>
    config.deleteLayer(node, layerId);

  const buildHierarchy = (node: TNode, frame?: number): THierarchyItem[] => {
    const layers = getLayers(node);
    const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
    const validLayerIds = new Set(layerMap.keys());
    const layersByParent = new Map<string | null, TLayer[]>();
    const childrenByParent = new Map<string | null, TChild[]>();

    const pushToGroup = <T>(map: Map<string | null, T[]>, key: string | null, value: T) => {
      const current = map.get(key) ?? [];
      current.push(value);
      map.set(key, current);
    };

    layers.forEach((layer) => {
      pushToGroup(layersByParent, layer.parentLayerId ?? null, layer);
    });

    config.getChildren(node).forEach((child) => {
      const parentLayerId = normalizeParentId(child, validLayerIds);
      pushToGroup(childrenByParent, parentLayerId, child);
    });

    const buildItems = (
      parentLayerId: string | null,
      depth: number,
      visitedLayerIds: Set<string>,
    ): THierarchyItem[] => {
      const siblingSources: HierarchySource<TLayer, TChild>[] = [
        ...(layersByParent.get(parentLayerId) ?? []).map(
          (layer, fallbackIndex): HierarchySource<TLayer, TChild> => ({
            type: 'layer',
            item: layer,
            fallbackIndex,
          }),
        ),
        ...(childrenByParent.get(parentLayerId) ?? []).map(
          (child, fallbackIndex): HierarchySource<TLayer, TChild> => ({
            type: 'child',
            item: child,
            fallbackIndex,
          }),
        ),
      ].sort(compareSources);

      const items: THierarchyItem[] = [];

      siblingSources.forEach((source) => {
        if (source.type === 'child') {
          items.push(config.buildChildItem(source.item, depth, node, frame));
          return;
        }

        if (visitedLayerIds.has(source.item.id)) {
          return;
        }

        const nextVisitedLayerIds = new Set(visitedLayerIds);
        nextVisitedLayerIds.add(source.item.id);
        const children = buildItems(source.item.id, depth + 1, nextVisitedLayerIds);

        items.push(config.buildLayerItem(source.item, depth, children, node, frame));
      });

      return items;
    };

    return buildItems(null, 0, new Set());
  };

  return {
    getLayers,
    getLayerMap,
    getChildParentLayerId,
    isLayerVisible,
    isChildVisible,
    getLayerChildIds,
    getCommonParentLayerId,
    getCreationParentLayerId,
    getNextLayerName,
    createLayer,
    toggleLayerExpanded,
    toggleLayerVisibility,
    toggleChildVisibility,
    canMoveLayerToParent,
    moveLayer,
    getItemParentLayerId,
    getOrderedSiblingItems,
    getOrderedSiblingItemsExcluding,
    filterTopLevelItems,
    normalizeItems,
    assignSiblingStackOrders,
    areSiblingOrdersEqual,
    flattenItemRefs,
    getOrderedItems,
    moveHierarchyItems,
    moveHierarchyItem,
    deleteLayer,
    buildHierarchy,
    getCommonHierarchyParentId,
    getResolvedLayerVisibilityMap,
  };
}
