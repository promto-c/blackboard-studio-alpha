import React from 'react';
import type { ViewportBackgroundMode } from '@/state/preferences';

interface ViewportBackgroundProps {
  mode: ViewportBackgroundMode;
  color: [number, number, number];
  className?: string;
}

const toRgb = ([red, green, blue]: [number, number, number]): string =>
  `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;

export function getViewportBackgroundStyle(
  mode: ViewportBackgroundMode,
  color: [number, number, number],
): React.CSSProperties | undefined {
  switch (mode) {
    case 'checkerboard':
      return {
        backgroundColor: '#242424',
        backgroundImage:
          'linear-gradient(45deg, #3d3d3d 25%, transparent 25%), linear-gradient(-45deg, #3d3d3d 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3d3d3d 75%), linear-gradient(-45deg, transparent 75%, #3d3d3d 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
      };
    case 'grid':
      return {
        backgroundColor: '#141414',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      };
    case 'custom':
      return { backgroundColor: toRgb(color) };
    case 'none':
      return undefined;
  }
}

export default function ViewportBackground({
  mode,
  color,
  className = '',
}: ViewportBackgroundProps) {
  const style = getViewportBackgroundStyle(mode, color);
  if (!style) return null;

  return <div aria-hidden="true" className={className} style={style} />;
}
