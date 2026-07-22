import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useKeyPressed } from '@/hotkeys';
import { useSmoothAnimation } from '@/hooks/useSmoothAnimation';

interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

interface StartPanOptions {
  allowPrimaryButton?: boolean;
}

interface FitOptions {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  animate?: boolean;
}

export const CANVAS_MIN_ZOOM = 0.15;
export const CANVAS_MAX_ZOOM = 3.0;
const ZOOM_SPEED = 0.0015;

export const getZoomedCanvasViewport = (
  viewport: ViewportState,
  zoom: number,
  focalPoint: { x: number; y: number },
): ViewportState => {
  const nextZoom = Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom));
  const scale = nextZoom / viewport.zoom;
  return {
    panX: focalPoint.x - (focalPoint.x - viewport.panX) * scale,
    panY: focalPoint.y - (focalPoint.y - viewport.panY) * scale,
    zoom: nextZoom,
  };
};

export function useCanvasViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportState>({ panX: 0, panY: 0, zoom: 1 });
  const isPanningRef = useRef(false);
  const [isPanningActive, setIsPanningActive] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isSpacePressed = useKeyPressed('Space');
  const commitViewport = useCallback((value: ViewportState) => setViewport(value), []);

  const { targetRef, scheduleAnimation, stopAnimation, snapTo } = useSmoothAnimation(
    viewport,
    commitViewport,
    { epsilons: { zoom: 0.001, panX: 0.25, panY: 0.25 } },
  );

  const zoomAtPoint = useCallback(
    (zoom: number, focalPoint: { x: number; y: number }) => {
      targetRef.current = getZoomedCanvasViewport(targetRef.current, zoom, focalPoint);
      scheduleAnimation();
    },
    [scheduleAnimation, targetRef],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const container = containerRef.current;
      if (!container) return;
      zoomAtPoint(targetRef.current.zoom * factor, {
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
      });
    },
    [containerRef, targetRef, zoomAtPoint],
  );
  const zoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);

  // --- Wheel zoom (focal-point zoom toward cursor) with smooth animation ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const currentTarget = targetRef.current;
      const zoomDelta = -e.deltaY * ZOOM_SPEED;
      zoomAtPoint(currentTarget.zoom * (1 + zoomDelta), { x: cx, y: cy });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [targetRef, zoomAtPoint]);

  // --- Panning (middle mouse / Space+left click) ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, options: StartPanOptions = {}) => {
      // Middle mouse, Space+left click, or an explicitly-enabled primary drag starts panning.
      if (
        e.button === 1 ||
        (e.button === 0 && (isSpacePressed || options.allowPrimaryButton === true))
      ) {
        e.preventDefault();

        // Snap to animation target immediately to avoid rubber-banding
        const target = targetRef.current;
        stopAnimation();
        snapTo(target);

        isPanningRef.current = true;
        setIsPanningActive(true);
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: target.panX,
          panY: target.panY,
        };
      }
    },
    [isSpacePressed, snapTo, stopAnimation, targetRef],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      const newPanX = panStartRef.current.panX + dx;
      const newPanY = panStartRef.current.panY + dy;

      targetRef.current = { ...targetRef.current, panX: newPanX, panY: newPanY };
      setViewport((prev) => ({ ...prev, panX: newPanX, panY: newPanY }));
    };

    const stopPanning = () => {
      isPanningRef.current = false;
      setIsPanningActive(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopPanning);
    window.addEventListener('blur', stopPanning);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopPanning);
      window.removeEventListener('blur', stopPanning);
    };
  }, [targetRef]);

  const getTransformStyle = useCallback(
    (): React.CSSProperties => ({
      transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0',
    }),
    [viewport],
  );

  /** Fit the given bounds, optionally animating toward the calculated viewport. */
  const fitAll = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }, options?: FitOptions) => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const insetTop = Math.max(0, options?.top ?? 0);
      const insetRight = Math.max(0, options?.right ?? 0);
      const insetBottom = Math.max(0, options?.bottom ?? 0);
      const insetLeft = Math.max(0, options?.left ?? 0);
      const availableWidth = Math.max(1, containerWidth - insetLeft - insetRight);
      const availableHeight = Math.max(1, containerHeight - insetTop - insetBottom);
      const graphWidth = bounds.maxX - bounds.minX + 240; // padding
      const graphHeight = bounds.maxY - bounds.minY + 200;

      if (graphWidth <= 0 || graphHeight <= 0) return;

      const zoom = Math.min(
        Math.max(
          CANVAS_MIN_ZOOM,
          Math.min(CANVAS_MAX_ZOOM, availableWidth / graphWidth, availableHeight / graphHeight),
        ),
        1.0, // don't zoom in past 1x on fit
      );

      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;

      const fitTarget = {
        zoom,
        panX: insetLeft + availableWidth / 2 - centerX * zoom,
        panY: insetTop + availableHeight / 2 - centerY * zoom,
      };

      if (options?.animate) {
        targetRef.current = fitTarget;
        scheduleAnimation();
        return;
      }

      stopAnimation();
      snapTo(fitTarget);
    },
    [scheduleAnimation, snapTo, stopAnimation, targetRef],
  );

  const getCursorStyle = useCallback((): string => {
    if (isPanningActive) return 'grabbing';
    if (isSpacePressed) return 'grab';
    return 'default';
  }, [isPanningActive, isSpacePressed]);

  return {
    viewport,
    containerRef,
    getTransformStyle,
    fitAll,
    handleMouseDown,
    zoomIn,
    zoomOut,
    getCursorStyle,
    isPanning: isPanningRef,
  };
}
