import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useWindowDragAdjustment } from '@/hooks/useWindowDragAdjustment';
import type { Pan, SceneNode } from '@blackboard/types';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import {
  advanceAdaptiveAnimationClock,
  createAdaptiveAnimationClock,
  getTimeCorrectedSmoothing,
} from '@/utils/adaptiveAnimation';
import { useViewportLayoutInsets } from './useViewportLayoutInsets';
import {
  calculatePivotedViewportPan,
  calculateViewportFitTarget,
  type ViewportFitMode,
  type ViewportFitTarget,
} from './viewportFit';

const MIN_VIEWPORT_ZOOM = 0.02;
const MAX_VIEWPORT_ZOOM = 16;
const WHEEL_ZOOM_FACTOR = 1.1;
const VIEWPORT_ANIMATION_SMOOTHING = 0.2;
const VIEWPORT_ZOOM_EPSILON = 0.001;
const VIEWPORT_PAN_EPSILON = 0.25;

const isViewportTransformSettled = (
  zoom: number,
  pan: Pan,
  targetZoom: number,
  targetPan: Pan,
): boolean =>
  Math.abs(targetZoom - zoom) < VIEWPORT_ZOOM_EPSILON &&
  Math.abs(targetPan.x - pan.x) < VIEWPORT_PAN_EPSILON &&
  Math.abs(targetPan.y - pan.y) < VIEWPORT_PAN_EPSILON;

interface UseViewportGesturesParams {
  sceneNode: SceneNode | undefined;
  enableGestures?: boolean;
  zoom: number;
  pan: Pan;
  targetZoom: number;
  targetPan: Pan;
  viewportSize: { width: number; height: number };
  viewportRef: React.RefObject<HTMLDivElement | null>;
  projectId: string;
  setViewportTransform: (
    transform: { zoom: number; pan: Pan },
    options?: { syncAnimationTarget?: boolean },
  ) => void;
  setAnimationTarget: (target: { zoom?: number; pan?: Pan }) => void;
  gestureTransform?: ViewportGestureTransform | null;
  fitMode?: ViewportFitMode;
  fitPaddingScale?: number;
  fitTargetOverride?: ViewportFitTarget | null;
}

export interface ViewportGestureFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportGestureTransform {
  panBase: Pan;
  fitFrame: ViewportGestureFrame;
  getFrameForPoint: (point: { x: number; y: number }) => ViewportGestureFrame;
}

interface UseViewportGesturesResult {
  /** If the user is currently panning via middle-mouse-button. */
  isMousePanning: boolean;
  /** Computed panel width from CSS variable. */
  panelWidth: number;
  /** Current zoom level that would fit the scene in view. */
  fitZoom: number;
  /** Whether the viewport is currently fitted. */
  isFit: boolean;
  /** Fit the scene to the viewport. */
  fitToView: () => void;
  /** Calculate a new pan that keeps a world-space point under the cursor after zooming. */
  calculatePivotedPan: (
    pivotClient: { x: number; y: number },
    oldZoom: number,
    newZoom: number,
    oldPan: Pan,
  ) => Pan;
  /** Begin a middle-mouse-button pan.  Returns true if consumed. */
  startPan: (e: React.MouseEvent<HTMLDivElement>) => boolean;
}

export function useViewportGestures({
  sceneNode,
  enableGestures = true,
  zoom,
  pan,
  targetZoom,
  targetPan,
  viewportSize,
  viewportRef,
  projectId,
  setViewportTransform,
  setAnimationTarget,
  gestureTransform = null,
  fitMode = 'fit',
  fitPaddingScale,
  fitTargetOverride = null,
}: UseViewportGesturesParams): UseViewportGesturesResult {
  // --- Middle mouse panning ---
  const [isMousePanning, setIsMousePanning] = useState(false);
  const panStartRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  // --- Zoom/pan animation ---
  const animationFrameRef = useRef<number | null>(null);
  const animationTickRef = useRef<(timestamp: number) => void>(() => undefined);
  const animationClockRef = useRef(createAdaptiveAnimationClock());
  const sceneNodeRef = useRef(sceneNode);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const targetZoomRef = useRef(targetZoom);
  const targetPanRef = useRef(targetPan);
  const previousFitTargetRef = useRef<{ zoom: number; pan: Pan } | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    sceneNodeRef.current = sceneNode;
    zoomRef.current = zoom;
    panRef.current = pan;
    targetZoomRef.current = targetZoom;
    targetPanRef.current = targetPan;
  }, [sceneNode, zoom, pan, targetZoom, targetPan]);

  const commitViewportTransform = useCallback(
    (
      nextZoom: number,
      nextPan: Pan,
      options?: {
        syncAnimationTarget?: boolean;
      },
    ) => {
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      if (options?.syncAnimationTarget) {
        targetZoomRef.current = nextZoom;
        targetPanRef.current = nextPan;
      }
      setViewportTransform(
        { zoom: nextZoom, pan: nextPan },
        { syncAnimationTarget: options?.syncAnimationTarget },
      );
    },
    [setViewportTransform],
  );

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

  useLayoutEffect(() => {
    animationTickRef.current = (timestamp) => {
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const currentTargetZoom = targetZoomRef.current;
      const currentTargetPan = targetPanRef.current;
      const zoomDiff = currentTargetZoom - currentZoom;
      const panXDiff = currentTargetPan.x - currentPan.x;
      const panYDiff = currentTargetPan.y - currentPan.y;

      if (
        isViewportTransformSettled(currentZoom, currentPan, currentTargetZoom, currentTargetPan)
      ) {
        if (
          currentZoom !== currentTargetZoom ||
          currentPan.x !== currentTargetPan.x ||
          currentPan.y !== currentTargetPan.y
        ) {
          commitViewportTransform(currentTargetZoom, currentTargetPan);
        }
        animationClockRef.current = createAdaptiveAnimationClock();
        return;
      }

      const frame = advanceAdaptiveAnimationClock(animationClockRef.current, timestamp);
      animationClockRef.current = frame.clock;
      if (!frame.shouldUpdate) {
        scheduleAnimation();
        return;
      }

      const smoothing = getTimeCorrectedSmoothing(VIEWPORT_ANIMATION_SMOOTHING, frame.elapsedMs);
      const nextZoom = currentZoom + zoomDiff * smoothing;
      const nextPan = {
        x: currentPan.x + panXDiff * smoothing,
        y: currentPan.y + panYDiff * smoothing,
      };
      if (isViewportTransformSettled(nextZoom, nextPan, currentTargetZoom, currentTargetPan)) {
        commitViewportTransform(currentTargetZoom, currentTargetPan);
        animationClockRef.current = createAdaptiveAnimationClock();
        return;
      }

      commitViewportTransform(nextZoom, nextPan);
      scheduleAnimation();
    };
  }, [commitViewportTransform, scheduleAnimation]);

  useEffect(() => {
    const isAnimating = zoom !== targetZoom || pan.x !== targetPan.x || pan.y !== targetPan.y;
    if (isAnimating && prefersReducedMotion) {
      stopAnimation();
      commitViewportTransform(targetZoom, targetPan);
      return;
    }

    if (isAnimating) scheduleAnimation();
  }, [
    zoom,
    pan,
    targetZoom,
    targetPan,
    prefersReducedMotion,
    commitViewportTransform,
    scheduleAnimation,
    stopAnimation,
  ]);

  useEffect(() => stopAnimation, [stopAnimation]);

  // --- Pivoted pan calculation ---
  const calculatePivotedPan = useCallback(
    (pivotClient: { x: number; y: number }, oldZoom: number, newZoom: number, oldPan: Pan): Pan => {
      if (!viewportRef.current || !sceneNode) return oldPan;
      const rect = viewportRef.current.getBoundingClientRect();
      const pivot = { x: pivotClient.x - rect.left, y: pivotClient.y - rect.top };

      if (gestureTransform) {
        const frame = gestureTransform.getFrameForPoint(pivot);
        if (frame.width > 0 && frame.height > 0) {
          const oldLocalPan = {
            x: oldPan.x - gestureTransform.panBase.x,
            y: oldPan.y - gestureTransform.panBase.y,
          };
          const nextLocalPan = calculatePivotedViewportPan({
            viewportSize: { width: frame.width, height: frame.height },
            pivot: { x: pivot.x - frame.x, y: pivot.y - frame.y },
            oldZoom,
            newZoom,
            oldPan: oldLocalPan,
          });

          return {
            x: nextLocalPan.x + gestureTransform.panBase.x,
            y: nextLocalPan.y + gestureTransform.panBase.y,
          };
        }
      }

      return calculatePivotedViewportPan({
        viewportSize: { width: rect.width, height: rect.height },
        pivot,
        oldZoom,
        newZoom,
        oldPan,
      });
    },
    [gestureTransform, sceneNode, viewportRef],
  );

  // --- Fit to view ---
  const viewportInsets = useViewportLayoutInsets(viewportRef);
  const panelWidth = viewportInsets.left;

  const fitTarget = useMemo(() => {
    if (fitTargetOverride) return fitTargetOverride;

    if (gestureTransform) {
      const target = calculateViewportFitTarget({
        viewportSize: {
          width: gestureTransform.fitFrame.width,
          height: gestureTransform.fitFrame.height,
        },
        sceneSize: sceneNode
          ? { width: sceneNode.width, height: sceneNode.height }
          : { width: 0, height: 0 },
        mode: fitMode,
        paddingScale: fitPaddingScale,
      });

      return {
        zoom: target.zoom,
        pan: {
          x: target.pan.x + gestureTransform.panBase.x,
          y: target.pan.y + gestureTransform.panBase.y,
        },
      };
    }

    return calculateViewportFitTarget({
      viewportSize,
      sceneSize: sceneNode
        ? { width: sceneNode.width, height: sceneNode.height }
        : { width: 0, height: 0 },
      insets: viewportInsets,
      mode: fitMode,
      paddingScale: fitPaddingScale,
    });
  }, [
    fitMode,
    fitPaddingScale,
    fitTargetOverride,
    gestureTransform,
    sceneNode,
    viewportInsets,
    viewportSize,
  ]);
  const fitZoom = fitTarget.zoom;

  const isFit = useMemo(() => {
    return (
      Math.abs(targetZoom - fitZoom) < 0.001 &&
      Math.abs(targetPan.x - fitTarget.pan.x) < 0.01 &&
      Math.abs(targetPan.y - fitTarget.pan.y) < 0.01
    );
  }, [targetZoom, targetPan, fitZoom, fitTarget.pan]);

  const fitToView = useCallback(() => {
    if (!sceneNode || !viewportSize.width) return;
    setAnimationTarget({ zoom: fitZoom, pan: fitTarget.pan });
  }, [sceneNode, viewportSize, setAnimationTarget, fitZoom, fitTarget.pan]);

  // Auto-fit on initial project load
  const hasInitializedView = useRef(false);
  useEffect(() => {
    hasInitializedView.current = false;
  }, [projectId]);
  useEffect(() => {
    if (sceneNode && viewportSize.width && !hasInitializedView.current) {
      fitToView();
      hasInitializedView.current = true;
    }
  }, [sceneNode, viewportSize, fitToView]);

  useEffect(() => {
    const previousFitTarget = previousFitTargetRef.current;
    previousFitTargetRef.current = fitTarget;

    if (!previousFitTarget || !sceneNode || !viewportSize.width || !hasInitializedView.current) {
      return;
    }

    const fitTargetChanged =
      Math.abs(fitZoom - previousFitTarget.zoom) >= 0.001 ||
      Math.abs(fitTarget.pan.x - previousFitTarget.pan.x) >= 0.01 ||
      Math.abs(fitTarget.pan.y - previousFitTarget.pan.y) >= 0.01;
    const wasFit =
      Math.abs(targetZoom - previousFitTarget.zoom) < 0.001 &&
      Math.abs(targetPan.x - previousFitTarget.pan.x) < 0.01 &&
      Math.abs(targetPan.y - previousFitTarget.pan.y) < 0.01;

    if (fitTargetChanged && wasFit) {
      setAnimationTarget({ zoom: fitZoom, pan: fitTarget.pan });
    }
  }, [fitTarget, fitZoom, sceneNode, setAnimationTarget, targetPan, targetZoom, viewportSize]);

  // --- Touch (pinch-to-zoom) ---
  const gestureStateRef = useRef<{
    type: 'pan' | 'pinch';
    startPan: Pan;
    startZoom: number;
    initialMidpoint: { x: number; y: number };
    initialDist: number;
  } | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      if (!enableGestures) return;
      e.preventDefault();

      if (!sceneNodeRef.current) return;

      const currentTargetZoom = targetZoomRef.current;
      const currentTargetPan = targetPanRef.current;
      const nextTargetZoom =
        e.deltaY < 0
          ? currentTargetZoom * WHEEL_ZOOM_FACTOR
          : currentTargetZoom / WHEEL_ZOOM_FACTOR;
      const clampedZoom = Math.max(MIN_VIEWPORT_ZOOM, Math.min(MAX_VIEWPORT_ZOOM, nextTargetZoom));
      const nextTargetPan = calculatePivotedPan(
        { x: e.clientX, y: e.clientY },
        currentTargetZoom,
        clampedZoom,
        currentTargetPan,
      );

      targetZoomRef.current = clampedZoom;
      targetPanRef.current = nextTargetPan;
      setAnimationTarget({ zoom: clampedZoom, pan: nextTargetPan });
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!enableGestures) return;
      if (!sceneNodeRef.current || e.touches.length !== 2) return;

      e.preventDefault();

      stopAnimation();

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const currentTargetZoom = targetZoomRef.current;
      const currentTargetPan = targetPanRef.current;

      if (
        currentZoom !== currentTargetZoom ||
        currentPan.x !== currentTargetPan.x ||
        currentPan.y !== currentTargetPan.y
      ) {
        commitViewportTransform(currentTargetZoom, currentTargetPan);
      }

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      gestureStateRef.current = {
        type: 'pinch',
        startPan: currentTargetPan,
        startZoom: currentTargetZoom,
        initialMidpoint: {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        },
        initialDist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!enableGestures) return;
      const gesture = gestureStateRef.current;
      if (!gesture || !sceneNodeRef.current) return;

      e.preventDefault();

      if (gesture.type === 'pinch' && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const midpoint = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };

        if (gesture.initialDist === 0) return;

        const zoomRatio = dist / gesture.initialDist;
        const nextZoom = gesture.startZoom * zoomRatio;
        const clampedZoom = Math.max(MIN_VIEWPORT_ZOOM, Math.min(MAX_VIEWPORT_ZOOM, nextZoom));
        const panFromZoom = calculatePivotedPan(
          gesture.initialMidpoint,
          gesture.startZoom,
          clampedZoom,
          gesture.startPan,
        );
        const panDelta = {
          x: midpoint.x - gesture.initialMidpoint.x,
          y: midpoint.y - gesture.initialMidpoint.y,
        };
        const nextPan = { x: panFromZoom.x + panDelta.x, y: panFromZoom.y - panDelta.y };

        commitViewportTransform(clampedZoom, nextPan, { syncAnimationTarget: true });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (gestureStateRef.current && e.cancelable) e.preventDefault();
      gestureStateRef.current = null;
    };

    const handleTouchCancel = () => {
      gestureStateRef.current = null;
    };

    // Native listeners let us opt out of passive wheel/touch handling so preventDefault works.
    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: false });
    element.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [
    viewportRef,
    calculatePivotedPan,
    commitViewportTransform,
    enableGestures,
    setAnimationTarget,
    stopAnimation,
  ]);

  // --- Middle-mouse panning ---
  const startPan = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): boolean => {
      if (!enableGestures) return false;
      if (e.button !== 1 || !sceneNode) return false;
      e.preventDefault();

      // Ctrl+middle-mouse is handled by scrubbing, not panning
      if (e.ctrlKey) return false;

      stopAnimation();
      if (zoom !== targetZoom || pan.x !== targetPan.x || pan.y !== targetPan.y) {
        commitViewportTransform(targetZoom, targetPan);
      }
      setIsMousePanning(true);
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: targetPan.x,
        panY: targetPan.y,
      };
      return true;
    },
    [
      commitViewportTransform,
      enableGestures,
      pan,
      sceneNode,
      stopAnimation,
      targetPan,
      targetZoom,
      zoom,
    ],
  );

  useWindowDragAdjustment(isMousePanning, {
    onMouseMove: (e: MouseEvent) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.startX,
        dy = e.clientY - panStartRef.current.startY;
      const newPan = { x: panStartRef.current.panX + dx, y: panStartRef.current.panY - dy };
      commitViewportTransform(zoomRef.current, newPan, { syncAnimationTarget: true });
    },
    onMouseUp: () => {
      setIsMousePanning(false);
      panStartRef.current = null;
    },
  });

  return {
    isMousePanning,
    panelWidth,
    fitZoom,
    isFit,
    fitToView,
    calculatePivotedPan,
    startPan,
  };
}
