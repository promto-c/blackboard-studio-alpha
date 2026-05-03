import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import type { Pan, SceneNode } from '@blackboard/types';

interface UseViewportGesturesParams {
  sceneNode: SceneNode | undefined;
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

    if (Math.abs(zoomDiff) < 0.001 && Math.abs(panXDiff) < 0.01 && Math.abs(panYDiff) < 0.01) {
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

    const smoothing = 0.2;
    const nextZoom = zoom + zoomDiff * smoothing;
    const nextPan = {
      x: pan.x + panXDiff * smoothing,
      y: pan.y + panYDiff * smoothing,
    };

    setZoom(nextZoom);
    setPan(nextPan);

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [pan, setPan, setZoom, targetPan, targetZoom, zoom]);

  useEffect(() => {
    const isAnimating = zoom !== targetZoom || pan.x !== targetPan.x || pan.y !== targetPan.y;
    if (isAnimating && !animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [zoom, pan, targetZoom, targetPan, animate]);

  // --- Pivoted pan calculation ---
  const calculatePivotedPan = useCallback(
    (pivotClient: { x: number; y: number }, oldZoom: number, newZoom: number, oldPan: Pan): Pan => {
      if (!viewportRef.current || !sceneNode) return oldPan;
      const rect = viewportRef.current.getBoundingClientRect();

      const pivotX = pivotClient.x - rect.left,
        pivotY = pivotClient.y - rect.top;
      const canvasCenterX = rect.width / 2 + oldPan.x,
        canvasCenterY = rect.height / 2 - oldPan.y;
      const pivotFromCenterX = pivotX - canvasCenterX,
        pivotFromCenterY = pivotY - canvasCenterY;
      const worldX = pivotFromCenterX / oldZoom,
        worldY = pivotFromCenterY / oldZoom;
      const newCanvasCenterX = pivotX - worldX * newZoom,
        newCanvasCenterY = pivotY - worldY * newZoom;
      const newPanX = newCanvasCenterX - rect.width / 2,
        newPanY = -(newCanvasCenterY - rect.height / 2);
      return { x: newPanX, y: newPanY };
    },
    [sceneNode],
  );

  // --- Fit to view ---
  const panelWidth = useMemo(() => {
    if (!viewportRef.current) return 0;
    return parseFloat(getComputedStyle(viewportRef.current).getPropertyValue('--panel-width')) || 0;
  }, [viewportSize]);

  const fitZoom = useMemo(() => {
    if (!sceneNode || !viewportSize.width || !viewportSize.height) return 1;
    const availableWidth = viewportSize.width - panelWidth;
    return Math.min(availableWidth / sceneNode.width, viewportSize.height / sceneNode.height) * 0.9;
  }, [sceneNode, viewportSize, panelWidth]);

  const isFit = useMemo(() => {
    const targetPanX = panelWidth / 2;
    return (
      Math.abs(targetZoom - fitZoom) < 0.001 &&
      Math.abs(targetPan.x - targetPanX) < 0.01 &&
      Math.abs(targetPan.y) < 0.01
    );
  }, [targetZoom, targetPan, fitZoom, panelWidth]);

  const fitToView = useCallback(() => {
    if (!sceneNode || !viewportSize.width) return;
    setAnimationTarget({ zoom: fitZoom, pan: { x: panelWidth / 2, y: 0 } });
  }, [sceneNode, viewportSize, setAnimationTarget, fitZoom, panelWidth]);

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
      e.preventDefault();

      if (!sceneNodeRef.current) return;

      const currentTargetZoom = targetZoomRef.current;
      const currentTargetPan = targetPanRef.current;
      const zoomFactor = 1.1;
      const nextTargetZoom =
        e.deltaY < 0 ? currentTargetZoom * zoomFactor : currentTargetZoom / zoomFactor;
      const clampedZoom = Math.max(0.02, Math.min(16, nextTargetZoom));
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
        const clampedZoom = Math.max(0.02, Math.min(16, nextZoom));
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
  }, [viewportRef, calculatePivotedPan, setAnimationTarget, setPan, setZoom]);

  // --- Middle-mouse panning ---
  const startPan = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): boolean => {
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
    [sceneNode, zoom, targetZoom, pan, targetPan, setZoom, setPan],
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
