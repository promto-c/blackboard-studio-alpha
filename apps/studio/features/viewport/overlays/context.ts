/**
 * Overlay context — shared types and helpers for overlay wrapper components.
 */
import type {
  AnyNode,
  PaintBrushSettings,
  PaintStrokePathsMode,
  Point,
  RotoMotionCueMode,
  RotoPath,
  RotoPointRef,
  RotoPointWeightMode,
  RotoRefinement,
} from '@blackboard/types';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';
import type { useViewportMotionCues } from '@/hooks/viewport/useViewportMotionCues';
import type { NudgeOverlayState } from '@/nodes/builtin/roto/RotoOverlay';
import type { DataWindowRect } from '../dataWindow';
import type { ViewportAdapterContext } from '../viewportAdapterContext';

// ---------------------------------------------------------------------------
// Domain-specific context slices
// ---------------------------------------------------------------------------

/**
 * Viewport state shared across all overlay types.
 * Changes here affect all overlays equally.
 */
export interface ViewportOverlayViewportContext {
  altPressed: boolean;
  affineModifierPressed: boolean;
  mouseScenePos: { x: number; y: number } | null;
  viewportSize: { width: number; height: number };
  transformInputDataWindowRect: DataWindowRect | null;
  stabilizationMatrix: number[][] | null;
  activeViewportTool: string | null;
  showOverlays: boolean;
}

/**
 * Roto-specific overlay context.
 * Changes here only affect roto overlay components.
 */
export interface RotoOverlayContext {
  interaction: ViewportAdapterContext['hooks']['roto'];
  nudgeOverlayState: NudgeOverlayState;
  pointWeightMode: RotoPointWeightMode;
  selectedLayerIds: string[];
  selectedPathIds: string[];
  selectedPointRefs: RotoPointRef[];
  setSelectedPointRefs: (pointRefs: RotoPointRef[]) => void;
  setHierarchySelection: (nodeId: string, layerIds: string[], itemIds: string[]) => void;
  motionCueTargetPathIdSet: ReturnType<typeof useViewportMotionCues>['motionCueTargetPathIdSet'];
  gradientTrailsByPath: ReturnType<typeof useViewportMotionCues>['gradientTrailsByPath'];
  speedHeatSegmentsByPath: ReturnType<typeof useViewportMotionCues>['speedHeatSegmentsByPath'];
  motionBlurCuePathsByPath: ReturnType<typeof useViewportMotionCues>['motionBlurCuePathsByPath'];
  motionCueEnabled: boolean;
  motionCueMode: RotoMotionCueMode;
  isDrawing: boolean;
  drawingPath: RotoPath | null;
  refinement: RotoRefinement | null;
  refinementSimplifiedPoints: Point[];
  activeTrackingPoints: Point[] | null;
}

/**
 * Paint-specific overlay context.
 * Changes here only affect paint overlay components.
 */
export interface PaintOverlayContext {
  interaction: ViewportAdapterContext['hooks']['paint'];
  brush: PaintBrushSettings;
  nudgeRadius: number;
  strokePathsVisible: boolean;
  strokePathsMode: PaintStrokePathsMode;
  selectedLayerIds: string[];
  selectedStrokeIds: string[];
  selectedNodeId: string | null;
  setHierarchySelection: (nodeId: string, layerIds: string[], itemIds: string[]) => void;
  /** Stable callback — use useEvent when creating this. */
  onStrokeSelect: (strokeId: string, shiftKey: boolean) => void;
}

// ---------------------------------------------------------------------------
// Composed context (passed through overlayProps.context)
// ---------------------------------------------------------------------------

/**
 * Extra context keys (built by useViewportOverlayContext, consumed by wrappers).
 *
 * Organized by domain to avoid monolithic invalidation: each memoized slice
 * changes independently, so a paint state update won't invalidate roto overlays.
 */
export interface ViewportOverlayExtraContext {
  viewport: ViewportOverlayViewportContext;
  roto: RotoOverlayContext;
  paint: PaintOverlayContext;
  warp: ViewportAdapterContext['hooks']['warp'];
  spatial: ViewportAdapterContext['hooks']['spatial'];
  comfyCrop: ViewportAdapterContext['hooks']['comfyCrop'];
  selectedViewportNode: AnyNode | undefined;
}

/** Extract the extra context from overlay props. */
export function ecc(props: ViewportOverlayProps): ViewportOverlayExtraContext {
  return (props.context ?? {}) as unknown as ViewportOverlayExtraContext;
}
