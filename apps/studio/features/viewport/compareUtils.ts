/**
 * Shared coordinate utilities for compare mode (wipe / split).
 *
 * Kept as pure functions so they can be used both from the render hook
 * (which runs inside a useLayoutEffect) and from viewport mouse handlers.
 */

/**
 * Given a divider position in viewport UV space (0-1 fraction of viewport),
 * convert it to canvas UV space accounting for zoom and pan.
 *
 * Canvas UV is the coordinate space the wipe shader operates in — the A/B
 * split is determined by comparing the fragment's UV against u_divider.
 *
 * Derivation:
 *   scenePoint = (viewportPos - viewportCenter - panCompensated) / zoom
 *   canvasUV   = (scenePoint + canvasSize/2) / canvasSize
 *
 * Pan compensation: +panX for X, -panY for Y (matching the CSS transform
 * `translate(calc(-50% + panX), calc(-50% - panY)) scale(zoom)`).
 */
export function viewportUVToCanvasUV(
  vpUV: number,
  orientation: 'vertical' | 'horizontal',
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
): number {
  const safeZoom = Math.max(zoom, 0.001);
  const vpW = viewportSize.width;
  const vpH = viewportSize.height;
  const cW = canvasSize.width;
  const cH = canvasSize.height;

  if (orientation === 'vertical') {
    const vpX = vpUV * vpW;
    return (vpX - vpW / 2 - pan.x + (cW / 2) * safeZoom) / (cW * safeZoom);
  } else {
    const vpY = vpUV * vpH;
    return (vpY - vpH / 2 + pan.y + (cH / 2) * safeZoom) / (cH * safeZoom);
  }
}

/**
 * Inverse of viewportUVToCanvasUV: given a position in canvas UV space,
 * convert it to viewport UV space (0-1 fraction of viewport).
 *
 * Derivation (solving viewportUVToCanvasUV for vpUV):
 *   vpUV = (canvasUV * canvasSize * zoom + viewportCenter + panCompensated - canvasSize/2 * zoom) / viewportSize
 */
export function canvasUVToViewportUV(
  canvasUV: number,
  orientation: 'vertical' | 'horizontal',
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
): number {
  const safeZoom = Math.max(zoom, 0.001);
  const vpW = viewportSize.width;
  const vpH = viewportSize.height;
  const cW = canvasSize.width;
  const cH = canvasSize.height;

  if (orientation === 'vertical') {
    return (canvasUV * cW * safeZoom + vpW / 2 + pan.x - (cW / 2) * safeZoom) / vpW;
  } else {
    return (canvasUV * cH * safeZoom + vpH / 2 - pan.y - (cH / 2) * safeZoom) / vpH;
  }
}

/**
 * Convert a canvas UV position to a viewport-space pixel position.
 *
 * This is canvasUVToViewportUV multiplied by the viewport dimension,
 * giving a pixel coordinate suitable for positioning overlays in the
 * viewport's coordinate system (e.g. the SVG wipe divider line).
 */
export function canvasUVToViewportPixel(
  canvasUV: number,
  orientation: 'vertical' | 'horizontal',
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
): number {
  const safeZoom = Math.max(zoom, 0.001);
  const vpW = viewportSize.width;
  const vpH = viewportSize.height;
  const cW = canvasSize.width;
  const cH = canvasSize.height;

  if (orientation === 'vertical') {
    return canvasUV * cW * safeZoom + vpW / 2 + pan.x - (cW / 2) * safeZoom;
  } else {
    return canvasUV * cH * safeZoom + vpH / 2 - pan.y - (cH / 2) * safeZoom;
  }
}
