/**
 * useWindowDragAdjustment — Sets up window-level mousemove/mouseup listeners
 * when `isActive` is true, cleaning up on deactivation or unmount.
 *
 * Uses a ref to hold the latest callbacks so the effect only depends on
 * `isActive` — callbacks never cause listener re-registration.
 *
 * @example
 * ```ts
 * useWindowDragAdjustment(isAdjusting, {
 *   onMouseMove: (e) => {
 *     if (startRef.current) {
 *       const dx = e.clientX - startRef.current.startX;
 *       setPreferences({ someValue: startRef.current.initial + dx });
 *     }
 *   },
 *   onMouseUp: () => {
 *     setIsAdjusting(false);
 *     startRef.current = null;
 *   },
 * });
 * ```
 */

import { useEffect, useRef } from 'react';

export interface WindowDragAdjustmentCallbacks {
  onMouseMove: (event: MouseEvent) => void;
  onMouseUp: (event: MouseEvent) => void;
}

export function useWindowDragAdjustment(
  isActive: boolean,
  callbacks: WindowDragAdjustmentCallbacks,
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!isActive) return;

    const handleMouseMove = (e: MouseEvent) => callbacksRef.current.onMouseMove(e);
    const handleMouseUp = (e: MouseEvent) => callbacksRef.current.onMouseUp(e);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isActive]);
}
