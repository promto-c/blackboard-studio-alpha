import { useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import {
  advanceAdaptiveAnimationClock,
  createAdaptiveAnimationClock,
  getTimeCorrectedSmoothing,
} from '@/utils/adaptiveAnimation';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

const DEFAULT_PAN_EPSILON = 0.25;
const DEFAULT_ZOOM_EPSILON = 0.001;
const DEFAULT_SMOOTHING = 0.2;

/**
 * Drives a target-based smooth animation loop for numeric values (zoom, pan, etc.).
 *
 * Callers set `targetRef.current` to the desired destination and call
 * `scheduleAnimation()`. The hook interpolates toward the target on each
 * animation frame and calls the provided `commit` function to update React state.
 *
 * @param current  The current React state value.
 * @param commit   Callback invoked each frame with the interpolated value.
 * @param options.smoothing  Smoothing factor per 60 Hz frame (default 0.2).
 * @param options.epsilons   Per-field settle thresholds (default zoom=0.001, pan=0.25).
 */
export function useSmoothAnimation<T extends Record<keyof T, number>>(
  current: T,
  commit: (value: T) => void,
  options?: {
    smoothing?: number;
    epsilons?: Partial<Record<keyof T, number>>;
  },
) {
  const smoothing = options?.smoothing ?? DEFAULT_SMOOTHING;

  // Stable ref for field keys so layout-effect deps don't churn
  const fieldsRef = useRef(Object.keys(current) as (keyof T)[]);
  const epsilonsRef = useRef<Partial<Record<keyof T, number>>>(options?.epsilons ?? {});

  const currentRef = useRef(current);
  const targetRef = useRef(current);
  const animationFrameRef = useRef<number | null>(null);
  const animationClockRef = useRef(createAdaptiveAnimationClock());
  const prefersReducedMotion = usePrefersReducedMotion();

  // Sync currentRef with React state
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // --- Helpers ---

  const getFieldEpsilon = useCallback((key: keyof T): number => {
    const explicit = epsilonsRef.current[key];
    if (explicit !== undefined) return explicit;
    return String(key).startsWith('pan') ? DEFAULT_PAN_EPSILON : DEFAULT_ZOOM_EPSILON;
  }, []);

  /** Check whether all fields are within epsilon of the target. */
  const isSettled = useCallback(() => {
    const cur = currentRef.current;
    const tgt = targetRef.current;
    for (const key of fieldsRef.current) {
      if (Math.abs(tgt[key] - cur[key]) >= getFieldEpsilon(key)) return false;
    }
    return true;
  }, [getFieldEpsilon]);

  /** Write a value to both the ref and React state. */
  const commitValue = useCallback(
    (value: T) => {
      currentRef.current = value;
      commit(value);
    },
    [commit],
  );

  // --- Animation loop ---

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    animationClockRef.current = createAdaptiveAnimationClock();
  }, []);

  const scheduleAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame((timestamp) => {
      animationFrameRef.current = null;
      animationTickRef.current(timestamp);
    });
  }, []);

  /** Snap both current and target to a value (used by pan handlers). */
  const snapTo = useCallback(
    (value: T) => {
      currentRef.current = value;
      targetRef.current = value;
      commit(value);
    },
    [commit],
  );

  // --- Animation tick ---

  const animationTickRef = useRef<(timestamp: number) => void>(() => undefined);

  useLayoutEffect(() => {
    animationTickRef.current = (timestamp) => {
      const cur = currentRef.current;
      const tgt = targetRef.current;

      if (isSettled()) {
        // If not exact-matched yet, flush the final target value
        let needsCommit = false;
        for (const key of fieldsRef.current) {
          if (cur[key] !== tgt[key]) {
            needsCommit = true;
            break;
          }
        }
        if (needsCommit) commitValue(tgt);
        animationClockRef.current = createAdaptiveAnimationClock();
        return;
      }

      const frame = advanceAdaptiveAnimationClock(animationClockRef.current, timestamp);
      animationClockRef.current = frame.clock;
      if (!frame.shouldUpdate) {
        scheduleAnimation();
        return;
      }

      const perFrame = getTimeCorrectedSmoothing(smoothing, frame.elapsedMs);
      const next = { ...cur } as T;
      for (const key of fieldsRef.current) {
        next[key] = (cur[key] + (tgt[key] - cur[key]) * perFrame) as T[keyof T];
      }

      commitValue(next);
      scheduleAnimation();
    };
  }, [commitValue, scheduleAnimation, isSettled, smoothing]);

  useEffect(() => stopAnimation, [stopAnimation]);

  // --- prefers-reduced-motion ---

  useEffect(() => {
    if (!prefersReducedMotion) return;
    const cur = currentRef.current;
    const tgt = targetRef.current;
    let needsSnap = false;
    for (const key of fieldsRef.current) {
      if (cur[key] !== tgt[key]) {
        needsSnap = true;
        break;
      }
    }
    if (needsSnap) {
      stopAnimation();
      snapTo(tgt);
    }
  }, [prefersReducedMotion, stopAnimation, snapTo]);

  return {
    /** Mutable ref — set this to the desired destination and call `scheduleAnimation()`. */
    targetRef,
    /** Start (or continue) the animation loop toward `targetRef.current`. */
    scheduleAnimation,
    /** Immediately stop any running animation. */
    stopAnimation,
    /** Commit a value to both current and target, stopping animation. */
    snapTo,
  };
}
