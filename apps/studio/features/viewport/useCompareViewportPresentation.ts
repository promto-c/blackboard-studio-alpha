import { useMemo, type RefObject } from 'react';
import type { CompareViewState } from '@/state/editor/compareView';
import type { ViewportInsets } from '@/hooks/viewport/viewportFit';
import { useViewportLayoutInsets } from '@/hooks/viewport/useViewportLayoutInsets';
import type { ViewportGestureTransform } from '@/hooks/viewport/useViewportGestures';
import {
  calculateCompareLeadingViewProjection,
  calculateComparePaneLayout,
  calculateComparePresetTarget,
  type ComparePaneLayout,
  type ComparePresentationRect,
  type ComparePresentationSize,
  type CompareViewProjection,
} from './comparePresentation';

interface UseCompareViewportPresentationOptions {
  viewportRef: RefObject<HTMLElement | null>;
  viewportSize: ComparePresentationSize;
  compareView: CompareViewState;
  isActive: boolean;
  slotASize: ComparePresentationSize | null | undefined;
  leadingSize: ComparePresentationSize | null | undefined;
  zoom: number;
  pan: { x: number; y: number };
}

interface CompareViewportPresentation {
  interactiveRect: ComparePresentationRect;
  paneLayout: ComparePaneLayout;
  presetTarget: { zoom: number; pan: { x: number; y: number } } | null;
  leadingProjection: CompareViewProjection | null;
  gestureTransform: ViewportGestureTransform | null;
  overlayZoom: number;
  overlayPan: { x: number; y: number };
}

export const calculateCompareInteractiveRect = (
  viewportSize: ComparePresentationSize,
  viewportInsets: ViewportInsets,
): ComparePresentationRect => {
  const left = Math.min(Math.max(0, viewportInsets.left), Math.max(0, viewportSize.width - 1));
  const top = Math.min(Math.max(0, viewportInsets.top), Math.max(0, viewportSize.height - 1));
  const right = Math.min(Math.max(0, viewportInsets.right), Math.max(0, viewportSize.width - left));
  const bottom = Math.min(
    Math.max(0, viewportInsets.bottom),
    Math.max(0, viewportSize.height - top),
  );

  return {
    x: left,
    y: top,
    width: Math.max(1, viewportSize.width - left - right),
    height: Math.max(1, viewportSize.height - top - bottom),
  };
};

/** Owns the canonical pane, fit, gesture, and leading-overlay projections for Compare mode. */
export function useCompareViewportPresentation({
  viewportRef,
  viewportSize,
  compareView,
  isActive,
  slotASize,
  leadingSize,
  zoom,
  pan,
}: UseCompareViewportPresentationOptions): CompareViewportPresentation {
  const viewportInsets = useViewportLayoutInsets(viewportRef);
  const interactiveRect = useMemo(
    () => calculateCompareInteractiveRect(viewportSize, viewportInsets),
    [viewportInsets, viewportSize],
  );
  const paneLayout = useMemo(
    () =>
      calculateComparePaneLayout({
        viewportSize,
        interactiveRect,
        mode: compareView.mode,
        orientation: compareView.wipe.orientation,
        sidesSwapped: compareView.sidesSwapped,
      }),
    [
      compareView.mode,
      compareView.sidesSwapped,
      compareView.wipe.orientation,
      interactiveRect,
      viewportSize,
    ],
  );
  const presetTarget = useMemo(
    () =>
      isActive && slotASize
        ? calculateComparePresetTarget(paneLayout, slotASize, compareView.sizingMode)
        : null,
    [compareView.sizingMode, isActive, paneLayout, slotASize],
  );
  const leadingProjection = useMemo(
    () =>
      isActive && slotASize && leadingSize
        ? calculateCompareLeadingViewProjection({
            viewportSize,
            layout: paneLayout,
            slotASize,
            leadingSize,
            sizingMode: compareView.sizingMode,
            zoom,
            pan,
          })
        : null,
    [compareView.sizingMode, isActive, leadingSize, pan, paneLayout, slotASize, viewportSize, zoom],
  );
  const gestureTransform = useMemo<ViewportGestureTransform | null>(() => {
    if (!isActive || compareView.mode !== 'split') return null;
    return {
      panBase: paneLayout.panBase,
      fitFrame: paneLayout.slotAPane,
      getFrameForPoint: (point) =>
        compareView.wipe.orientation === 'vertical'
          ? point.x < paneLayout.trailingPane.x
            ? paneLayout.leadingPane
            : paneLayout.trailingPane
          : point.y < paneLayout.trailingPane.y
            ? paneLayout.leadingPane
            : paneLayout.trailingPane,
    };
  }, [compareView.mode, compareView.wipe.orientation, isActive, paneLayout]);

  return {
    interactiveRect,
    paneLayout,
    presetTarget,
    leadingProjection,
    gestureTransform,
    overlayZoom: leadingProjection?.frame.scale ?? zoom,
    overlayPan: leadingProjection?.overlayPan ?? pan,
  };
}
