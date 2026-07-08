import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useKeyPressed } from '@/hotkeys';
import { useSmoothAnimation } from '@/hooks/useSmoothAnimation';

interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

interface FitInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.0;
const ZOOM_SPEED = 0.0015;

export function useCanvasViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportState>({ panX: 0, panY: 0, zoom: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isSpacePressed = useKeyPressed('Space');

  const { targetRef, scheduleAnimation, stopAnimation, snapTo } = useSmoothAnimation(
    viewport,
    (v: ViewportState) => setViewport(v),
    { epsilons: { zoom: 0.001, panX: 0.25, panY: 0.25 } },
  );

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
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentTarget.zoom * (1 + zoomDelta)));
      const scale = newZoom / currentTarget.zoom;

      targetRef.current = {
        panX: cx - (cx - currentTarget.panX) * scale,
        panY: cy - (cy - currentTarget.panY) * scale,
        zoom: newZoom,
      };

      scheduleAnimation();
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [scheduleAnimation]);

  // --- Panning (middle mouse / Space+left click) ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle mouse or Space+Left click starts panning
      if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
        e.preventDefault();

        // Snap to animation target immediately to avoid rubber-banding
        const target = targetRef.current;
        stopAnimation();
        snapTo(target);

        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: target.panX,
          panY: target.panY,
        };
      }
    },
    [isSpacePressed, stopAnimation, snapTo],
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

    const handleMouseUp = () => {
      isPanningRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const getTransformStyle = useCallback(
    (): React.CSSProperties => ({
      transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0',
    }),
    [viewport],
  );

  /** Immediately snap viewport to fit given bounds within the container. */
  const fitAll = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }, insets?: FitInsets) => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const insetTop = Math.max(0, insets?.top ?? 0);
      const insetRight = Math.max(0, insets?.right ?? 0);
      const insetBottom = Math.max(0, insets?.bottom ?? 0);
      const insetLeft = Math.max(0, insets?.left ?? 0);
      const availableWidth = Math.max(1, containerWidth - insetLeft - insetRight);
      const availableHeight = Math.max(1, containerHeight - insetTop - insetBottom);
      const graphWidth = bounds.maxX - bounds.minX + 240; // padding
      const graphHeight = bounds.maxY - bounds.minY + 200;

      if (graphWidth <= 0 || graphHeight <= 0) return;

      const zoom = Math.min(
        Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, availableWidth / graphWidth, availableHeight / graphHeight),
        ),
        1.0, // don't zoom in past 1x on fit
      );

      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;

      // Snap immediately so the viewport is correct on the next render
      snapTo({
        zoom,
        panX: insetLeft + availableWidth / 2 - centerX * zoom,
        panY: insetTop + availableHeight / 2 - centerY * zoom,
      });
    },
    [snapTo],
  );

  const getCursorStyle = useCallback((): string => {
    if (isPanningRef.current) return 'grabbing';
    if (isSpacePressed) return 'grab';
    return 'default';
  }, [isSpacePressed]);

  return {
    viewport,
    containerRef,
    getTransformStyle,
    fitAll,
    handleMouseDown,
    getCursorStyle,
    isPanning: isPanningRef,
  };
}
