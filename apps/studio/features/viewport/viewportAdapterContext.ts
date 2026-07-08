import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import type {
  AnyNode,
  PaintBrushSettings,
  RotoPointRef,
  RotoPath,
  RotoRefinement,
  SceneNode,
  ViewerSettings,
} from '@blackboard/types';
import type { useRotoInteraction } from '@/nodes/builtin/roto/useRotoInteraction';
import type { usePaintInteraction } from '@/nodes/builtin/paint/usePaintInteraction';
import type { useWarpInteraction } from '@/nodes/spatial/warp/useWarpInteraction';
import type { useBokehInteraction } from '@/nodes/effects/bokeh/useBokehInteraction';
import type { useComfyCropInteraction } from '@/nodes/ai/comfy/useComfyCropInteraction';
import type { useSpatialInteraction } from '@/nodes/spatial/transform/useSpatialInteraction';

/**
 * Mutable context object passed to every ViewportInteraction adapter.
 *
 * Fields are populated on each render by `useViewportInteractions`.
 * Adapter classes store a reference to this object and read the latest
 * values when their methods are called.
 */
export interface ViewportAdapterContext {
  // ── Reactive state ───────────────────────────────────────────────
  selectedNode: AnyNode | undefined;
  selectedNodeId: string | null;
  nodes: AnyNode[];
  sceneNode: SceneNode | undefined;
  zoom: number;
  visualFrame: number;
  activeViewportTool: string | null;
  altPressed: boolean;
  shiftPressed: boolean;
  affineModifierPressed: boolean;
  mouseScenePos: { x: number; y: number } | null;
  isDrawing: boolean;
  drawingRotoPath: RotoPath | null;
  rotoRefinement: RotoRefinement | null;
  nudgeRadius: number;
  rotoPointWeightMode: string;
  paintBrush: PaintBrushSettings;
  viewerChannels: ViewerSettings['channels'];
  pixelInfo: { x: number; y: number; color: [number, number, number, number] } | null;
  transformInputDataWindowRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    nativeWidth: number;
    nativeHeight: number;
  } | null;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  viewportToSceneCentered: (pos: { x: number; y: number }) => { x: number; y: number };

  // ── Actions ──────────────────────────────────────────────────────
  updateNode: (nodeId: string, changes: Record<string, unknown>, pushHistory?: boolean) => void;
  commitMutation: CommitEditorMutation;
  setActiveViewportTool: (tool: string | null) => void;
  setHierarchySelection: (nodeId: string, layerIds: string[], itemIds: string[]) => void;
  setSelectedRotoPointRefs: (pointRefs: RotoPointRef[]) => void;
  setKeyframe: (
    nodeId: string,
    propertyPath: string,
    value?: number,
    withHistory?: boolean,
  ) => void;
  startDrawingShape: (path: RotoPath) => void;
  addPointToDrawingShape: (point: { x: number; y: number }) => void;
  updateDrawingPoint: (index: number, point: { x: number; y: number }) => void;
  commitDrawingShape: (opts?: { closed?: boolean; style?: Record<string, unknown> }) => void;
  cancelDrawingShape: () => void;
  addRotoPointToPath: (
    pathId: string,
    insertIndex: number,
    point: { x: number; y: number },
  ) => void;
  startRotoRefinement: (
    refinement: Omit<RotoRefinement, 'targetPathId'> & { targetPathId?: string },
  ) => void;
  commitRotoRefinement: () => void;
  setPreferences: (prefs: Record<string, unknown>) => void;

  // ── Hook results (populated by useViewportInteractions) ─────────
  hooks: {
    roto: ReturnType<typeof useRotoInteraction>;
    paint: ReturnType<typeof usePaintInteraction>;
    warp: ReturnType<typeof useWarpInteraction>;
    bokeh: ReturnType<typeof useBokehInteraction>;
    comfyCrop: ReturnType<typeof useComfyCropInteraction>;
    spatial: ReturnType<typeof useSpatialInteraction>;
  };
}
