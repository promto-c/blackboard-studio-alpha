import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';

interface MinimapProps {
  sourceCanvas: HTMLCanvasElement | null;
  viewportSize: { width: number; height: number };
  sceneSize: { width: number; height: number };
  previewRefreshToken: unknown;
}

const MINIMAP_MAX_SIZE = 120; // pixels

const Minimap: React.FC<MinimapProps> = ({
  sourceCanvas,
  viewportSize,
  sceneSize,
  previewRefreshToken,
}) => {
  const zoom = useEditorSelector((s) => s.zoom);
  const pan = useEditorSelector((s) => s.pan);
  const { setPan, setAnimationTarget } = useEditorActions();
  const minimapRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const canRender = sceneSize.width > 0 && sceneSize.height > 0 && viewportSize.width > 0;
  const imageAspect = canRender ? sceneSize.width / sceneSize.height : 1;

  const minimapSize = {
    width: imageAspect > 1 ? MINIMAP_MAX_SIZE : MINIMAP_MAX_SIZE * imageAspect,
    height: imageAspect > 1 ? MINIMAP_MAX_SIZE / imageAspect : MINIMAP_MAX_SIZE,
  };

  const currentRenderedSize = {
    width: sceneSize.width * zoom,
    height: sceneSize.height * zoom,
  };

  const viewTopLeft = {
    x: -pan.x + (currentRenderedSize.width - viewportSize.width) / 2,
    y: pan.y + (currentRenderedSize.height - viewportSize.height) / 2,
  };

  const sceneRect = {
    x: 0,
    y: 0,
    width: currentRenderedSize.width,
    height: currentRenderedSize.height,
  };
  const viewportRect = {
    x: viewTopLeft.x,
    y: viewTopLeft.y,
    width: viewportSize.width,
    height: viewportSize.height,
  };

  const intersection = {
    x: Math.max(sceneRect.x, viewportRect.x),
    y: Math.max(sceneRect.y, viewportRect.y),
    right: Math.min(sceneRect.x + sceneRect.width, viewportRect.x + viewportRect.width),
    bottom: Math.min(sceneRect.y + sceneRect.height, viewportRect.y + viewportRect.height),
    width: 0,
    height: 0,
  };
  intersection.width = Math.max(0, intersection.right - intersection.x);
  intersection.height = Math.max(0, intersection.bottom - intersection.y);

  const hasOverlap = intersection.width > 0 && intersection.height > 0;

  const minimapViewRect = {
    x:
      currentRenderedSize.width > 0
        ? (intersection.x / currentRenderedSize.width) * minimapSize.width
        : 0,
    y:
      currentRenderedSize.height > 0
        ? (intersection.y / currentRenderedSize.height) * minimapSize.height
        : 0,
    width:
      currentRenderedSize.width > 0
        ? (intersection.width / currentRenderedSize.width) * minimapSize.width
        : 0,
    height:
      currentRenderedSize.height > 0
        ? (intersection.height / currentRenderedSize.height) * minimapSize.height
        : 0,
  };

  const updatePanImmediately = useCallback(
    (newPan: { x: number; y: number }) => {
      setPan(newPan);
      setAnimationTarget({ pan: newPan });
    },
    [setPan, setAnimationTarget],
  );

  useEffect(() => {
    if (!canRender || !sourceCanvas || !previewCanvasRef.current) return;

    let cancelled = false;
    const drawFrame = () => {
      if (cancelled || !previewCanvasRef.current) return;

      const canvas = previewCanvasRef.current;
      const width = Math.max(1, Math.round(minimapSize.width));
      const height = Math.max(1, Math.round(minimapSize.height));

      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
    };

    const frameId = window.requestAnimationFrame(drawFrame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [canRender, sourceCanvas, minimapSize.width, minimapSize.height, previewRefreshToken]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const mouseDeltaX = e.clientX - dragStartRef.current.startMouseX;
      const mouseDeltaY = e.clientY - dragStartRef.current.startMouseY;

      const panRatioX = currentRenderedSize.width / minimapSize.width;
      const panRatioY = currentRenderedSize.height / minimapSize.height;

      const panDeltaX = mouseDeltaX * panRatioX;
      const panDeltaY = mouseDeltaY * panRatioY;

      const newPan = {
        x: dragStartRef.current.startPanX - panDeltaX,
        y: dragStartRef.current.startPanY + panDeltaY,
      };

      updatePanImmediately(newPan);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isDragging,
    currentRenderedSize.width,
    currentRenderedSize.height,
    minimapSize.width,
    minimapSize.height,
    updatePanImmediately,
  ]);

  if (!canRender) {
    return null;
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !minimapRef.current) return;
    e.preventDefault();

    const rect = minimapRef.current.getBoundingClientRect();
    const localX = e.clientX - rect.left - 1;
    const localY = e.clientY - rect.top - 1;

    const isInsideRect =
      hasOverlap &&
      localX >= minimapViewRect.x &&
      localX <= minimapViewRect.x + minimapViewRect.width &&
      localY >= minimapViewRect.y &&
      localY <= minimapViewRect.y + minimapViewRect.height;

    if (isInsideRect) {
      setIsDragging(true);
      dragStartRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      return;
    }

    const newPan = {
      x: currentRenderedSize.width * (0.5 - localX / minimapSize.width),
      y: currentRenderedSize.height * (localY / minimapSize.height - 0.5),
    };

    updatePanImmediately(newPan);
  };

  return (
    <div
      ref={minimapRef}
      className={`absolute glass-component bottom-4 right-4 z-30 bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl ring-1 ring-inset ring-white/20 p-1 animate-[fadeIn_150ms_ease-out] pointer-events-auto ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
      style={{ width: minimapSize.width + 2, height: minimapSize.height + 2 }}
      onMouseDown={handleMouseDown}
      aria-hidden="true"
    >
      <div className="relative w-full h-full overflow-hidden rounded-sm pointer-events-none">
        <canvas
          ref={previewCanvasRef}
          className="w-full h-full object-contain"
          width={Math.max(1, Math.round(minimapSize.width))}
          height={Math.max(1, Math.round(minimapSize.height))}
        />
        {hasOverlap && (
          <div
            className={`absolute pointer-events-none transition-colors ${isDragging ? 'border-2 border-primary-400 bg-primary-500/30' : 'border-2 border-white/80 bg-white/20'}`}
            style={{
              width: `${minimapViewRect.width}px`,
              height: `${minimapViewRect.height}px`,
              transform: `translate(${minimapViewRect.x}px, ${minimapViewRect.y}px)`,
              top: 0,
              left: 0,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Minimap;
