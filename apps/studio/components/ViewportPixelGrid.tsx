import type { CSSProperties } from 'react';

interface ViewportPixelGridProps {
  enabled: boolean;
  zoom: number;
  thresholdZoom: number;
  style?: CSSProperties;
}

export const VIEWPORT_PIXEL_GRID_FADE_ZOOM_SPAN = 1;
export const VIEWPORT_PIXEL_GRID_MAX_OPACITY = 0.1;

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

export const getEffectiveViewportPixelZoom = (
  viewportZoom: number,
  stabilizationScale: number,
): number =>
  viewportZoom *
  (Number.isFinite(stabilizationScale) && stabilizationScale > 0 ? stabilizationScale : 1);

export const getViewportPixelGridVisibility = ({
  enabled,
  zoom,
  thresholdZoom,
}: ViewportPixelGridProps): number => {
  if (
    !enabled ||
    !Number.isFinite(zoom) ||
    !Number.isFinite(thresholdZoom) ||
    zoom <= 0 ||
    thresholdZoom <= 0
  ) {
    return 0;
  }

  const fadeStartZoom = Math.max(0, thresholdZoom - VIEWPORT_PIXEL_GRID_FADE_ZOOM_SPAN);
  const fadeProgress = Math.min(
    1,
    Math.max(0, (zoom - fadeStartZoom) / VIEWPORT_PIXEL_GRID_FADE_ZOOM_SPAN),
  );
  return smoothstep(fadeProgress);
};

export const getViewportPixelGridStyle = (zoom: number, visibility = 1): CSSProperties => {
  const screenPixelWidth = 1 / zoom;
  const line = `rgba(255, 255, 255, 0.82) 0 ${screenPixelWidth}px, transparent ${screenPixelWidth}px 1px`;

  return {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    backgroundImage: `repeating-linear-gradient(to right, ${line}), repeating-linear-gradient(to bottom, ${line})`,
    mixBlendMode: 'difference',
    opacity: VIEWPORT_PIXEL_GRID_MAX_OPACITY * visibility,
  };
};

/** Draws one screen-pixel-wide lines on native scene-pixel boundaries. */
export default function ViewportPixelGrid(props: ViewportPixelGridProps) {
  const visibility = getViewportPixelGridVisibility(props);
  if (visibility <= 0) return null;

  return (
    <div
      aria-hidden="true"
      data-viewport-pixel-grid
      style={{ ...getViewportPixelGridStyle(props.zoom, visibility), ...props.style }}
    />
  );
}
