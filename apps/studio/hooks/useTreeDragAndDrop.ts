import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { usePointerDrag } from './usePointerDrag';
import { TreeDragController, type TreeDragCallbacks } from './TreeDragController';

type RefValue<T> = {
  current: T;
};

export interface TreeDragRow<TItem> {
  depth: number;
  item: TItem;
  key: string;
  label: string;
  parentLayerId: string | null;
}

export interface TreeDropTarget {
  description: string;
  expandLayerId: string | null;
  highlightLayerId: string | null;
  indicatorDepth: number;
  indicatorTop: number;
  parentLayerId: string | null;
  siblingIndex: number;
}

interface UseTreeDragAndDropOptions<TItem, TRow extends TreeDragRow<TItem>> {
  rows: readonly TRow[];
  rowRefs: RefValue<Map<string, HTMLDivElement>>;
  contentRef: RefValue<HTMLDivElement | null>;
  viewportRef?: RefValue<HTMLDivElement | null>;
  getDragItemsForRow: (row: TRow) => readonly TItem[];
  getSiblingItems: (parentLayerId: string | null) => readonly TItem[];
  getItemKey: (item: TItem) => string;
  isSameItem: (a: TItem, b: TItem) => boolean;
  onDrop: (items: readonly TItem[], target: TreeDropTarget) => void | Promise<void>;
  canDropItemsToParent?: (items: readonly TItem[], parentLayerId: string | null) => boolean;
  isContainerItem?: (item: TItem) => boolean;
  getContainerItemId?: (item: TItem) => string | null;
  rowControlSelector?: string;
  activationDistance?: number;
  autoScrollEdge?: number;
  autoScrollStep?: number;
}

type DragState<TItem> = {
  items: readonly TItem[];
  key: string;
};

const DEFAULT_ROW_CONTROL_SELECTOR = '[data-tree-row-control="true"]';
const DEFAULT_DRAG_AUTO_SCROLL_EDGE = 40;
const DEFAULT_DRAG_AUTO_SCROLL_STEP = 18;
const DEFAULT_ROW_DRAG_ACTIVATION_DISTANCE = 4;

export const useTreeDragAndDrop = <TItem, TRow extends TreeDragRow<TItem>>({
  rows,
  rowRefs,
  contentRef,
  viewportRef,
  getDragItemsForRow,
  getSiblingItems,
  getItemKey,
  isSameItem,
  onDrop,
  canDropItemsToParent,
  isContainerItem,
  getContainerItemId,
  rowControlSelector = DEFAULT_ROW_CONTROL_SELECTOR,
  activationDistance = DEFAULT_ROW_DRAG_ACTIVATION_DISTANCE,
  autoScrollEdge = DEFAULT_DRAG_AUTO_SCROLL_EDGE,
  autoScrollStep = DEFAULT_DRAG_AUTO_SCROLL_STEP,
}: UseTreeDragAndDropOptions<TItem, TRow>) => {
  const dragStateRef = useRef<DragState<TItem> | null>(null);
  const dropTargetRef = useRef<TreeDropTarget | null>(null);
  const [dragState, setDragState] = useState<DragState<TItem> | null>(null);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);

  const getBranchEndIndex = useCallback(
    (startIndex: number) => {
      const startRow = rows[startIndex];
      if (!startRow) return startIndex;

      let endIndex = startIndex;
      for (let index = startIndex + 1; index < rows.length; index += 1) {
        if (rows[index].depth <= startRow.depth) break;
        endIndex = index;
      }
      return endIndex;
    },
    [rows],
  );

  const autoScrollDragViewport = useCallback(
    (clientY: number) => {
      const viewport = viewportRef?.current ?? null;
      if (!viewport) return;

      const viewportRect = viewport.getBoundingClientRect();
      if (clientY < viewportRect.top + autoScrollEdge) {
        const ratio = (viewportRect.top + autoScrollEdge - clientY) / autoScrollEdge;
        viewport.scrollTop -= Math.ceil(autoScrollStep * Math.min(1, ratio));
        return;
      }

      if (clientY > viewportRect.bottom - autoScrollEdge) {
        const ratio = (clientY - (viewportRect.bottom - autoScrollEdge)) / autoScrollEdge;
        viewport.scrollTop += Math.ceil(autoScrollStep * Math.min(1, ratio));
      }
    },
    [autoScrollEdge, autoScrollStep, viewportRef],
  );

  const canDropDraggedItemsToParent = useCallback(
    (draggedItems: readonly TItem[], parentLayerId: string | null) =>
      canDropItemsToParent ? canDropItemsToParent(draggedItems, parentLayerId) : true,
    [canDropItemsToParent],
  );

  const getDropTargetFromClientY = useCallback(
    (clientY: number, draggedItems: readonly TItem[]): TreeDropTarget | null => {
      const contentElement = contentRef.current;
      if (!contentElement || rows.length === 0 || draggedItems.length === 0) return null;

      const draggedItemKeySet = new Set(draggedItems.map((item) => getItemKey(item)));
      const rowsWithRects = rows
        .map((row, index) => {
          const element = rowRefs.current.get(row.key);
          if (!element) return null;
          return {
            index,
            rect: element.getBoundingClientRect(),
            row,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            index: number;
            rect: DOMRect;
            row: TRow;
          } => entry !== null,
        );

      if (rowsWithRects.length === 0) return null;

      const contentRect = contentElement.getBoundingClientRect();
      const toContentTop = (viewportY: number) => viewportY - contentRect.top;
      const rootSiblings = getSiblingItems(null).filter(
        (item) => !draggedItemKeySet.has(getItemKey(item)),
      );
      const firstRow = rowsWithRects[0];
      const lastRow = rowsWithRects[rowsWithRects.length - 1];

      if (clientY <= firstRow.rect.top) {
        return {
          description: 'To Root',
          expandLayerId: null,
          highlightLayerId: null,
          indicatorDepth: 0,
          indicatorTop: toContentTop(firstRow.rect.top),
          parentLayerId: null,
          siblingIndex: 0,
        };
      }

      if (clientY >= lastRow.rect.bottom) {
        return {
          description: 'To Root',
          expandLayerId: null,
          highlightLayerId: null,
          indicatorDepth: 0,
          indicatorTop: toContentTop(lastRow.rect.bottom),
          parentLayerId: null,
          siblingIndex: rootSiblings.length,
        };
      }

      let hitEntry =
        rowsWithRects.find((entry) => clientY >= entry.rect.top && clientY <= entry.rect.bottom) ??
        null;

      if (!hitEntry) {
        hitEntry = rowsWithRects.find((entry) => clientY < entry.rect.top) ?? null;
        if (!hitEntry) return null;

        const siblingItems = getSiblingItems(hitEntry.row.parentLayerId).filter(
          (item) => !draggedItemKeySet.has(getItemKey(item)),
        );
        const siblingIndex = siblingItems.findIndex((item) => isSameItem(item, hitEntry.row.item));

        if (siblingIndex === -1) return null;
        if (!canDropDraggedItemsToParent(draggedItems, hitEntry.row.parentLayerId)) return null;

        return {
          description: `Before ${hitEntry.row.label}`,
          expandLayerId: null,
          highlightLayerId: null,
          indicatorDepth: hitEntry.row.depth,
          indicatorTop: toContentTop(hitEntry.rect.top),
          parentLayerId: hitEntry.row.parentLayerId,
          siblingIndex,
        };
      }

      const rowHeight = Math.max(1, hitEntry.rect.height);
      const relativeY = (clientY - hitEntry.rect.top) / rowHeight;

      if (draggedItemKeySet.has(hitEntry.row.key)) {
        return null;
      }

      const canDropInside =
        isContainerItem?.(hitEntry.row.item) &&
        relativeY >= 0.32 &&
        relativeY <= 0.68 &&
        canDropDraggedItemsToParent(draggedItems, getContainerItemId?.(hitEntry.row.item) ?? null);

      if (canDropInside) {
        const containerId = getContainerItemId?.(hitEntry.row.item) ?? null;
        if (containerId !== null) {
          const nextChildIndex = hitEntry.index + 1;
          const nextRow = rows[nextChildIndex];
          const hasVisibleChildren = nextRow !== undefined && nextRow.depth > hitEntry.row.depth;

          return {
            description: `Inside ${hitEntry.row.label}`,
            expandLayerId: containerId,
            highlightLayerId: containerId,
            indicatorDepth: hitEntry.row.depth + 1,
            indicatorTop: toContentTop(
              hasVisibleChildren
                ? (rowRefs.current.get(nextRow.key)?.getBoundingClientRect().top ??
                    hitEntry.rect.bottom)
                : hitEntry.rect.bottom,
            ),
            parentLayerId: containerId,
            siblingIndex: 0,
          };
        }
      }

      if (!canDropDraggedItemsToParent(draggedItems, hitEntry.row.parentLayerId)) {
        return null;
      }

      const siblingItems = getSiblingItems(hitEntry.row.parentLayerId).filter(
        (item) => !draggedItemKeySet.has(getItemKey(item)),
      );
      const targetIndex = siblingItems.findIndex((item) => isSameItem(item, hitEntry.row.item));

      if (targetIndex === -1) return null;

      if (relativeY < 0.5) {
        return {
          description: `Before ${hitEntry.row.label}`,
          expandLayerId: null,
          highlightLayerId: null,
          indicatorDepth: hitEntry.row.depth,
          indicatorTop: toContentTop(hitEntry.rect.top),
          parentLayerId: hitEntry.row.parentLayerId,
          siblingIndex: targetIndex,
        };
      }

      const branchEndRow = rowsWithRects[getBranchEndIndex(hitEntry.index)] ?? hitEntry;
      return {
        description: `After ${hitEntry.row.label}`,
        expandLayerId: null,
        highlightLayerId: null,
        indicatorDepth: hitEntry.row.depth,
        indicatorTop: toContentTop(branchEndRow.rect.bottom),
        parentLayerId: hitEntry.row.parentLayerId,
        siblingIndex: targetIndex + 1,
      };
    },
    [
      canDropDraggedItemsToParent,
      contentRef,
      getBranchEndIndex,
      getContainerItemId,
      getItemKey,
      getSiblingItems,
      isContainerItem,
      isSameItem,
      rowRefs,
      rows,
    ],
  );

  const { handleRowPointerDown, suppressedClickKeyRef } = usePointerDrag<TRow>({
    activationDistance,
    onDragStart: (row) => {
      const target = eventTargetRef.current;
      if (rowControlSelector && target && target.closest(rowControlSelector)) return false;

      const draggedItems = [...getDragItemsForRow(row)];
      if (draggedItems.length === 0 || !rowRefs.current.get(row.key)) return false;

      const nextDragState: DragState<TItem> = {
        items: draggedItems,
        key: row.key,
      };

      dragStateRef.current = nextDragState;
      setDragState(nextDragState);

      // Start the drag controller session
      const controller = dragControllerRef.current;
      if (controller) {
        controller.callbacks = dragCallbacksRef.current;
        controller.start(draggedItems);
      }

      return true;
    },
  });

  // Drag controller (persistent class instance, no React deps)
  const dragControllerRef = useRef<TreeDragController<TItem> | null>(null);
  if (!dragControllerRef.current) {
    dragControllerRef.current = new TreeDragController<TItem>();
  }

  // Stable ref for drag callbacks (updated each render to avoid stale closures)
  const dragCallbacksRef = useRef<TreeDragCallbacks<TItem> | null>(null);
  dragCallbacksRef.current = {
    onDragMove: (clientY, items) => {
      autoScrollDragViewport(clientY);
      const nextDropTarget = getDropTargetFromClientY(clientY, items);
      dropTargetRef.current = nextDropTarget;
      setDropTarget(nextDropTarget);
    },
    onDragUp: () => {
      const activeDropTarget = dropTargetRef.current;
      const activeDragState = dragStateRef.current;
      if (activeDropTarget && activeDragState) {
        void onDrop(activeDragState.items, activeDropTarget);
      }
    },
    onDragCancel: () => {
      // No commit — just cleanup
    },
    onDragEnd: () => {
      dragStateRef.current = null;
      dropTargetRef.current = null;
      setDragState(null);
      setDropTarget(null);
    },
  };

  // Cleanup: stop drag session on unmount to prevent listener leaks
  useEffect(() => {
    const controller = dragControllerRef.current;
    return () => controller?.stop();
  }, []);

  // Track the event target from the last pointer down for rowControlSelector check
  const eventTargetRef = useRef<Element | null>(null);

  // Wrap handleRowPointerDown to intercept and store the event target
  const handleRowPointerDownWithTarget = useCallback(
    (event: React.PointerEvent<HTMLElement>, row: TRow) => {
      eventTargetRef.current = event.target instanceof Element ? event.target : null;
      handleRowPointerDown(event, row);
    },
    [handleRowPointerDown],
  );

  const handlePrimaryRowClick = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      rowKey: string,
      onSelect: (shiftKey: boolean, toggleKey: boolean) => void,
    ) => {
      if (suppressedClickKeyRef.current === rowKey) {
        suppressedClickKeyRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      onSelect(event.shiftKey, event.metaKey || event.ctrlKey);
    },
    [suppressedClickKeyRef],
  );

  const draggedItemKeySet = useMemo(
    () => new Set((dragState?.items ?? []).map((item) => getItemKey(item))),
    [dragState?.items, getItemKey],
  );

  return {
    dropTarget,
    handleRowPointerDown: handleRowPointerDownWithTarget,
    handlePrimaryRowClick,
    draggedItemKeySet,
    activeDropHighlightLayerId: dropTarget?.highlightLayerId ?? null,
  };
};
