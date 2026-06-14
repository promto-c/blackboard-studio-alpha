// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreeDragCallbacks<TItem> {
  /** Called on each pointer move during the drag. */
  onDragMove: (clientY: number, items: readonly TItem[]) => void;
  /** Called on pointer up. Intended for commit logic. */
  onDragUp: () => void;
  /** Called on pointer cancel. Intended for cancel-only cleanup. */
  onDragCancel: () => void;
  /** Called after every drag end (both up and cancel). Cleans up React state. */
  onDragEnd: () => void;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Manages the imperative drag session lifecycle for a tree/list drag-and-drop.
 *
 * Handles window-level pointermove/pointerup/pointercancel listeners, body
 * cursor/user-select restoration, and delegates drop-target computation and
 * commit via a `callbacks` ref that is updated each render.
 *
 * ## Usage
 *
 * ```ts
 * const controllerRef = useRef(new TreeDragController<TItem>());
 * controllerRef.current.callbacks = callbacks;
 * controllerRef.current.start(items);
 * ```
 */
export class TreeDragController<TItem> {
  // ---- Updated each render (avoids stale closures) ----
  callbacks: TreeDragCallbacks<TItem> | null = null;

  // ---- Drag session state ----
  private dragItems: readonly TItem[] = [];
  private active = false;

  /** Saved body styles restored on drag end. */
  private previousCursor = '';
  private previousUserSelect = '';

  constructor() {
    // Arrow function class fields are auto-bound — stable references.
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start a new drag session. Registers window-level event listeners. */
  start(items: readonly TItem[]): void {
    this.dragItems = items;
    this.active = true;

    this.previousCursor = document.body.style.cursor;
    this.previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', this.#onMove);
    window.addEventListener('pointerup', this.#onUp);
    window.addEventListener('pointercancel', this.#onCancel);
  }

  /** Terminate the current drag session immediately (e.g. on unmount). */
  stop(): void {
    this.#removeListeners();
    this.#restoreBody();
    this.active = false;
    this.dragItems = [];
  }

  // -----------------------------------------------------------------------
  // Private: event handlers
  // -----------------------------------------------------------------------

  #onMove = (e: PointerEvent): void => {
    if (!this.active) return;
    this.callbacks?.onDragMove(e.clientY, this.dragItems);
  };

  #onUp = (): void => {
    if (!this.active) return;
    this.#removeListeners();
    this.#restoreBody();
    this.active = false;

    this.callbacks?.onDragUp();
    this.callbacks?.onDragEnd();
    this.dragItems = [];
  };

  #onCancel = (): void => {
    if (!this.active) return;
    this.#removeListeners();
    this.#restoreBody();
    this.active = false;

    this.callbacks?.onDragCancel();
    this.callbacks?.onDragEnd();
    this.dragItems = [];
  };

  // -----------------------------------------------------------------------
  // Private: helpers
  // -----------------------------------------------------------------------

  #restoreBody(): void {
    document.body.style.cursor = this.previousCursor;
    document.body.style.userSelect = this.previousUserSelect;
  }

  #removeListeners(): void {
    window.removeEventListener('pointermove', this.#onMove);
    window.removeEventListener('pointerup', this.#onUp);
    window.removeEventListener('pointercancel', this.#onCancel);
  }
}
