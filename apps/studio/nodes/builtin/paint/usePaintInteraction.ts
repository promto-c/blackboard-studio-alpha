import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDragAdjustment } from '@/hooks/useWindowDragAdjustment';
import type {
  AnyNode,
  PaintBrushSettings,
  PaintNode,
  PaintStroke,
  PaintStrokeChannels,
  PaintStrokePath,
  PaintTool,
  Point,
  ProjectColorManagement,
  SceneNode,
  ViewerSettings,
} from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import {
  getNextPaintStrokeName,
  isPaintTool,
  isPaintViewportTool,
  type PaintLivePreview,
} from './paintModel';
import { PaintStrokeSession } from './paintStrokeSession';
import { clearPaintLivePreview, setPaintLivePreview } from './paintRuntime';
import { createCloneOffset, getCloneSourceFromOffset } from './cloneMath';
import { resolvePaintLifetimePreset } from './paintLifetime';
import {
  getNextPaintStackOrder,
  getPaintCreationParentLayerId,
  isPaintStrokeActiveAtFrame,
  isPaintStrokeVisible,
} from './paintLayers';
import { mergePaintBrushSettings } from './softness';
import { resolvePaintBrushChannels } from './channels';
import { colorManagementService, convertColorPickingToSceneLinear } from '@/color-management';

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

export interface UsePaintInteractionParams {
  nodes: AnyNode[];
  selectedNode: AnyNode | undefined;
  selectedNodeId: string | null;
  selectedPaintLayerIds: string[];
  selectedPaintStrokeIds: string[];
  setHierarchySelection: (nodeId: string, layerIds: string[], itemIds: string[]) => void;
  activeViewportTool: string | null;
  sceneNode: SceneNode | undefined;
  projectColorManagement: ProjectColorManagement;
  frame: number;
  zoom: number;
  paintBrush: PaintBrushSettings;
  viewerChannels: ViewerSettings['channels'];
  nudgeRadius: number;
  updateNode: (nodeId: string, changes: Record<string, unknown>, pushHistory?: boolean) => void;
  commitMutation: CommitEditorMutation;
  setPreferences: (prefs: Partial<{ nudgeRadius: number; paintBrush: PaintBrushSettings }>) => void;
}

interface PaintNudgeAffectedStroke {
  originalPath: PaintStrokePath;
  affectedIndexMap: Map<number, number>;
}

interface ActivePaintStrokeStyle {
  brush: PaintBrushSettings;
  color: [number, number, number];
  channels: PaintStrokeChannels;
}

export interface PaintNudgeDragState {
  startScenePos: Point;
  affectedStrokeMap: Map<string, PaintNudgeAffectedStroke>;
}

export interface PaintNudgePreviewPoint {
  strokeId: string;
  pointIndex: number;
  point: Point;
  weight: number;
}

const getDistance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const clampBrushSize = (size: number): number => Math.max(1, Math.min(256, size));

export function usePaintInteraction({
  nodes,
  selectedNode,
  selectedNodeId,
  selectedPaintLayerIds,
  selectedPaintStrokeIds,
  setHierarchySelection,
  activeViewportTool,
  sceneNode,
  projectColorManagement,
  frame,
  zoom,
  paintBrush,
  viewerChannels,
  nudgeRadius,
  updateNode,
  commitMutation,
  setPreferences,
}: UsePaintInteractionParams) {
  const [cursorScenePos, setCursorScenePos] = useState<Point | null>(null);
  const projectColorManagementRoles = useMemo(
    () => colorManagementService.resolveProjectColorManagement(projectColorManagement),
    [projectColorManagement],
  );
  const [strokePath, setStrokePath] = useState<PaintStrokePath | null>(null);
  const strokeSessionRef = useRef<PaintStrokeSession | null>(null);
  const strokePreviewFrameRef = useRef<number | null>(null);
  const strokeNodeRef = useRef<PaintNode | null>(null);
  const strokeToolRef = useRef<PaintTool | null>(null);
  const strokeCloneOffsetRef = useRef<Point | null>(null);
  const strokeStyleRef = useRef<ActivePaintStrokeStyle | null>(null);
  const [isAdjustingBrushSize, setIsAdjustingBrushSize] = useState(false);
  const [clonePlacementDrag, setClonePlacementDrag] = useState<{
    source: Point;
    target: Point;
  } | null>(null);
  const [cloneOffsetByNodeId, setCloneOffsetByNodeId] = useState<Record<string, Point | null>>({});
  const previewSessionRef = useRef(0);

  const cancelPendingStrokePreview = useCallback(() => {
    if (strokePreviewFrameRef.current === null) return;
    cancelAnimationFrame(strokePreviewFrameRef.current);
    strokePreviewFrameRef.current = null;
  }, []);

  const scheduleStrokePreview = useCallback(() => {
    if (strokePreviewFrameRef.current !== null) return;
    strokePreviewFrameRef.current = requestAnimationFrame(() => {
      strokePreviewFrameRef.current = null;
      const session = strokeSessionRef.current;
      if (session) setStrokePath(session.getPath());
    });
  }, []);

  useEffect(() => cancelPendingStrokePreview, [cancelPendingStrokePreview]);
  const brushAdjustStartRef = useRef<{
    startX: number;
    initialSize: number;
    currentSize: number;
    center: Point;
    brushBase: PaintBrushSettings;
  } | null>(null);
  const sceneLinearBrushColor = useMemo(
    () =>
      sceneNode
        ? convertColorPickingToSceneLinear(paintBrush.color, {
            colorPickingColorSpace: projectColorManagementRoles.colorPickingColorSpace,
            workingColorSpace: projectColorManagementRoles.workingColorSpace,
            context: projectColorManagementRoles.context,
          })
        : paintBrush.color,
    [paintBrush.color, projectColorManagementRoles, sceneNode],
  );

  // Nudge state
  const [nudgeDragState, setNudgeDragState] = useState<PaintNudgeDragState | null>(null);
  const [nudgePreviewPoints, setNudgePreviewPoints] = useState<PaintNudgePreviewPoint[]>([]);
  const [isAdjustingNudgeRadius, setIsAdjustingNudgeRadius] = useState(false);
  const nudgeRadiusAdjustStartRef = useRef<{
    startX: number;
    initialRadius: number;
    center: Point;
  } | null>(null);
  const nudgeHistoryStartRef = useRef<{
    nodes: AnyNode[];
    selectedNodeId: string | null;
  } | null>(null);
  const latestNodesRef = useRef(nodes);

  latestNodesRef.current = nodes;

  const paintNode = selectedNode?.type === NodeType.PAINT ? (selectedNode as PaintNode) : null;
  const activePaintTool = isPaintTool(activeViewportTool) ? activeViewportTool : null;
  const isActiveViewportPaintTool = isPaintViewportTool(activeViewportTool);
  const isPainting = Boolean(strokePath?.points.length);
  const isSettingCloneSource = clonePlacementDrag !== null;
  const activeCloneOffset = useMemo(
    () => (paintNode ? (cloneOffsetByNodeId[paintNode.id] ?? null) : null),
    [cloneOffsetByNodeId, paintNode],
  );
  const resolvedPaintChannels = useMemo(
    () => resolvePaintBrushChannels(paintBrush.channels, viewerChannels),
    [paintBrush.channels, viewerChannels],
  );

  const clearActiveStrokePreview = useCallback(() => {
    previewSessionRef.current += 1;
  }, []);

  const clearNudgePreview = useCallback(() => {
    setNudgePreviewPoints((current) => (current.length > 0 ? [] : current));
  }, []);

  // Brush size adjustment effect
  useWindowDragAdjustment(isAdjustingBrushSize, {
    onMouseMove: (event: MouseEvent) => {
      const start = brushAdjustStartRef.current;
      if (!start) return;

      const nextSize = clampBrushSize(start.initialSize + (event.clientX - start.startX));
      if (nextSize === start.currentSize) return;

      start.currentSize = nextSize;
      setPreferences({
        paintBrush: mergePaintBrushSettings(start.brushBase, { size: nextSize }),
      });
    },
    onMouseUp: () => {
      setIsAdjustingBrushSize(false);
      brushAdjustStartRef.current = null;
    },
  });

  // Nudge radius adjustment effect
  useWindowDragAdjustment(isAdjustingNudgeRadius, {
    onMouseMove: (event: MouseEvent) => {
      const start = nudgeRadiusAdjustStartRef.current;
      if (!start) return;
      const dx = event.clientX - start.startX;
      setPreferences({ nudgeRadius: Math.max(1, Math.min(500, start.initialRadius + dx)) });
    },
    onMouseUp: () => {
      setIsAdjustingNudgeRadius(false);
      nudgeRadiusAdjustStartRef.current = null;
    },
  });

  const commitStroke = useCallback(
    (
      node: PaintNode,
      tool: PaintTool,
      path: PaintStrokePath,
      cloneOffset: Point | null,
      style: ActivePaintStrokeStyle,
    ) => {
      if (!sceneNode || path.points.length === 0) return;
      const latestNode =
        (latestNodesRef.current.find(
          (candidate) => candidate.id === node.id && candidate.type === NodeType.PAINT,
        ) as PaintNode | undefined) ?? node;
      const parentLayerId = getPaintCreationParentLayerId(latestNode, selectedPaintLayerIds);

      const stroke: PaintStroke = {
        id: `paint_stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: getNextPaintStrokeName(latestNode.strokes, tool),
        tool,
        visible: true,
        path,
        size: style.brush.size,
        spacing: style.brush.spacing,
        softness: style.brush.softness,
        opacity: style.brush.opacity,
        color: tool === 'clone' ? undefined : style.color,
        alpha: style.channels === 'a' ? style.brush.alpha : undefined,
        channels: style.channels,
        parentLayerId,
        stackOrder: getNextPaintStackOrder(),
        cloneOffset: tool === 'clone' ? cloneOffset : null,
        lifetime: resolvePaintLifetimePreset(latestNode.defaultLifetime, frame),
      };
      const strokes = [stroke, ...latestNode.strokes];
      latestNodesRef.current = latestNodesRef.current.map((candidate) =>
        candidate.id === latestNode.id && candidate.type === NodeType.PAINT
          ? ({ ...candidate, strokes } as AnyNode)
          : candidate,
      );
      updateNode(latestNode.id, { strokes }, true);
    },
    [frame, sceneNode, selectedPaintLayerIds, updateNode],
  );

  const finishNudgeDrag = useCallback((): boolean => {
    if (!nudgeDragState) {
      nudgeHistoryStartRef.current = null;
      clearNudgePreview();
      return false;
    }

    if (nudgeHistoryStartRef.current) {
      commitMutation({
        patch: {},
        history: { label: 'Nudge Paint Stroke', state: nudgeHistoryStartRef.current },
      });
    }

    nudgeHistoryStartRef.current = null;
    clearNudgePreview();
    setNudgeDragState(null);
    return true;
  }, [clearNudgePreview, nudgeDragState, commitMutation]);

  const finishClonePlacement = useCallback((): boolean => {
    if (!paintNode || !clonePlacementDrag) {
      setClonePlacementDrag(null);
      return false;
    }

    if (getDistance(clonePlacementDrag.source, clonePlacementDrag.target) < 0.5) {
      setClonePlacementDrag(null);
      return true;
    }

    const nextCloneOffset = createCloneOffset(clonePlacementDrag.source, clonePlacementDrag.target);
    setClonePlacementDrag(null);
    setCloneOffsetByNodeId((current) => ({
      ...current,
      [paintNode.id]: nextCloneOffset,
    }));
    return true;
  }, [clonePlacementDrag, paintNode]);

  const handleMouseDown = useCallback(
    (
      event: React.MouseEvent<HTMLDivElement>,
      _mousePos: { x: number; y: number },
      scenePos: Point,
    ): boolean => {
      if (event.button !== 0 || !paintNode) return false;

      // Select tool — stroke clicks are handled by PaintOverlay (stopPropagation prevents
      // this handler from firing). Empty-space clicks reach here and clear the selection.
      if (activeViewportTool === 'select') {
        setCursorScenePos(scenePos);
        clearNudgePreview();
        setHierarchySelection(selectedNodeId ?? '', [], []);
        return true;
      }

      // Nudge tool
      if (activeViewportTool === 'nudge') {
        event.preventDefault();
        setCursorScenePos(scenePos);

        if (event.ctrlKey || event.metaKey) {
          clearNudgePreview();
          setIsAdjustingNudgeRadius(true);
          nudgeRadiusAdjustStartRef.current = {
            startX: event.clientX,
            initialRadius: nudgeRadius,
            center: scenePos,
          };
          return true;
        }

        // Gather affected points from selected strokes
        const nudgeRadiusScene = nudgeRadius / zoom;
        const selectedStrokeIdSet = new Set(selectedPaintStrokeIds);
        const affectedStrokeMap = new Map<string, PaintNudgeAffectedStroke>();

        for (const stroke of paintNode.strokes) {
          if (!selectedStrokeIdSet.has(stroke.id)) continue;
          if (!stroke.path || stroke.path.points.length === 0) continue;
          if (!isPaintStrokeVisible(paintNode, stroke)) continue;
          if (!isPaintStrokeActiveAtFrame(paintNode, stroke, frame)) continue;

          const affectedIndexMap = new Map<number, number>();
          for (let i = 0; i < stroke.path.points.length; i++) {
            const pt = stroke.path.points[i];
            const dist = Math.hypot(pt.x - scenePos.x, pt.y - scenePos.y);
            if (dist < nudgeRadiusScene) {
              affectedIndexMap.set(i, dist);
            }
          }
          if (affectedIndexMap.size > 0) {
            affectedStrokeMap.set(stroke.id, {
              originalPath: {
                mode: stroke.path.mode,
                points: stroke.path.points.map((p) => ({ ...p })),
              },
              affectedIndexMap,
            });
          }
        }

        if (affectedStrokeMap.size > 0) {
          nudgeHistoryStartRef.current = {
            nodes,
            selectedNodeId,
          };
          clearNudgePreview();
          setNudgeDragState({ startScenePos: scenePos, affectedStrokeMap });
        } else {
          nudgeHistoryStartRef.current = null;
        }
        return true;
      }

      if (!activePaintTool) return false;

      if (activePaintTool === 'clone' && event.shiftKey) {
        event.preventDefault();
        setCursorScenePos(scenePos);
        setClonePlacementDrag({
          source: scenePos,
          target: scenePos,
        });
        return true;
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setCursorScenePos(scenePos);
        setIsAdjustingBrushSize(true);
        brushAdjustStartRef.current = {
          startX: event.clientX,
          initialSize: paintBrush.size,
          currentSize: paintBrush.size,
          center: scenePos,
          brushBase: mergePaintBrushSettings(paintBrush, {}),
        };
        return true;
      }

      if (activePaintTool === 'clone' && !activeCloneOffset) {
        event.preventDefault();
        return true;
      }

      event.preventDefault();
      clearActiveStrokePreview();
      setCursorScenePos(scenePos);
      const strokeSession = new PaintStrokeSession(scenePos, event.timeStamp, {
        brushSize: paintBrush.size,
        stabilization: paintBrush.stabilization,
      });
      strokeSessionRef.current = strokeSession;
      strokeStyleRef.current = {
        brush: mergePaintBrushSettings(paintBrush, {}),
        color: [...sceneLinearBrushColor],
        channels: resolvedPaintChannels,
      };
      strokeNodeRef.current = paintNode;
      strokeToolRef.current = activePaintTool;
      strokeCloneOffsetRef.current = activePaintTool === 'clone' ? activeCloneOffset : null;
      setStrokePath(strokeSession.getPath());
      previewSessionRef.current += 1;
      return true;
    },
    [
      activeCloneOffset,
      activePaintTool,
      activeViewportTool,
      clearActiveStrokePreview,
      clearNudgePreview,
      frame,
      nudgeRadius,
      nodes,
      paintBrush,
      paintNode,
      selectedNodeId,
      selectedPaintStrokeIds,
      resolvedPaintChannels,
      sceneLinearBrushColor,
      setHierarchySelection,
      zoom,
    ],
  );

  const handleMouseMove = useCallback(
    (event: ViewportMouseEvent, _mousePos: { x: number; y: number }, scenePos: Point): boolean => {
      if (!paintNode || !isActiveViewportPaintTool) {
        setCursorScenePos(null);
        clearNudgePreview();
        return false;
      }

      // Select tool — just track cursor for overlay
      if (activeViewportTool === 'select') {
        setCursorScenePos(scenePos);
        clearNudgePreview();
        return false;
      }

      // Nudge tool
      if (activeViewportTool === 'nudge') {
        setCursorScenePos(scenePos);

        if (isAdjustingNudgeRadius) {
          clearNudgePreview();
          event.preventDefault();
          return true;
        }

        // Active nudge drag
        if (nudgeDragState) {
          clearNudgePreview();
          event.preventDefault();
          const delta = {
            x: scenePos.x - nudgeDragState.startScenePos.x,
            y: scenePos.y - nudgeDragState.startScenePos.y,
          };
          const nudgeRadiusScene = nudgeRadius / zoom;

          const updatedStrokes = paintNode.strokes.map((stroke) => {
            const affected = nudgeDragState.affectedStrokeMap.get(stroke.id);
            if (!affected || !stroke.path) return stroke;

            const newPoints = affected.originalPath.points.map((pt, index) => {
              const dist = affected.affectedIndexMap.get(index);
              if (dist == null) return pt;
              const weight = event.shiftKey
                ? 1.0
                : 1.0 - Math.min(1.0, Math.max(0.0, dist / nudgeRadiusScene));
              return {
                x: pt.x + delta.x * weight,
                y: pt.y + delta.y * weight,
              };
            });
            return { ...stroke, path: { ...stroke.path, points: newPoints } };
          });

          updateNode(paintNode.id, { strokes: updatedStrokes }, false);
          return true;
        }

        // Passive nudge preview
        const nudgeRadiusScene = nudgeRadius / zoom;
        const selectedStrokeIdSet = new Set(selectedPaintStrokeIds);
        const previewPoints: PaintNudgePreviewPoint[] = [];
        for (const stroke of paintNode.strokes) {
          if (!selectedStrokeIdSet.has(stroke.id)) continue;
          if (!stroke.path || stroke.path.points.length === 0) continue;
          if (!isPaintStrokeVisible(paintNode, stroke)) continue;
          if (!isPaintStrokeActiveAtFrame(paintNode, stroke, frame)) continue;

          for (let i = 0; i < stroke.path.points.length; i++) {
            const pt = stroke.path.points[i];
            const dist = Math.hypot(pt.x - scenePos.x, pt.y - scenePos.y);
            if (dist < nudgeRadiusScene) {
              const w = event.shiftKey ? 1.0 : 1.0 - dist / nudgeRadiusScene;
              previewPoints.push({
                strokeId: stroke.id,
                pointIndex: i,
                point: pt,
                weight: w * w,
              });
            }
          }
        }
        setNudgePreviewPoints(previewPoints);
        return false;
      }

      clearNudgePreview();

      if (clonePlacementDrag) {
        event.preventDefault();
        setCursorScenePos(scenePos);
        setClonePlacementDrag((previous) =>
          previous
            ? {
                ...previous,
                target: scenePos,
              }
            : previous,
        );
        return true;
      }

      if (isAdjustingBrushSize) {
        event.preventDefault();
        return true;
      }

      setCursorScenePos(scenePos);

      const strokeSession = strokeSessionRef.current;
      if (!strokeSession) return false;
      strokeSession.add(scenePos, event.timeStamp);
      scheduleStrokePreview();
      return true;
    },
    [
      activeViewportTool,
      clonePlacementDrag,
      clearNudgePreview,
      frame,
      isActiveViewportPaintTool,
      isAdjustingBrushSize,
      isAdjustingNudgeRadius,
      nudgeDragState,
      nudgeRadius,
      paintNode,
      selectedPaintStrokeIds,
      scheduleStrokePreview,
      updateNode,
      zoom,
    ],
  );

  const finishStroke = useCallback((): boolean => {
    const strokeSession = strokeSessionRef.current;
    const strokeNode = strokeNodeRef.current;
    const strokeTool = strokeToolRef.current;
    const strokeStyle = strokeStyleRef.current;
    if (!strokeNode || !strokeTool || !strokeSession || !strokeStyle) {
      cancelPendingStrokePreview();
      strokeSessionRef.current = null;
      strokeNodeRef.current = null;
      strokeToolRef.current = null;
      strokeCloneOffsetRef.current = null;
      strokeStyleRef.current = null;
      setStrokePath(null);
      clearActiveStrokePreview();
      return false;
    }

    const path = strokeSession.finish();
    cancelPendingStrokePreview();
    const strokeCloneOffset = strokeCloneOffsetRef.current;
    strokeSessionRef.current = null;
    strokeNodeRef.current = null;
    strokeToolRef.current = null;
    strokeCloneOffsetRef.current = null;
    strokeStyleRef.current = null;
    setStrokePath(null);
    clearActiveStrokePreview();
    commitStroke(strokeNode, strokeTool, path, strokeCloneOffset, strokeStyle);
    return true;
  }, [cancelPendingStrokePreview, clearActiveStrokePreview, commitStroke]);

  const handleMouseUp = useCallback(
    (_event?: ViewportMouseEvent): boolean => {
      // Nudge drag end
      if (nudgeDragState) {
        return finishNudgeDrag();
      }

      if (isAdjustingNudgeRadius) {
        return true;
      }

      if (isSettingCloneSource) {
        return finishClonePlacement();
      }
      if (isAdjustingBrushSize) {
        return true;
      }
      finishStroke();
      return isPainting;
    },
    [
      finishClonePlacement,
      finishStroke,
      finishNudgeDrag,
      isAdjustingBrushSize,
      isAdjustingNudgeRadius,
      isPainting,
      isSettingCloneSource,
      nudgeDragState,
    ],
  );

  const handleMouseLeave = useCallback(() => {
    if (!isAdjustingBrushSize && !isAdjustingNudgeRadius) {
      setCursorScenePos(null);
      clearNudgePreview();
    }
    if (nudgeDragState) {
      finishNudgeDrag();
      return;
    }
    if (isSettingCloneSource) {
      finishClonePlacement();
      return;
    }
    if (isPainting) {
      finishStroke();
    }
  }, [
    finishClonePlacement,
    finishStroke,
    finishNudgeDrag,
    clearNudgePreview,
    isAdjustingBrushSize,
    isAdjustingNudgeRadius,
    isPainting,
    isSettingCloneSource,
    nudgeDragState,
  ]);

  const cleanupOnToolChange = useCallback(
    (previousTool: string | null) => {
      if (!isActiveViewportPaintTool) {
        cancelPendingStrokePreview();
        strokeSessionRef.current = null;
        strokeNodeRef.current = null;
        strokeToolRef.current = null;
        strokeCloneOffsetRef.current = null;
        strokeStyleRef.current = null;
        setStrokePath(null);
        setIsAdjustingBrushSize(false);
        setClonePlacementDrag(null);
        clearActiveStrokePreview();
        brushAdjustStartRef.current = null;
        if (nudgeDragState) {
          finishNudgeDrag();
        } else {
          nudgeHistoryStartRef.current = null;
          setNudgeDragState(null);
          clearNudgePreview();
        }
        setIsAdjustingNudgeRadius(false);
        nudgeRadiusAdjustStartRef.current = null;
        return;
      }

      if (previousTool === 'nudge' && activeViewportTool !== 'nudge') {
        if (nudgeDragState) {
          finishNudgeDrag();
        } else {
          nudgeHistoryStartRef.current = null;
          setNudgeDragState(null);
          clearNudgePreview();
        }
      }
    },
    [
      activeViewportTool,
      clearActiveStrokePreview,
      cancelPendingStrokePreview,
      clearNudgePreview,
      finishNudgeDrag,
      isActiveViewportPaintTool,
      nudgeDragState,
    ],
  );

  const cloneSourcePreviewPos = useMemo(() => {
    if (activePaintTool !== 'clone' || !paintNode) return null;
    if (clonePlacementDrag) {
      return clonePlacementDrag.source;
    }
    return cursorScenePos ? getCloneSourceFromOffset(cursorScenePos, activeCloneOffset) : null;
  }, [activeCloneOffset, activePaintTool, clonePlacementDrag, cursorScenePos, paintNode]);

  const shouldForceOverlays = useMemo(
    () =>
      Boolean(
        paintNode &&
        isActiveViewportPaintTool &&
        (isPainting ||
          isAdjustingBrushSize ||
          isSettingCloneSource ||
          isAdjustingNudgeRadius ||
          nudgeDragState ||
          cursorScenePos),
      ),
    [
      cursorScenePos,
      isActiveViewportPaintTool,
      isAdjustingBrushSize,
      isAdjustingNudgeRadius,
      isPainting,
      isSettingCloneSource,
      nudgeDragState,
      paintNode,
    ],
  );

  const livePreview = useMemo<PaintLivePreview | null>(() => {
    const style = strokeStyleRef.current;
    if (!paintNode || !activePaintTool || !strokePath || strokePath.points.length === 0 || !style) {
      return null;
    }

    const parentLayerId = getPaintCreationParentLayerId(paintNode, selectedPaintLayerIds);
    const previewLifetime = resolvePaintLifetimePreset(paintNode.defaultLifetime, frame);
    const previewStroke: PaintStroke = {
      id: '__paint_preview__',
      name: 'Preview',
      tool: activePaintTool,
      visible: true,
      path: strokePath,
      size: style.brush.size,
      spacing: style.brush.spacing,
      softness: style.brush.softness,
      opacity: style.brush.opacity,
      color: activePaintTool === 'clone' ? undefined : style.color,
      alpha: style.channels === 'a' ? style.brush.alpha : undefined,
      channels: style.channels,
      parentLayerId,
      cloneOffset: strokeCloneOffsetRef.current,
      lifetime: previewLifetime,
    };

    if (
      !isPaintStrokeVisible(paintNode, previewStroke) ||
      !isPaintStrokeActiveAtFrame(paintNode, previewStroke, frame)
    ) {
      return null;
    }

    return {
      nodeId: paintNode.id,
      sessionId: previewSessionRef.current,
      tool: activePaintTool,
      path: previewStroke.path,
      size: style.brush.size,
      spacing: style.brush.spacing,
      softness: style.brush.softness,
      opacity: style.brush.opacity,
      color: style.color,
      alpha: style.brush.alpha,
      channels: style.channels,
      cloneOffset: strokeCloneOffsetRef.current,
    };
  }, [activePaintTool, frame, paintNode, selectedPaintLayerIds, strokePath]);

  useEffect(() => {
    setPaintLivePreview(livePreview);
    return () => clearPaintLivePreview(livePreview?.nodeId);
  }, [livePreview]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    cleanupOnToolChange,
    shouldForceOverlays,
    cursorScenePos,
    strokePoints: strokePath?.points ?? null,
    isPainting,
    isAdjustingBrushSize,
    isSettingCloneSource,
    cloneSourcePreviewPos,
    brushAdjustStartRef,
    livePreview,
    // Nudge
    nudgeDragState,
    nudgePreviewPoints,
    isAdjustingNudgeRadius,
    nudgeRadiusAdjustStartRef,
  };
}
