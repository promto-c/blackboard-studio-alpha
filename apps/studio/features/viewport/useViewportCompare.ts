import { useCallback, useEffect, useRef } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { type ViewerSlot } from '@blackboard/types';
import isTextEntryTarget from '@/utils/isTextEntryTarget';

/**
 * useViewportCompare — Manages keyboard-driven compare mode activation.
 *
 * Keyboard behavior:
 * - Press 1/2/3/4 to activate that viewer slot (existing behavior via hotkeys).
 * - Hold two number keys briefly to enter compare mode for those two slots.
 * - Normalize slot order so 1+2 and 2+1 produce the same layout.
 * - Pressing a single number while comparing exits compare and activates that slot.
 * - Escape exits compare.
 * - Compare remains active after releasing the keys.
 * - Clears held-key state on window blur.
 * - Ignores key repeat and shortcuts while typing in text inputs.
 */
export function useViewportCompare() {
  const compareView = useEditorSelector((s) => s.compareView);
  const viewerSlots = useEditorSelector((s) => s.viewerSlots);
  const viewerNodeId = useEditorSelector((s) => s.viewerNodeId);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const nodes = useEditorSelector((s) => s.nodes);
  const { compareChordHoldMs } = usePreferences();
  const {
    enterCompareMode,
    exitCompareMode,
    swapCompareSlots,
    setCompareMode,
    setCompareSizingMode,
    setCompareWipeOrientation,
    setCompareWipeReference,
  } = useEditorActions();

  // Track currently held slot keys (by number value, not by keyboard event)
  const heldSlotsRef = useRef<Set<number>>(new Set());
  const compareChordTimeoutRef = useRef<number | null>(null);
  const pendingCompareSlotsRef = useRef<[ViewerSlot, ViewerSlot] | null>(null);

  // Track if we've already entered compare mode from the current key combination
  // to prevent re-entering on key repeat events
  const hasEnteredCompareFromComboRef = useRef<boolean>(false);

  const clearPendingCompareChord = useCallback(() => {
    if (compareChordTimeoutRef.current !== null) {
      window.clearTimeout(compareChordTimeoutRef.current);
      compareChordTimeoutRef.current = null;
    }
    pendingCompareSlotsRef.current = null;
  }, []);

  const scheduleCompareChord = useCallback(
    (first: ViewerSlot, second: ViewerSlot) => {
      if (pendingCompareSlotsRef.current || hasEnteredCompareFromComboRef.current) return;

      pendingCompareSlotsRef.current = [first, second];
      compareChordTimeoutRef.current = window.setTimeout(() => {
        compareChordTimeoutRef.current = null;
        const pendingSlots = pendingCompareSlotsRef.current;
        pendingCompareSlotsRef.current = null;
        if (!pendingSlots || compareView.isActive) return;

        const [slotA, slotB] = pendingSlots;
        if (
          heldSlotsRef.current.has(slotA) &&
          heldSlotsRef.current.has(slotB) &&
          viewerSlots?.[slotA] &&
          viewerSlots?.[slotB]
        ) {
          hasEnteredCompareFromComboRef.current = true;
          enterCompareMode(slotA, slotB);
        }
      }, compareChordHoldMs);
    },
    [compareChordHoldMs, compareView.isActive, enterCompareMode, viewerSlots],
  );

  // Handle keydown for compare mode detection
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore key repeat
      if (event.repeat) return;
      // Ignore if typing in a text input
      if (isTextEntryTarget(event.target)) return;

      const key = event.key;
      const slotNumber = parseInt(key, 10);

      // Check if the key is a viewer slot number (1-4)
      if (!isNaN(slotNumber) && slotNumber >= 1 && slotNumber <= 4) {
        const slot = slotNumber as ViewerSlot;
        const isAssigned = !!viewerSlots?.[slot];

        // Only respond to assigned slots
        if (!isAssigned) return;

        // Add to held slots
        heldSlotsRef.current.add(slotNumber);

        // Check if we have exactly 2 held slots
        if (heldSlotsRef.current.size === 2 && !hasEnteredCompareFromComboRef.current) {
          const [first, second] = Array.from(heldSlotsRef.current).sort() as [
            ViewerSlot,
            ViewerSlot,
          ];
          if (viewerSlots?.[first] && viewerSlots?.[second]) {
            scheduleCompareChord(first, second);
          }
        } else if (heldSlotsRef.current.size !== 2) {
          clearPendingCompareChord();
        }
      }

      // Escape exits compare
      if (event.key === 'Escape' && compareView.isActive) {
        event.preventDefault();
        event.stopPropagation();
        exitCompareMode();
        // Also clear refs
        clearPendingCompareChord();
        heldSlotsRef.current.clear();
        hasEnteredCompareFromComboRef.current = false;
      }
    },
    [
      clearPendingCompareChord,
      compareView.isActive,
      exitCompareMode,
      scheduleCompareChord,
      viewerSlots,
    ],
  );

  // Handle keyup for compare mode tracking
  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;

      const key = event.key;
      const slotNumber = parseInt(key, 10);

      if (!isNaN(slotNumber) && slotNumber >= 1 && slotNumber <= 4) {
        heldSlotsRef.current.delete(slotNumber);

        if (heldSlotsRef.current.size < 2) {
          clearPendingCompareChord();
        }

        // If we released one of the two compare keys, don't exit compare
        // (compare remains active after releasing the keys)
        if (heldSlotsRef.current.size === 0) {
          hasEnteredCompareFromComboRef.current = false;
        }

        // If we were in compare mode and a single key is pressed (not held together),
        // it's handled by the keydown path above entering compare mode.
        // If user releases all keys, compare stays active as specified.
      }
    },
    [clearPendingCompareChord],
  );

  // Handle window blur - clear held state
  const handleWindowBlur = useCallback(() => {
    clearPendingCompareChord();
    heldSlotsRef.current.clear();
    hasEnteredCompareFromComboRef.current = false;
  }, [clearPendingCompareChord]);

  // Register global keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [handleKeyDown, handleKeyUp, handleWindowBlur]);

  // Cleanup on unmount
  useEffect(() => {
    const heldSlots = heldSlotsRef.current;
    return () => {
      clearPendingCompareChord();
      heldSlots.clear();
      hasEnteredCompareFromComboRef.current = false;
    };
  }, [clearPendingCompareChord]);

  // Close compare if either compared slot becomes unassigned
  useEffect(() => {
    if (!compareView.isActive) return;
    if (!compareView.slotA || !compareView.slotB) {
      exitCompareMode();
      return;
    }

    const nodeIdA = viewerSlots?.[compareView.slotA];
    const nodeIdB = viewerSlots?.[compareView.slotB];
    if (!nodeIdA || !nodeIdB) {
      exitCompareMode();
    }
  }, [compareView.isActive, compareView.slotA, compareView.slotB, viewerSlots, exitCompareMode]);

  return {
    compareView,
    viewerSlots,
    viewerNodeId,
    viewerSettings,
    nodes,
    exitCompareMode,
    swapCompareSlots,
    setCompareMode,
    setCompareSizingMode,
    setCompareWipeOrientation,
    setCompareWipeReference,
  };
}
