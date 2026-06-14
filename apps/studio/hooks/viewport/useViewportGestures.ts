import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import type { Pan, SceneNode } from '@blackboard/types';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useViewportLayoutInsets } from './useViewportLayoutInsets';
import { calculatePivotedViewportPan, calculateViewportFitTarget } from './viewportFit';

const MIN_VIEWPORT_ZOOM = 0.02;
const MAX_VIEWPORT_ZOOM = 16;
const WHEEL_ZOOM_FACTOR = 1.1;
const VIEWPORT_ANIMATION_SMOOTHING = 0.2;
const VIEWPORT_ZOOM_EPSILON = 0.001;
const VIEWPORT_PAN_EPSILON = 0.01;

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
  setZoom: (zoom: number) => void;
  setPan: (pan: Pan) => void;
  setAnimationTarget: (target: { zoom?: number; pan?: Pan }) => void;
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
  setZoom,
  setPan,
  setAnimationTarget,
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

  const animate = useCallback(() => {
    const zoomDiff = targetZoom - zoom;
    const panXDiff = targetPan.x - pan.x;
    const panYDiff = targetPan.y - pan.y;

    if (
      Math.abs(zoomDiff) < VIEWPORT_ZOOM_EPSILON &&
      Math.abs(panXDiff) < VIEWPORT_PAN_EPSILON &&
      Math.abs(panYDiff) < VIEWPORT_PAN_EPSILON
    ) {
      if (animationFrameRef.current) {
        if (zoom !== targetZoom || pan.x !== targetPan.x || pan.y !== targetPan.y) {
          setZoom(targetZoom);
          setPan(targetPan);
        }
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const nextZoom = zoom + zoomDiff * VIEWPORT_ANIMATION_SMOOTHING;
    const nextPan = {
      x: pan.x + panXDiff * VIEWPORT_ANIMATION_SMOOTHING,
      y: pan.y + panYDiff * VIEWPORT_ANIMATION_SMOOTHING,
    };

    setZoom(nextZoom);
    setPan(nextPan);

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [pan, setPan, setZoom, targetPan, targetZoom, zoom]);

  useEffect(() => {
    const isAnimating = zoom !== targetZoom || pan.x !== targetPan.x || pan.y !== targetPan.y;
    if (isAnimating && prefersReducedMotion) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setZoom(targetZoom);
      setPan(targetPan);
      return;
    }

    if (isAnimating && !animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [zoom, pan, targetZoom, targetPan, prefersReducedMotion, animate, setPan, setZoom]);

  // --- Pivoted pan calculation ---
  const calculatePivotedPan = useCallback(
    (pivotClient: { x: number; y: number }, oldZoom: number, newZoom: number, oldPan: Pan): Pan => {
      if (!viewportRef.current || !sceneNode) return oldPan;
      const rect = viewportRef.current.getBoundingClientRect();

      return calculatePivotedViewportPan({
        viewportSize: { width: rect.width, height: rect.height },
        pivot: { x: pivotClient.x - rect.left, y: pivotClient.y - rect.top },
        oldZoom,
        newZoom,
        oldPan,
      });
    },
    [sceneNode, viewportRef],
  );

  // --- Fit to view ---
  const viewportInsets = useViewportLayoutInsets(viewportRef);
  const panelWidth = viewportInsets.left;

  const fitTarget = useMemo(
    () =>
      calculateViewportFitTarget({
        viewportSize,
        sceneSize: sceneNode
          ? { width: sceneNode.width, height: sceneNode.height }
          : { width: 0, height: 0 },
        insets: viewportInsets,
      }),
    [sceneNode, viewportInsets, viewportSize],
  );
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

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const currentTargetZoom = targetZoomRef.current;
      const currentTargetPan = targetPanRef.current;

      if (currentZoom !== currentTargetZoom) {
        zoomRef.current = currentTargetZoom;
        setZoom(currentTargetZoom);
      }
      if (currentPan.x !== currentTargetPan.x || currentPan.y !== currentTargetPan.y) {
        panRef.current = currentTargetPan;
        setPan(currentTargetPan);
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

        zoomRef.current = clampedZoom;
        panRef.current = nextPan;
        targetZoomRef.current = clampedZoom;
        targetPanRef.current = nextPan;
        setZoom(clampedZoom);
        setPan(nextPan);
        setAnimationTarget({ zoom: clampedZoom, pan: nextPan });
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
  }, [viewportRef, calculatePivotedPan, enableGestures, setAnimationTarget, setPan, setZoom]);

  // --- Middle-mouse panning ---
  const startPan = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): boolean => {
      if (!enableGestures) return false;
      if (e.button !== 1 || !sceneNode) return false;
      e.preventDefault();

      // Ctrl+middle-mouse is handled by scrubbing, not panning
      if (e.ctrlKey) return false;

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (zoom !== targetZoom) setZoom(targetZoom);
      if (pan.x !== targetPan.x || pan.y !== targetPan.y) setPan(targetPan);
      setIsMousePanning(true);
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: targetPan.x,
        panY: targetPan.y,
      };
      return true;
    },
    [enableGestures, sceneNode, zoom, targetZoom, pan, targetPan, setZoom, setPan],
  );

  useEffect(() => {
    if (!isMousePanning) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.startX,
        dy = e.clientY - panStartRef.current.startY;
      const newPan = { x: panStartRef.current.panX + dx, y: panStartRef.current.panY - dy };
      setPan(newPan);
      setAnimationTarget({ pan: newPan });
    };
    const handleMouseUp = () => {
      setIsMousePanning(false);
      panStartRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMousePanning, setPan, setAnimationTarget]);

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
