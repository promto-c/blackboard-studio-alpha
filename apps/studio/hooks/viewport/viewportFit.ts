import type { Pan } from '@blackboard/types';

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportFitTarget {
  zoom: number;
  pan: Pan;
}

export interface PivotedViewportPanParams {
  viewportSize: ViewportSize;
  pivot: { x: number; y: number };
  oldZoom: number;
  newZoom: number;
  oldPan: Pan;
}

export const EMPTY_VIEWPORT_INSETS: ViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const FIT_PADDING_SCALE = 0.9;

const clampInset = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const normalizeViewportInsets = (
  insets: Partial<ViewportInsets> | null | undefined,
): ViewportInsets => ({
  top: clampInset(insets?.top ?? 0),
  right: clampInset(insets?.right ?? 0),
  bottom: clampInset(insets?.bottom ?? 0),
  left: clampInset(insets?.left ?? 0),
});

export const getViewportFitPan = (insets: ViewportInsets): Pan => ({
  x: (insets.left - insets.right) / 2,
  y: (insets.bottom - insets.top) / 2,
});

export const calculateViewportFitTarget = ({
  viewportSize,
  sceneSize,
  insets = EMPTY_VIEWPORT_INSETS,
}: {
  viewportSize: ViewportSize;
  sceneSize: ViewportSize;
  insets?: Partial<ViewportInsets>;
}): ViewportFitTarget => {
  const normalizedInsets = normalizeViewportInsets(insets);
  const pan = getViewportFitPan(normalizedInsets);

  if (
    viewportSize.width <= 0 ||
    viewportSize.height <= 0 ||
    sceneSize.width <= 0 ||
    sceneSize.height <= 0
  ) {
    return { zoom: 1, pan };
  }

  const availableWidth = Math.max(
    1,
    viewportSize.width - normalizedInsets.left - normalizedInsets.right,
  );
  const availableHeight = Math.max(
    1,
    viewportSize.height - normalizedInsets.top - normalizedInsets.bottom,
  );

  return {
    zoom:
      Math.min(availableWidth / sceneSize.width, availableHeight / sceneSize.height) *
      FIT_PADDING_SCALE,
    pan,
  };
};

export const calculatePivotedViewportPan = ({
  viewportSize,
  pivot,
  oldZoom,
  newZoom,
  oldPan,
}: PivotedViewportPanParams): Pan => {
  const safeOldZoom = Math.max(0.001, oldZoom);
  const canvasCenterX = viewportSize.width / 2 + oldPan.x;
  const canvasCenterY = viewportSize.height / 2 - oldPan.y;
  const pivotFromCenterX = pivot.x - canvasCenterX;
  const pivotFromCenterY = pivot.y - canvasCenterY;
  const worldX = pivotFromCenterX / safeOldZoom;
  const worldY = pivotFromCenterY / safeOldZoom;
  const newCanvasCenterX = pivot.x - worldX * newZoom;
  const newCanvasCenterY = pivot.y - worldY * newZoom;

  return {
    x: newCanvasCenterX - viewportSize.width / 2,
    y: -(newCanvasCenterY - viewportSize.height / 2),
  };
};
