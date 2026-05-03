import React, { useCallback, useMemo, useRef } from 'react';
import {
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
  FloatingMenu,
  countLabel,
} from '@/components';
import { useTreeGuideSegments } from '@/hooks/useTreeGuideSegments';
import { useRangeSelection } from '@/hooks/useRangeSelection';
import { useTreeDragAndDrop, type TreeDragRow } from '@/hooks/useTreeDragAndDrop';
import { useTreeRowExitAnimation } from '@/hooks/useTreeRowExitAnimation';
import { useRotoItemsClipboard } from './rotoItemsClipboard';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, RotoLayer, RotoNode, RotoPath, RotoShapeType } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import {
  buildRotoHierarchy,
  canMoveRotoLayerToParent,
  createRotoLayer,
  createRotoLayerFromHierarchySelection,
  createRotoLayerFromLayerSelection,
  createRotoLayerFromSelection,
  deleteRotoLayer,
  getCommonRotoParentLayerId,
  getRotoCreationParentLayerId,
  getRotoHierarchyStructureSignature,
  getNextRotoLayerName,
  getRotoLayers,
  getOrderedRotoSiblingItems,
  filterTopLevelRotoHierarchyItems,
  moveRotoLayer,
  moveRotoHierarchyItems,
  moveRotoPathsToLayer,
  toggleRotoLayerExpanded,
  toggleRotoLayerVisibility,
  toggleRotoPathVisibility,
  type RotoHierarchyItem,
  type RotoHierarchyItemRef,
} from '@/utils/rotoHierarchy';
import { type TreeGuideAdapter } from '@/utils/treeGuides';
import { getLayerOptions } from '@/utils/itemsHierarchy';

interface RotoItemsPanelProps {
  node: AnyNode;
  inspectorLevel?: string;
  onInspectorLevelChange?: (level: string) => void;
}

type FlatHierarchyRow = TreeDragRow<RotoHierarchyItemRef> & {
  path?: RotoPath;
  layer?: RotoLayer;
};

const isSameRotoHierarchyItem = (a: RotoHierarchyItemRef, b: RotoHierarchyItemRef) =>
  a.type === b.type && a.id === b.id;

const getRotoHierarchyItemKey = (item: RotoHierarchyItemRef) => `${item.type}:${item.id}`;
const isRotoLayerHierarchyItem = (item: RotoHierarchyItemRef) => item.type === 'layer';
const getRotoLayerHierarchyItemId = (item: RotoHierarchyItemRef) =>
  item.type === 'layer' ? item.id : null;
const getRotoHierarchyChildren = (item: RotoHierarchyItem) =>
  item.type === 'layer' ? item.children : [];
const isRotoHierarchyItemExpanded = (item: RotoHierarchyItem) =>
  item.type !== 'layer' || item.layer.expanded !== false;
const ROTO_ROW_CONTROL_DATA_ATTR = { 'data-roto-row-control': 'true' } as const;

const rotoTreeGuideAdapter: TreeGuideAdapter<RotoHierarchyItem> = {
  getKey: (item) =>
    item.type === 'layer'
      ? getRotoHierarchyItemKey({ type: 'layer', id: item.layer.id })
      : getRotoHierarchyItemKey({ type: 'path', id: item.path.id }),
  getDepth: (item) => item.depth,
  getChildren: getRotoHierarchyChildren,
  isExpanded: isRotoHierarchyItemExpanded,
};

const flattenVisibleHierarchy = (
  items: RotoHierarchyItem[],
  parentLayerId: string | null = null,
  rows: FlatHierarchyRow[] = [],
): FlatHierarchyRow[] => {
  items.forEach((item) => {
    if (item.type === 'layer') {
      rows.push({
        depth: item.depth,
        item: { type: 'layer', id: item.layer.id },
        key: getRotoHierarchyItemKey({ type: 'layer', id: item.layer.id }),
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
      item: { type: 'path', id: item.path.id },
      key: getRotoHierarchyItemKey({ type: 'path', id: item.path.id }),
      label: item.path.name,
      parentLayerId,
      path: item.path,
    });
  });

  return rows;
};

const RotoItemsPanel: React.FC<RotoItemsPanelProps> = ({
  node: anyNode,
  inspectorLevel,
  onInspectorLevelChange,
}) => {
  const node = anyNode as RotoNode;
  const selectedRotoLayerIds = useEditorSelector((s) => s.selectedRotoLayerIds);
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
  const selectedRotoPointRefs = useEditorSelector((s) => s.selectedRotoPointRefs);
  const { updateNode, setSelectedRotoLayerIds, setSelectedRotoPathIds, setSelectedRotoSelection } =
    useEditorActions();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const treeContentRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const currentNodeRef = useRef(node);
  const hierarchyNodeRef = useRef(node);
  const hierarchySignatureRef = useRef<string | null>(null);
  const animateExit = useTreeRowExitAnimation(rowRefs);
  currentNodeRef.current = node;

  const hierarchySignature = getRotoHierarchyStructureSignature(node);
  if (
    hierarchySignatureRef.current !== hierarchySignature ||
    hierarchyNodeRef.current.id !== node.id
  ) {
    hierarchySignatureRef.current = hierarchySignature;
    hierarchyNodeRef.current = node;
  }
  const hierarchyNode = hierarchyNodeRef.current;
  const getCurrentNode = useCallback(() => currentNodeRef.current, []);
  const layers = useMemo(() => getRotoLayers(hierarchyNode), [hierarchyNode]);
  const layerMap = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  const hierarchy = useMemo(() => buildRotoHierarchy(hierarchyNode), [hierarchyNode]);
  const flatHierarchy = useMemo(() => flattenVisibleHierarchy(hierarchy), [hierarchy]);
  const flatHierarchyKeys = useMemo(() => flatHierarchy.map((row) => row.key), [flatHierarchy]);
  const {
    setAnchor: setSelectionAnchor,
    clearAnchor: clearSelectionAnchor,
    getRangeKeys,
  } = useRangeSelection();
  const layerOptions = useMemo(() => getLayerOptions(hierarchy), [hierarchy]);
  const selectedLayerIdSet = useMemo(() => new Set(selectedRotoLayerIds), [selectedRotoLayerIds]);
  const selectedPathIdSet = useMemo(() => new Set(selectedRotoPathIds), [selectedRotoPathIds]);
  const selectedPaths = useMemo(
    () => hierarchyNode.paths.filter((path) => selectedPathIdSet.has(path.id)),
    [hierarchyNode.paths, selectedPathIdSet],
  );
  const selectedLayers = useMemo(
    () =>
      selectedRotoLayerIds
        .map((layerId) => layerMap.get(layerId))
        .filter((layer): layer is RotoLayer => !!layer),
    [layerMap, selectedRotoLayerIds],
  );
  const hasSelectedLayers = selectedLayers.length > 0;
  const hasSelectedPaths = selectedPaths.length > 0;
  const selectedPathId =
    !hasSelectedLayers && selectedRotoPathIds.length === 1 ? selectedRotoPathIds[0] : null;
  const selectedLayer = selectedLayers.length === 1 && !hasSelectedPaths ? selectedLayers[0] : null;
  const selectedPathParentLayerId = useMemo(
    () => getCommonRotoParentLayerId(hierarchyNode, selectedRotoPathIds),
    [hierarchyNode, selectedRotoPathIds],
  );
  const selectedPathsShareParent = useMemo(() => {
    if (selectedPaths.length === 0) return false;
    const firstParentId = selectedPaths[0].parentLayerId ?? null;
    return selectedPaths.every((path) => (path.parentLayerId ?? null) === firstParentId);
  }, [selectedPaths]);
  const selectedPathBatchMoveTarget = selectedPathsShareParent
    ? (selectedPathParentLayerId ?? null)
    : undefined;
  const selectedItemCount = selectedLayers.length + selectedPaths.length;
  const hasMixedSelection = hasSelectedLayers && hasSelectedPaths;
  const selectedDragItems = useMemo(
    () =>
      filterTopLevelRotoHierarchyItems(
        hierarchyNode,
        flatHierarchy
          .filter((row) => {
            if (row.item.type === 'layer') return selectedLayerIdSet.has(row.item.id);
            return selectedPathIdSet.has(row.item.id);
          })
          .map((row) => row.item),
      ),
    [flatHierarchy, hierarchyNode, selectedLayerIdSet, selectedPathIdSet],
  );

  const hasWrapSelection = selectedDragItems.length > 0;
  const clipboardHotkeys = useRotoItemsClipboard({
    node,
    selectedLayerIds: selectedRotoLayerIds,
    selectedPathIds: selectedRotoPathIds,
    selectedPointRefs: selectedRotoPointRefs,
    updateNode,
    setSelectedRotoSelection,
    onInspectorLevelChange,
  });

  const applyNodeUpdate = useCallback(
    (updates: Partial<RotoNode>, withHistory = true) => {
      updateNode(node.id, updates, withHistory);
    },
    [node.id, updateNode],
  );

  const createLayerAt = useCallback(
    (parentLayerId?: string | null) => {
      const currentNode = getCurrentNode();
      const nextParentLayerId =
        parentLayerId !== undefined
          ? parentLayerId
          : getRotoCreationParentLayerId(currentNode, selectedRotoLayerIds, selectedRotoPathIds);
      const layer = createRotoLayer(getNextRotoLayerName(currentNode), nextParentLayerId);
      const nextLayers = [layer, ...getRotoLayers(currentNode)];

      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate({ layers: nextLayers });
    },
    [
      applyNodeUpdate,
      getCurrentNode,
      onInspectorLevelChange,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelectedRotoLayerIds,
    ],
  );

  const getDragItemsForRow = useCallback(
    (row: FlatHierarchyRow): RotoHierarchyItemRef[] => {
      const isSelectedRow =
        row.item.type === 'layer'
          ? selectedLayerIdSet.has(row.item.id)
          : selectedPathIdSet.has(row.item.id);

      if (isSelectedRow) {
        return selectedDragItems.length > 0 ? selectedDragItems : [row.item];
      }

      return [row.item];
    },
    [selectedDragItems, selectedLayerIdSet, selectedPathIdSet],
  );

  const handleHierarchyDrop = useCallback(
    (
      items: readonly RotoHierarchyItemRef[],
      target: { parentLayerId: string | null; siblingIndex: number; expandLayerId: string | null },
    ) => {
      const currentNode = getCurrentNode();
      const updates = moveRotoHierarchyItems(
        currentNode,
        items,
        target.parentLayerId,
        target.siblingIndex,
      );

      if (updates.layers === currentNode.layers && updates.paths === currentNode.paths) {
        return;
      }

      const nextLayers =
        target.expandLayerId !== null
          ? updates.layers.map((layer) =>
              layer.id === target.expandLayerId ? { ...layer, expanded: true } : layer,
            )
          : updates.layers;

      applyNodeUpdate({ layers: nextLayers, paths: updates.paths });
    },
    [applyNodeUpdate, getCurrentNode],
  );

  const getSiblingItemsForDrag = useCallback(
    (parentLayerId: string | null) => getOrderedRotoSiblingItems(hierarchyNode, parentLayerId),
    [hierarchyNode],
  );

  const canDropItemsToParent = useCallback(
    (items: readonly RotoHierarchyItemRef[], parentLayerId: string | null) =>
      items.every(
        (item) =>
          item.type !== 'layer' || canMoveRotoLayerToParent(hierarchyNode, item.id, parentLayerId),
      ),
    [hierarchyNode],
  );

  const {
    dropTarget,
    handleRowPointerDown,
    handlePrimaryRowClick,
    draggedItemKeySet: activeDraggedItemKeySet,
    activeDropHighlightLayerId,
  } = useTreeDragAndDrop<RotoHierarchyItemRef, FlatHierarchyRow>({
    rows: flatHierarchy,
    rowRefs,
    contentRef: treeContentRef,
    viewportRef: scrollViewportRef,
    getDragItemsForRow,
    getSiblingItems: getSiblingItemsForDrag,
    getItemKey: getRotoHierarchyItemKey,
    isSameItem: isSameRotoHierarchyItem,
    canDropItemsToParent,
    isContainerItem: isRotoLayerHierarchyItem,
    getContainerItemId: getRotoLayerHierarchyItemId,
    onDrop: handleHierarchyDrop,
    rowControlSelector: '[data-roto-row-control="true"]',
  });

  const clearSelection = useCallback(() => {
    setSelectedRotoSelection({ layerIds: [], pathIds: [] });
    onInspectorLevelChange?.('node');
    clearSelectionAnchor();
  }, [onInspectorLevelChange, setSelectedRotoSelection, clearSelectionAnchor]);

  const handleSelectAll = useCallback(() => {
    setSelectedRotoSelection({
      layerIds: layers.map((layer) => layer.id),
      pathIds: node.paths.map((path) => path.id),
    });
    onInspectorLevelChange?.('node');
    clearSelectionAnchor();
  }, [clearSelectionAnchor, layers, node.paths, onInspectorLevelChange, setSelectedRotoSelection]);

  const handleSelectPath = useCallback(
    (pathId: string, extendSelection: boolean) => {
      if (extendSelection) {
        const nextIds = selectedPathIdSet.has(pathId)
          ? selectedRotoPathIds.filter((id) => id !== pathId)
          : [...selectedRotoPathIds, pathId];

        setSelectedRotoSelection({ layerIds: selectedRotoLayerIds, pathIds: nextIds });
        onInspectorLevelChange?.(
          selectedRotoLayerIds.length === 0 && nextIds.length === 1 ? 'shape' : 'node',
        );
        return;
      }

      if (selectedPathId === pathId && inspectorLevel === 'shape') {
        onInspectorLevelChange?.('node');
        return;
      }

      setSelectedRotoPathIds([pathId]);
      onInspectorLevelChange?.('shape');
    },
    [
      inspectorLevel,
      onInspectorLevelChange,
      selectedPathId,
      selectedPathIdSet,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelectedRotoSelection,
      setSelectedRotoPathIds,
    ],
  );

  const handleSelectLayer = useCallback(
    (layerId: string, extendSelection: boolean) => {
      if (extendSelection) {
        const nextIds = selectedLayerIdSet.has(layerId)
          ? selectedRotoLayerIds.filter((id) => id !== layerId)
          : [...selectedRotoLayerIds, layerId];

        setSelectedRotoSelection({ layerIds: nextIds, pathIds: selectedRotoPathIds });
        onInspectorLevelChange?.(
          nextIds.length === 1 && selectedRotoPathIds.length === 0
            ? 'layer'
            : nextIds.length === 0 && selectedRotoPathIds.length === 1
              ? 'shape'
              : 'node',
        );
        return;
      }

      setSelectedRotoLayerIds([layerId]);
      onInspectorLevelChange?.('layer');
    },
    [
      onInspectorLevelChange,
      selectedLayerIdSet,
      selectedRotoPathIds,
      selectedRotoLayerIds,
      setSelectedRotoLayerIds,
      setSelectedRotoSelection,
    ],
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
          const nextPathIds: string[] = [];
          for (const row of flatHierarchy) {
            const isSelected =
              row.item.type === 'layer'
                ? selectedLayerIdSet.has(row.item.id)
                : selectedPathIdSet.has(row.item.id);

            if (!isSelected && !rangeKeySet.has(row.key)) continue;

            if (row.item.type === 'layer') nextLayerIds.push(row.item.id);
            else nextPathIds.push(row.item.id);
          }
          setSelectedRotoSelection({ layerIds: nextLayerIds, pathIds: nextPathIds });
          onInspectorLevelChange?.('node');
          return;
        }
      }

      if (toggleKey) {
        if (type === 'layer') handleSelectLayer(id, true);
        else handleSelectPath(id, true);
        setSelectionAnchor(rowKey);
        return;
      }

      if (type === 'layer') handleSelectLayer(id, false);
      else handleSelectPath(id, false);
      setSelectionAnchor(rowKey);
    },
    [
      flatHierarchy,
      flatHierarchyKeys,
      getRangeKeys,
      handleSelectLayer,
      handleSelectPath,
      onInspectorLevelChange,
      selectedLayerIdSet,
      selectedPathIdSet,
      setSelectedRotoSelection,
      setSelectionAnchor,
    ],
  );

  const handleDeletePath = useCallback(
    (pathId: string) => {
      const rowKey = getRotoHierarchyItemKey({ type: 'path', id: pathId });
      animateExit([rowKey], () => {
        const currentNode = getCurrentNode();
        const nextPaths = currentNode.paths.filter((path) => path.id !== pathId);
        const nextSelectedIds = selectedRotoPathIds.filter((id) => id !== pathId);

        setSelectedRotoSelection({
          layerIds: selectedRotoLayerIds,
          pathIds: nextSelectedIds,
        });
        onInspectorLevelChange?.(
          selectedRotoLayerIds.length === 0 && nextSelectedIds.length === 1 ? 'shape' : 'node',
        );

        applyNodeUpdate({ paths: nextPaths });
      });
    },
    [
      animateExit,
      applyNodeUpdate,
      getCurrentNode,
      onInspectorLevelChange,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelectedRotoSelection,
    ],
  );

  const handleWrapSelection = useCallback(() => {
    const currentNode = getCurrentNode();

    if (hasSelectedLayers && hasSelectedPaths) {
      const { layer, updates } = createRotoLayerFromHierarchySelection(
        currentNode,
        selectedDragItems,
        getNextRotoLayerName(currentNode),
      );

      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate(updates);
      return;
    }

    if (hasSelectedPaths && !hasSelectedLayers) {
      if (selectedRotoPathIds.length === 0) return;

      const { layer, updates } = createRotoLayerFromSelection(
        currentNode,
        selectedRotoPathIds,
        getNextRotoLayerName(currentNode),
        selectedPathParentLayerId,
      );

      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate(updates);
      return;
    }

    if (hasSelectedLayers && !hasSelectedPaths) {
      if (selectedRotoLayerIds.length === 0) return;

      const { layer, updates } = createRotoLayerFromLayerSelection(
        currentNode,
        selectedRotoLayerIds,
        getNextRotoLayerName(currentNode),
      );

      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate(updates);
    }
  }, [
    applyNodeUpdate,
    getCurrentNode,
    hasSelectedLayers,
    hasSelectedPaths,
    onInspectorLevelChange,
    selectedDragItems,
    selectedPathParentLayerId,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    setSelectedRotoLayerIds,
  ]);

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const rowKey = getRotoHierarchyItemKey({ type: 'layer', id: layerId });
      animateExit([rowKey], () => {
        const updates = deleteRotoLayer(getCurrentNode(), layerId);
        const nextLayerIds = selectedRotoLayerIds.filter((id) => id !== layerId);

        setSelectedRotoSelection({
          layerIds: nextLayerIds,
          pathIds: selectedRotoPathIds,
        });
        onInspectorLevelChange?.(
          nextLayerIds.length === 0 && selectedRotoPathIds.length === 1 ? 'shape' : 'node',
        );

        applyNodeUpdate(updates);
      });
    },
    [
      animateExit,
      applyNodeUpdate,
      getCurrentNode,
      onInspectorLevelChange,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelectedRotoSelection,
    ],
  );

  const handleMoveSelectedPaths = useCallback(
    (targetLayerId: string | null) => {
      if (selectedRotoPathIds.length === 0) return;
      applyNodeUpdate(moveRotoPathsToLayer(getCurrentNode(), selectedRotoPathIds, targetLayerId));
    },
    [applyNodeUpdate, getCurrentNode, selectedRotoPathIds],
  );

  const handleMoveSelectedLayers = useCallback(
    (targetLayerId: string | null) => {
      if (selectedRotoLayerIds.length === 0) return;

      let nextNode = getCurrentNode();
      selectedRotoLayerIds.forEach((layerId) => {
        nextNode = { ...nextNode, ...moveRotoLayer(nextNode, layerId, targetLayerId) };
      });

      applyNodeUpdate({ layers: nextNode.layers });
    },
    [applyNodeUpdate, getCurrentNode, selectedRotoLayerIds],
  );

  const handleMovePath = useCallback(
    (pathId: string, targetLayerId: string | null) => {
      applyNodeUpdate(moveRotoPathsToLayer(getCurrentNode(), [pathId], targetLayerId));
    },
    [applyNodeUpdate, getCurrentNode],
  );

  const handleMoveLayer = useCallback(
    (layerId: string, targetLayerId: string | null) => {
      applyNodeUpdate(moveRotoLayer(getCurrentNode(), layerId, targetLayerId));
    },
    [applyNodeUpdate, getCurrentNode],
  );

  const handleToggleSelectedItemsVisibility = useCallback(() => {
    if (!hasSelectedLayers && !hasSelectedPaths) return;

    const currentNode = getCurrentNode();
    const currentLayers = getRotoLayers(currentNode);
    const currentLayerMap = new Map(currentLayers.map((layer) => [layer.id, layer]));
    const currentSelectedLayers = selectedRotoLayerIds
      .map((layerId) => currentLayerMap.get(layerId))
      .filter((layer): layer is RotoLayer => !!layer);
    const currentSelectedPaths = currentNode.paths.filter((path) => selectedPathIdSet.has(path.id));

    const nextVisible =
      [...currentSelectedLayers, ...currentSelectedPaths].length > 0 &&
      [...currentSelectedLayers, ...currentSelectedPaths].every((item) => item.visible === false);

    applyNodeUpdate({
      layers: currentLayers.map((layer) =>
        selectedLayerIdSet.has(layer.id) ? { ...layer, visible: nextVisible } : layer,
      ),
      paths: currentNode.paths.map((path) =>
        selectedPathIdSet.has(path.id) ? { ...path, visible: nextVisible } : path,
      ),
    });
  }, [
    applyNodeUpdate,
    getCurrentNode,
    hasSelectedLayers,
    hasSelectedPaths,
    selectedLayerIdSet,
    selectedPathIdSet,
    selectedRotoLayerIds,
  ]);
  const handleDeleteSelectedItems = useCallback(() => {
    if (!hasSelectedLayers && !hasSelectedPaths) return;

    const keysToAnimate: string[] = [];
    for (const id of selectedRotoLayerIds) {
      keysToAnimate.push(getRotoHierarchyItemKey({ type: 'layer', id }));
    }
    for (const id of selectedRotoPathIds) {
      keysToAnimate.push(getRotoHierarchyItemKey({ type: 'path', id }));
    }

    animateExit(keysToAnimate, () => {
      let nextNode = getCurrentNode();
      selectedRotoLayerIds.forEach((layerId) => {
        nextNode = { ...nextNode, ...deleteRotoLayer(nextNode, layerId) };
      });

      if (selectedRotoPathIds.length > 0) {
        nextNode = {
          ...nextNode,
          paths: nextNode.paths.filter((path) => !selectedPathIdSet.has(path.id)),
        };
      }

      setSelectedRotoSelection({ layerIds: [], pathIds: [] });
      onInspectorLevelChange?.('node');
      applyNodeUpdate({ layers: nextNode.layers, paths: nextNode.paths });
    });
  }, [
    animateExit,
    applyNodeUpdate,
    getCurrentNode,
    hasSelectedLayers,
    hasSelectedPaths,
    onInspectorLevelChange,
    selectedPathIdSet,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    setSelectedRotoSelection,
  ]);

  const handleLayerVisibilityAction = useCallback(
    (layerId: string) => {
      if (selectedItemCount > 1 && selectedLayerIdSet.has(layerId)) {
        handleToggleSelectedItemsVisibility();
        return;
      }

      applyNodeUpdate(toggleRotoLayerVisibility(getCurrentNode(), layerId));
    },
    [
      applyNodeUpdate,
      getCurrentNode,
      handleToggleSelectedItemsVisibility,
      selectedItemCount,
      selectedLayerIdSet,
    ],
  );

  const handlePathVisibilityAction = useCallback(
    (pathId: string) => {
      if (selectedItemCount > 1 && selectedPathIdSet.has(pathId)) {
        handleToggleSelectedItemsVisibility();
        return;
      }

      applyNodeUpdate(toggleRotoPathVisibility(getCurrentNode(), pathId));
    },
    [
      applyNodeUpdate,
      getCurrentNode,
      handleToggleSelectedItemsVisibility,
      selectedItemCount,
      selectedPathIdSet,
    ],
  );

  const handleLayerMoveAction = useCallback(
    (layerId: string, targetLayerId: string | null) => {
      if (selectedRotoLayerIds.length > 1 && selectedLayerIdSet.has(layerId)) {
        handleMoveSelectedLayers(targetLayerId);
        return;
      }

      handleMoveLayer(layerId, targetLayerId);
    },
    [handleMoveLayer, handleMoveSelectedLayers, selectedLayerIdSet, selectedRotoLayerIds.length],
  );

  const handlePathMoveAction = useCallback(
    (pathId: string, targetLayerId: string | null) => {
      if (selectedRotoPathIds.length > 1 && selectedPathIdSet.has(pathId)) {
        handleMoveSelectedPaths(targetLayerId);
        return;
      }

      handleMovePath(pathId, targetLayerId);
    },
    [handleMovePath, handleMoveSelectedPaths, selectedPathIdSet, selectedRotoPathIds.length],
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

  const handlePathDeleteAction = useCallback(
    (pathId: string) => {
      if (selectedItemCount > 1 && selectedPathIdSet.has(pathId)) {
        handleDeleteSelectedItems();
        return;
      }

      handleDeletePath(pathId);
    },
    [handleDeletePath, handleDeleteSelectedItems, selectedItemCount, selectedPathIdSet],
  );

  const selectedLayerParentOptions = useMemo(
    () =>
      layerOptions.filter((option) =>
        selectedLayers.length === 0
          ? true
          : selectedLayers.every((layer) =>
              canMoveRotoLayerToParent(hierarchyNode, layer.id, option.id),
            ),
      ),
    [hierarchyNode, layerOptions, selectedLayers],
  );
  const selectedLayerBatchMoveTarget = useMemo(() => {
    if (selectedLayers.length === 0) return undefined;
    const firstParentLayerId = selectedLayers[0].parentLayerId ?? null;
    return selectedLayers.every((layer) => (layer.parentLayerId ?? null) === firstParentLayerId)
      ? firstParentLayerId
      : undefined;
  }, [selectedLayers]);
  const hasHeaderSelection = selectedItemCount > 0;
  const headerSelectionLabel = `${selectedItemCount} selected`;
  const wrapSelectionTitle = 'Wrap selection in a new layer';
  const isSingleLayerSelected = selectedLayers.length === 1 && selectedPaths.length === 0;
  const selectionVisibilityToggleLabel =
    [...selectedLayers, ...selectedPaths].length > 0 &&
    [...selectedLayers, ...selectedPaths].every((item) => item.visible === false)
      ? 'Show Selected'
      : 'Hide Selected';
  const hasItems = node.paths.length > 0 || layers.length > 0;
  const selectedPathCountByLayerId = useMemo(() => {
    const counts = new Map<string, number>();

    const countSelectedPaths = (items: readonly RotoHierarchyItem[]): number =>
      items.reduce((total, item) => {
        if (item.type === 'path') {
          return total + (selectedPathIdSet.has(item.path.id) ? 1 : 0);
        }

        const layerSelectedCount = countSelectedPaths(item.children);
        counts.set(item.layer.id, layerSelectedCount);
        return total + layerSelectedCount;
      }, 0);

    countSelectedPaths(hierarchy);
    return counts;
  }, [hierarchy, selectedPathIdSet]);
  const treeGuideSegments = useTreeGuideSegments({
    items: hierarchy,
    flatRowKeys: flatHierarchyKeys,
    rowRefs,
    contentRef: treeContentRef,
    viewportRef: scrollViewportRef,
    adapter: rotoTreeGuideAdapter,
  });

  const renderHierarchyItem = useCallback(
    (item: RotoHierarchyItem, children: React.ReactNode | null) => {
      if (item.type === 'layer') {
        const rowKey = getRotoHierarchyItemKey({ type: 'layer', id: item.layer.id });
        const layerRow: FlatHierarchyRow = {
          depth: item.depth,
          item: { type: 'layer', id: item.layer.id },
          key: rowKey,
          label: item.layer.name,
          parentLayerId: item.layer.parentLayerId ?? null,
          layer: item.layer,
        };
        const selectedCount = selectedPathCountByLayerId.get(item.layer.id) ?? 0;
        const isSelectedActionTarget =
          selectedItemCount > 1 && selectedLayerIdSet.has(item.layer.id);
        const usesSelectedLayerBatchMove =
          selectedRotoLayerIds.length > 1 && selectedLayerIdSet.has(item.layer.id);
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
            selectedChildCount={selectedCount}
            isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
            isDropInsideTarget={activeDropHighlightLayerId === item.layer.id}
            isVisible={item.visible}
            isExpanded={item.layer.expanded !== false}
            hasChildren={item.children.length > 0}
            itemCount={item.pathCount}
            visibilityLabel={layerVisibilityLabel}
            rowControlDataAttr={ROTO_ROW_CONTROL_DATA_ATTR}
            layerParentOptions={layerOptions.filter((option) =>
              canMoveRotoLayerToParent(hierarchyNode, item.layer.id, option.id),
            )}
            parentLayerId={item.layer.parentLayerId ?? null}
            onToggleExpand={() =>
              applyNodeUpdate(toggleRotoLayerExpanded(getCurrentNode(), item.layer.id), false)
            }
            onSelectLayer={(extendSelection) => handleSelectLayer(item.layer.id, extendSelection)}
            onToggleVisibility={() => handleLayerVisibilityAction(item.layer.id)}
            onCreateChildLayer={() => createLayerAt(item.layer.id)}
            onMove={(targetLayerId) => handleLayerMoveAction(item.layer.id, targetLayerId)}
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
      }

      const rowKey = getRotoHierarchyItemKey({ type: 'path', id: item.path.id });
      const pathRow: FlatHierarchyRow = {
        depth: item.depth,
        item: { type: 'path', id: item.path.id },
        key: rowKey,
        label: item.path.name,
        parentLayerId: item.path.parentLayerId ?? null,
        path: item.path,
      };
      const shapeIcon =
        item.path.shapeType === RotoShapeType.BSPLINE ? (
          <Icons.Curve className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <Icons.Square className="h-3.5 w-3.5 flex-shrink-0" />
        );
      const isSelectedActionTarget = selectedItemCount > 1 && selectedPathIdSet.has(item.path.id);
      const usesSelectedPathBatchMove =
        selectedRotoPathIds.length > 1 && selectedPathIdSet.has(item.path.id);
      const pathVisibilityLabel = isSelectedActionTarget
        ? selectionVisibilityToggleLabel
        : item.path.visible === false
          ? `Show ${item.path.name}`
          : `Hide ${item.path.name}`;

      return (
        <LeafItemRowShell
          key={item.path.id}
          itemName={item.path.name}
          rowKey={rowKey}
          depth={item.depth}
          isSelected={selectedPathIdSet.has(item.path.id)}
          isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
          isVisible={item.visible}
          leadingIcon={shapeIcon}
          visibilityLabel={pathVisibilityLabel}
          menuWidthClass="w-64"
          rowControlDataAttr={ROTO_ROW_CONTROL_DATA_ATTR}
          layerOptions={layerOptions}
          currentParentLayerId={item.path.parentLayerId ?? null}
          onSelect={(extendSelection) => handleSelectPath(item.path.id, extendSelection)}
          onToggleVisibility={() => handlePathVisibilityAction(item.path.id)}
          onMove={(targetLayerId) => handlePathMoveAction(item.path.id, targetLayerId)}
          onDelete={() => handlePathDeleteAction(item.path.id)}
          onPointerDown={(event) => handleRowPointerDown(event, pathRow)}
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
    },
    [
      activeDraggedItemKeySet,
      activeDropHighlightLayerId,
      applyNodeUpdate,
      createLayerAt,
      handleDeleteLayer,
      handleItemSelect,
      handleLayerDeleteAction,
      handleLayerMoveAction,
      handleLayerVisibilityAction,
      handleMoveLayer,
      handlePrimaryRowClick,
      handlePathDeleteAction,
      handlePathMoveAction,
      handlePathVisibilityAction,
      handleRowPointerDown,
      handleSelectLayer,
      handleSelectPath,
      hierarchyNode,
      layerOptions,
      rowRefs,
      selectedItemCount,
      selectedPathCountByLayerId,
      selectedLayerIdSet,
      selectedPathIdSet,
      selectedRotoLayerIds.length,
      selectedRotoPathIds.length,
      selectionVisibilityToggleLabel,
      getCurrentNode,
    ],
  );

  return (
    <ItemsPanelLayout
      title="Items"
      subtitle={
        <>
          {countLabel(layers.length, 'layer', 'layers')} /{' '}
          {countLabel(node.paths.length, 'shape', 'shapes')}
        </>
      }
      hasItems={hasItems}
      onDeleteSelected={hasHeaderSelection ? handleDeleteSelectedItems : undefined}
      onSelectAll={hasItems ? handleSelectAll : undefined}
      clipboardHotkeys={clipboardHotkeys}
      emptyState={
        <div className="max-w-[220px] rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-4 text-center text-xs text-gray-500">
          <p className="font-medium text-gray-300">Build your matte as a tree</p>
          <p className="mt-1">
            Draw in the viewport, then group shapes into layers as the mask grows.
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
            {isSingleLayerSelected ? (
              <button
                type="button"
                onClick={() => createLayerAt(selectedLayer?.id)}
                className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                title="Create new layer"
                aria-label="Create new layer"
              >
                <LayerPlusIcon />
              </button>
            ) : hasWrapSelection ? (
              <button
                type="button"
                onClick={handleWrapSelection}
                className={HEADER_SELECTION_ICON_BUTTON_CLASS}
                title={wrapSelectionTitle}
                aria-label={wrapSelectionTitle}
              >
                <Icons.Bundle className="h-3 w-3" />
              </button>
            ) : null}
            <FloatingMenu
              widthClass="w-64"
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
                  </div>
                  {hasSelectedLayers ? (
                    <>
                      <div className="h-px bg-white/10" />
                      <MoveMenuSection
                        label={hasMixedSelection ? 'Move Layers To' : 'Move To'}
                        options={selectedLayerParentOptions}
                        currentValue={selectedLayerBatchMoveTarget}
                        onMove={handleMoveSelectedLayers}
                        close={close}
                      />
                    </>
                  ) : null}
                  {hasSelectedPaths ? (
                    <>
                      <div className="h-px bg-white/10" />
                      <MoveMenuSection
                        label={hasMixedSelection ? 'Move Shapes To' : 'Move To'}
                        options={layerOptions}
                        currentValue={selectedPathBatchMoveTarget}
                        onMove={handleMoveSelectedPaths}
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
              className="flex items-center justify-center px-1.5 py-1 text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                selectedLayer ? `Create child layer inside ${selectedLayer.name}` : 'Create layer'
              }
              aria-label={
                selectedLayer ? `Create child layer inside ${selectedLayer.name}` : 'Create layer'
              }
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
          getKey={rotoTreeGuideAdapter.getKey}
          getChildren={getRotoHierarchyChildren}
          isExpanded={isRotoHierarchyItemExpanded}
          renderItem={renderHierarchyItem}
        />
      </ItemsTreeView>
    </ItemsPanelLayout>
  );
};

export default RotoItemsPanel;
