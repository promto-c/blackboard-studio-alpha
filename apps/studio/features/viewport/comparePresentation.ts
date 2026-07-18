import type {
  CompareMode,
  CompareOrientation,
  CompareSizingMode,
} from '@/state/editor/compareView';

export interface ComparePresentationSize {
  width: number;
  height: number;
}

export interface ComparePresentationFrame extends ComparePresentationSize {
  x: number;
  y: number;
  scale: number;
}

export interface ComparePresentationRect extends ComparePresentationSize {
  x: number;
  y: number;
}

export interface ComparePaneLayout {
  panBase: { x: number; y: number };
  leadingPane: ComparePresentationRect;
  trailingPane: ComparePresentationRect;
  slotAPane: ComparePresentationRect;
  leadingVisualPane: ComparePresentationRect;
  trailingVisualPane: ComparePresentationRect;
  slotAVisualPane: ComparePresentationRect;
}

export interface CompareViewProjection {
  frame: ComparePresentationFrame;
  clipRect: ComparePresentationRect;
  overlayPan: { x: number; y: number };
  presentationPan: { x: number; y: number };
  scaleMultiplier: number;
}

const isUsableSize = ({ width, height }: ComparePresentationSize): boolean =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

/**
 * Calculates a view-only scale for native display-window pixels.
 * Fit preserves the entire image, Fill covers the pane, and None keeps a 1:1 pixel scale.
 */
export const calculateComparePresentationScale = (
  paneSize: ComparePresentationSize,
  contentSize: ComparePresentationSize,
  mode: CompareSizingMode,
): number => {
  if (!isUsableSize(paneSize) || !isUsableSize(contentSize)) return 1;
  if (mode === 'none') return 1;

  const widthScale = paneSize.width / contentSize.width;
  const heightScale = paneSize.height / contentSize.height;
  return mode === 'fill' ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale);
};

/**
 * Positions a native display window inside a top-left-origin viewport pane.
 * Pan is expressed in screen pixels using the editor convention: +x moves right, +y moves up.
 */
export const calculateCompareViewportFrame = (
  pane: ComparePresentationRect,
  contentSize: ComparePresentationSize,
  mode: CompareSizingMode,
  options: {
    scaleMultiplier?: number;
    pan?: { x: number; y: number };
  } = {},
): ComparePresentationFrame => {
  const baseScale = calculateComparePresentationScale(pane, contentSize, mode);
  const requestedScaleMultiplier = options.scaleMultiplier ?? 1;
  const scaleMultiplier = Number.isFinite(requestedScaleMultiplier)
    ? Math.max(0.001, requestedScaleMultiplier)
    : 1;
  const scale = baseScale * scaleMultiplier;
  const width = contentSize.width * scale;
  const height = contentSize.height * scale;
  const pan = options.pan ?? { x: 0, y: 0 };

  return {
    x: pane.x + (pane.width - width) / 2 + pan.x,
    y: pane.y + (pane.height - height) / 2 - pan.y,
    width,
    height,
    scale,
  };
};

/** Builds the one canonical pane layout used by gestures, presentation, and fit targets. */
export const calculateComparePaneLayout = ({
  viewportSize,
  interactiveRect,
  mode,
  orientation,
  sidesSwapped,
}: {
  viewportSize: ComparePresentationSize;
  interactiveRect: ComparePresentationRect;
  mode: CompareMode;
  orientation: CompareOrientation;
  sidesSwapped: boolean;
}): ComparePaneLayout => {
  const panBase = {
    x: interactiveRect.x + interactiveRect.width / 2 - viewportSize.width / 2,
    y: viewportSize.height / 2 - (interactiveRect.y + interactiveRect.height / 2),
  };

  let leadingPane = interactiveRect;
  let trailingPane = interactiveRect;
  if (mode === 'split' && orientation === 'vertical') {
    const leadingWidth = Math.max(1, Math.floor(interactiveRect.width / 2));
    leadingPane = { ...interactiveRect, width: leadingWidth };
    trailingPane = {
      x: interactiveRect.x + leadingWidth,
      y: interactiveRect.y,
      width: Math.max(1, interactiveRect.width - leadingWidth),
      height: interactiveRect.height,
    };
  } else if (mode === 'split') {
    const leadingHeight = Math.max(1, Math.floor(interactiveRect.height / 2));
    leadingPane = { ...interactiveRect, height: leadingHeight };
    trailingPane = {
      x: interactiveRect.x,
      y: interactiveRect.y + leadingHeight,
      width: interactiveRect.width,
      height: Math.max(1, interactiveRect.height - leadingHeight),
    };
  }

  let leadingVisualPane: ComparePresentationRect = {
    x: 0,
    y: 0,
    width: viewportSize.width,
    height: viewportSize.height,
  };
  let trailingVisualPane = leadingVisualPane;
  if (mode === 'split' && orientation === 'vertical') {
    const splitX = trailingPane.x;
    leadingVisualPane = { x: 0, y: 0, width: splitX, height: viewportSize.height };
    trailingVisualPane = {
      x: splitX,
      y: 0,
      width: Math.max(0, viewportSize.width - splitX),
      height: viewportSize.height,
    };
  } else if (mode === 'split') {
    const splitY = trailingPane.y;
    leadingVisualPane = { x: 0, y: 0, width: viewportSize.width, height: splitY };
    trailingVisualPane = {
      x: 0,
      y: splitY,
      width: viewportSize.width,
      height: Math.max(0, viewportSize.height - splitY),
    };
  }

  return {
    panBase,
    leadingPane,
    trailingPane,
    slotAPane: sidesSwapped ? trailingPane : leadingPane,
    leadingVisualPane,
    trailingVisualPane,
    slotAVisualPane: sidesSwapped ? trailingVisualPane : leadingVisualPane,
  };
};

/** Returns the exact transform that reapplies the selected automatic Compare preset. */
export const calculateComparePresetTarget = (
  layout: ComparePaneLayout,
  slotASize: ComparePresentationSize,
  mode: CompareSizingMode,
): { zoom: number; pan: { x: number; y: number } } => ({
  zoom: calculateComparePresentationScale(layout.slotAPane, slotASize, mode),
  pan: layout.panBase,
});

/**
 * Resolves lower-numbered slot A, which owns Compare's canonical zoom multiplier,
 * into its viewport-space presentation frame.
 */
const calculateCompareBaseViewProjection = ({
  viewportSize,
  layout,
  slotASize,
  sizingMode,
  zoom,
  pan,
}: {
  viewportSize: ComparePresentationSize;
  layout: ComparePaneLayout;
  slotASize: ComparePresentationSize;
  sizingMode: CompareSizingMode;
  zoom: number;
  pan: { x: number; y: number };
}): CompareViewProjection => {
  const baseScale = calculateComparePresentationScale(layout.slotAPane, slotASize, sizingMode);
  const scaleMultiplier = zoom / Math.max(baseScale, 0.001);
  const presentationPan = {
    x: pan.x - layout.panBase.x,
    y: pan.y - layout.panBase.y,
  };
  return calculateCompareViewProjection({
    viewportSize,
    pane: layout.slotAPane,
    visualPane: layout.slotAVisualPane,
    contentSize: slotASize,
    sizingMode,
    scaleMultiplier,
    presentationPan,
  });
};

const calculateCompareViewProjection = ({
  viewportSize,
  pane,
  visualPane,
  contentSize,
  sizingMode,
  scaleMultiplier,
  presentationPan,
}: {
  viewportSize: ComparePresentationSize;
  pane: ComparePresentationRect;
  visualPane: ComparePresentationRect;
  contentSize: ComparePresentationSize;
  sizingMode: CompareSizingMode;
  scaleMultiplier: number;
  presentationPan: { x: number; y: number };
}): CompareViewProjection => {
  const frame = calculateCompareViewportFrame(pane, contentSize, sizingMode, {
    scaleMultiplier,
    pan: presentationPan,
  });

  return {
    frame,
    clipRect: visualPane,
    overlayPan: {
      x: frame.x + frame.width / 2 - viewportSize.width / 2,
      y: viewportSize.height / 2 - (frame.y + frame.height / 2),
    },
    presentationPan,
    scaleMultiplier,
  };
};

/**
 * Projects the currently leading image (left for Vertical, top for Horizontal)
 * while retaining slot A as the canonical shared zoom multiplier.
 */
export const calculateCompareLeadingViewProjection = ({
  viewportSize,
  layout,
  slotASize,
  leadingSize,
  sizingMode,
  zoom,
  pan,
}: {
  viewportSize: ComparePresentationSize;
  layout: ComparePaneLayout;
  slotASize: ComparePresentationSize;
  leadingSize: ComparePresentationSize;
  sizingMode: CompareSizingMode;
  zoom: number;
  pan: { x: number; y: number };
}): CompareViewProjection => {
  const baseProjection = calculateCompareBaseViewProjection({
    viewportSize,
    layout,
    slotASize,
    sizingMode,
    zoom,
    pan,
  });

  return calculateCompareViewProjection({
    viewportSize,
    pane: layout.leadingPane,
    visualPane: layout.leadingVisualPane,
    contentSize: leadingSize,
    sizingMode,
    scaleMultiplier: baseProjection.scaleMultiplier,
    presentationPan: baseProjection.presentationPan,
  });
};
