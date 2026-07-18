import type { ReactNode } from 'react';
import type {
  ComparePresentationFrame,
  ComparePresentationRect,
  ComparePresentationSize,
} from './comparePresentation';

interface ViewportSceneOverlayFrameProps {
  sceneSize: ComparePresentationSize;
  frame: ComparePresentationFrame;
  clipRect: ComparePresentationRect;
  children: ReactNode;
}

/**
 * Places native scene-space overlays over a viewport-space presentation frame.
 * The outer pane clips Split views; the inner native-sized surface applies the
 * same scale and origin used to present the base image.
 */
export function ViewportSceneOverlayFrame({
  sceneSize,
  frame,
  clipRect,
  children,
}: ViewportSceneOverlayFrameProps) {
  if (
    sceneSize.width <= 0 ||
    sceneSize.height <= 0 ||
    frame.scale <= 0 ||
    clipRect.width <= 0 ||
    clipRect.height <= 0
  ) {
    return null;
  }

  return (
    <div
      data-viewport-scene-overlay-clip
      className="pointer-events-none absolute overflow-hidden"
      style={{
        left: clipRect.x,
        top: clipRect.y,
        width: clipRect.width,
        height: clipRect.height,
      }}
    >
      <div
        data-viewport-scene-overlay-frame
        className="absolute"
        style={{
          left: frame.x - clipRect.x,
          top: frame.y - clipRect.y,
          width: sceneSize.width,
          height: sceneSize.height,
          transform: `scale(${frame.scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}
