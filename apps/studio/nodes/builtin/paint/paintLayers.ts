import type { PaintLayer, PaintNode, PaintStroke } from '@blackboard/types';
import { isPaintLifetimeActiveAtFrame } from './paintLifetime';
import { createHierarchySystem } from '@/utils/hierarchySystem';
import { normalizeParentId } from '@/utils/hierarchyHelpers';

let lastPaintStackOrder = 0;

export const getNextPaintStackOrder = (): number => {
  const now = Date.now();
  lastPaintStackOrder = Math.max(now, lastPaintStackOrder + 1);
  return lastPaintStackOrder;
};

const createPaintLayerId = () =>
  `paint_layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const getPaintLayers = (node: Pick<PaintNode, 'layers'>): PaintLayer[] => {
  const rawLayers = Array.isArray(node.layers) ? node.layers : [];
  const validLayerIds = new Set(rawLayers.map((layer) => layer.id));

  return rawLayers.map((layer) => ({
    ...layer,
    parentLayerId: normalizeParentId(layer, validLayerIds, layer.id),
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
  normalizeParentId(stroke, new Set(getPaintLayers(node).map((layer) => layer.id)));

export const isPaintLayerVisible = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string | null | undefined,
  prebuiltLayerMap?: Map<string, PaintLayer>,
): boolean => {
  if (!layerId) return true;

  const layerMap = prebuiltLayerMap ?? new Map(getPaintLayers(node).map((l) => [l.id, l]));
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

  const layerMap = prebuiltLayerMap ?? new Map(getPaintLayers(node).map((l) => [l.id, l]));
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

export type PaintHierarchyItemRef = { type: 'layer'; id: string } | { type: 'stroke'; id: string };

const countHierarchyStrokes = (items: readonly PaintHierarchyItem[]): number =>
  items.reduce(
    (total, item) => total + (item.type === 'stroke' ? 1 : countHierarchyStrokes(item.children)),
    0,
  );

const paintGetHierarchyItemId = (item: PaintHierarchyItem): string =>
  item.type === 'layer' ? item.layer.id : item.stroke.id;

const paintGetHierarchyItemChildren = (
  item: PaintHierarchyItem,
): readonly PaintHierarchyItem[] | undefined => (item.type === 'layer' ? item.children : undefined);

const paintGetItemParentLayerId = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  item: PaintHierarchyItemRef,
): string | null => {
  if (item.type === 'layer') {
    return getPaintLayers(node).find((layer) => layer.id === item.id)?.parentLayerId ?? null;
  }

  const stroke = node.strokes.find((existingStroke) => existingStroke.id === item.id);
  return stroke ? getPaintStrokeParentLayerId(node, stroke) : null;
};

const paintDeleteLayer = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  layerId: string,
): { layers: PaintLayer[]; children: PaintStroke[] } => {
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
    children: node.strokes.filter((stroke) => {
      const parentId = getPaintStrokeParentLayerId(node, stroke);
      return !parentId || !removedIds.has(parentId);
    }),
  };
};

const _hier = createHierarchySystem({
  childTypeName: 'stroke' as const,
  getLayers: (node: Pick<PaintNode, 'layers' | 'strokes'>) => getPaintLayers(node),
  getChildren: (node: Pick<PaintNode, 'layers' | 'strokes'>) => node.strokes,
  getChildParentLayerId: (node: Pick<PaintNode, 'layers' | 'strokes'>, stroke) =>
    getPaintStrokeParentLayerId(node, stroke),
  getItemParentLayerId: paintGetItemParentLayerId,
  getNextStackOrder: getNextPaintStackOrder,
  createLayerId: createPaintLayerId,
  buildLayerItem: (
    layer: PaintLayer,
    depth: number,
    children: PaintHierarchyItem[],
    node: Pick<PaintNode, 'layers' | 'strokes'>,
    frame?: number,
  ): PaintHierarchyItem => ({
    type: 'layer',
    layer,
    depth,
    visible: isPaintLayerVisible(node, layer.id),
    activeAtFrame: frame === undefined ? true : isPaintLayerActiveAtFrame(node, layer.id, frame),
    children,
    strokeCount: countHierarchyStrokes(children),
  }),
  buildChildItem: (
    stroke: PaintStroke,
    depth: number,
    node: Pick<PaintNode, 'layers' | 'strokes'>,
    frame?: number,
  ): PaintHierarchyItem => ({
    type: 'stroke',
    stroke,
    depth,
    visible:
      stroke.visible !== false &&
      isPaintLayerVisible(node, getPaintStrokeParentLayerId(node, stroke)),
    activeAtFrame:
      frame === undefined
        ? true
        : isPaintLifetimeActiveAtFrame(stroke.lifetime, frame) &&
          isPaintLayerActiveAtFrame(node, getPaintStrokeParentLayerId(node, stroke), frame),
  }),
  countHierarchyChildren: countHierarchyStrokes,
  deleteLayer: paintDeleteLayer,
  getHierarchyItemId: paintGetHierarchyItemId,
  getHierarchyItemChildren: paintGetHierarchyItemChildren,
});

export const getPaintLayerStrokeIds = _hier.getLayerChildIds;

export const getCommonPaintParentLayerId = _hier.getCommonParentLayerId;

export const getPaintCreationParentLayerId = _hier.getCreationParentLayerId;

export const getNextPaintLayerName = _hier.getNextLayerName;

export const createPaintLayer = _hier.createLayer;

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
      strokeIdSet.has(stroke.id) ? { ...stroke, parentLayerId: validTargetLayerId } : stroke,
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

export const canMovePaintLayerToParent = (
  node: Pick<PaintNode, 'layers'>,
  layerId: string,
  parentLayerId: string | null,
): boolean => {
  if (!parentLayerId) return true;
  if (layerId === parentLayerId) return false;

  const descendantIds = new Set<string>();
  const collectDescendants = (parentId: string) => {
    for (const layer of getPaintLayers(node)) {
      if (layer.parentLayerId === parentId && !descendantIds.has(layer.id)) {
        descendantIds.add(layer.id);
        collectDescendants(layer.id);
      }
    }
  };
  collectDescendants(layerId);

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

export const getPaintItemParentLayerId = _hier.getItemParentLayerId;

export const getOrderedPaintSiblingItems = _hier.getOrderedSiblingItemsExcluding;

export const filterTopLevelPaintHierarchyItems = _hier.filterTopLevelItems;

export const movePaintHierarchyItems = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  items: readonly PaintHierarchyItemRef[],
  parentLayerId: string | null,
  siblingIndex: number,
): Pick<PaintNode, 'layers' | 'strokes'> => {
  const result = _hier.moveHierarchyItems(node, items, parentLayerId, siblingIndex);
  return { layers: result.layers, strokes: result.children };
};

export const deletePaintLayer = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  layerId: string,
): Pick<PaintNode, 'layers' | 'strokes'> => {
  const result = _hier.deleteLayer(node, layerId);
  return { layers: result.layers, strokes: result.children };
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

export const buildPaintHierarchy = _hier.buildHierarchy;

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
