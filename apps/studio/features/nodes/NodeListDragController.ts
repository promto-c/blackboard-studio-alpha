import type { AnyNode } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SPACING = 4;

export interface NodeListDragCallbacks {
  onLocalReorder: (ids: string[], newIdx: number) => void;
  onCommit: (startIdx: number, currentIdx: number, ids: string[]) => void;
  onDragEnd: () => void;
}

export interface NodeListDragControllerOptions {
  listElFactory: () => HTMLElement | null;
  itemRefsFactory: () => Map<string, HTMLElement>;
  measuredHeightsFactory: () => Map<string, number>;
  dragInitialTopsFactory: () => Map<string, number>;
  displayedStacksFactory: () => AnyNode[][];
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Manages the imperative drag session lifecycle for NodeList's drag-to-reorder.
 *
 * Handles window-level pointermove/pointerup listeners, element positioning,
 * multi-stack visual sync, and index computation. Delegates React-specific
 * state mutations via a `callbacks` ref that is updated each render to
 * prevent stale closures.
 *
 * ## Usage
 *
 * ```ts
 * const controllerRef = useRef(new NodeListDragController({ ... }));
 * controllerRef.current.callbacks = callbacks;
 * controllerRef.current.start(ids, element, yOffset, startIdx);
 * ```
 */
export class NodeListDragController {
  // ---- Factories (read each frame to get latest React data) ----
  private readonly listElFactory: () => HTMLElement | null;
  private readonly itemRefsFactory: () => Map<string, HTMLElement>;
  private readonly measuredHeightsFactory: () => Map<string, number>;
  private readonly dragInitialTopsFactory: () => Map<string, number>;
  private readonly displayedStacksFactory: () => AnyNode[][];

  // ---- Updated each render (avoids stale closures) ----
  callbacks: NodeListDragCallbacks | null = null;

  // ---- Drag session state ----
  private ids: string[] = [];
  private yOffset = 0;
  private element: HTMLElement | null = null;
  private startIdx = 0;
  private currentIdx = 0;
  private active = false;

  constructor(options: NodeListDragControllerOptions) {
    this.listElFactory = options.listElFactory;
    this.itemRefsFactory = options.itemRefsFactory;
    this.measuredHeightsFactory = options.measuredHeightsFactory;
    this.dragInitialTopsFactory = options.dragInitialTopsFactory;
    this.displayedStacksFactory = options.displayedStacksFactory;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start a new drag session. Registers window-level event listeners. */
  start(ids: string[], element: HTMLElement, yOffset: number, startIdx: number): void {
    this.ids = ids;
    this.yOffset = yOffset;
    this.element = element;
    this.startIdx = startIdx;
    this.currentIdx = startIdx;
    this.active = true;

    window.addEventListener('pointermove', this.#onMove);
    window.addEventListener('pointerup', this.#onUp);
  }

  /** Terminate the current drag session immediately (e.g. on unmount). */
  stop(): void {
    this.#removeListeners();
    this.active = false;
    this.element = null;
    this.ids = [];
  }

  // -----------------------------------------------------------------------
  // Private: event handlers
  // -----------------------------------------------------------------------

  #onMove = (e: PointerEvent): void => {
    if (!this.active) return;

    const listEl = this.listElFactory();
    const measuredHeights = this.measuredHeightsFactory();
    const dragInitialTops = this.dragInitialTopsFactory();
    const itemRefs = this.itemRefsFactory();
    const displayedStacks = this.displayedStacksFactory();

    if (!listEl || !this.element) return;

    const listRect = listEl.getBoundingClientRect();
    let y = e.clientY - listRect.top - this.yOffset;

    const listHeight = parseFloat(listEl.style.height);
    const primaryItemHeight = measuredHeights.get(this.ids[0]) ?? 0;
    const maxY = listHeight - primaryItemHeight;
    y = Math.max(0, Math.min(maxY, y));

    // Position the primary dragged element
    this.element.style.transform = 'none';
    this.element.style.top = `${y}px`;

    // Position all other dragged elements to follow the cursor
    const primaryDelta = y - (dragInitialTops.get(this.ids[0]) ?? y);
    for (let i = 1; i < this.ids.length; i++) {
      const otherId = this.ids[i];
      const otherEl = itemRefs.get(otherId);
      const otherInitialTop = dragInitialTops.get(otherId);
      if (otherEl && otherInitialTop !== undefined) {
        otherEl.style.transform = 'none';
        otherEl.style.top = `${otherInitialTop + primaryDelta}px`;
      }
    }

    // Compute the new insertion index from cursor Y
    const newIdx = this.#computeIndex(y, displayedStacks, measuredHeights);

    if (newIdx !== this.currentIdx) {
      this.currentIdx = newIdx;
      this.callbacks?.onLocalReorder(this.ids, newIdx);
    }
  };

  #onUp = (e: PointerEvent): void => {
    if (!this.active || !this.element) return;

    this.element.releasePointerCapture(e.pointerId);
    this.#removeListeners();
    this.active = false;

    if (this.startIdx !== this.currentIdx) {
      this.callbacks?.onCommit(this.startIdx, this.currentIdx, this.ids);
    }

    this.callbacks?.onDragEnd();
    this.element = null;
  };

  // -----------------------------------------------------------------------
  // Private: helpers
  // -----------------------------------------------------------------------

  #computeIndex(
    relativeY: number,
    displayedStacks: AnyNode[][],
    measuredHeights: Map<string, number>,
  ): number {
    let newIdx = 0;
    let cumulativeHeight = 0;

    for (let i = 0; i < displayedStacks.length; i++) {
      const stackId = displayedStacks[i][0].id;
      const height = measuredHeights.get(stackId) ?? 0;
      const slotCenter = cumulativeHeight + height / 2;
      if (relativeY < slotCenter) {
        newIdx = i;
        break;
      }
      cumulativeHeight += height + SPACING;
      if (i === displayedStacks.length - 1) {
        newIdx = i;
      }
    }

    return Math.max(0, Math.min(displayedStacks.length - 1, newIdx));
  }

  #removeListeners(): void {
    window.removeEventListener('pointermove', this.#onMove);
    window.removeEventListener('pointerup', this.#onUp);
  }
}
