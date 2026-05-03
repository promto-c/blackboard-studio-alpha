import React, { useRef, useEffect } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import * as Icons from '@blackboard/icons';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;

interface ViewportControlsProps {
  visible: boolean;
  onFit: () => void;
  zoomValue: number;
}

const ViewportControls: React.FC<ViewportControlsProps> = ({ visible, onFit, zoomValue }) => {
  const targetZoom = useEditorSelector((s) => s.targetZoom);
  const { setAnimationTarget } = useEditorActions();
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = glowRef.current;
    if (!element) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      element.style.setProperty('--glow-x', `${x}px`);
      element.style.setProperty('--glow-y', `${y}px`);
    };

    const handleMouseEnter = () => {
      element.style.setProperty('--glow-opacity', '1');
      element.style.setProperty('--glow-scale', '1');
    };

    const handleMouseLeave = () => {
      element.style.setProperty('--glow-opacity', '0');
      element.style.setProperty('--glow-scale', '0');
    };

    element.addEventListener('mousemove', handleMouseMove);
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      element.removeEventListener('mousemove', handleMouseMove);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  const handleZoomIn = () => {
    const newZoom = Math.min(MAX_ZOOM, targetZoom * 1.2);
    setAnimationTarget({ zoom: newZoom });
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(MIN_ZOOM, targetZoom / 1.2);
    setAnimationTarget({ zoom: newZoom });
  };

  return (
    <div
      ref={glowRef}
      className={`interactive-glow glass-component absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-full shadow-xl ring-1 ring-inset ring-white/20 px-3 py-1.5 transition-all duration-300 ease-in-out ${visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
    >
      <button
        onClick={handleZoomOut}
        className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Zoom out"
        title="Zoom Out (-)"
        disabled={targetZoom <= MIN_ZOOM}
      >
        <Icons.Minus className="h-4 w-4" />
      </button>

      <div className="text-xs font-mono w-12 text-center text-white select-none">
        {Math.round(zoomValue * 100)}%
      </div>

      <button
        onClick={handleZoomIn}
        className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Zoom in"
        title="Zoom In (+)"
        disabled={targetZoom >= MAX_ZOOM}
      >
        <Icons.Plus className="h-4 w-4" />
      </button>

      <div className="w-px h-5 bg-gray-700 mx-1" />

      <button
        onClick={onFit}
        className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        aria-label="Fit to screen"
        title="Fit to Screen (F)"
      >
        <Icons.ArrowsPointingOut className="h-4 w-4" />
      </button>
    </div>
  );
};

export default ViewportControls;
