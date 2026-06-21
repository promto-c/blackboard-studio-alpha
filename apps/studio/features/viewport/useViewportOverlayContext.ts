import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { AnyNode } from '@blackboard/types';
import type {
  PaintOverlayContext,
  RotoOverlayContext,
  ViewportOverlayExtraContext,
  ViewportOverlayViewportContext,
} from './overlays';
import type { DataWindowRect } from './dataWindow';
import type { ViewportAdapterContext } from './viewportAdapterContext';

export interface UseViewportOverlayContextProps {
  rotoInteraction: ViewportAdapterContext['hooks']['roto'];
  paintInteraction: ViewportAdapterContext['hooks']['paint'];
  warpInteraction: ViewportAdapterContext['hooks']['warp'];
  spatialInteraction: ViewportAdapterContext['hooks']['spatial'];
  comfyCropInteraction: ViewportAdapterContext['hooks']['comfyCrop'];

  altPressed: boolean;
  affineModifierPressed: boolean;
  mouseScenePos: ViewportOverlayViewportContext['mouseScenePos'];
  viewportSize: ViewportOverlayViewportContext['viewportSize'];
  transformInputDataWindowRect: DataWindowRect | null;
  stabilizationMatrix: ViewportOverlayViewportContext['stabilizationMatrix'];

  isDrawing: RotoOverlayContext['isDrawing'];
  drawingRotoPath: RotoOverlayContext['drawingPath'];
  rotoRefinement: RotoOverlayContext['refinement'];
  refinementSimplifiedPoints: RotoOverlayContext['refinementSimplifiedPoints'];
  activeTrackingPoints: RotoOverlayContext['activeTrackingPoints'];
  nudgeRadius: PaintOverlayContext['nudgeRadius'];
  rotoPointWeightMode: RotoOverlayContext['pointWeightMode'];
  rotoNudgeOverlayState: RotoOverlayContext['nudgeOverlayState'];

  paintBrush: PaintOverlayContext['brush'];
  paintStrokePathsVisible: PaintOverlayContext['strokePathsVisible'];
  paintStrokePathsMode: PaintOverlayContext['strokePathsMode'];

  selectedRotoLayerIds: RotoOverlayContext['selectedLayerIds'];
  selectedRotoPathIds: RotoOverlayContext['selectedPathIds'];
  selectedRotoPointRefs: RotoOverlayContext['selectedPointRefs'];
  selectedPaintLayerIds: PaintOverlayContext['selectedLayerIds'];
  selectedPaintStrokeIds: PaintOverlayContext['selectedStrokeIds'];
  selectedViewportNode: AnyNode | undefined;
  selectedNodeId: string | null;

  setSelectedRotoPointRefs: RotoOverlayContext['setSelectedPointRefs'];
  setHierarchySelection: PaintOverlayContext['setHierarchySelection'];

  motionCueTargetPathIdSet: RotoOverlayContext['motionCueTargetPathIdSet'];
  gradientTrailsByPath: RotoOverlayContext['gradientTrailsByPath'];
  speedHeatSegmentsByPath: RotoOverlayContext['speedHeatSegmentsByPath'];
  motionBlurCuePathsByPath: RotoOverlayContext['motionBlurCuePathsByPath'];
  rotoMotionCueEnabled: RotoOverlayContext['motionCueEnabled'];
  rotoMotionCueMode: RotoOverlayContext['motionCueMode'];

  activeViewportTool: ViewportOverlayViewportContext['activeViewportTool'];
  showOverlays: ViewportOverlayViewportContext['showOverlays'];
}

export interface UseViewportOverlayContextResult {
  overlayContext: ViewportOverlayExtraContext;
  overlayContextRef: RefObject<ViewportOverlayExtraContext>;
}

export function useViewportOverlayContext({
  rotoInteraction,
  paintInteraction,
  warpInteraction,
  spatialInteraction,
  comfyCropInteraction,
  altPressed,
  affineModifierPressed,
  mouseScenePos,
  viewportSize,
  transformInputDataWindowRect,
  stabilizationMatrix,
  isDrawing,
  drawingRotoPath,
  rotoRefinement,
  refinementSimplifiedPoints,
  activeTrackingPoints,
  nudgeRadius,
  rotoPointWeightMode,
  rotoNudgeOverlayState,
  paintBrush,
  paintStrokePathsVisible,
  paintStrokePathsMode,
  selectedRotoLayerIds,
  selectedRotoPathIds,
  selectedRotoPointRefs,
  selectedPaintLayerIds,
  selectedPaintStrokeIds,
  selectedViewportNode,
  selectedNodeId,
  setSelectedRotoPointRefs,
  setHierarchySelection,
  motionCueTargetPathIdSet,
  gradientTrailsByPath,
  speedHeatSegmentsByPath,
  motionBlurCuePathsByPath,
  rotoMotionCueEnabled,
  rotoMotionCueMode,
  activeViewportTool,
  showOverlays,
}: UseViewportOverlayContextProps): UseViewportOverlayContextResult {
  const onPaintStrokeSelect = useCallback(
    (strokeId: string, shiftKey: boolean) => {
      if (shiftKey) {
        const ids = selectedPaintStrokeIds as string[];
        setHierarchySelection(
          selectedNodeId ?? '',
          selectedPaintLayerIds,
          ids.includes(strokeId) ? ids.filter((id) => id !== strokeId) : [...ids, strokeId],
        );
        return;
      }

      setHierarchySelection(selectedNodeId ?? '', [], [strokeId]);
    },
    [selectedPaintStrokeIds, selectedPaintLayerIds, selectedNodeId, setHierarchySelection],
  );

  const viewportContext = useMemo<ViewportOverlayViewportContext>(
    () => ({
      altPressed,
      affineModifierPressed,
      mouseScenePos,
      viewportSize,
      transformInputDataWindowRect,
      stabilizationMatrix,
      activeViewportTool,
      showOverlays,
    }),
    [
      altPressed,
      affineModifierPressed,
      mouseScenePos,
      viewportSize,
      transformInputDataWindowRect,
      stabilizationMatrix,
      activeViewportTool,
      showOverlays,
    ],
  );

  const rotoContext = useMemo<RotoOverlayContext>(
    () => ({
      interaction: rotoInteraction,
      nudgeOverlayState: rotoNudgeOverlayState,
      pointWeightMode: rotoPointWeightMode,
      selectedLayerIds: selectedRotoLayerIds,
      selectedPathIds: selectedRotoPathIds,
      selectedPointRefs: selectedRotoPointRefs,
      setSelectedPointRefs: setSelectedRotoPointRefs,
      setHierarchySelection,
      motionCueTargetPathIdSet,
      gradientTrailsByPath,
      speedHeatSegmentsByPath,
      motionBlurCuePathsByPath,
      motionCueEnabled: rotoMotionCueEnabled,
      motionCueMode: rotoMotionCueMode,
      isDrawing,
      drawingPath: drawingRotoPath,
      refinement: rotoRefinement,
      refinementSimplifiedPoints,
      activeTrackingPoints,
    }),
    [
      rotoInteraction,
      rotoNudgeOverlayState,
      rotoPointWeightMode,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      selectedRotoPointRefs,
      setSelectedRotoPointRefs,
      setHierarchySelection,
      motionCueTargetPathIdSet,
      gradientTrailsByPath,
      speedHeatSegmentsByPath,
      motionBlurCuePathsByPath,
      rotoMotionCueEnabled,
      rotoMotionCueMode,
      isDrawing,
      drawingRotoPath,
      rotoRefinement,
      refinementSimplifiedPoints,
      activeTrackingPoints,
    ],
  );

  const paintContext = useMemo<PaintOverlayContext>(
    () => ({
      interaction: paintInteraction,
      brush: paintBrush,
      nudgeRadius,
      strokePathsVisible: paintStrokePathsVisible,
      strokePathsMode: paintStrokePathsMode,
      selectedLayerIds: selectedPaintLayerIds,
      selectedStrokeIds: selectedPaintStrokeIds,
      selectedNodeId,
      setHierarchySelection,
      onStrokeSelect: onPaintStrokeSelect,
    }),
    [
      paintInteraction,
      paintBrush,
      nudgeRadius,
      paintStrokePathsVisible,
      paintStrokePathsMode,
      selectedPaintLayerIds,
      selectedPaintStrokeIds,
      selectedNodeId,
      setHierarchySelection,
      onPaintStrokeSelect,
    ],
  );

  const overlayContext = useMemo<ViewportOverlayExtraContext>(
    () => ({
      viewport: viewportContext,
      roto: rotoContext,
      paint: paintContext,
      warp: warpInteraction,
      spatial: spatialInteraction,
      comfyCrop: comfyCropInteraction,
      selectedViewportNode,
    }),
    [
      viewportContext,
      rotoContext,
      paintContext,
      warpInteraction,
      spatialInteraction,
      comfyCropInteraction,
      selectedViewportNode,
    ],
  );

  const overlayContextRef = useRef(overlayContext);
  overlayContextRef.current = overlayContext;

  return {
    overlayContext,
    overlayContextRef,
  };
}
