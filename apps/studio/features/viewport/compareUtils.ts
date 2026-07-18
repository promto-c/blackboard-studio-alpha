/**
 * Shared coordinate utilities for compare mode (wipe / split).
 *
 * Kept as pure functions so they can be used both from the render hook
 * (which runs inside a useLayoutEffect) and from viewport mouse handlers.
 */

interface PresentationFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Converts a viewport pixel on the divider axis into UV within a presented image frame. */
export function viewportPixelToPresentationFrameUV(
  viewportPixel: number,
  orientation: 'vertical' | 'horizontal',
  frame: PresentationFrame,
): number {
  return orientation === 'vertical'
    ? (viewportPixel - frame.x) / Math.max(frame.width, 0.001)
    : (viewportPixel - frame.y) / Math.max(frame.height, 0.001);
}

/** Converts UV within a presented image frame into a full-viewport pixel. */
export function presentationFrameUVToViewportPixel(
  frameUV: number,
  orientation: 'vertical' | 'horizontal',
  frame: PresentationFrame,
): number {
  return orientation === 'vertical'
    ? frame.x + frameUV * frame.width
    : frame.y + frameUV * frame.height;
}

/** Converts UV within a presented image frame into full-viewport UV. */
export function presentationFrameUVToViewportUV(
  frameUV: number,
  orientation: 'vertical' | 'horizontal',
  viewportSize: { width: number; height: number },
  frame: PresentationFrame,
): number {
  const viewportPixel = presentationFrameUVToViewportPixel(frameUV, orientation, frame);
  return viewportPixel / (orientation === 'vertical' ? viewportSize.width : viewportSize.height);
}

/** Maps a divider stored relative to the interactive pane into the full viewport. */
export function interactiveUVToViewportUV(
  divider: number,
  orientation: 'vertical' | 'horizontal',
  viewportSize: { width: number; height: number },
  interactiveRect: { x: number; y: number; width: number; height: number },
): number {
  if (orientation === 'vertical') {
    return (interactiveRect.x + divider * interactiveRect.width) / viewportSize.width;
  }
  return (interactiveRect.y + divider * interactiveRect.height) / viewportSize.height;
}

/** Maps a divider stored relative to the interactive pane into full-viewport pixels. */
export function interactiveUVToViewportPixel(
  divider: number,
  orientation: 'vertical' | 'horizontal',
  interactiveRect: { x: number; y: number; width: number; height: number },
): number {
  return orientation === 'vertical'
    ? interactiveRect.x + divider * interactiveRect.width
    : interactiveRect.y + divider * interactiveRect.height;
}
