import type { RotoLayer, RotoNode, RotoPath } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { createHierarchySystem } from '@/utils/hierarchySystem';
import { normalizeParentId } from '@/utils/hierarchyHelpers';

let lastRotoStackOrder = 0;

export const getNextRotoStackOrder = (): number => {
  const now = Date.now();
  lastRotoStackOrder = Math.max(now, lastRotoStackOrder + 1);
  return lastRotoStackOrder;
};

const createRotoId = (prefix: 'layer') =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const rotoGetLayers = (node: RotoNode): RotoLayer[] => {
  const rawLayers = Array.isArray(node.layers) ? node.layers : [];
  const validLayerIds = new Set(rawLayers.map((layer) => layer.id));

  return rawLayers.map((layer) => ({
    ...layer,
    parentLayerId: normalizeParentId(layer, validLayerIds, layer.id),
    visible: layer.visible !== false,
    expanded: layer.expanded !== false,
  }));
};

const rotoGetChildParentLayerId = (node: RotoNode, path: RotoPath): string | null =>
  normalizeParentId(path, new Set(rotoGetLayers(node).map((layer) => layer.id)));

const rotoDeleteLayer = (
  node: RotoNode,
  layerId: string,
): { layers: RotoLayer[]; children: RotoPath[] } => {
  const layers = rotoGetLayers(node);

  // Collect all layer IDs to remove (the layer itself + all descendants)
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
    children: node.paths.filter((path) => {
      const parentId = rotoGetChildParentLayerId(node, path);
      return !parentId || !removedIds.has(parentId);
    }),
  };
};

const rotoIsLayerVisible = (node: RotoNode, layerId: string | null | undefined): boolean => {
  if (!layerId) return true;

  const layers = rotoGetLayers(node);
  const layerMap = new Map(layers.map((l) => [l.id, l]));
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

const rotoGetItemParentLayerId = (node: RotoNode, item: RotoHierarchyItemRef): string | null => {
  if (item.type === 'layer') {
    return rotoGetLayers(node).find((layer) => layer.id === item.id)?.parentLayerId ?? null;
  }

  const path = node.paths.find((existingPath) => existingPath.id === item.id);
  return path ? rotoGetChildParentLayerId(node, path) : null;
};

export type RotoHierarchyItemRef = { type: 'layer'; id: string } | { type: 'path'; id: string };

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

const rotoGetHierarchyItemId = (item: RotoHierarchyItem): string =>
  item.type === 'layer' ? item.layer.id : item.path.id;

const rotoGetHierarchyItemChildren = (
  item: RotoHierarchyItem,
): readonly RotoHierarchyItem[] | undefined => (item.type === 'layer' ? item.children : undefined);

const _hier = createHierarchySystem({
  childTypeName: 'path' as const,
  getLayers: rotoGetLayers,
  getChildren: (node: RotoNode) => node.paths,
  getChildParentLayerId: rotoGetChildParentLayerId,
  getItemParentLayerId: rotoGetItemParentLayerId,
  getNextStackOrder: getNextRotoStackOrder,
  createLayerId: () => createRotoId('layer'),
  buildLayerItem: (
    layer: RotoLayer,
    depth: number,
    children: RotoHierarchyItem[],
    node: RotoNode,
    _frame?: number,
  ): RotoHierarchyItem => ({
    type: 'layer',
    layer,
    depth,
    pathCount: countHierarchyPaths(children),
    visible: rotoIsLayerVisible(node, layer.id),
    children,
  }),
  buildChildItem: (
    path: RotoPath,
    depth: number,
    node: RotoNode,
    _frame?: number,
  ): RotoHierarchyItem => ({
    type: 'path',
    path,
    depth,
    visible:
      path.visible !== false && rotoIsLayerVisible(node, rotoGetChildParentLayerId(node, path)),
  }),
  countHierarchyChildren: countHierarchyPaths,
  deleteLayer: rotoDeleteLayer,
  getHierarchyItemId: rotoGetHierarchyItemId,
  getHierarchyItemChildren: rotoGetHierarchyItemChildren,
});

export const getRotoLayers = _hier.getLayers;

export const getRotoLayerMap = _hier.getLayerMap;

export const getRotoPathParentLayerId = _hier.getChildParentLayerId;

const isRotoLayerVisible = _hier.isLayerVisible;

const rotoGetResolvedLayerVisibilityMap = _hier.getResolvedLayerVisibilityMap;

export const getVisibleRotoPaths = (node: RotoNode): RotoPath[] => {
  const layerMap = getRotoLayerMap(node);
  const layerVisibilityMap = rotoGetResolvedLayerVisibilityMap(node);

  return node.paths.filter((path) => {
    if (path.visible === false) return false;

    const parentLayerId =
      path.parentLayerId && layerMap.has(path.parentLayerId) ? path.parentLayerId : null;
    return !parentLayerId || layerVisibilityMap.get(parentLayerId) !== false;
  });
};

export const isRotoPathVisible = (node: RotoNode, path: RotoPath): boolean => {
  if (path.visible === false) return false;
  return isRotoLayerVisible(node, getRotoPathParentLayerId(node, path));
};

export const isRotoPathActiveAtFrame = (node: RotoNode, path: RotoPath, frame: number): boolean => {
  if (!isRotoPathVisible(node, path)) return false;
  return getValueAtFrame(path.opacity, frame) > 0;
};

export const getRotoLayerPathIds = _hier.getLayerChildIds;

export const getCommonRotoParentLayerId = _hier.getCommonParentLayerId;

export const getRotoCreationParentLayerId = _hier.getCreationParentLayerId;

export const getNextRotoLayerName = _hier.getNextLayerName;

export const createRotoLayer = _hier.createLayer;

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
  parentLayerId: string | null = _hier.getCommonHierarchyParentId(
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

export const createRotoLayerFromHierarchySelection = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
  name: string = getNextRotoLayerName(node),
  parentLayerId: string | null = _hier.getCommonHierarchyParentId(node, items),
): { layer: RotoLayer; updates: Pick<RotoNode, 'layers' | 'paths'> } => {
  const layer = createRotoLayer(name, parentLayerId);
  const orderedItems = _hier.getOrderedItems(node, items);
  const nextNode: RotoNode = {
    ...node,
    layers: [layer, ...getRotoLayers(node)],
  };
  const updates = _hier.moveHierarchyItems(nextNode, orderedItems, layer.id, 0);

  return {
    layer,
    updates: {
      layers: updates.layers,
      paths: updates.children,
    },
  };
};

export const prependRotoPath = (node: RotoNode, path: RotoPath): Pick<RotoNode, 'paths'> => ({
  paths: [{ ...path, stackOrder: path.stackOrder ?? getNextRotoStackOrder() }, ...node.paths],
});

export const deleteRotoLayer = (
  node: RotoNode,
  layerId: string,
): Pick<RotoNode, 'layers' | 'paths'> => {
  const result = _hier.deleteLayer(node, layerId);
  return { layers: result.layers, paths: result.children };
};

export const toggleRotoLayerExpanded = (
  node: RotoNode,
  layerId: string,
): Pick<RotoNode, 'layers'> => _hier.toggleLayerExpanded(node, layerId);

export const toggleRotoLayerVisibility = (
  node: RotoNode,
  layerId: string,
): Pick<RotoNode, 'layers'> => _hier.toggleLayerVisibility(node, layerId);

export const toggleRotoPathVisibility = (
  node: RotoNode,
  pathId: string,
): Pick<RotoNode, 'paths'> => {
  const result = _hier.toggleChildVisibility(node, pathId);
  return { paths: result.children };
};

export const canMoveRotoLayerToParent = _hier.canMoveLayerToParent;

export const moveRotoLayer = (
  node: RotoNode,
  layerId: string,
  parentLayerId: string | null,
): Pick<RotoNode, 'layers'> => _hier.moveLayer(node, layerId, parentLayerId);

export const getRotoItemParentLayerId = _hier.getItemParentLayerId;

export const getOrderedRotoSiblingItems = _hier.getOrderedSiblingItemsExcluding;

export const filterTopLevelRotoHierarchyItems = _hier.filterTopLevelItems;

export const moveRotoHierarchyItems = (
  node: RotoNode,
  items: readonly RotoHierarchyItemRef[],
  parentLayerId: string | null,
  siblingIndex: number,
): Pick<RotoNode, 'layers' | 'paths'> => {
  const result = _hier.moveHierarchyItems(node, items, parentLayerId, siblingIndex);
  return { layers: result.layers, paths: result.children };
};

export const moveRotoHierarchyItem = (
  node: RotoNode,
  item: RotoHierarchyItemRef,
  parentLayerId: string | null,
  siblingIndex: number,
): Pick<RotoNode, 'layers' | 'paths'> => {
  const result = _hier.moveHierarchyItem(node, item, parentLayerId, siblingIndex);
  return { layers: result.layers, paths: result.children };
};

export const buildRotoHierarchy = _hier.buildHierarchy;

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
