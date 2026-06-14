import { useCallback, useEffect, useState, type RefObject } from 'react';
import { EMPTY_VIEWPORT_INSETS, normalizeViewportInsets, type ViewportInsets } from './viewportFit';

const readCssPixels = (styles: CSSStyleDeclaration, propertyName: string): number => {
  const value = Number.parseFloat(styles.getPropertyValue(propertyName));
  return Number.isFinite(value) ? value : 0;
};

const readViewportInsets = (element: HTMLElement | null): ViewportInsets => {
  if (!element) return EMPTY_VIEWPORT_INSETS;

  const styles = getComputedStyle(element);
  return normalizeViewportInsets({
    left: readCssPixels(styles, '--panel-width'),
    bottom:
      readCssPixels(styles, '--bottom-tray-height') + readCssPixels(styles, '--timeline-height'),
  });
};

const areInsetsEqual = (left: ViewportInsets, right: ViewportInsets): boolean =>
  left.top === right.top &&
  left.right === right.right &&
  left.bottom === right.bottom &&
  left.left === right.left;

export function useViewportLayoutInsets(
  viewportRef: RefObject<HTMLElement | null>,
): ViewportInsets {
  const [insets, setInsets] = useState<ViewportInsets>(EMPTY_VIEWPORT_INSETS);

  const updateInsets = useCallback(() => {
    const nextInsets = readViewportInsets(viewportRef.current);
    setInsets((currentInsets) =>
      areInsetsEqual(currentInsets, nextInsets) ? currentInsets : nextInsets,
    );
  }, [viewportRef]);

  useEffect(() => {
    const element = viewportRef.current;
    updateInsets();

    window.addEventListener('resize', updateInsets);
    window.addEventListener('studio-editor-layout-resize', updateInsets);

    const observer =
      element && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateInsets) : null;
    if (element && observer) {
      observer.observe(element);
    }

    return () => {
      window.removeEventListener('resize', updateInsets);
      window.removeEventListener('studio-editor-layout-resize', updateInsets);
      observer?.disconnect();
    };
  }, [updateInsets, viewportRef]);

  return insets;
}
