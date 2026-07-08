/**
 * useViewportInteractions — Centralises all viewport interaction hooks and
 * exposes a unified ViewportInteraction via the node registry.
 *
 * ARCHITECTURE
 * ────────────
 * Each node type that has viewport interactions registers a
 * `createViewportInteraction` factory on its NodeDefinition. This hook:
 *
 * 1. Calls all interaction hooks unconditionally (React rules)
 * 2. Builds a mutable ViewportAdapterContext ref (updated every render)
 * 3. Looks up the selected node's definition from the node registry
 * 4. Calls createViewportInteraction to get a ViewportInteraction adapter
 * 5. The adapter is swapped only when the node TYPE changes (stable ref)
 *
 * Zero if/else chains on node types in this file — all dispatch is
 * delegated to the registry-provided adapter.
 */

import { useRef, type RefObject } from 'react';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import type {
  AnyNode,
  ComfyNode,
  PaintBrushSettings,
  ProjectColorManagement,
  SceneNode,
  ViewerSettings,
  RotoPointRef,
  RotoPath,
  RotoRefinement,
  RotoPointWeightMode,
} from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import type { ViewportInteraction } from '@/nodes/NodeDefinition';
import { nodeRegistry } from '@/nodes/registry';

// ── Interaction hooks (called unconditionally per React rules) ──────
import { useWarpInteraction } from '@/nodes/spatial/warp/useWarpInteraction';
import { useBokehInteraction } from '@/nodes/effects/bokeh/useBokehInteraction';
import { useSpatialInteraction } from '@/nodes/spatial/transform/useSpatialInteraction';
import { usePaintInteraction } from '@/nodes/builtin/paint/usePaintInteraction';
import { useComfyCropInteraction } from '@/nodes/ai/comfy/useComfyCropInteraction';
import { useRotoInteraction } from '@/nodes/builtin/roto/useRotoInteraction';

// ── Adapter classes (one per node type with viewport interaction) ───
import { noopViewportInteraction } from './interactions';
import type { ViewportAdapterContext } from './viewportAdapterContext';

// -------------------------------------------------------------------
// Re-export types that consumers (Viewport.tsx) need
// -------------------------------------------------------------------
export type { ViewportAdapterContext } from './viewportAdapterContext';

// -------------------------------------------------------------------
// Params — same shape as before (bridged to the ViewportAdapterContext)
// -------------------------------------------------------------------

export interface UseViewportInteractionsParams {
  selectedNode: AnyNode | undefined;
  selectedNodeId: string | null;
  nodes: AnyNode[];
  sceneNode: SceneNode | undefined;
  projectColorManagement: ProjectColorManagement;
  selectedRotoLayerIds: string[];
  selectedRotoPathIds: string[];
  selectedRotoPointRefs: RotoPointRef[];
  selectedPaintLayerIds: string[];
  selectedPaintStrokeIds: string[];
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
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportToSceneCentered: (pos: { x: number; y: number }) => { x: number; y: number };
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
}

// -------------------------------------------------------------------
// Return type
// -------------------------------------------------------------------

export interface UseViewportInteractionsResult {
  /** Unified interaction object for generic dispatch in Viewport.tsx. */
  interaction: ViewportInteraction;
  /** Mutable context ref — contains all hook results and reactive state. */
  ctxRef: React.RefObject<ViewportAdapterContext>;
}

// -------------------------------------------------------------------
// Hook
// -------------------------------------------------------------------

export function useViewportInteractions(
  params: UseViewportInteractionsParams,
): UseViewportInteractionsResult {
  // ── Destructure params ──────────────────────────────────────────────
  const {
    selectedNode,
    selectedNodeId,
    nodes,
    sceneNode,
    projectColorManagement,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    selectedPaintLayerIds,
    selectedPaintStrokeIds,
    zoom,
    visualFrame,
    activeViewportTool,
    altPressed,
    shiftPressed,
    affineModifierPressed,
    mouseScenePos,
    isDrawing,
    drawingRotoPath,
    rotoRefinement,
    nudgeRadius,
    rotoPointWeightMode,
    paintBrush,
    viewerChannels,
    pixelInfo,
    transformInputDataWindowRect,
    viewportRef,
    viewportToSceneCentered,
    updateNode,
    commitMutation,
    setActiveViewportTool,
    setHierarchySelection,
    setSelectedRotoPointRefs,
    setKeyframe,
    startDrawingShape,
    addPointToDrawingShape,
    updateDrawingPoint,
    commitDrawingShape,
    cancelDrawingShape,
    addRotoPointToPath,
    startRotoRefinement,
    commitRotoRefinement,
    setPreferences,
  } = params;

  // ── Call all interaction hooks unconditionally (React rules) ────────
  const warp = useWarpInteraction({
    selectedNode,
    sceneNode,
    activeViewportTool,
    zoom,
    visualFrame,
    nodes,
    selectedNodeId,
    updateNode,
    setActiveViewportTool,
    commitMutation,
  });

  const bokeh = useBokehInteraction({
    selectedNode,
    sceneNode,
    activeViewportTool,
    pixelInfo,
    setKeyframe,
  });

  const spatial = useSpatialInteraction({
    selectedNode,
    sceneNode,
    sourceRect: transformInputDataWindowRect,
    zoom,
    visualFrame,
    nodes,
    selectedNodeId,
    updateNode,
    commitMutation,
  });

  const paint = usePaintInteraction({
    nodes,
    selectedNode,
    selectedNodeId,
    selectedPaintLayerIds,
    selectedPaintStrokeIds,
    setHierarchySelection,
    activeViewportTool,
    sceneNode,
    projectColorManagement,
    frame: visualFrame,
    zoom,
    paintBrush,
    viewerChannels,
    nudgeRadius,
    updateNode,
    commitMutation,
    setPreferences,
  });

  const comfyCrop = useComfyCropInteraction({
    selectedNode: selectedNode?.type === NodeType.COMFY ? (selectedNode as ComfyNode) : undefined,
    sceneNode,
    activeViewportTool,
    zoom,
    updateNode: updateNode as (
      nodeId: string,
      updates: Record<string, unknown>,
      withHistory?: boolean,
    ) => void,
    setHierarchySelection,
  });

  const roto = useRotoInteraction({
    selectedNode,
    selectedNodeId,
    nodes,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    zoom,
    visualFrame,
    activeViewportTool,
    altPressed,
    shiftPressed,
    affineModifierPressed,
    mouseScenePos,
    isDrawing,
    drawingRotoPath,
    rotoRefinement,
    nudgeRadius,
    rotoPointWeightMode: rotoPointWeightMode as RotoPointWeightMode,
    viewportRef,
    viewportToSceneCentered,
    updateNode,
    commitMutation,
    setHierarchySelection,
    setSelectedRotoPointRefs,
    setActiveViewportTool,
    startDrawingShape,
    addPointToDrawingShape,
    updateDrawingPoint,
    commitDrawingShape,
    cancelDrawingShape,
    addRotoPointToPath,
    startRotoRefinement,
    commitRotoRefinement,
    setPreferences,
  });

  // ── Build the mutable shared context (updated every render) ─────────
  const ctxRef = useRef<ViewportAdapterContext>(null as unknown as ViewportAdapterContext);

  // Ensure initial creation
  if (!ctxRef.current) {
    ctxRef.current = {} as ViewportAdapterContext;
  }

  const ctx = ctxRef.current;
  ctx.selectedNode = selectedNode;
  ctx.selectedNodeId = selectedNodeId;
  ctx.nodes = nodes;
  ctx.sceneNode = sceneNode;
  ctx.zoom = zoom;
  ctx.visualFrame = visualFrame;
  ctx.activeViewportTool = activeViewportTool;
  ctx.altPressed = altPressed;
  ctx.shiftPressed = shiftPressed;
  ctx.affineModifierPressed = affineModifierPressed;
  ctx.mouseScenePos = mouseScenePos;
  ctx.isDrawing = isDrawing;
  ctx.drawingRotoPath = drawingRotoPath;
  ctx.rotoRefinement = rotoRefinement;
  ctx.nudgeRadius = nudgeRadius;
  ctx.rotoPointWeightMode = rotoPointWeightMode;
  ctx.paintBrush = paintBrush;
  ctx.viewerChannels = viewerChannels;
  ctx.pixelInfo = pixelInfo;
  ctx.transformInputDataWindowRect = transformInputDataWindowRect;
  ctx.viewportRef = viewportRef;
  ctx.viewportToSceneCentered = viewportToSceneCentered;
  ctx.updateNode = updateNode;
  ctx.commitMutation = commitMutation;
  ctx.setActiveViewportTool = setActiveViewportTool;
  ctx.setHierarchySelection = setHierarchySelection;
  ctx.setSelectedRotoPointRefs = setSelectedRotoPointRefs;
  ctx.setKeyframe = setKeyframe;
  ctx.startDrawingShape = startDrawingShape;
  ctx.addPointToDrawingShape = addPointToDrawingShape;
  ctx.updateDrawingPoint = updateDrawingPoint;
  ctx.commitDrawingShape = commitDrawingShape;
  ctx.cancelDrawingShape = cancelDrawingShape;
  ctx.addRotoPointToPath = addRotoPointToPath;
  ctx.startRotoRefinement = startRotoRefinement;
  ctx.commitRotoRefinement = commitRotoRefinement;
  ctx.setPreferences = setPreferences;
  ctx.hooks = { roto, paint, warp, bokeh, comfyCrop, spatial };

  // ── Get interaction from registry (swapped only when node type changes) ──
  const interactionRef = useRef<ViewportInteraction>(noopViewportInteraction);
  const prevTypeRef = useRef<string | null>(null);
  const nodeType = selectedNode?.type ?? null;

  if (nodeType !== prevTypeRef.current) {
    prevTypeRef.current = nodeType;
    const def = selectedNode ? nodeRegistry.get(selectedNode.type) : undefined;
    interactionRef.current = def?.createViewportInteraction?.(ctx) ?? noopViewportInteraction;
  }

  // ── Return ──────────────────────────────────────────────────────────
  return {
    interaction: interactionRef.current,
    ctxRef,
  };
}
