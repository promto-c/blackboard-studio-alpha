interface CanvasGridProps {
  zoom: number;
  panX?: number;
  panY?: number;
}

function CanvasGrid({ zoom, panX = 0, panY = 0 }: CanvasGridProps) {
  const baseSize = 24;
  const size = baseSize * zoom;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `radial-gradient(circle, rgba(75, 85, 99, 0.4) ${Math.max(0.5, zoom * 0.8)}px, transparent ${Math.max(0.5, zoom * 0.8)}px)`,
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${panX}px ${panY}px`,
      }}
    />
  );
}

export default CanvasGrid;
