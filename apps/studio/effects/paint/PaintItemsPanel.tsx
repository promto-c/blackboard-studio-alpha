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
import { useRangeSelection } from '@/hooks/useRangeSelection';
import { useTreeDragAndDrop, type TreeDragRow } from '@/hooks/useTreeDragAndDrop';
import { useTreeGuideSegments } from '@/hooks/useTreeGuideSegments';
import { useTreeRowExitAnimation } from '@/hooks/useTreeRowExitAnimation';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  AnyNode,
  PaintLayer,
  PaintNode,
  type PaintLifetime,
  type PaintStroke,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { getLayerOptions } from '@/utils/itemsHierarchy';
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
  getPaintHierarchyItemKey,
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
import { type TreeGuideAdapter } from '@/utils/treeGuides';

interface PaintItemsPanelProps {
  node: AnyNode;
  inspectorLevel?: string;
  onInspectorLevelChange?: (level: string) => void;
}

type FlatHierarchyRow = TreeDragRow<PaintHierarchyItemRef> & {
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

const flattenVisibleHierarchy = (
  items: readonly PaintHierarchyItem[],
  parentLayerId: string | null = null,
  rows: FlatHierarchyRow[] = [],
): FlatHierarchyRow[] => {
  items.forEach((item) => {
    if (item.type === 'layer') {
      rows.push({
        depth: item.depth,
        item: { type: 'layer', id: item.layer.id },
        key: getPaintHierarchyItemKey({ type: 'layer', id: item.layer.id }),
        label: item.layer.name,
        parentLayerId,
        layer: item.layer,
      });

      if (item.layer.expanded !== false && item.children.length > 0) {
        flattenVisibleHierarchy(item.children, item.layer.id, rows);
      }

      return;
    }

    rows.push({
      depth: item.depth,
      item: { type: 'stroke', id: item.stroke.id },
      key: getPaintHierarchyItemKey({ type: 'stroke', id: item.stroke.id }),
      label: item.stroke.name,
      parentLayerId,
      stroke: item.stroke,
    });
  });

  return rows;
};
const getPaintHierarchyChildren = (item: PaintHierarchyItem) =>
  item.type === 'layer' ? item.children : [];
const isPaintHierarchyItemExpanded = (item: PaintHierarchyItem) =>
  item.type !== 'layer' || item.layer.expanded !== false;

const paintTreeGuideAdapter: TreeGuideAdapter<PaintHierarchyItem> = {
  getKey: (item) =>
    item.type === 'layer'
      ? getPaintHierarchyItemKey({ type: 'layer', id: item.layer.id })
      : getPaintHierarchyItemKey({ type: 'stroke', id: item.stroke.id }),
  getDepth: (item) => item.depth,
  getChildren: getPaintHierarchyChildren,
  isExpanded: isPaintHierarchyItemExpanded,
};

const toolLabel = (stroke: PaintStroke): string =>
  stroke.tool === 'brush' ? 'Brush' : stroke.tool === 'erase' ? 'Erase' : 'Clone';

const toolIcon = (stroke: PaintStroke): React.ReactNode => {
  if (stroke.tool === 'brush') return <Icons.Brush className="h-3.5 w-3.5 flex-shrink-0" />;
  if (stroke.tool === 'erase') return <EraserIcon className="h-3.5 w-3.5 flex-shrink-0" />;
  return <CloneIcon className="h-3.5 w-3.5 flex-shrink-0" />;
};

const PaintItemsPanel: React.FC<PaintItemsPanelProps> = ({
  node: anyNode,
  inspectorLevel: _inspectorLevel,
  onInspectorLevelChange: _onInspectorLevelChange,
}) => {
  const node = anyNode as PaintNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const maxFrames = useEditorSelector((state) => state.maxFrames);
  const selectedLayerIds = useEditorSelector((state) => state.selectedPaintLayerIds as string[]);
  const selectedStrokeIds = useEditorSelector((state) => state.selectedPaintStrokeIds as string[]);
  const { setSelectedPaintLayerIds, setSelectedPaintStrokeIds, updateNode } = useEditorActions();
  const setSelectedStrokeIds = setSelectedPaintStrokeIds;
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const treeContentRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const animateExit = useTreeRowExitAnimation(rowRefs);

  const layers = useMemo(() => getPaintLayers(node), [node]);
  const hierarchy = useMemo(() => buildPaintHierarchy(node, currentFrame), [node, currentFrame]);
  const flatHierarchy = useMemo(() => flattenVisibleHierarchy(hierarchy), [hierarchy]);
  const flatHierarchyKeys = useMemo(() => flatHierarchy.map((row) => row.key), [flatHierarchy]);
  const {
    setAnchor: setSelectionAnchor,
    clearAnchor: clearSelectionAnchor,
    getRangeKeys,
  } = useRangeSelection();
  const layerMap = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  const layerOptions = useMemo<LayerOption[]>(() => getLayerOptions(hierarchy), [hierarchy]);
  const strokeIndexById = useMemo(
    () => new Map(node.strokes.map((stroke, index) => [stroke.id, index])),
    [node.strokes],
  );

  useEffect(() => {
    const validLayerIds = new Set(layers.map((layer) => layer.id));
    const nextSelectedLayerIds = selectedLayerIds.filter((id) => validLayerIds.has(id));
    if (nextSelectedLayerIds.length !== selectedLayerIds.length) {
      setSelectedPaintLayerIds(nextSelectedLayerIds);
    }

    const validStrokeIds = new Set(node.strokes.map((stroke) => stroke.id));
    const nextStrokeIds = selectedStrokeIds.filter((id) => validStrokeIds.has(id));
    if (nextStrokeIds.length !== selectedStrokeIds.length) {
      setSelectedStrokeIds(nextStrokeIds);
    }
  }, [
    layers,
    node.strokes,
    selectedLayerIds,
    selectedStrokeIds,
    setSelectedPaintLayerIds,
    setSelectedStrokeIds,
  ]);

  const selectedLayerIdSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);
  const selectedStrokeIdSet = useMemo(() => new Set(selectedStrokeIds), [selectedStrokeIds]);
  const selectedLayers = useMemo(
    () =>
      selectedLayerIds
        .map((layerId) => layerMap.get(layerId))
        .filter((layer): layer is PaintLayer => !!layer),
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
  const selectedDragItems = useMemo(
    () =>
      filterTopLevelPaintHierarchyItems(
        node,
        flatHierarchy
          .filter((row) => {
            if (row.item.type === 'layer') return selectedLayerIdSet.has(row.item.id);
            return selectedStrokeIdSet.has(row.item.id);
          })
          .map((row) => row.item),
      ),
    [flatHierarchy, node, selectedLayerIdSet, selectedStrokeIdSet],
  );
  const clipboardHotkeys = usePaintItemsClipboard({
    node,
    selectedLayerIds,
    selectedStrokeIds,
    updateNode,
    setSelectedPaintLayerIds,
    setSelectedPaintStrokeIds: setSelectedStrokeIds,
  });

  const applyPaintUpdates = useCallback(
    async (updates: Partial<PaintNode>, withHistory = true) => {
      updateNode(node.id, updates, withHistory);
    },
    [node.id, updateNode],
  );

  const getDragItemsForRow = useCallback(
    (row: FlatHierarchyRow): PaintHierarchyItemRef[] => {
      const isSelectedRow =
        row.item.type === 'layer'
          ? selectedLayerIdSet.has(row.item.id)
          : selectedStrokeIdSet.has(row.item.id);

      if (isSelectedRow) {
        return selectedDragItems.length > 0 ? selectedDragItems : [row.item];
      }

      return [row.item];
    },
    [selectedDragItems, selectedLayerIdSet, selectedStrokeIdSet],
  );

  const handleHierarchyDrop = useCallback(
    async (
      items: readonly PaintHierarchyItemRef[],
      target: { parentLayerId: string | null; siblingIndex: number; expandLayerId: string | null },
    ) => {
      const updates = movePaintHierarchyItems(
        node,
        items,
        target.parentLayerId,
        target.siblingIndex,
      );

      if (updates.layers === node.layers && updates.strokes === node.strokes) {
        return;
      }

      const nextLayers =
        target.expandLayerId !== null
          ? updates.layers.map((layer) =>
              layer.id === target.expandLayerId ? { ...layer, expanded: true } : layer,
            )
          : updates.layers;

      await applyPaintUpdates({ layers: nextLayers, strokes: updates.strokes });
    },
    [applyPaintUpdates, node],
  );

  const {
    dropTarget,
    handleRowPointerDown,
    handlePrimaryRowClick,
    draggedItemKeySet: activeDraggedItemKeySet,
    activeDropHighlightLayerId,
  } = useTreeDragAndDrop<PaintHierarchyItemRef, FlatHierarchyRow>({
    rows: flatHierarchy,
    rowRefs,
    contentRef: treeContentRef,
    viewportRef: scrollViewportRef,
    getDragItemsForRow,
    getSiblingItems: (parentLayerId) => getOrderedPaintSiblingItems(node, parentLayerId),
    getItemKey: getPaintHierarchyItemKey,
    isSameItem: (a, b) => a.type === b.type && a.id === b.id,
    canDropItemsToParent: (items, parentLayerId) =>
      items.every(
        (item) => item.type !== 'layer' || canMovePaintLayerToParent(node, item.id, parentLayerId),
      ),
    isContainerItem: (item) => item.type === 'layer',
    getContainerItemId: (item) => (item.type === 'layer' ? item.id : null),
    onDrop: handleHierarchyDrop,
  });

  const clearSelection = useCallback(() => {
    setSelectedPaintLayerIds([]);
    setSelectedStrokeIds([]);
    clearSelectionAnchor();
  }, [setSelectedPaintLayerIds, setSelectedStrokeIds, clearSelectionAnchor]);

  const handleSelectAll = useCallback(() => {
    setSelectedPaintLayerIds(layers.map((layer) => layer.id));
    setSelectedStrokeIds(node.strokes.map((stroke) => stroke.id));
    clearSelectionAnchor();
  }, [clearSelectionAnchor, layers, node.strokes, setSelectedPaintLayerIds, setSelectedStrokeIds]);

  const handleSelectLayer = useCallback(
    (layerId: string, extendSelection: boolean) => {
      if (extendSelection) {
        setSelectedPaintLayerIds(
          selectedLayerIdSet.has(layerId)
            ? selectedLayerIds.filter((id) => id !== layerId)
            : [...selectedLayerIds, layerId],
        );
        return;
      }

      setSelectedPaintLayerIds([layerId]);
      setSelectedStrokeIds([]);
    },
    [selectedLayerIdSet, selectedLayerIds, setSelectedPaintLayerIds, setSelectedStrokeIds],
  );

  const handleSelectStroke = useCallback(
    (strokeId: string, extendSelection: boolean) => {
      if (extendSelection) {
        setSelectedStrokeIds(
          selectedStrokeIds.includes(strokeId)
            ? selectedStrokeIds.filter((id) => id !== strokeId)
            : [...selectedStrokeIds, strokeId],
        );
        return;
      }

      setSelectedStrokeIds([strokeId]);
      setSelectedPaintLayerIds([]);
    },
    [selectedStrokeIds, setSelectedPaintLayerIds, setSelectedStrokeIds],
  );

  const handleItemSelect = useCallback(
    (rowKey: string, shiftKey: boolean, toggleKey: boolean) => {
      const separatorIndex = rowKey.indexOf(':');
      const type = rowKey.slice(0, separatorIndex);
      const id = rowKey.slice(separatorIndex + 1);

      if (shiftKey) {
        const rangeKeys = getRangeKeys(rowKey, flatHierarchyKeys);
        if (rangeKeys) {
          const rangeKeySet = new Set(rangeKeys);
          const nextLayerIds: string[] = [];
          const nextStrokeIds: string[] = [];
          for (const row of flatHierarchy) {
            const isSelected =
              row.item.type === 'layer'
                ? selectedLayerIdSet.has(row.item.id)
                : selectedStrokeIdSet.has(row.item.id);

            if (!isSelected && !rangeKeySet.has(row.key)) continue;

            if (row.item.type === 'layer') nextLayerIds.push(row.item.id);
            else nextStrokeIds.push(row.item.id);
          }
          setSelectedPaintLayerIds(nextLayerIds);
          setSelectedStrokeIds(nextStrokeIds);
          return;
        }
      }

      if (toggleKey) {
        if (type === 'layer') handleSelectLayer(id, true);
        else handleSelectStroke(id, true);
        setSelectionAnchor(rowKey);
        return;
      }

      if (type === 'layer') handleSelectLayer(id, false);
      else handleSelectStroke(id, false);
      setSelectionAnchor(rowKey);
    },
    [
      flatHierarchy,
      flatHierarchyKeys,
      getRangeKeys,
      handleSelectLayer,
      handleSelectStroke,
      selectedLayerIdSet,
      selectedStrokeIdSet,
      setSelectedPaintLayerIds,
      setSelectedStrokeIds,
      setSelectionAnchor,
    ],
  );

  const moveStroke = useCallback(
    async (strokeId: string, direction: -1 | 1) => {
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
      await applyPaintUpdates(updates);
    },
    [applyPaintUpdates, node],
  );

  const toggleStrokeVisibility = useCallback(
    async (strokeId: string) => {
      const strokes = node.strokes.map((stroke) =>
        stroke.id === strokeId ? { ...stroke, visible: !stroke.visible } : stroke,
      );
      await applyPaintUpdates({ strokes });
    },
    [applyPaintUpdates, node.strokes],
  );

  const deleteStroke = useCallback(
    (strokeId: string) => {
      const rowKey = getPaintHierarchyItemKey({ type: 'stroke', id: strokeId });
      animateExit([rowKey], () => {
        setSelectedStrokeIds(selectedStrokeIds.filter((id) => id !== strokeId));
        void applyPaintUpdates({
          strokes: node.strokes.filter((stroke) => stroke.id !== strokeId),
        });
      });
    },
    [animateExit, applyPaintUpdates, node.strokes, selectedStrokeIds, setSelectedStrokeIds],
  );

  const createLayerAt = useCallback(
    async (parentLayerId?: string | null) => {
      const nextParentLayerId =
        parentLayerId !== undefined
          ? parentLayerId
          : getPaintCreationParentLayerId(node, selectedLayerIds, selectedStrokeIds);
      const layer = createPaintLayer(getNextPaintLayerName(node), nextParentLayerId);

      setSelectedPaintLayerIds([layer.id]);
      setSelectedStrokeIds([]);
      await applyPaintUpdates({
        layers: [layer, ...layers],
      });
    },
    [
      applyPaintUpdates,
      layers,
      node,
      selectedLayerIds,
      selectedStrokeIds,
      setSelectedPaintLayerIds,
      setSelectedStrokeIds,
    ],
  );

  const handleWrapSelection = useCallback(async () => {
    if (selectedStrokeIds.length === 0) return;

    const { layer, updates } = wrapPaintSelectionInNewLayer(node, selectedStrokeIds);
    setSelectedPaintLayerIds([layer.id]);
    setSelectedStrokeIds([]);
    await applyPaintUpdates(updates);
  }, [applyPaintUpdates, node, selectedStrokeIds, setSelectedPaintLayerIds, setSelectedStrokeIds]);

  const handleMoveStroke = useCallback(
    async (strokeId: string, targetLayerId: string | null) => {
      await applyPaintUpdates(assignPaintStrokesToLayer(node, [strokeId], targetLayerId));
    },
    [applyPaintUpdates, node],
  );

  const handleMoveSelectedStrokes = useCallback(
    async (targetLayerId: string | null) => {
      if (selectedStrokeIds.length === 0) return;
      await applyPaintUpdates(assignPaintStrokesToLayer(node, selectedStrokeIds, targetLayerId));
    },
    [applyPaintUpdates, node, selectedStrokeIds],
  );

  const handleMoveLayer = useCallback(
    async (layerId: string, targetLayerId: string | null) => {
      await applyPaintUpdates(movePaintLayer(node, layerId, targetLayerId));
    },
    [applyPaintUpdates, node],
  );

  const handleMoveSelectedLayers = useCallback(
    async (targetLayerId: string | null) => {
      if (selectedLayerIds.length === 0) return;

      let nextNode: Pick<PaintNode, 'layers'> = {
        layers: node.layers,
      };

      selectedLayerIds.forEach((layerId) => {
        nextNode = { ...nextNode, ...movePaintLayer(nextNode, layerId, targetLayerId) };
      });

      await applyPaintUpdates({ layers: nextNode.layers });
    },
    [applyPaintUpdates, node.layers, selectedLayerIds],
  );

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const rowKey = getPaintHierarchyItemKey({ type: 'layer', id: layerId });
      animateExit([rowKey], () => {
        setSelectedPaintLayerIds(selectedLayerIds.filter((id) => id !== layerId));
        void applyPaintUpdates(deletePaintLayer(node, layerId));
      });
    },
    [animateExit, applyPaintUpdates, node, selectedLayerIds, setSelectedPaintLayerIds],
  );

  const handleSetStrokeLifetime = useCallback(
    async (strokeId: string, lifetime: PaintLifetime) => {
      await applyPaintUpdates({
        strokes: node.strokes.map((stroke) =>
          stroke.id === strokeId ? { ...stroke, lifetime } : stroke,
        ),
      });
    },
    [applyPaintUpdates, node.strokes],
  );

  const handleSetLayerLifetime = useCallback(
    async (layerId: string, lifetime: PaintLifetime) => {
      await applyPaintUpdates({
        layers: layers.map((layer) => (layer.id === layerId ? { ...layer, lifetime } : layer)),
      });
    },
    [applyPaintUpdates, layers],
  );

  const handleSetSelectedItemsLifetime = useCallback(
    async (lifetime: PaintLifetime) => {
      if (selectedLayerIds.length === 0 && selectedStrokeIds.length === 0) return;

      await applyPaintUpdates({
        layers: layers.map((layer) =>
          selectedLayerIdSet.has(layer.id) ? { ...layer, lifetime } : layer,
        ),
        strokes: node.strokes.map((stroke) =>
          selectedStrokeIdSet.has(stroke.id) ? { ...stroke, lifetime } : stroke,
        ),
      });
    },
    [
      applyPaintUpdates,
      layers,
      node.strokes,
      selectedLayerIdSet,
      selectedLayerIds.length,
      selectedStrokeIdSet,
      selectedStrokeIds.length,
    ],
  );

  const handleSetSelectedStrokeLifetime = useCallback(
    async (lifetime: PaintLifetime) => {
      if (selectedStrokeIds.length === 0) return;

      await applyPaintUpdates({
        strokes: node.strokes.map((stroke) =>
          selectedStrokeIdSet.has(stroke.id) ? { ...stroke, lifetime } : stroke,
        ),
      });
    },
    [applyPaintUpdates, node.strokes, selectedStrokeIdSet, selectedStrokeIds.length],
  );

  const handleSetSelectedLayerLifetime = useCallback(
    async (lifetime: PaintLifetime) => {
      if (selectedLayerIds.length === 0) return;

      await applyPaintUpdates({
        layers: layers.map((layer) =>
          selectedLayerIdSet.has(layer.id) ? { ...layer, lifetime } : layer,
        ),
      });
    },
    [applyPaintUpdates, layers, selectedLayerIdSet, selectedLayerIds.length],
  );

  const handleToggleSelectedItemsVisibility = useCallback(async () => {
    if (selectedLayers.length === 0 && selectedStrokes.length === 0) return;

    const nextVisible = [...selectedLayers, ...selectedStrokes].every(
      (item) => item.visible === false,
    );

    await applyPaintUpdates({
      layers: layers.map((layer) =>
        selectedLayerIdSet.has(layer.id) ? { ...layer, visible: nextVisible } : layer,
      ),
      strokes: node.strokes.map((stroke) =>
        selectedStrokeIdSet.has(stroke.id) ? { ...stroke, visible: nextVisible } : stroke,
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

  const handleDeleteSelectedItems = useCallback(() => {
    if (selectedLayerIds.length === 0 && selectedStrokeIds.length === 0) return;

    const keysToAnimate: string[] = [];
    for (const id of selectedLayerIds) {
      keysToAnimate.push(getPaintHierarchyItemKey({ type: 'layer', id }));
    }
    for (const id of selectedStrokeIds) {
      keysToAnimate.push(getPaintHierarchyItemKey({ type: 'stroke', id }));
    }

    animateExit(keysToAnimate, () => {
      const selectedStrokeIdLookup = new Set(selectedStrokeIds);
      let nextNode: Pick<PaintNode, 'layers' | 'strokes'> = {
        layers,
        strokes: node.strokes,
      };

      selectedLayerIds.forEach((layerId) => {
        nextNode = {
          ...nextNode,
          ...deletePaintLayer(nextNode, layerId),
        };
      });

      nextNode = {
        ...nextNode,
        strokes: nextNode.strokes.filter((stroke) => !selectedStrokeIdLookup.has(stroke.id)),
      };

      clearSelection();
      void applyPaintUpdates(nextNode);
    });
  }, [
    animateExit,
    applyPaintUpdates,
    clearSelection,
    layers,
    node.strokes,
    selectedLayerIds,
    selectedStrokeIds,
  ]);

  const handleStrokeVisibilityAction = useCallback(
    async (strokeId: string) => {
      if (selectedItemCount > 1 && selectedStrokeIdSet.has(strokeId)) {
        await handleToggleSelectedItemsVisibility();
        return;
      }

      await toggleStrokeVisibility(strokeId);
    },
    [
      handleToggleSelectedItemsVisibility,
      selectedItemCount,
      selectedStrokeIdSet,
      toggleStrokeVisibility,
    ],
  );

  const handleLayerVisibilityAction = useCallback(
    async (layerId: string) => {
      if (selectedItemCount > 1 && selectedLayerIdSet.has(layerId)) {
        await handleToggleSelectedItemsVisibility();
        return;
      }

      await applyPaintUpdates(togglePaintLayerVisibility(node, layerId));
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
    async (strokeId: string, targetLayerId: string | null) => {
      if (selectedStrokeIds.length > 1 && selectedStrokeIdSet.has(strokeId)) {
        await handleMoveSelectedStrokes(targetLayerId);
        return;
      }

      await handleMoveStroke(strokeId, targetLayerId);
    },
    [handleMoveSelectedStrokes, handleMoveStroke, selectedStrokeIdSet, selectedStrokeIds.length],
  );

  const handleLayerMoveAction = useCallback(
    async (layerId: string, targetLayerId: string | null) => {
      if (selectedLayerIds.length > 1 && selectedLayerIdSet.has(layerId)) {
        await handleMoveSelectedLayers(targetLayerId);
        return;
      }

      await handleMoveLayer(layerId, targetLayerId);
    },
    [handleMoveLayer, handleMoveSelectedLayers, selectedLayerIdSet, selectedLayerIds.length],
  );

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
    async (strokeId: string, lifetime: PaintLifetime) => {
      if (selectedStrokeIds.length > 1 && selectedStrokeIdSet.has(strokeId)) {
        await handleSetSelectedStrokeLifetime(lifetime);
        return;
      }

      await handleSetStrokeLifetime(strokeId, lifetime);
    },
    [
      handleSetSelectedStrokeLifetime,
      handleSetStrokeLifetime,
      selectedStrokeIdSet,
      selectedStrokeIds.length,
    ],
  );

  const handleLayerLifetimeAction = useCallback(
    async (layerId: string, lifetime: PaintLifetime) => {
      if (selectedLayerIds.length > 1 && selectedLayerIdSet.has(layerId)) {
        await handleSetSelectedLayerLifetime(lifetime);
        return;
      }

      await handleSetLayerLifetime(layerId, lifetime);
    },
    [
      handleSetLayerLifetime,
      handleSetSelectedLayerLifetime,
      selectedLayerIdSet,
      selectedLayerIds.length,
    ],
  );

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
    return selectedStrokes.every(
      (stroke) => getPaintStrokeParentLayerId(node, stroke) === firstParentLayerId,
    )
      ? firstParentLayerId
      : undefined;
  }, [node, selectedStrokes]);
  const selectedLayerParentOptions = useMemo(
    () =>
      layerOptions.filter((option) =>
        selectedLayers.length === 0
          ? true
          : selectedLayers.every((layer) => canMovePaintLayerToParent(node, layer.id, option.id)),
      ),
    [layerOptions, node, selectedLayers],
  );
  const selectedLayerBatchMoveTarget = useMemo(() => {
    if (selectedLayers.length === 0) return undefined;
    const firstParentLayerId = selectedLayers[0].parentLayerId ?? null;
    return selectedLayers.every((layer) => (layer.parentLayerId ?? null) === firstParentLayerId)
      ? firstParentLayerId
      : undefined;
  }, [selectedLayers]);
  const selectedLifetime = useMemo(
    () => getCommonLifetime([...selectedLayers, ...selectedStrokes]),
    [selectedLayers, selectedStrokes],
  );
  const hasItems = node.strokes.length > 0 || layers.length > 0;
  const treeGuideSegments = useTreeGuideSegments({
    items: hierarchy,
    flatRowKeys: flatHierarchyKeys,
    rowRefs,
    contentRef: treeContentRef,
    viewportRef: scrollViewportRef,
    adapter: paintTreeGuideAdapter,
  });

  const renderHierarchyItem = useCallback(
    (item: PaintHierarchyItem, children: React.ReactNode | null) => {
      if (item.type === 'stroke') {
        const { stroke } = item;
        const lifetimeBadgeLabel = getPaintLifetimeBadgeLabel(stroke.lifetime);
        const rowKey = getPaintHierarchyItemKey({ type: 'stroke', id: stroke.id });
        const strokeRow: FlatHierarchyRow = {
          depth: item.depth,
          item: { type: 'stroke', id: stroke.id },
          key: rowKey,
          label: stroke.name,
          parentLayerId: getPaintStrokeParentLayerId(node, stroke),
          stroke,
        };
        const strokeIndex = strokeIndexById.get(stroke.id) ?? -1;
        const isSelectedActionTarget = selectedItemCount > 1 && selectedStrokeIdSet.has(stroke.id);
        const usesSelectedStrokeBatchMove =
          selectedStrokeIds.length > 1 && selectedStrokeIdSet.has(stroke.id);
        const strokeVisibilityLabel = isSelectedActionTarget
          ? selectionVisibilityToggleLabel
          : stroke.visible === false
            ? `Show ${stroke.name}`
            : `Hide ${stroke.name}`;

        return (
          <LeafItemRowShell
            key={stroke.id}
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
                  void handleStrokeLifetimeAction(stroke.id, lifetime);
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
                    void moveStroke(stroke.id, -1);
                    close();
                  }}
                />
                <MenuButton
                  icon={<Icons.ArrowDown className="h-4 w-4" />}
                  label="Move Later"
                  disabled={strokeIndex === -1 || strokeIndex >= node.strokes.length - 1}
                  onClick={() => {
                    void moveStroke(stroke.id, 1);
                    close();
                  }}
                />
              </div>
            )}
            visibilityLabel={strokeVisibilityLabel}
            menuWidthClass="w-72"
            layerOptions={layerOptions}
            currentParentLayerId={getPaintStrokeParentLayerId(node, stroke)}
            onSelect={(extendSelection) => handleSelectStroke(stroke.id, extendSelection)}
            onToggleVisibility={() => void handleStrokeVisibilityAction(stroke.id)}
            onMove={(targetLayerId) => {
              void handleStrokeMoveAction(stroke.id, targetLayerId);
            }}
            onDelete={() => handleStrokeDeleteAction(stroke.id)}
            onPointerDown={(event) => handleRowPointerDown(event, strokeRow)}
            onPrimaryClick={(event) =>
              handlePrimaryRowClick(event, rowKey, (shiftKey, toggleKey) =>
                handleItemSelect(rowKey, shiftKey, toggleKey),
              )
            }
            rowRef={(element) => {
              if (element) rowRefs.current.set(rowKey, element);
              else rowRefs.current.delete(rowKey);
            }}
          />
        );
      }

      const rowKey = getPaintHierarchyItemKey({ type: 'layer', id: item.layer.id });
      const layerRow: FlatHierarchyRow = {
        depth: item.depth,
        item: { type: 'layer', id: item.layer.id },
        key: rowKey,
        label: item.layer.name,
        parentLayerId: item.layer.parentLayerId ?? null,
        layer: item.layer,
      };
      const lifetimeBadgeLabel = getPaintLifetimeBadgeLabel(item.layer.lifetime);
      const isSelectedActionTarget = selectedItemCount > 1 && selectedLayerIdSet.has(item.layer.id);
      const usesSelectedLayerBatchMove =
        selectedLayerIds.length > 1 && selectedLayerIdSet.has(item.layer.id);
      const layerVisibilityLabel = isSelectedActionTarget
        ? selectionVisibilityToggleLabel
        : item.layer.visible === false
          ? 'Show Layer'
          : 'Hide Layer';

      return (
        <LayerRowShell
          key={item.layer.id}
          layerName={item.layer.name}
          rowKey={rowKey}
          depth={item.depth}
          isSelected={selectedLayerIdSet.has(item.layer.id)}
          selectedChildCount={
            getPaintLayerStrokeIds(node, item.layer.id).filter((strokeId) =>
              selectedStrokeIdSet.has(strokeId),
            ).length
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
                void handleLayerLifetimeAction(item.layer.id, lifetime);
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
                void handleLayerVisibilityAction(item.layer.id);
                close();
              }}
            />
          )}
          menuWidthClass="w-72"
          layerParentOptions={layerOptions.filter((option) =>
            canMovePaintLayerToParent(node, item.layer.id, option.id),
          )}
          parentLayerId={item.layer.parentLayerId ?? null}
          onToggleExpand={() =>
            updateNode(node.id, togglePaintLayerExpanded(node, item.layer.id), false)
          }
          onSelectLayer={(extendSelection) => handleSelectLayer(item.layer.id, extendSelection)}
          onToggleVisibility={() => void handleLayerVisibilityAction(item.layer.id)}
          onCreateChildLayer={() => void createLayerAt(item.layer.id)}
          onMove={(targetLayerId) => {
            void handleLayerMoveAction(item.layer.id, targetLayerId);
          }}
          onDelete={() => handleLayerDeleteAction(item.layer.id)}
          onPointerDown={(event) => handleRowPointerDown(event, layerRow)}
          onPrimaryClick={(event) =>
            handlePrimaryRowClick(event, rowKey, (shiftKey, toggleKey) =>
              handleItemSelect(rowKey, shiftKey, toggleKey),
            )
          }
          rowRef={(element) => {
            if (element) rowRefs.current.set(rowKey, element);
            else rowRefs.current.delete(rowKey);
          }}
        >
          {children}
        </LayerRowShell>
      );
    },
    [
      activeDraggedItemKeySet,
      activeDropHighlightLayerId,
      handleLayerDeleteAction,
      handleLayerLifetimeAction,
      handleLayerMoveAction,
      handleLayerVisibilityAction,
      handleRowPointerDown,
      createLayerAt,
      currentFrame,
      handleItemSelect,
      handlePrimaryRowClick,
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
      selectedLayerIds.length,
      selectedStrokeIdSet,
      selectedStrokeIds.length,
      selectionVisibilityToggleLabel,
      strokeIndexById,
      updateNode,
    ],
  );

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
                onClick={() => void createLayerAt(selectedLayer.id)}
                className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                title="Create child layer"
                aria-label="Create child layer"
              >
                <LayerPlusIcon />
              </button>
            ) : selectedStrokes.length > 0 ? (
              <button
                type="button"
                onClick={() => void handleWrapSelection()}
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
                        void handleToggleSelectedItemsVisibility();
                        close();
                      }}
                    />
                    {selectedLayer ? (
                      <MenuButton
                        icon={<LayerPlusIcon />}
                        label="New Child Layer"
                        onClick={() => {
                          void createLayerAt(selectedLayer.id);
                          close();
                        }}
                      />
                    ) : null}
                    {selectedStrokes.length > 0 ? (
                      <MenuButton
                        icon={<Icons.Bundle className="h-4 w-4" />}
                        label="Wrap In New Layer"
                        onClick={() => {
                          void handleWrapSelection();
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
                      void handleSetSelectedItemsLifetime(lifetime);
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
                          void handleMoveSelectedLayers(targetLayerId);
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
                          void handleMoveSelectedStrokes(targetLayerId);
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
                      void handleDeleteSelectedItems();
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
              onClick={() => void createLayerAt()}
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
          getKey={paintTreeGuideAdapter.getKey}
          getChildren={getPaintHierarchyChildren}
          isExpanded={isPaintHierarchyItemExpanded}
          renderItem={renderHierarchyItem}
        />
      </ItemsTreeView>
    </ItemsPanelLayout>
  );
};

export default PaintItemsPanel;
