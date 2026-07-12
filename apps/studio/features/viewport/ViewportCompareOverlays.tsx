/**
 * ViewportCompareOverlays — renders the compare-mode overlay UI elements:
 * the wipe divider line and the split divider bar.
 *
 * Extracted from Viewport.tsx to reduce the monolith's size.
 */

// Props
// -----

export interface ViewportCompareOverlaysProps {
  visible: boolean;
  mode: 'wipe' | 'split';
  orientation: 'vertical' | 'horizontal';
  wipeDividerViewportPos: number;
  compareInteractiveViewportRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Component
// ---------

export function ViewportCompareOverlays({
  visible,
  mode,
  orientation,
  wipeDividerViewportPos,
  compareInteractiveViewportRect,
}: ViewportCompareOverlaysProps) {
  if (!visible) return null;

  const containerClassName = 'pointer-events-none absolute inset-0 z-[5] overflow-hidden';

  if (mode === 'wipe') {
    return (
      <div className={containerClassName}>
        <div
          className={
            orientation === 'vertical'
              ? 'absolute inset-y-0 w-px bg-white/25'
              : 'absolute inset-x-0 h-px bg-white/25'
          }
          style={
            orientation === 'vertical'
              ? { left: wipeDividerViewportPos }
              : { top: wipeDividerViewportPos }
          }
        />
      </div>
    );
  }

  const { x, y, width, height } = compareInteractiveViewportRect;

  return (
    <div className={containerClassName}>
      <div
        className={
          orientation === 'vertical' ? 'absolute w-px bg-white/25' : 'absolute h-px bg-white/25'
        }
        style={
          orientation === 'vertical'
            ? {
                left: x + width / 2,
                top: y,
                height,
              }
            : {
                left: x,
                top: y + height / 2,
                width,
              }
        }
      />
    </div>
  );
}
