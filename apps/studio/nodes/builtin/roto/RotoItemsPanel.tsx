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
import {
  useTreePanelState,
  flattenHierarchy,
  type FlatTreeRow,
} from '@/components/useTreeItemsPanel';
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
import { getLayerOptions, type HierarchyItemNode } from '@/utils/itemsHierarchy';
import { getHierarchyItemKey } from '@/utils/hierarchyHelpers';
import { useRotoItemsClipboard } from './rotoItemsClipboard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RotoItemsPanelProps {
  node: AnyNode;
  inspectorLevel?: string;
  onInspectorLevelChange?: (level: string) => void;
}

type Row = FlatTreeRow<RotoHierarchyItemRef> & {
  path?: RotoPath;
  layer?: RotoLayer;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function RotoItemsPanel({
  node: anyNode,
  inspectorLevel,
  onInspectorLevelChange,
}: RotoItemsPanelProps) {
  const node = anyNode as RotoNode;
  const selectedRotoLayerIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.layerIds ?? [],
  );
  const selectedRotoPathIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.itemIds ?? [],
  );
  const selectedRotoPointRefs = useEditorSelector((s) => s.selectedRotoPointRefs);
  const { updateNode, setHierarchySelection } = useEditorActions();
  const nodeId = node.id;
  const setSelectedRotoLayerIds = useCallback(
    (ids: string[]) => setHierarchySelection(nodeId, ids, []),
    [setHierarchySelection, nodeId],
  );
  const setSelectedRotoPathIds = useCallback(
    (ids: string[]) => setHierarchySelection(nodeId, [], ids),
    [setHierarchySelection, nodeId],
  );
  const currentNodeRef = useRef(node);
  currentNodeRef.current = node;
  const getCurrentNode = useCallback(() => currentNodeRef.current, []);

  // -----------------------------------------------------------------------
  // Cache hierarchy node for stable references
  // -----------------------------------------------------------------------
  const hierarchySignature = getRotoHierarchyStructureSignature(node);
  const [hierarchyNode, setHierarchyNode] = React.useState(node);
  const prevSigRef = useRef(hierarchySignature);
  if (prevSigRef.current !== hierarchySignature || hierarchyNode.id !== node.id) {
    prevSigRef.current = hierarchySignature;
    setHierarchyNode(node);
  }

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------
  const layers = useMemo(() => getRotoLayers(hierarchyNode), [hierarchyNode]);
  const layerMap = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const hierarchy = useMemo(() => buildRotoHierarchy(hierarchyNode), [hierarchyNode]);
  const layerOptions = useMemo(() => getLayerOptions(hierarchy), [hierarchy]);

  const { rows: flatHierarchy, keys: flatHierarchyKeys } = useMemo(
    () =>
      flattenHierarchy<RotoHierarchyItemRef>(hierarchy, 'path', (item: RotoHierarchyItem) =>
        item.type === 'path' ? item.path : null,
      ),
    [hierarchy],
  );

  // -----------------------------------------------------------------------
  // Selection state
  // -----------------------------------------------------------------------
  const selectedLayerIdSet = useMemo(() => new Set(selectedRotoLayerIds), [selectedRotoLayerIds]);
  const selectedPathIdSet = useMemo(() => new Set(selectedRotoPathIds), [selectedRotoPathIds]);

  const selectedLayers = useMemo(
    () => selectedRotoLayerIds.map((id) => layerMap.get(id)).filter((l): l is RotoLayer => !!l),
    [layerMap, selectedRotoLayerIds],
  );
  const selectedPaths = useMemo(
    () => hierarchyNode.paths.filter((p) => selectedPathIdSet.has(p.id)),
    [hierarchyNode.paths, selectedPathIdSet],
  );

  const hasSelectedLayers = selectedLayers.length > 0;
  const hasSelectedPaths = selectedPaths.length > 0;
  const hasMixedSelection = hasSelectedLayers && hasSelectedPaths;
  const selectedItemCount = selectedLayers.length + selectedPaths.length;
  const selectedPathId =
    !hasSelectedLayers && selectedRotoPathIds.length === 1 ? selectedRotoPathIds[0] : null;
  const selectedLayer = selectedLayers.length === 1 && !hasSelectedPaths ? selectedLayers[0] : null;
  const isSingleLayerSelected = selectedLayer !== null;

  // -----------------------------------------------------------------------
  // Clipboard
  // -----------------------------------------------------------------------
  const clipboardHotkeys = useRotoItemsClipboard({
    node,
    selectedLayerIds: selectedRotoLayerIds,
    selectedPathIds: selectedRotoPathIds,
    selectedPointRefs: selectedRotoPointRefs,
    updateNode,
    onSetHierarchySelection: (layerIds: string[], itemIds: string[]) =>
      setHierarchySelection(nodeId, layerIds, itemIds),
    onInspectorLevelChange,
  });

  // -----------------------------------------------------------------------
  // Update helper
  // -----------------------------------------------------------------------
  const applyNodeUpdate = useCallback(
    (updates: Partial<RotoNode>, withHistory = true) => {
      updateNode(node.id, updates as Record<string, unknown>, withHistory);
    },
    [node.id, updateNode],
  );

  // -----------------------------------------------------------------------
  // Selection handlers
  // -----------------------------------------------------------------------
  const setSelection = useCallback(
    (sel: { layerIds: string[]; pathIds: string[] }) => {
      setHierarchySelection(nodeId, sel.layerIds, sel.pathIds);
    },
    [setHierarchySelection, nodeId],
  );

  const clearSelection = useCallback(() => {
    setHierarchySelection(nodeId, [], []);
    onInspectorLevelChange?.('node');
  }, [nodeId, onInspectorLevelChange, setHierarchySelection]);

  const handleSelectAll = useCallback(() => {
    setHierarchySelection(
      nodeId,
      layers.map((l) => l.id),
      hierarchyNode.paths.map((p) => p.id),
    );
    onInspectorLevelChange?.('node');
  }, [nodeId, hierarchyNode.paths, layers, onInspectorLevelChange, setHierarchySelection]);

  const handleSelectPath = useCallback(
    (pathId: string, extendSelection: boolean) => {
      if (extendSelection) {
        const nextIds = selectedPathIdSet.has(pathId)
          ? selectedRotoPathIds.filter((id) => id !== pathId)
          : [...selectedRotoPathIds, pathId];
        setHierarchySelection(nodeId, selectedRotoLayerIds, nextIds);
        onInspectorLevelChange?.(
          selectedRotoLayerIds.length === 0 && nextIds.length === 1 ? 'shape' : 'node',
        );
        return;
      }
      if (selectedPathId === pathId && inspectorLevel === 'shape') {
        onInspectorLevelChange?.('node');
        return;
      }
      setHierarchySelection(nodeId, [], [pathId]);
      onInspectorLevelChange?.('shape');
    },
    [
      inspectorLevel,
      nodeId,
      onInspectorLevelChange,
      selectedPathId,
      selectedPathIdSet,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setHierarchySelection,
    ],
  );

  const handleSelectLayer = useCallback(
    (layerId: string, extendSelection: boolean) => {
      if (extendSelection) {
        const nextIds = selectedLayerIdSet.has(layerId)
          ? selectedRotoLayerIds.filter((id) => id !== layerId)
          : [...selectedRotoLayerIds, layerId];
        setHierarchySelection(nodeId, nextIds, selectedRotoPathIds);
        onInspectorLevelChange?.(
          nextIds.length === 1 && selectedRotoPathIds.length === 0
            ? 'layer'
            : nextIds.length === 0 && selectedRotoPathIds.length === 1
              ? 'shape'
              : 'node',
        );
        return;
      }
      setHierarchySelection(nodeId, [layerId], []);
      onInspectorLevelChange?.('layer');
    },
    [
      nodeId,
      onInspectorLevelChange,
      selectedLayerIdSet,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setHierarchySelection,
    ],
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
          const nextPathIds: string[] = [];
          for (const row of flatHierarchy) {
            if (!rangeSet.has(row.key)) continue;
            if (row.item.type === 'layer') nextLayerIds.push(row.item.id);
            else nextPathIds.push(row.item.id);
          }
          setHierarchySelection(nodeId, nextLayerIds, nextPathIds);
          onInspectorLevelChange?.('node');
          return;
        }
      }

      if (toggleKey) {
        rangeAnchorRef.current = rowKey;
        if (type === 'layer') handleSelectLayer(id, true);
        else handleSelectPath(id, true);
        return;
      }

      rangeAnchorRef.current = rowKey;
      if (type === 'layer') handleSelectLayer(id, false);
      else handleSelectPath(id, false);
    },
    [
      flatHierarchy,
      flatHierarchyKeys,
      handleSelectLayer,
      handleSelectPath,
      nodeId,
      onInspectorLevelChange,
      setHierarchySelection,
    ],
  );

  // -----------------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------------
  const createLayerAt = useCallback(
    (parentLayerId?: string | null) => {
      const n = getCurrentNode();
      const pid =
        parentLayerId !== undefined
          ? parentLayerId
          : getRotoCreationParentLayerId(n, selectedRotoLayerIds, selectedRotoPathIds);
      const layer = createRotoLayer(getNextRotoLayerName(n), pid);
      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate({ layers: [layer, ...layers] });
    },
    [
      applyNodeUpdate,
      getCurrentNode,
      layers,
      onInspectorLevelChange,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelectedRotoLayerIds,
    ],
  );

  const handleDeletePath = useCallback(
    (pathId: string) => {
      const n = getCurrentNode();
      const nextPaths = n.paths.filter((p) => p.id !== pathId);
      setSelectedRotoPathIds(selectedRotoPathIds.filter((id) => id !== pathId));
      onInspectorLevelChange?.(
        selectedRotoLayerIds.length === 0 && selectedRotoPathIds.length - 1 === 1
          ? 'shape'
          : 'node',
      );
      applyNodeUpdate({ paths: nextPaths });
    },
    [
      applyNodeUpdate,
      getCurrentNode,
      onInspectorLevelChange,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelectedRotoPathIds,
    ],
  );

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const updates = deleteRotoLayer(getCurrentNode(), layerId);
      setSelection({
        layerIds: selectedRotoLayerIds.filter((id) => id !== layerId),
        pathIds: selectedRotoPathIds,
      });
      onInspectorLevelChange?.(
        selectedRotoLayerIds.length - 1 === 0 && selectedRotoPathIds.length === 1
          ? 'shape'
          : 'node',
      );
      applyNodeUpdate(updates);
    },
    [
      applyNodeUpdate,
      getCurrentNode,
      onInspectorLevelChange,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      setSelection,
    ],
  );

  const handleDeleteSelectedItems = useCallback(() => {
    if (!hasSelectedLayers && !hasSelectedPaths) return;

    const n = getCurrentNode();
    let nextLayers: RotoLayer[] = layers;
    let nextPaths: RotoPath[] = n.paths;

    selectedRotoLayerIds.forEach((layerId) => {
      const updates = deleteRotoLayer({ ...n, layers: nextLayers, paths: nextPaths }, layerId);
      nextLayers = updates.layers;
      nextPaths = updates.paths;
    });

    if (selectedRotoPathIds.length > 0) {
      const idSet = new Set(selectedRotoPathIds);
      nextPaths = nextPaths.filter((p) => !idSet.has(p.id));
    }

    setSelection({ layerIds: [], pathIds: [] });
    onInspectorLevelChange?.('node');
    applyNodeUpdate({ layers: nextLayers, paths: nextPaths });
  }, [
    applyNodeUpdate,
    getCurrentNode,
    hasSelectedLayers,
    hasSelectedPaths,
    layers,
    onInspectorLevelChange,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    setSelection,
  ]);

  const handleToggleSelectedItemsVisibility = useCallback(() => {
    if (!hasSelectedLayers && !hasSelectedPaths) return;
    const n = getCurrentNode();
    const allItems = [...selectedLayers, ...selectedPaths];
    const nextVisible = allItems.length > 0 && allItems.every((item) => item.visible === false);

    applyNodeUpdate({
      layers: n.layers.map((l) =>
        selectedLayerIdSet.has(l.id) ? { ...l, visible: nextVisible } : l,
      ),
      paths: n.paths.map((p) => (selectedPathIdSet.has(p.id) ? { ...p, visible: nextVisible } : p)),
    });
  }, [
    applyNodeUpdate,
    getCurrentNode,
    hasSelectedLayers,
    hasSelectedPaths,
    selectedLayerIdSet,
    selectedLayers,
    selectedPathIdSet,
    selectedPaths,
  ]);

  // -----------------------------------------------------------------------
  // Move handlers
  // -----------------------------------------------------------------------
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
      let n = getCurrentNode();
      selectedRotoLayerIds.forEach((layerId) => {
        n = { ...n, ...moveRotoLayer(n, layerId, targetLayerId) };
      });
      applyNodeUpdate({ layers: n.layers });
    },
    [applyNodeUpdate, getCurrentNode, selectedRotoLayerIds],
  );

  const handleMovePath = useCallback(
    (pathId: string, targetLayerId: string | null) =>
      applyNodeUpdate(moveRotoPathsToLayer(getCurrentNode(), [pathId], targetLayerId)),
    [applyNodeUpdate, getCurrentNode],
  );

  const handleMoveLayer = useCallback(
    (layerId: string, targetLayerId: string | null) =>
      applyNodeUpdate(moveRotoLayer(getCurrentNode(), layerId, targetLayerId)),
    [applyNodeUpdate, getCurrentNode],
  );

  // -----------------------------------------------------------------------
  // Visibility handlers
  // -----------------------------------------------------------------------
  const handleLayerVisibility = useCallback(
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

  const handlePathVisibility = useCallback(
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

  // -----------------------------------------------------------------------
  // Delete dispatchers
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Drag & Drop + Tree Guides via shared hook
  // -----------------------------------------------------------------------
  const selectedDragItems = useMemo(
    () =>
      filterTopLevelRotoHierarchyItems(
        hierarchyNode,
        flatHierarchy
          .filter((r) =>
            r.item.type === 'layer'
              ? selectedLayerIdSet.has(r.item.id)
              : selectedPathIdSet.has(r.item.id),
          )
          .map((r) => r.item),
      ),
    [hierarchyNode, flatHierarchy, selectedLayerIdSet, selectedPathIdSet],
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
  } = useTreePanelState<RotoHierarchyItemRef>({
    leafTypeName: 'path',
    hierarchy,
    flatHierarchy,
    flatHierarchyKeys,
    getDragItemsForRow: (row) => {
      const isSelected =
        row.item.type === 'layer'
          ? selectedLayerIdSet.has(row.item.id)
          : selectedPathIdSet.has(row.item.id);
      return isSelected && selectedDragItems.length > 0 ? selectedDragItems : [row.item];
    },
    getSiblingItems: (parentLayerId) => getOrderedRotoSiblingItems(hierarchyNode, parentLayerId),
    canDropItemsToParent: (items, parentLayerId) =>
      items.every(
        (item) =>
          item.type !== 'layer' || canMoveRotoLayerToParent(hierarchyNode, item.id, parentLayerId),
      ),
    isContainerItem: (item) => item.type === 'layer',
    getContainerItemId: (item) => (item.type === 'layer' ? item.id : null),
    onHierarchyDrop: (items, target) => {
      const n = getCurrentNode();
      const updates = moveRotoHierarchyItems(n, items, target.parentLayerId, target.siblingIndex);
      if (updates.layers === n.layers && updates.paths === n.paths) return;
      const nextLayers =
        target.expandLayerId !== null
          ? updates.layers.map((l) =>
              l.id === target.expandLayerId ? { ...l, expanded: true } : l,
            )
          : updates.layers;
      applyNodeUpdate({ layers: nextLayers, paths: updates.paths });
    },
    getHierarchyItemDepth: (item: HierarchyItemNode) => item.depth,
    getHierarchyItemChildren: (item: HierarchyItemNode) =>
      item.type === 'layer' ? (item.children ?? []) : [],
    isHierarchyItemExpanded: (item: HierarchyItemNode) =>
      item.type !== 'layer' || item.layer?.expanded !== false,
    getLeafId: (item: HierarchyItemNode) => item.path?.id ?? item.stroke?.id ?? '',
    rowControlSelector: '[data-roto-row-control="true"]',
  });

  // -----------------------------------------------------------------------
  // Wrap selection
  // -----------------------------------------------------------------------
  const handleWrapSelection = useCallback(() => {
    const n = getCurrentNode();
    if (hasSelectedLayers && hasSelectedPaths) {
      const { layer, updates } = createRotoLayerFromHierarchySelection(
        n,
        selectedDragItems,
        getNextRotoLayerName(n),
      );
      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate(updates);
      return;
    }
    if (hasSelectedPaths && !hasSelectedLayers) {
      const { layer, updates } = createRotoLayerFromSelection(
        n,
        selectedRotoPathIds,
        getNextRotoLayerName(n),
        getCommonRotoParentLayerId(n, selectedRotoPathIds),
      );
      setSelectedRotoLayerIds([layer.id]);
      onInspectorLevelChange?.('node');
      applyNodeUpdate(updates);
      return;
    }
    if (hasSelectedLayers && !hasSelectedPaths) {
      const { layer, updates } = createRotoLayerFromLayerSelection(
        n,
        selectedRotoLayerIds,
        getNextRotoLayerName(n),
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
    selectedRotoLayerIds,
    selectedRotoPathIds,
    setSelectedRotoLayerIds,
    selectedDragItems,
  ]);

  // -----------------------------------------------------------------------
  // Memos
  // -----------------------------------------------------------------------
  const hasHeaderSelection = selectedItemCount > 0;
  const headerSelectionLabel = `${selectedItemCount} selected`;
  const hasItems = hierarchyNode.paths.length > 0 || layers.length > 0;
  const selectionVisibilityToggleLabel =
    [...selectedLayers, ...selectedPaths].length > 0 &&
    [...selectedLayers, ...selectedPaths].every((item) => item.visible === false)
      ? 'Show Selected'
      : 'Hide Selected';

  const selectedLayerParentOptions = useMemo(
    () =>
      layerOptions.filter((option) =>
        selectedLayers.length === 0
          ? true
          : selectedLayers.every((l) => canMoveRotoLayerToParent(hierarchyNode, l.id, option.id)),
      ),
    [hierarchyNode, layerOptions, selectedLayers],
  );

  const selectedLayerBatchMoveTarget = useMemo(() => {
    if (selectedLayers.length === 0) return undefined;
    const firstParentLayerId = selectedLayers[0].parentLayerId ?? null;
    return selectedLayers.every((l) => (l.parentLayerId ?? null) === firstParentLayerId)
      ? firstParentLayerId
      : undefined;
  }, [selectedLayers]);

  const selectedPathBatchMoveTarget = useMemo(() => {
    if (selectedPaths.length === 0) return undefined;
    const firstParentLayerId = getCommonRotoParentLayerId(
      hierarchyNode,
      selectedPaths.map((p) => p.id),
    );
    return firstParentLayerId;
  }, [hierarchyNode, selectedPaths]);

  const selectedPathCountByLayerId = useMemo(() => {
    const counts = new Map<string, number>();
    const count = (items: readonly RotoHierarchyItem[]): number =>
      items.reduce((total, item) => {
        if (item.type === 'path') return total + (selectedPathIdSet.has(item.path.id) ? 1 : 0);
        const c = count(item.children);
        counts.set(item.layer.id, c);
        return total + c;
      }, 0);
    count(hierarchy);
    return counts;
  }, [hierarchy, selectedPathIdSet]);

  const hasWrapSelection = selectedDragItems.length > 0;

  // -----------------------------------------------------------------------
  // Render hierarchy item
  // -----------------------------------------------------------------------
  const renderHierarchyItem = useCallback(
    (item: RotoHierarchyItem, children: React.ReactNode | null) => {
      if (item.type === 'layer') {
        const rowKey = getHierarchyItemKey({ type: 'layer', id: item.layer.id });
        const row: Row = {
          depth: item.depth,
          item: { type: 'layer', id: item.layer.id },
          key: rowKey,
          label: item.layer.name,
          parentLayerId: item.layer.parentLayerId ?? null,
          layer: item.layer,
        };
        const selectedCount = selectedPathCountByLayerId.get(item.layer.id) ?? 0;
        const isSelectedTarget = selectedItemCount > 1 && selectedLayerIdSet.has(item.layer.id);
        const visibilityLabel = isSelectedTarget
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
            selectedChildCount={selectedCount}
            isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
            isDropInsideTarget={activeDropHighlightLayerId === item.layer.id}
            isVisible={item.visible}
            isExpanded={item.layer.expanded !== false}
            hasChildren={item.children.length > 0}
            itemCount={item.pathCount}
            visibilityLabel={visibilityLabel}
            rowControlDataAttr={{ 'data-roto-row-control': 'true' }}
            layerParentOptions={layerOptions.filter((opt) =>
              canMoveRotoLayerToParent(hierarchyNode, item.layer.id, opt.id),
            )}
            parentLayerId={item.layer.parentLayerId ?? null}
            onToggleExpand={() =>
              applyNodeUpdate(toggleRotoLayerExpanded(getCurrentNode(), item.layer.id), false)
            }
            onSelectLayer={(ext) => handleSelectLayer(item.layer.id, ext)}
            onToggleVisibility={() => handleLayerVisibility(item.layer.id)}
            onCreateChildLayer={() => createLayerAt(item.layer.id)}
            onMove={(targetId) => {
              if (selectedRotoLayerIds.length > 1 && selectedLayerIdSet.has(item.layer.id)) {
                handleMoveSelectedLayers(targetId);
              } else {
                handleMoveLayer(item.layer.id, targetId);
              }
            }}
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
      }

      const rowKey = getHierarchyItemKey({ type: 'path', id: item.path.id });
      const row: Row = {
        depth: item.depth,
        item: { type: 'path', id: item.path.id },
        key: rowKey,
        label: item.path.name,
        parentLayerId: item.path.parentLayerId ?? null,
        path: item.path,
      };
      const shapeIcon = item.path.sourceMask ? (
        <Icons.Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
      ) : item.path.shapeType === RotoShapeType.BSPLINE ? (
        <Icons.Curve className="h-3.5 w-3.5 flex-shrink-0" />
      ) : (
        <Icons.Square className="h-3.5 w-3.5 flex-shrink-0" />
      );
      const isSelectedTarget = selectedItemCount > 1 && selectedPathIdSet.has(item.path.id);
      const visibilityLabel = isSelectedTarget
        ? selectionVisibilityToggleLabel
        : item.path.visible === false
          ? `Show ${item.path.name}`
          : `Hide ${item.path.name}`;

      return (
        <LeafItemRowShell
          itemName={item.path.name}
          rowKey={rowKey}
          depth={item.depth}
          isSelected={selectedPathIdSet.has(item.path.id)}
          isBeingDragged={activeDraggedItemKeySet.has(rowKey)}
          isVisible={item.visible}
          leadingIcon={shapeIcon}
          visibilityLabel={visibilityLabel}
          menuWidthClass="w-64"
          rowControlDataAttr={{ 'data-roto-row-control': 'true' }}
          layerOptions={layerOptions}
          currentParentLayerId={item.path.parentLayerId ?? null}
          onSelect={(ext) => handleSelectPath(item.path.id, ext)}
          onToggleVisibility={() => handlePathVisibility(item.path.id)}
          onMove={(targetId) => {
            if (selectedRotoPathIds.length > 1 && selectedPathIdSet.has(item.path.id)) {
              handleMoveSelectedPaths(targetId);
            } else {
              handleMovePath(item.path.id, targetId);
            }
          }}
          onDelete={() => handlePathDeleteAction(item.path.id)}
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
    },
    [
      activeDraggedItemKeySet,
      activeDropHighlightLayerId,
      applyNodeUpdate,
      createLayerAt,
      getCurrentNode,
      handleItemSelect,
      handleLayerDeleteAction,
      handleLayerVisibility,
      handleMoveLayer,
      handleMoveSelectedLayers,
      handleMovePath,
      handleMoveSelectedPaths,
      handlePathDeleteAction,
      handlePathVisibility,
      handlePrimaryRowClick,
      handleRowPointerDown,
      handleSelectLayer,
      handleSelectPath,
      hierarchyNode,
      layerOptions,
      rowRefs,
      selectedItemCount,
      selectedLayerIdSet,
      selectedPathCountByLayerId,
      selectedPathIdSet,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      selectionVisibilityToggleLabel,
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
          {countLabel(hierarchyNode.paths.length, 'shape', 'shapes')}
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
                title="Wrap selection in a new layer"
                aria-label="Wrap selection in a new layer"
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
          getKey={(item: RotoHierarchyItem) =>
            item.type === 'layer'
              ? getHierarchyItemKey({ type: 'layer', id: item.layer.id })
              : getHierarchyItemKey({ type: 'path', id: item.path.id })
          }
          getChildren={(item: RotoHierarchyItem) => (item.type === 'layer' ? item.children : [])}
          isExpanded={(item: RotoHierarchyItem) =>
            item.type !== 'layer' || item.layer.expanded !== false
          }
          renderItem={renderHierarchyItem}
        />
      </ItemsTreeView>
    </ItemsPanelLayout>
  );
}

export default RotoItemsPanel;
