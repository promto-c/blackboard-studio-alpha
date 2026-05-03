import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

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

type PendingDragIntent<TRow> = {
  pointerId: number;
  row: TRow;
  startClientX: number;
  startClientY: number;
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
  const pendingDragIntentRef = useRef<PendingDragIntent<TRow> | null>(null);
  const suppressedClickRowKeyRef = useRef<string | null>(null);
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

  const beginRowDrag = useCallback(
    (row: TRow, clientY: number) => {
      const draggedItems = [...getDragItemsForRow(row)];
      if (draggedItems.length === 0 || !rowRefs.current.get(row.key)) return false;

      const nextDragState: DragState<TItem> = {
        items: draggedItems,
        key: row.key,
      };

      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
      const nextDropTarget = getDropTargetFromClientY(clientY, draggedItems);
      dropTargetRef.current = nextDropTarget;
      setDropTarget(nextDropTarget);
      return true;
    },
    [getDragItemsForRow, getDropTargetFromClientY, rowRefs],
  );

  const handleRowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, row: TRow) => {
      if (event.button !== 0 || !event.isPrimary) return;

      const target = event.target instanceof Element ? event.target : null;
      if (rowControlSelector && target?.closest(rowControlSelector)) return;

      pendingDragIntentRef.current = {
        pointerId: event.pointerId,
        row,
        startClientX: event.clientX,
        startClientY: event.clientY,
      };
      suppressedClickRowKeyRef.current = null;
    },
    [rowControlSelector],
  );

  const handlePrimaryRowClick = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      rowKey: string,
      onSelect: (shiftKey: boolean, toggleKey: boolean) => void,
    ) => {
      if (suppressedClickRowKeyRef.current === rowKey) {
        suppressedClickRowKeyRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      onSelect(event.shiftKey, event.metaKey || event.ctrlKey);
    },
    [],
  );

  useEffect(() => {
    const dragSession = dragState;
    if (!dragSession) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const activeDragState = dragStateRef.current;
      if (!activeDragState) return;

      autoScrollDragViewport(event.clientY);
      const nextDropTarget = getDropTargetFromClientY(event.clientY, activeDragState.items);
      dropTargetRef.current = nextDropTarget;
      setDropTarget(nextDropTarget);
    };

    const finishDrag = (commit: boolean) => {
      const activeDropTarget = dropTargetRef.current;
      const activeDragState = dragStateRef.current;

      dragStateRef.current = null;
      dropTargetRef.current = null;
      setDragState(null);
      setDropTarget(null);

      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;

      if (!commit || !activeDropTarget || !activeDragState) return;
      void onDrop(activeDragState.items, activeDropTarget);
    };

    const handlePointerUp = () => finishDrag(true);
    const handlePointerCancel = () => finishDrag(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [autoScrollDragViewport, dragState, getDropTargetFromClientY, onDrop]);

  useEffect(() => {
    const clearPendingIntent = (pointerId?: number) => {
      const pendingIntent = pendingDragIntentRef.current;
      if (!pendingIntent) return;
      if (pointerId !== undefined && pendingIntent.pointerId !== pointerId) return;
      pendingDragIntentRef.current = null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const pendingIntent = pendingDragIntentRef.current;
      if (!pendingIntent || pendingIntent.pointerId !== event.pointerId || dragStateRef.current) {
        return;
      }

      const deltaX = event.clientX - pendingIntent.startClientX;
      const deltaY = event.clientY - pendingIntent.startClientY;
      if (Math.hypot(deltaX, deltaY) < activationDistance) {
        return;
      }

      pendingDragIntentRef.current = null;
      if (beginRowDrag(pendingIntent.row, event.clientY)) {
        suppressedClickRowKeyRef.current = pendingIntent.row.key;
      }
    };

    const handlePointerUp = (event: PointerEvent) => clearPendingIntent(event.pointerId);
    const handlePointerCancel = (event: PointerEvent) => clearPendingIntent(event.pointerId);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [activationDistance, beginRowDrag]);

  const draggedItemKeySet = useMemo(
    () => new Set((dragState?.items ?? []).map((item) => getItemKey(item))),
    [dragState?.items, getItemKey],
  );

  return {
    dropTarget,
    handleRowPointerDown,
    handlePrimaryRowClick,
    draggedItemKeySet,
    activeDropHighlightLayerId: dropTarget?.highlightLayerId ?? null,
  };
};
