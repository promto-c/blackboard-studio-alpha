import { useMemo, useRef } from 'react';
import { useTreeDragAndDrop, type TreeDragRow } from '@/hooks/useTreeDragAndDrop';
import { useTreeGuideSegments } from '@/hooks/useTreeGuideSegments';
import { getHierarchyItemKey, isSameHierarchyItem } from '@/utils/hierarchyHelpers';
import type { TreeGuideAdapter } from '@/utils/treeGuides';

// ---------------------------------------------------------------------------
// Generic row type
// ---------------------------------------------------------------------------

export interface FlatTreeRow<TItemRef> extends TreeDragRow<TItemRef> {
  depth: number;
  item: TItemRef;
  key: string;
  label: string;
  parentLayerId: string | null;
}

// ---------------------------------------------------------------------------
// Shared flatten utility — works for roto (path) and paint (stroke) hierarchies
// ---------------------------------------------------------------------------

export function flattenHierarchy<TItemRef>(
  items: readonly unknown[],
  leafTypeName: string,
  getLeaf?: (item: unknown) => { id: string; name: string } | null,
): { rows: FlatTreeRow<TItemRef>[]; keys: string[] } {
  const rows: FlatTreeRow<TItemRef>[] = [];

  const flatten = (items: readonly unknown[], parentLayerId: string | null = null) => {
    items.forEach((item: any) => {
      if (item.type === 'layer') {
        rows.push({
          depth: item.depth,
          item: { type: 'layer', id: item.layer.id } as unknown as TItemRef,
          key: getHierarchyItemKey({ type: 'layer', id: item.layer.id }),
          label: item.layer.name,
          parentLayerId,
        });
        if (item.layer.expanded !== false && item.children?.length > 0) {
          flatten(item.children, item.layer.id);
        }
        return;
      }

      const leaf = getLeaf ? getLeaf(item) : (item.path ?? item.stroke ?? item.leaf);
      if (!leaf) return;
      rows.push({
        depth: item.depth,
        item: { type: leafTypeName, id: leaf.id } as unknown as TItemRef,
        key: getHierarchyItemKey({ type: leafTypeName, id: leaf.id }),
        label: leaf.name,
        parentLayerId,
      });
    });
  };

  flatten(items);
  return {
    rows,
    keys: rows.map((r) => r.key),
  };
}

// ---------------------------------------------------------------------------
// Config for the shared hook
// ---------------------------------------------------------------------------

export interface TreePanelStateConfig<TItemRef> {
  leafTypeName: string;
  hierarchy: readonly unknown[];
  flatHierarchy: FlatTreeRow<TItemRef>[];
  flatHierarchyKeys: string[];
  getDragItemsForRow: (row: FlatTreeRow<TItemRef>) => TItemRef[];
  getSiblingItems: (parentLayerId: string | null) => TItemRef[];
  canDropItemsToParent: (items: readonly TItemRef[], parentLayerId: string | null) => boolean;
  isContainerItem: (item: TItemRef) => boolean;
  getContainerItemId: (item: TItemRef) => string | null;
  onHierarchyDrop: (
    items: readonly TItemRef[],
    target: {
      parentLayerId: string | null;
      siblingIndex: number;
      expandLayerId: string | null;
    },
  ) => void;
  getHierarchyItemDepth: (item: unknown) => number;
  getHierarchyItemChildren: (item: unknown) => readonly unknown[];
  isHierarchyItemExpanded: (item: unknown) => boolean;
  /** Extract the leaf ID for tree guide key generation. Leaf items don't have a top-level `id`. */
  getLeafId: (item: unknown) => string;
  rowControlSelector?: string;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface TreePanelState<TItemRef> {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  treeContentRef: React.RefObject<HTMLDivElement | null>;
  rowRefs: React.RefObject<Map<string, HTMLDivElement>>;
  dropTarget: { indicatorDepth: number; indicatorTop: number } | null;
  activeDraggedItemKeySet: ReadonlySet<string>;
  activeDropHighlightLayerId: string | null;
  treeGuideSegments: readonly import('@/utils/treeGuides').TreeGuideSegment[];
  handleRowPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    row: FlatTreeRow<TItemRef>,
  ) => void;
  handlePrimaryRowClick: (
    event: React.MouseEvent<HTMLElement>,
    rowKey: string,
    onSelect: (shiftKey: boolean, toggleKey: boolean) => void,
  ) => void;
}

// ---------------------------------------------------------------------------
// Shared hook: handles DnD setup + tree guide segments
// ---------------------------------------------------------------------------

export function useTreePanelState<TItemRef>(
  config: TreePanelStateConfig<TItemRef>,
): TreePanelState<TItemRef> {
  const {
    flatHierarchy,
    getDragItemsForRow,
    getSiblingItems,
    canDropItemsToParent,
    isContainerItem,
    getContainerItemId,
    onHierarchyDrop,
    rowControlSelector,
    leafTypeName,
    getHierarchyItemDepth,
    getHierarchyItemChildren,
    isHierarchyItemExpanded,
    getLeafId,
  } = config;

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const treeContentRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // -----------------------------------------------------------------------
  // Drag & Drop
  // -----------------------------------------------------------------------
  const {
    dropTarget,
    handleRowPointerDown,
    handlePrimaryRowClick,
    draggedItemKeySet: activeDraggedItemKeySet,
    activeDropHighlightLayerId,
  } = useTreeDragAndDrop<TItemRef, FlatTreeRow<TItemRef>>({
    rows: flatHierarchy,
    rowRefs,
    contentRef: treeContentRef,
    viewportRef: scrollViewportRef,
    getDragItemsForRow,
    getSiblingItems,
    getItemKey: getHierarchyItemKey as (item: TItemRef) => string,
    isSameItem: isSameHierarchyItem as (a: TItemRef, b: TItemRef) => boolean,
    canDropItemsToParent,
    isContainerItem,
    getContainerItemId,
    onDrop: onHierarchyDrop,
    rowControlSelector,
  });

  // -----------------------------------------------------------------------
  // Tree guides
  // -----------------------------------------------------------------------
  const treeGuideAdapter = useMemo<TreeGuideAdapter<unknown>>(
    () => ({
      getKey: (item: unknown) => {
        const typed = item as { type: string; layer?: { id: string } };
        if (typed.type === 'layer' && typed.layer) {
          return getHierarchyItemKey({ type: 'layer', id: typed.layer.id });
        }
        return getHierarchyItemKey({ type: leafTypeName, id: getLeafId(item) });
      },
      getDepth: getHierarchyItemDepth,
      getChildren: getHierarchyItemChildren,
      isExpanded: isHierarchyItemExpanded,
    }),
    [
      leafTypeName,
      getHierarchyItemDepth,
      getHierarchyItemChildren,
      isHierarchyItemExpanded,
      getLeafId,
    ],
  );

  const treeGuideSegments = useTreeGuideSegments({
    items: config.hierarchy as readonly unknown[],
    flatRowKeys: config.flatHierarchyKeys,
    rowRefs,
    contentRef: treeContentRef,
    viewportRef: scrollViewportRef,
    adapter: treeGuideAdapter,
  });

  return {
    scrollViewportRef,
    treeContentRef,
    rowRefs,
    dropTarget,
    activeDraggedItemKeySet,
    activeDropHighlightLayerId,
    treeGuideSegments,
    handleRowPointerDown,
    handlePrimaryRowClick,
  };
}
