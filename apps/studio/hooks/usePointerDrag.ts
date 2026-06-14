import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PointerDragRow {
  key: string;
}

interface PendingDragIntent<TRow> {
  pointerId: number;
  row: TRow;
  startClientX: number;
  startClientY: number;
}

export interface UsePointerDragOptions<TRow extends PointerDragRow> {
  /** Minimum pointer movement in px to activate a drag. */
  activationDistance?: number;
  /**
   * When true, starts dragging immediately on pointer down instead of waiting for
   * the activation distance to be exceeded. The click suppression mechanism still
   * works, marking the row key so the corresponding click handler can skip it.
   */
  startImmediately?: boolean;
  /**
   * Called when drag is activated (either immediately when `startImmediately` is
   * true, or after pointer movement exceeds `activationDistance`).
   * Return true to accept the drag; false to cancel.
   */
  onDragStart: (row: TRow, clientY: number) => boolean;
}

export interface UsePointerDragReturn<TRow> {
  /**
   * Call from the row's onPointerDown to register a pending drag intent.
   */
  handleRowPointerDown: (event: ReactPointerEvent<HTMLElement>, row: TRow) => void;
  /**
   * Attach this to your click handler: if the click targets a row whose
   * key matches this ref, the click should be suppressed (it was actually
   * a drag gesture).
   */
  suppressedClickKeyRef: { current: string | null };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ACTIVATION_DISTANCE = 4;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Handles the low-level pointer event plumbing for drag-and-drop:
 * - Registers a pending drag intent on pointer down
 * - Watches pointer movement across the window
 * - Calls `onDragStart` when the pointer moves past `activationDistance` px
 * - Provides a ref to suppress the corresponding click event
 *
 * This hook does NOT manage the active drag session (move/up/cancel listeners,
 * cursor styling, etc.). Each consumer manages its own drag session lifecycle
 * using its own state (e.g. `dragState != null` -> active drag).
 *
 * ## Usage
 *
 * ```ts
 * const { handleRowPointerDown, suppressedClickKeyRef } = usePointerDrag({
 *   onDragStart: (row, clientY) => {
 *     setDragState({ ... });
 *     return true;
 *   },
 * });
 *
 * // On each row element:
 * <div onPointerDown={(e) => handleRowPointerDown(e, row)} />
 *
 * // In the click handler:
 * const handleClick = (e, rowKey) => {
 *   if (suppressedClickKeyRef.current === rowKey) {
 *     suppressedClickKeyRef.current = null;
 *     e.preventDefault();
 *     e.stopPropagation();
 *     return;
 *   }
 *   // normal selection logic...
 * };
 * ```
 */
export function usePointerDrag<TRow extends PointerDragRow>({
  activationDistance = DEFAULT_ACTIVATION_DISTANCE,
  startImmediately = false,
  onDragStart,
}: UsePointerDragOptions<TRow>): UsePointerDragReturn<TRow> {
  const pendingDragIntentRef = useRef<PendingDragIntent<TRow> | null>(null);
  const suppressedClickKeyRef = useRef<string | null>(null);
  const onDragStartRef = useRef(onDragStart);
  const activationDistanceRef = useRef(activationDistance);
  const startImmediatelyRef = useRef(startImmediately);

  onDragStartRef.current = onDragStart;
  activationDistanceRef.current = activationDistance;
  startImmediatelyRef.current = startImmediately;

  const handleRowPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, row: TRow) => {
    if (event.button !== 0 || !event.isPrimary) return;

    const { clientY } = event;

    pendingDragIntentRef.current = {
      pointerId: event.pointerId,
      row,
      startClientX: event.clientX,
      startClientY: clientY,
    };
    suppressedClickKeyRef.current = null;

    if (startImmediatelyRef.current) {
      pendingDragIntentRef.current = null;
      if (onDragStartRef.current(row, clientY)) {
        suppressedClickKeyRef.current = row.key;
      }
    }
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pendingIntent = pendingDragIntentRef.current;
      if (!pendingIntent || pendingIntent.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pendingIntent.startClientX;
      const deltaY = event.clientY - pendingIntent.startClientY;
      if (Math.hypot(deltaX, deltaY) < activationDistanceRef.current) {
        return;
      }

      pendingDragIntentRef.current = null;

      if (onDragStartRef.current(pendingIntent.row, event.clientY)) {
        suppressedClickKeyRef.current = pendingIntent.row.key;
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const pendingIntent = pendingDragIntentRef.current;
      if (!pendingIntent || pendingIntent.pointerId !== event.pointerId) return;
      pendingDragIntentRef.current = null;
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const pendingIntent = pendingDragIntentRef.current;
      if (!pendingIntent || pendingIntent.pointerId !== event.pointerId) return;
      pendingDragIntentRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, []);

  return {
    handleRowPointerDown,
    suppressedClickKeyRef,
  };
}
