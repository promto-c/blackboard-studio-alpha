import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
  useTreePanelState,
  flattenHierarchy,
  type FlatTreeRow,
} from '@/components/useTreeItemsPanel';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  AnyNode,
  PaintLayer,
  PaintNode,
  type PaintLifetime,
  type PaintStroke,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { getLayerOptions, type HierarchyItemNode } from '@/utils/itemsHierarchy';
import { usePaintItemsClipboard } from './paintItemsClipboard';
import PaintLifetimeMenuSection from './PaintLifetimeMenuSection';
import { CloneIcon, EraserIcon } from './PaintIcons';
import { getPaintLifetimeBadgeLabel, normalizePaintLifetime } from './paintLifetime';
import {
  assignPaintStrokesToLayer,
  buildPaintHierarchy,
  canMovePaintLayerToParent,
  createPaintLayer,
  deletePaintLayer,
  filterTopLevelPaintHierarchyItems,
  getNextPaintLayerName,
  getPaintCreationParentLayerId,
  getOrderedPaintSiblingItems,
  getPaintLayerStrokeIds,
  getPaintLayers,
  getPaintStrokeParentLayerId,
  movePaintHierarchyItems,
  movePaintLayer,
  togglePaintLayerExpanded,
  togglePaintLayerVisibility,
  wrapPaintSelectionInNewLayer,
  type PaintHierarchyItem,
  type PaintHierarchyItemRef,
} from './paintLayers';
import { getHierarchyItemKey } from '@/utils/hierarchyHelpers';

interface PaintItemsPanelProps {
  node: AnyNode;
  inspectorLevel?: string;
  onInspectorLevelChange?: (level: string) => void;
}

type Row = FlatTreeRow<PaintHierarchyItemRef> & {
  stroke?: PaintStroke;
  layer?: PaintLayer;
};

const getCommonLifetime = (
  items: ReadonlyArray<{ lifetime?: PaintLifetime | null }>,
): PaintLifetime | undefined => {
  if (items.length === 0) return undefined;
  const firstLifetime = normalizePaintLifetime(items[0].lifetime);
  const firstKey = JSON.stringify(firstLifetime);
  return items.every((item) => JSON.stringify(normalizePaintLifetime(item.lifetime)) === firstKey)
    ? firstLifetime
    : undefined;
};

const toolLabel = (stroke: PaintStroke): string =>
  stroke.tool === 'brush' ? 'Brush' : stroke.tool === 'erase' ? 'Erase' : 'Clone';

const toolIcon = (stroke: PaintStroke): React.ReactNode => {
  if (stroke.tool === 'brush') return <Icons.Brush className="h-3.5 w-3.5 flex-shrink-0" />;
  if (stroke.tool === 'erase') return <EraserIcon className="h-3.5 w-3.5 flex-shrink-0" />;
  return <CloneIcon className="h-3.5 w-3.5 flex-shrink-0" />;
};

function PaintItemsPanel({
  node: anyNode,
  inspectorLevel: _inspectorLevel,
  onInspectorLevelChange: _onInspectorLevelChange,
}: PaintItemsPanelProps) {
  const node = anyNode as PaintNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const maxFrames = useEditorSelector((state) => state.maxFrames);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedLayerIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.layerIds ?? [],
  );
  const selectedStrokeIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.itemIds ?? [],
  );
  const { setHierarchySelection, updateNode } = useEditorActions();
  const nodeId = selectedNodeId ?? '';

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------
  const layers = useMemo(() => getPaintLayers(node), [node]);
  const hierarchy = useMemo(() => buildPaintHierarchy(node, currentFrame), [node, currentFrame]);
  const layerMap = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  const layerOptions = useMemo<LayerOption[]>(() => getLayerOptions(hierarchy), [hierarchy]);
  const strokeIndexById = useMemo(
    () => new Map(node.strokes.map((stroke, index) => [stroke.id, index])),
    [node.strokes],
  );

  const { rows: flatHierarchy, keys: flatHierarchyKeys } = useMemo(
    () =>
      flattenHierarchy<PaintHierarchyItemRef>(hierarchy, 'stroke', (item: PaintHierarchyItem) =>
        item.type === 'stroke' ? item.stroke : null,
      ),
    [hierarchy],
  );

  // -----------------------------------------------------------------------
  // Validate selection on node changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    const validLayerIds = new Set(layers.map((layer) => layer.id));
    const nextSelectedLayerIds = selectedLayerIds.filter((id) => validLayerIds.has(id));
    if (nextSelectedLayerIds.length !== selectedLayerIds.length) {
      setHierarchySelection(nodeId, nextSelectedLayerIds, selectedStrokeIds);
    }
    const validStrokeIds = new Set(node.strokes.map((stroke) => stroke.id));
    const nextStrokeIds = selectedStrokeIds.filter((id) => validStrokeIds.has(id));
    if (nextStrokeIds.length !== selectedStrokeIds.length) {
      setHierarchySelection(nodeId, selectedLayerIds, nextStrokeIds);
    }
  }, [nodeId, layers, node.strokes, selectedLayerIds, selectedStrokeIds, setHierarchySelection]);

  // -----------------------------------------------------------------------
  // Selection state
  // -----------------------------------------------------------------------
  const selectedLayerIdSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);
  const selectedStrokeIdSet = useMemo(() => new Set(selectedStrokeIds), [selectedStrokeIds]);
  const selectedLayers = useMemo(
    () => selectedLayerIds.map((id) => layerMap.get(id)).filter((l): l is PaintLayer => !!l),
    [layerMap, selectedLayerIds],
  );
  const selectedStrokes = useMemo(
    () => node.strokes.filter((stroke) => selectedStrokeIdSet.has(stroke.id)),
    [node.strokes, selectedStrokeIdSet],
  );
  const selectedLayer =
    selectedLayers.length === 1 && selectedStrokeIds.length === 0 ? selectedLayers[0] : null;
  const hasSelectedLayers = selectedLayers.length > 0;
  const hasSelectedStrokes = selectedStrokes.length > 0;
  const hasMixedSelection = hasSelectedLayers && hasSelectedStrokes;
  const selectedItemCount = selectedLayers.length + selectedStrokes.length;

  // -----------------------------------------------------------------------
  // Clipboard
  // -----------------------------------------------------------------------
  const clipboardHotkeys = usePaintItemsClipboard({
    node,
    selectedLayerIds,
    selectedStrokeIds,
    updateNode,
    onSetHierarchySelection: (layerIds: string[], itemIds: string[]) =>
      setHierarchySelection(nodeId, layerIds, itemIds),
  });

  // -----------------------------------------------------------------------
  // Update helper
  // -----------------------------------------------------------------------
  const applyPaintUpdates = useCallback(
    (updates: Partial<PaintNode>, withHistory = true) => {
      updateNode(node.id, updates, withHistory);
    },
    [node.id, updateNode],
  );

  // -----------------------------------------------------------------------
  // Selection handlers
  // -----------------------------------------------------------------------
  const setSelection = useCallback(
    (sel: { layerIds: string[]; strokeIds: string[] }) => {
      setHierarchySelection(nodeId, sel.layerIds, sel.strokeIds);
    },
    [setHierarchySelection, nodeId],
  );

  const clearSelection = useCallback(() => {
    setHierarchySelection(nodeId, [], []);
  }, [setHierarchySelection, nodeId]);

  const handleSelectAll = useCallback(() => {
    setHierarchySelection(
      nodeId,
      layers.map((l) => l.id),
      node.strokes.map((s) => s.id),
    );
  }, [layers, node.strokes, setHierarchySelection, nodeId]);

  const handleSelectLayer = useCallback(
    (layerId: string, extendSelection: boolean) => {
      if (extendSelection) {
        setHierarchySelection(
          nodeId,
          selectedLayerIdSet.has(layerId)
            ? selectedLayerIds.filter((id) => id !== layerId)
            : [...selectedLayerIds, layerId],
          selectedStrokeIds,
        );
        return;
      }
      setHierarchySelection(nodeId, [layerId], []);
    },
    [selectedLayerIdSet, selectedLayerIds, selectedStrokeIds, setHierarchySelection, nodeId],
  );

  const handleSelectStroke = useCallback(
    (strokeId: string, extendSelection: boolean) => {
      if (extendSelection) {
        setHierarchySelection(
          nodeId,
          selectedLayerIds,
          selectedStrokeIds.includes(strokeId)
            ? selectedStrokeIds.filter((id) => id !== strokeId)
            : [...selectedStrokeIds, strokeId],
        );
        return;
      }
      setHierarchySelection(nodeId, [], [strokeId]);
    },
    [selectedLayerIds, selectedStrokeIds, setHierarchySelection, nodeId],
  );

  // -----------------------------------------------------------------------
  // Range selection
  // -----------------------------------------------------------------------
  const rangeAnchorRef = useRef<string | null>(null);

  const handleItemSelect = useCallback(
    (rowKey: string, shiftKey: boolean, toggleKey: boolean) => {
      const sep = rowKey.indexOf(':');
      const type = rowKey.slice(0, sep);
      const id = rowKey.slice(sep + 1);

      if (shiftKey && rangeAnchorRef.current) {
        const start = flatHierarchyKeys.indexOf(rangeAnchorRef.current);
        const end = flatHierarchyKeys.indexOf(rowKey);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          const range = flatHierarchyKeys.slice(from, to + 1);
          const rangeSet = new Set(range);
          const nextLayerIds: string[] = [];
          const nextStrokeIds: string[] = [];
          for (const row of flatHierarchy) {
            if (!rangeSet.has(row.key)) continue;
            if (row.item.type === 'layer') nextLayerIds.push(row.item.id);
            else nextStrokeIds.push(row.item.id);
          }
          setSelection({ layerIds: nextLayerIds, strokeIds: nextStrokeIds });
          return;
        }
      }

      if (toggleKey) {
        rangeAnchorRef.current = rowKey;
        if (type === 'layer') handleSelectLayer(id, true);
        else handleSelectStroke(id, true);
        return;
      }

      rangeAnchorRef.current = rowKey;
      if (type === 'layer') handleSelectLayer(id, false);
      else handleSelectStroke(id, false);
    },
    [flatHierarchy, flatHierarchyKeys, handleSelectLayer, handleSelectStroke, setSelection],
  );

  // -----------------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------------
  const moveStroke = useCallback(
    (strokeId: string, direction: -1 | 1) => {
      const item = { type: 'stroke' as const, id: strokeId };
      const stroke = node.strokes.find((candidate) => candidate.id === strokeId);
      if (!stroke) return;

      const parentLayerId = getPaintStrokeParentLayerId(node, stroke);
      const siblingItems = getOrderedPaintSiblingItems(node, parentLayerId);
      const index = siblingItems.findIndex(
        (candidate) => candidate.type === 'stroke' && candidate.id === strokeId,
      );
      const targetIndex = direction === -1 ? index - 1 : index + 1;
      if (index === -1 || targetIndex < 0 || targetIndex >= siblingItems.length) return;

      const updates = movePaintHierarchyItems(node, [item], parentLayerId, targetIndex);
      applyPaintUpdates(updates);
    },
    [applyPaintUpdates, node],
  );

  const toggleStrokeVisibility = useCallback(
    (strokeId: string) => {
      const strokes = node.strokes.map((stroke) =>
        stroke.id === strokeId ? { ...stroke, visible: !stroke.visible } : stroke,
      );
      applyPaintUpdates({ strokes });
    },
    [applyPaintUpdates, node.strokes],
  );

  const deleteStroke = useCallback(
    (strokeId: string) => {
      setHierarchySelection(
        nodeId,
        [],
        selectedStrokeIds.filter((id) => id !== strokeId),
      );
      applyPaintUpdates({
        strokes: node.strokes.filter((stroke) => stroke.id !== strokeId),
      });
    },
    [applyPaintUpdates, node.strokes, selectedStrokeIds, setHierarchySelection, nodeId],
  );

  const createLayerAt = useCallback(
    (parentLayerId?: string | null) => {
      const nextParentLayerId =
        parentLayerId !== undefined
          ? parentLayerId
          : getPaintCreationParentLayerId(node, selectedLayerIds, selectedStrokeIds);
      const layer = createPaintLayer(getNextPaintLayerName(node), nextParentLayerId);
      setHierarchySelection(nodeId, [layer.id], []);
      applyPaintUpdates({ layers: [layer, ...layers] });
    },
    [
      applyPaintUpdates,
      layers,
      node,
      selectedLayerIds,
      selectedStrokeIds,
      setHierarchySelection,
      nodeId,
    ],
  );

  const handleWrapSelection = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const { layer, updates } = wrapPaintSelectionInNewLayer(node, selectedStrokeIds);
    setHierarchySelection(nodeId, [layer.id], []);
    applyPaintUpdates(updates);
  }, [applyPaintUpdates, node, selectedStrokeIds, setHierarchySelection, nodeId]);

  const handleMoveStroke = useCallback(
    (strokeId: string, targetLayerId: string | null) => {
      applyPaintUpdates(assignPaintStrokesToLayer(node, [strokeId], targetLayerId));
    },
    [applyPaintUpdates, node],
  );

  const handleMoveSelectedStrokes = useCallback(
    (targetLayerId: string | null) => {
      if (selectedStrokeIds.length === 0) return;
      applyPaintUpdates(assignPaintStrokesToLayer(node, selectedStrokeIds, targetLayerId));
    },
    [applyPaintUpdates, node, selectedStrokeIds],
  );

  const handleMoveLayer = useCallback(
    (layerId: string, targetLayerId: string | null) => {
      applyPaintUpdates(movePaintLayer(node, layerId, targetLayerId));
    },
    [applyPaintUpdates, node],
  );

  const handleMoveSelectedLayers = useCallback(
    (targetLayerId: string | null) => {
      if (selectedLayerIds.length === 0) return;
      let n: Pick<PaintNode, 'layers'> = { layers: node.layers };
      selectedLayerIds.forEach((layerId) => {
        n = { ...n, ...movePaintLayer(n, layerId, targetLayerId) };
      });
      applyPaintUpdates({ layers: n.layers });
    },
    [applyPaintUpdates, node.layers, selectedLayerIds],
  );

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      setHierarchySelection(
        nodeId,
        selectedLayerIds.filter((id) => id !== layerId),
        selectedStrokeIds,
      );
      applyPaintUpdates(deletePaintLayer(node, layerId));
    },
    [applyPaintUpdates, node, nodeId, selectedLayerIds, selectedStrokeIds, setHierarchySelection],
  );

  // -----------------------------------------------------------------------
  // Lifetime handlers
  // -----------------------------------------------------------------------
  const handleSetStrokeLifetime = useCallback(
    (strokeId: string, lifetime: PaintLifetime) => {
      applyPaintUpdates({
        strokes: node.strokes.map((s) => (s.id === strokeId ? { ...s, lifetime } : s)),
      });
    },
    [applyPaintUpdates, node.strokes],
  );

  const handleSetLayerLifetime = useCallback(
    (layerId: string, lifetime: PaintLifetime) => {
      applyPaintUpdates({
        layers: layers.map((l) => (l.id === layerId ? { ...l, lifetime } : l)),
      });
    },
    [applyPaintUpdates, layers],
  );

  const handleSetSelectedItemsLifetime = useCallback(
    (lifetime: PaintLifetime) => {
      applyPaintUpdates({
        layers: layers.map((l) => (selectedLayerIdSet.has(l.id) ? { ...l, lifetime } : l)),
        strokes: node.strokes.map((s) => (selectedStrokeIdSet.has(s.id) ? { ...s, lifetime } : s)),
      });
    },
    [applyPaintUpdates, layers, node.strokes, selectedLayerIdSet, selectedStrokeIdSet],
  );

  const handleSetSelectedStrokeLifetime = useCallback(
    (lifetime: PaintLifetime) => {
      applyPaintUpdates({
        strokes: node.strokes.map((s) => (selectedStrokeIdSet.has(s.id) ? { ...s, lifetime } : s)),
      });
    },
    [applyPaintUpdates, node.strokes, selectedStrokeIdSet],
  );

  const handleSetSelectedLayerLifetime = useCallback(
    (lifetime: PaintLifetime) => {
      applyPaintUpdates({
        layers: layers.map((l) => (selectedLayerIdSet.has(l.id) ? { ...l, lifetime } : l)),
      });
    },
    [applyPaintUpdates, layers, selectedLayerIdSet],
  );

  // -----------------------------------------------------------------------
  // Visibility
  // -----------------------------------------------------------------------
  const handleToggleSelectedItemsVisibility = useCallback(() => {
    if (selectedLayers.length === 0 && selectedStrokes.length === 0) return;
    const nextVisible = [...selectedLayers, ...selectedStrokes].every(
      (item) => item.visible === false,
    );
    applyPaintUpdates({
      layers: layers.map((l) =>
        selectedLayerIdSet.has(l.id) ? { ...l, visible: nextVisible } : l,
      ),
      strokes: node.strokes.map((s) =>
        selectedStrokeIdSet.has(s.id) ? { ...s, visible: nextVisible } : s,
      ),
    });
  }, [
    applyPaintUpdates,
    layers,
    node.strokes,
    selectedLayerIdSet,
    selectedLayers,
    selectedStrokeIdSet,
    selectedStrokes,
  ]);

  // -----------------------------------------------------------------------
  // Dispatchers
  // -----------------------------------------------------------------------
  const handleStrokeVisibilityAction = useCallback(
    (strokeId: string) => {
      if (selectedItemCount > 1 && selectedStrokeIdSet.has(strokeId)) {
        handleToggleSelectedItemsVisibility();
        return;
      }
      toggleStrokeVisibility(strokeId);
    },
    [
      handleToggleSelectedItemsVisibility,
      selectedItemCount,
      selectedStrokeIdSet,
      toggleStrokeVisibility,
    ],
  );

  const handleLayerVisibilityAction = useCallback(
    (layerId: string) => {
      if (selectedItemCount > 1 && selectedLayerIdSet.has(layerId)) {
        handleToggleSelectedItemsVisibility();
        return;
      }
      applyPaintUpdates(togglePaintLayerVisibility(node, layerId));
    },
    [
      applyPaintUpdates,
      handleToggleSelectedItemsVisibility,
      node,
      selectedItemCount,
      selectedLayerIdSet,
    ],
  );

  const handleStrokeMoveAction = useCallback(
    (strokeId: string, targetLayerId: string | null) => {
      if (selectedStrokeIds.length > 1 && selectedStrokeIdSet.has(strokeId)) {
        handleMoveSelectedStrokes(targetLayerId);
        return;
      }
      handleMoveStroke(strokeId, targetLayerId);
    },
    [handleMoveSelectedStrokes, handleMoveStroke, selectedStrokeIdSet, selectedStrokeIds.length],
  );

  const handleLayerMoveAction = useCallback(
    (layerId: string, targetLayerId: string | null) => {
      if (selectedLayerIds.length > 1 && selectedLayerIdSet.has(layerId)) {
        handleMoveSelectedLayers(targetLayerId);
        return;
      }
      handleMoveLayer(layerId, targetLayerId);
    },
    [handleMoveLayer, handleMoveSelectedLayers, selectedLayerIdSet, selectedLayerIds.length],
  );

  // -----------------------------------------------------------------------
  // Delete selected items
  // -----------------------------------------------------------------------
  const handleDeleteSelectedItems = useCallback(() => {
    if (selectedLayerIds.length === 0 && selectedStrokeIds.length === 0) return;
    const selectedStrokeIdLookup = new Set(selectedStrokeIds);
    let nextNode: Pick<PaintNode, 'layers' | 'strokes'> = { layers, strokes: node.strokes };

    selectedLayerIds.forEach((layerId) => {
      nextNode = { ...nextNode, ...deletePaintLayer(nextNode, layerId) };
    });

    nextNode = {
      ...nextNode,
      strokes: nextNode.strokes.filter((stroke) => !selectedStrokeIdLookup.has(stroke.id)),
    };

    clearSelection();
    applyPaintUpdates(nextNode);
  }, [
    applyPaintUpdates,
    clearSelection,
    layers,
    node.strokes,
    selectedLayerIds,
    selectedStrokeIds,
  ]);

  const handleStrokeDeleteAction = useCallback(
    (strokeId: string) => {
      if (selectedItemCount > 1 && selectedStrokeIdSet.has(strokeId)) {
        handleDeleteSelectedItems();
        return;
      }
      deleteStroke(strokeId);
    },
    [deleteStroke, handleDeleteSelectedItems, selectedItemCount, selectedStrokeIdSet],
  );

  const handleLayerDeleteAction = useCallback(
    (layerId: string) => {
      if (selectedItemCount > 1 && selectedLayerIdSet.has(layerId)) {
        handleDeleteSelectedItems();
        return;
      }
      handleDeleteLayer(layerId);
    },
    [handleDeleteLayer, handleDeleteSelectedItems, selectedItemCount, selectedLayerIdSet],
  );

  const handleStrokeLifetimeAction = useCallback(
    (strokeId: string, lifetime: PaintLifetime) => {
      if (selectedStrokeIds.length > 1 && selectedStrokeIdSet.has(strokeId)) {
        handleSetSelectedStrokeLifetime(lifetime);
        return;
      }
      handleSetStrokeLifetime(strokeId, lifetime);
    },
    [
      handleSetSelectedStrokeLifetime,
      handleSetStrokeLifetime,
      selectedStrokeIdSet,
      selectedStrokeIds.length,
    ],
  );

  const handleLayerLifetimeAction = useCallback(
    (layerId: string, lifetime: PaintLifetime) => {
      if (selectedLayerIds.length > 1 && selectedLayerIdSet.has(layerId)) {
        handleSetSelectedLayerLifetime(lifetime);
        return;
      }
      handleSetLayerLifetime(layerId, lifetime);
    },
    [
      handleSetSelectedLayerLifetime,
      handleSetLayerLifetime,
      selectedLayerIdSet,
      selectedLayerIds.length,
    ],
  );

  // -----------------------------------------------------------------------
  // Drag & Drop + Tree Guides
  // -----------------------------------------------------------------------
  const selectedDragItems = useMemo(
    () =>
      filterTopLevelPaintHierarchyItems(
        node,
        flatHierarchy
          .filter((r) =>
            r.item.type === 'layer'
              ? selectedLayerIdSet.has(r.item.id)
              : selectedStrokeIdSet.has(r.item.id),
          )
          .map((r) => r.item),
      ),
    [node, flatHierarchy, selectedLayerIdSet, selectedStrokeIdSet],
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
  } = useTreePanelState<PaintHierarchyItemRef>({
    leafTypeName: 'stroke',
    hierarchy,
    flatHierarchy,
    flatHierarchyKeys,
    getDragItemsForRow: (row) => {
      const isSelected =
        row.item.type === 'layer'
          ? selectedLayerIdSet.has(row.item.id)
          : selectedStrokeIdSet.has(row.item.id);
      return isSelected && selectedDragItems.length > 0 ? selectedDragItems : [row.item];
    },
    getSiblingItems: (parentLayerId) => getOrderedPaintSiblingItems(node, parentLayerId),
    canDropItemsToParent: (items, parentLayerId) =>
      items.every(
        (item) => item.type !== 'layer' || canMovePaintLayerToParent(node, item.id, parentLayerId),
      ),
    isContainerItem: (item) => item.type === 'layer',
    getContainerItemId: (item) => (item.type === 'layer' ? item.id : null),
    onHierarchyDrop: (items, target) => {
      const updates = movePaintHierarchyItems(
        node,
        items,
        target.parentLayerId,
        target.siblingIndex,
      );
      if (updates.layers === node.layers && updates.strokes === node.strokes) return;
      const nextLayers =
        target.expandLayerId !== null
          ? updates.layers.map((l) =>
              l.id === target.expandLayerId ? { ...l, expanded: true } : l,
            )
          : updates.layers;
      applyPaintUpdates({ layers: nextLayers, strokes: updates.strokes });
    },
    getHierarchyItemDepth: (item: HierarchyItemNode) => item.depth,
    getHierarchyItemChildren: (item: HierarchyItemNode) =>
      item.type === 'layer' ? (item.children ?? []) : [],
    isHierarchyItemExpanded: (item: HierarchyItemNode) =>
      item.type !== 'layer' || item.layer?.expanded !== false,
    getLeafId: (item: HierarchyItemNode) => item.stroke?.id ?? item.path?.id ?? '',
  });

  // -----------------------------------------------------------------------
  // Memos
  // -----------------------------------------------------------------------
  const hasHeaderSelection = selectedItemCount > 0;
  const headerSelectionLabel = `${selectedItemCount} selected`;
  const selectionVisibilityToggleLabel =
    [...selectedLayers, ...selectedStrokes].length > 0 &&
    [...selectedLayers, ...selectedStrokes].every((item) => item.visible === false)
      ? 'Show Selected'
      : 'Hide Selected';

  const selectedStrokeBatchMoveTarget = useMemo(() => {
    if (selectedStrokes.length === 0) return undefined;
    const firstParentLayerId = getPaintStrokeParentLayerId(node, selectedStrokes[0]);
    return selectedStrokes.every((s) => getPaintStrokeParentLayerId(node, s) === firstParentLayerId)
      ? firstParentLayerId
      : undefined;
  }, [node, selectedStrokes]);

  const selectedLayerParentOptions = useMemo(
    () =>
      layerOptions.filter((option) =>
        selectedLayers.length === 0
          ? true
          : selectedLayers.every((l) => canMovePaintLayerToParent(node, l.id, option.id)),
      ),
    [layerOptions, node, selectedLayers],
  );

  const selectedLayerBatchMoveTarget = useMemo(() => {
    if (selectedLayers.length === 0) return undefined;
    const firstParentLayerId = selectedLayers[0].parentLayerId ?? null;
    return selectedLayers.every((l) => (l.parentLayerId ?? null) === firstParentLayerId)
      ? firstParentLayerId
      : undefined;
  }, [selectedLayers]);

  const selectedLifetime = useMemo(
    () => getCommonLifetime([...selectedLayers, ...selectedStrokes]),
    [selectedLayers, selectedStrokes],
  );
  const hasItems = node.strokes.length > 0 || layers.length > 0;

  // -----------------------------------------------------------------------
  // Render hierarchy item
  // -----------------------------------------------------------------------
  const renderHierarchyItem = useCallback(
    (item: PaintHierarchyItem, children: React.ReactNode | null) => {
      if (item.type === 'stroke') {
        const { stroke } = item;
        const lifetimeBadgeLabel = getPaintLifetimeBadgeLabel(stroke.lifetime);
        const rowKey = getHierarchyItemKey({ type: 'stroke', id: stroke.id });
        const row: Row = {
          depth: item.depth,
          item: { type: 'stroke', id: stroke.id },
          key: rowKey,
          label: stroke.name,
          parentLayerId: getPaintStrokeParentLayerId(node, stroke),
          stroke,
        };
        const strokeIndex = strokeIndexById.get(stroke.id) ?? -1;
        const isSelectedTarget = selectedItemCount > 1 && selectedStrokeIdSet.has(stroke.id);
        const strokeVisibilityLabel = isSelectedTarget
          ? selectionVisibilityToggleLabel
          : stroke.visible === false
            ? `Show ${stroke.name}`
            : `Hide ${stroke.name}`;

        return (
          <LeafItemRowShell
            itemName={stroke.name}
            rowKey={rowKey}
            depth={item.depth}
            isSelected={selectedStrokeIdSet.has(stroke.id)}
            isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
            isVisible={item.visible}
            extraOpacityClass={item.activeAtFrame ? '' : 'opacity-60'}
            leadingIcon={toolIcon(stroke)}
            labelExtra={
              <span className="truncate text-[10px] text-gray-500">
                {toolLabel(stroke)} • {Math.round(stroke.size)}px
                {lifetimeBadgeLabel ? ` • ${lifetimeBadgeLabel}` : ''}
              </span>
            }
            menuSectionsBefore={(close) => (
              <PaintLifetimeMenuSection
                lifetime={stroke.lifetime}
                currentFrame={currentFrame}
                maxFrames={maxFrames}
                onApply={(lifetime) => {
                  handleStrokeLifetimeAction(stroke.id, lifetime);
                  close();
                }}
              />
            )}
            menuSectionsAfterMove={(close) => (
              <div className="space-y-1">
                <MenuSectionLabel>Order</MenuSectionLabel>
                <MenuButton
                  icon={<Icons.ArrowUp className="h-4 w-4" />}
                  label="Move Earlier"
                  disabled={strokeIndex <= 0}
                  onClick={() => {
                    moveStroke(stroke.id, -1);
                    close();
                  }}
                />
                <MenuButton
                  icon={<Icons.ArrowDown className="h-4 w-4" />}
                  label="Move Later"
                  disabled={strokeIndex === -1 || strokeIndex >= node.strokes.length - 1}
                  onClick={() => {
                    moveStroke(stroke.id, 1);
                    close();
                  }}
                />
              </div>
            )}
            visibilityLabel={strokeVisibilityLabel}
            menuWidthClass="w-72"
            layerOptions={layerOptions}
            currentParentLayerId={getPaintStrokeParentLayerId(node, stroke)}
            onSelect={(ext) => handleSelectStroke(stroke.id, ext)}
            onToggleVisibility={() => handleStrokeVisibilityAction(stroke.id)}
            onMove={(targetId) => handleStrokeMoveAction(stroke.id, targetId)}
            onDelete={() => handleStrokeDeleteAction(stroke.id)}
            onPointerDown={(e) => handleRowPointerDown(e, row)}
            onPrimaryClick={(e) =>
              handlePrimaryRowClick(e, rowKey, (shift, toggle) =>
                handleItemSelect(rowKey, shift, toggle),
              )
            }
            rowRef={(el) => {
              if (el) rowRefs.current?.set(rowKey, el);
              else rowRefs.current?.delete(rowKey);
            }}
          />
        );
      }

      const rowKey = getHierarchyItemKey({ type: 'layer', id: item.layer.id });
      const row: Row = {
        depth: item.depth,
        item: { type: 'layer', id: item.layer.id },
        key: rowKey,
        label: item.layer.name,
        parentLayerId: item.layer.parentLayerId ?? null,
        layer: item.layer,
      };
      const lifetimeBadgeLabel = getPaintLifetimeBadgeLabel(item.layer.lifetime);
      const isSelectedTarget = selectedItemCount > 1 && selectedLayerIdSet.has(item.layer.id);
      const layerVisibilityLabel = isSelectedTarget
        ? selectionVisibilityToggleLabel
        : item.layer.visible === false
          ? 'Show Layer'
          : 'Hide Layer';

      return (
        <LayerRowShell
          layerName={item.layer.name}
          rowKey={rowKey}
          depth={item.depth}
          isSelected={selectedLayerIdSet.has(item.layer.id)}
          selectedChildCount={
            getPaintLayerStrokeIds(node, item.layer.id).filter((id) => selectedStrokeIdSet.has(id))
              .length
          }
          isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
          isDropInsideTarget={activeDropHighlightLayerId === item.layer.id}
          isVisible={item.visible}
          isExpanded={item.layer.expanded !== false}
          hasChildren={item.children.length > 0}
          itemCount={item.strokeCount}
          extraOpacityClass={item.activeAtFrame ? '' : 'opacity-60'}
          visibilityLabel={layerVisibilityLabel}
          labelExtra={
            lifetimeBadgeLabel ? (
              <span className="truncate text-[10px] text-gray-500">{lifetimeBadgeLabel}</span>
            ) : null
          }
          menuSectionsBefore={(close) => (
            <PaintLifetimeMenuSection
              lifetime={item.layer.lifetime}
              currentFrame={currentFrame}
              maxFrames={maxFrames}
              onApply={(lifetime) => {
                handleLayerLifetimeAction(item.layer.id, lifetime);
                close();
              }}
            />
          )}
          layerMenuExtra={(close) => (
            <MenuButton
              icon={
                layerVisibilityLabel.startsWith('Show') ? (
                  <Icons.Eye className="h-4 w-4" />
                ) : (
                  <Icons.EyeSlash className="h-4 w-4" />
                )
              }
              label={layerVisibilityLabel}
              onClick={() => {
                handleLayerVisibilityAction(item.layer.id);
                close();
              }}
            />
          )}
          menuWidthClass="w-72"
          layerParentOptions={layerOptions.filter((opt) =>
            canMovePaintLayerToParent(node, item.layer.id, opt.id),
          )}
          parentLayerId={item.layer.parentLayerId ?? null}
          onToggleExpand={() =>
            updateNode(node.id, togglePaintLayerExpanded(node, item.layer.id), false)
          }
          onSelectLayer={(ext) => handleSelectLayer(item.layer.id, ext)}
          onToggleVisibility={() => handleLayerVisibilityAction(item.layer.id)}
          onCreateChildLayer={() => createLayerAt(item.layer.id)}
          onMove={(targetId) => handleLayerMoveAction(item.layer.id, targetId)}
          onDelete={() => handleLayerDeleteAction(item.layer.id)}
          onPointerDown={(e) => handleRowPointerDown(e, row)}
          onPrimaryClick={(e) =>
            handlePrimaryRowClick(e, rowKey, (shift, toggle) =>
              handleItemSelect(rowKey, shift, toggle),
            )
          }
          rowRef={(el) => {
            if (el) rowRefs.current?.set(rowKey, el);
            else rowRefs.current?.delete(rowKey);
          }}
        >
          {children}
        </LayerRowShell>
      );
    },
    [
      activeDraggedItemKeySet,
      activeDropHighlightLayerId,
      createLayerAt,
      currentFrame,
      handleItemSelect,
      handleLayerDeleteAction,
      handleLayerLifetimeAction,
      handleLayerMoveAction,
      handleLayerVisibilityAction,
      handlePrimaryRowClick,
      handleRowPointerDown,
      handleSelectLayer,
      handleSelectStroke,
      handleStrokeDeleteAction,
      handleStrokeLifetimeAction,
      handleStrokeMoveAction,
      handleStrokeVisibilityAction,
      layerOptions,
      maxFrames,
      moveStroke,
      node,
      rowRefs,
      selectedItemCount,
      selectedLayerIdSet,
      selectedStrokeIdSet,
      selectionVisibilityToggleLabel,
      strokeIndexById,
      updateNode,
    ],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <ItemsPanelLayout
      title="Items"
      subtitle={
        <>
          {countLabel(layers.length, 'layer', 'layers')} /{' '}
          {countLabel(node.strokes.length, 'stroke', 'strokes')}
        </>
      }
      hasItems={hasItems}
      onDeleteSelected={hasHeaderSelection ? handleDeleteSelectedItems : undefined}
      onSelectAll={hasItems ? handleSelectAll : undefined}
      clipboardHotkeys={clipboardHotkeys}
      emptyState={
        <div className="max-w-[220px] rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-4 text-center text-xs text-gray-500">
          <p className="font-medium text-gray-300">Build your paint pass as a tree</p>
          <p className="mt-1">
            Paint in the viewer, then group committed strokes into layers as the composite grows.
          </p>
        </div>
      }
      headerActions={
        hasHeaderSelection ? (
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
              <div className="truncate font-medium text-gray-100">{headerSelectionLabel}</div>
            </div>
            {selectedLayer ? (
              <button
                type="button"
                onClick={() => createLayerAt(selectedLayer.id)}
                className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                title="Create child layer"
                aria-label="Create child layer"
              >
                <LayerPlusIcon />
              </button>
            ) : selectedStrokes.length > 0 ? (
              <button
                type="button"
                onClick={handleWrapSelection}
                className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                title="Wrap selection in a new layer"
                aria-label="Wrap selection in a new layer"
              >
                <Icons.Bundle className="h-3 w-3" />
              </button>
            ) : null}
            <FloatingMenu
              widthClass="w-72"
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
                    <MenuSectionLabel>
                      {hasMixedSelection ? 'Mixed Selection' : 'Selection'}
                    </MenuSectionLabel>
                    <MenuButton
                      icon={
                        selectionVisibilityToggleLabel === 'Show Selected' ? (
                          <Icons.Eye className="h-4 w-4" />
                        ) : (
                          <Icons.EyeSlash className="h-4 w-4" />
                        )
                      }
                      label={selectionVisibilityToggleLabel}
                      onClick={() => {
                        handleToggleSelectedItemsVisibility();
                        close();
                      }}
                    />
                    {selectedLayer ? (
                      <MenuButton
                        icon={<LayerPlusIcon />}
                        label="New Child Layer"
                        onClick={() => {
                          createLayerAt(selectedLayer.id);
                          close();
                        }}
                      />
                    ) : null}
                    {selectedStrokes.length > 0 ? (
                      <MenuButton
                        icon={<Icons.Bundle className="h-4 w-4" />}
                        label="Wrap In New Layer"
                        onClick={() => {
                          handleWrapSelection();
                          close();
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="h-px bg-white/10" />
                  <PaintLifetimeMenuSection
                    lifetime={selectedLifetime}
                    currentFrame={currentFrame}
                    maxFrames={maxFrames}
                    onApply={(lifetime) => {
                      handleSetSelectedItemsLifetime(lifetime);
                      close();
                    }}
                  />
                  {hasSelectedLayers ? (
                    <>
                      <div className="h-px bg-white/10" />
                      <MoveMenuSection
                        label={hasMixedSelection ? 'Move Layers To' : 'Move To'}
                        options={selectedLayerParentOptions}
                        currentValue={selectedLayerBatchMoveTarget}
                        onMove={(targetLayerId) => {
                          handleMoveSelectedLayers(targetLayerId);
                          close();
                        }}
                        close={close}
                      />
                    </>
                  ) : null}
                  {selectedStrokes.length > 0 ? (
                    <>
                      <div className="h-px bg-white/10" />
                      <MoveMenuSection
                        label={hasMixedSelection ? 'Move Strokes To' : 'Move To'}
                        options={layerOptions}
                        currentValue={selectedStrokeBatchMoveTarget}
                        onMove={(targetLayerId) => {
                          handleMoveSelectedStrokes(targetLayerId);
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
                      handleDeleteSelectedItems();
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
              onClick={() => createLayerAt()}
              className="flex items-center justify-center px-1.5 py-1 text-gray-300 transition hover:bg-white/10"
              title="Create layer"
              aria-label="Create layer"
            >
              <LayerPlusIcon />
            </button>
          </div>
        )
      }
    >
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
          getKey={(item: PaintHierarchyItem) =>
            item.type === 'layer'
              ? getHierarchyItemKey({ type: 'layer', id: item.layer.id })
              : getHierarchyItemKey({ type: 'stroke', id: item.stroke.id })
          }
          getChildren={(item: PaintHierarchyItem) => (item.type === 'layer' ? item.children : [])}
          isExpanded={(item: PaintHierarchyItem) =>
            item.type !== 'layer' || item.layer.expanded !== false
          }
          renderItem={renderHierarchyItem}
        />
      </ItemsTreeView>
    </ItemsPanelLayout>
  );
}

export default PaintItemsPanel;
