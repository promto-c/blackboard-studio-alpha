import { useEffect, useRef } from 'react';
import * as Icons from '@blackboard/icons';
import { IconButton } from '@blackboard/ui';

interface CanvasViewportControlsProps {
  zoom: number;
  targetZoom?: number;
  minZoom: number;
  maxZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  fitTooltip?: string;
  visible?: boolean;
}

export function CanvasViewportControls({
  zoom,
  targetZoom = zoom,
  minZoom,
  maxZoom,
  onZoomIn,
  onZoomOut,
  onFit,
  fitTooltip = 'Fit to view',
  visible = true,
}: CanvasViewportControlsProps) {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = glowRef.current;
    if (!element) return;

    const handleMouseMove = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      element.style.setProperty('--glow-x', `${event.clientX - rect.left}px`);
      element.style.setProperty('--glow-y', `${event.clientY - rect.top}px`);
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

  return (
    <div
      ref={glowRef}
      className={`interactive-glow glass-component absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-gray-900/60 px-1.5 py-1 shadow-xl ring-1 ring-inset ring-white/20 backdrop-blur-xl transition-all duration-300 ease-in-out ${
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-3 opacity-0'
      }`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <IconButton
        icon={Icons.Minus}
        tooltip="Zoom out"
        className="!h-7 !w-7 !text-gray-300 hover:!text-white"
        disabled={targetZoom <= minZoom}
        onClick={onZoomOut}
      />
      <span
        className="w-12 select-none text-center font-mono text-[11px] tabular-nums text-gray-200"
        aria-live="polite"
      >
        {Math.round(zoom * 100)}%
      </span>
      <IconButton
        icon={Icons.Plus}
        tooltip="Zoom in"
        className="!h-7 !w-7 !text-gray-300 hover:!text-white"
        disabled={targetZoom >= maxZoom}
        onClick={onZoomIn}
      />
      <span className="mx-0.5 h-4 w-px bg-white/10" />
      <IconButton
        icon={Icons.ArrowsPointingOut}
        tooltip={fitTooltip}
        className="!h-7 !w-7 !text-gray-300 hover:!text-white"
        onClick={onFit}
      />
    </div>
  );
}
