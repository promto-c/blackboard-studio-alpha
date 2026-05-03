import React from 'react';

interface CanvasGridProps {
  zoom: number;
}

/**
 * Dot grid background for the infinite canvas.
 * Grid spacing scales with zoom to maintain a consistent visual density.
 */
const CanvasGrid: React.FC<CanvasGridProps> = ({ zoom }) => {
  const baseSize = 24;
  const size = baseSize * zoom;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `radial-gradient(circle, rgba(75, 85, 99, 0.4) ${Math.max(0.5, zoom * 0.8)}px, transparent ${Math.max(0.5, zoom * 0.8)}px)`,
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: '0 0',
      }}
    />
  );
};

export default CanvasGrid;
