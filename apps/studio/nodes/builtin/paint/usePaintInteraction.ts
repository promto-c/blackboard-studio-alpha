import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnyNode,
  PaintBrushSettings,
  PaintNode,
  PaintStroke,
  PaintStrokePath,
  PaintTool,
  Point,
  ProjectColorManagement,
  SceneNode,
  ViewerSettings,
} from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import {
  buildPaintStrokeRaster,
  createPaintStrokePath,
  getNextPaintStrokeName,
  isPaintTool,
  isPaintViewportTool,
  savePaintStrokeRaster,
  type PaintLivePreview,
} from './paintRaster';
import { withSharedPaintSnapshotRenderer } from './paintSnapshotRenderer';
import { renderTargetToPaintCloneSource, type PaintCloneSource } from './paintFloatReadback';
import { createCloneOffset, getCloneSourceFromOffset } from './cloneMath';
import { resolvePaintLifetimePreset } from './paintLifetime';
import {
  getNextPaintStackOrder,
  getPaintCreationParentLayerId,
  isPaintStrokeActiveAtFrame,
  isPaintStrokeVisible,
} from './paintLayers';
import { mergePaintBrushSettings, resolvePaintSoftness } from './softness';
import { resolvePaintBrushChannels } from './channels';
import { colorManagementService, convertColorPickingToSceneLinear } from '@/color-management';

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

interface UsePaintInteractionParams {
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
  const [strokePoints, setStrokePoints] = useState<Point[] | null>(null);
  const strokeBufferRef = useRef<Point[] | null>(null);
  const strokePreviewFrameRef = useRef<number | null>(null);
  const strokeNodeRef = useRef<PaintNode | null>(null);
  const strokeToolRef = useRef<PaintTool | null>(null);
  const strokeCloneOffsetRef = useRef<Point | null>(null);
  const [isAdjustingBrushSize, setIsAdjustingBrushSize] = useState(false);
  const [clonePlacementDrag, setClonePlacementDrag] = useState<{
    source: Point;
    target: Point;
  } | null>(null);
  const [cloneOffsetByNodeId, setCloneOffsetByNodeId] = useState<Record<string, Point | null>>({});
  const [activeSourceSnapshot, setActiveSourceSnapshot] = useState<PaintCloneSource | null>(null);
  const sourceSnapshotPromiseRef = useRef<Promise<PaintCloneSource | null> | null>(null);
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
      const points = strokeBufferRef.current;
      if (points) setStrokePoints([...points]);
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
  const isPainting = Boolean(strokePoints?.length);
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
    sourceSnapshotPromiseRef.current = null;
    setActiveSourceSnapshot(null);
  }, []);

  const clearNudgePreview = useCallback(() => {
    setNudgePreviewPoints((current) => (current.length > 0 ? [] : current));
  }, []);

  // Brush size adjustment effect
  useEffect(() => {
    if (!isAdjustingBrushSize) return;

    const handleBrushAdjustMouseMove = (event: MouseEvent) => {
      const start = brushAdjustStartRef.current;
      if (!start) return;

      const nextSize = clampBrushSize(start.initialSize + (event.clientX - start.startX));
      if (nextSize === start.currentSize) return;

      start.currentSize = nextSize;
      setPreferences({
        paintBrush: mergePaintBrushSettings(start.brushBase, { size: nextSize }),
      });
    };

    const handleBrushAdjustMouseUp = () => {
      setIsAdjustingBrushSize(false);
      brushAdjustStartRef.current = null;
    };

    window.addEventListener('mousemove', handleBrushAdjustMouseMove);
    window.addEventListener('mouseup', handleBrushAdjustMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleBrushAdjustMouseMove);
      window.removeEventListener('mouseup', handleBrushAdjustMouseUp);
    };
  }, [isAdjustingBrushSize, setPreferences]);

  // Nudge radius adjustment effect
  useEffect(() => {
    if (!isAdjustingNudgeRadius) return;

    const handleNudgeRadiusMove = (event: MouseEvent) => {
      const start = nudgeRadiusAdjustStartRef.current;
      if (!start) return;
      const dx = event.clientX - start.startX;
      setPreferences({ nudgeRadius: Math.max(1, Math.min(500, start.initialRadius + dx)) });
    };

    const handleNudgeRadiusUp = () => {
      setIsAdjustingNudgeRadius(false);
      nudgeRadiusAdjustStartRef.current = null;
    };

    window.addEventListener('mousemove', handleNudgeRadiusMove);
    window.addEventListener('mouseup', handleNudgeRadiusUp);
    return () => {
      window.removeEventListener('mousemove', handleNudgeRadiusMove);
      window.removeEventListener('mouseup', handleNudgeRadiusUp);
    };
  }, [isAdjustingNudgeRadius, setPreferences]);

  const captureCloneSourceSnapshot = useCallback(
    async (node: PaintNode): Promise<PaintCloneSource | null> => {
      if (!sceneNode) return null;

      const paintNodeIndex = nodes.findIndex((candidate) => candidate.id === node.id);
      if (paintNodeIndex < 0) return null;

      const upstreamNodes = nodes.slice(0, paintNodeIndex);
      return withSharedPaintSnapshotRenderer(async (renderer) => {
        const { finalOutputTarget, dispose } = await renderWithSharedPipeline({
          captureFinalOutput: true,
          nodes: upstreamNodes,
          sceneNode,
          projectColorManagement,
          frame,
          width: sceneNode.width,
          height: sceneNode.height,
          finalColorSpace: 'scene_linear',
          presentToCanvas: false,
          textureCacheMode: 'persistent',
          renderer,
        });

        try {
          if (!finalOutputTarget) {
            throw new Error('Clone sampling requires a floating-point renderer capture.');
          }
          return renderTargetToPaintCloneSource(renderer, finalOutputTarget);
        } finally {
          dispose();
        }
      });
    },
    [frame, nodes, projectColorManagement, sceneNode],
  );

  const commitStroke = useCallback(
    async (
      node: PaintNode,
      tool: PaintTool,
      points: Point[],
      cloneOffset: Point | null,
      sourceSnapshot: PaintCloneSource | null,
    ) => {
      if (!sceneNode || points.length === 0) return;
      const latestNode =
        (latestNodesRef.current.find(
          (candidate) => candidate.id === node.id && candidate.type === NodeType.PAINT,
        ) as PaintNode | undefined) ?? node;
      const softness = resolvePaintSoftness(paintBrush);
      const strokeChannels = resolvePaintBrushChannels(paintBrush.channels, viewerChannels);
      const strokeRaster = buildPaintStrokeRaster({
        tool,
        points,
        width: sceneNode.width,
        height: sceneNode.height,
        size: paintBrush.size,
        spacing: paintBrush.spacing,
        softness,
        opacity: paintBrush.opacity,
        color: sceneLinearBrushColor,
        alpha: paintBrush.alpha,
        channels: strokeChannels,
        cloneOffset,
        cloneSource: sourceSnapshot,
      });
      if (!strokeRaster) return;
      const parentLayerId = getPaintCreationParentLayerId(latestNode, selectedPaintLayerIds);

      const stroke: PaintStroke = {
        id: `paint_stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: getNextPaintStrokeName(latestNode.strokes, tool),
        tool,
        visible: true,
        raster: '',
        path: createPaintStrokePath(points, paintBrush.size),
        pointCount: points.length,
        size: paintBrush.size,
        spacing: paintBrush.spacing,
        softness,
        opacity: paintBrush.opacity,
        color: tool === 'clone' ? undefined : paintBrush.color,
        alpha: strokeChannels === 'a' ? paintBrush.alpha : undefined,
        channels: strokeChannels,
        parentLayerId,
        stackOrder: getNextPaintStackOrder(),
        cloneOffset: tool === 'clone' ? cloneOffset : null,
        lifetime: resolvePaintLifetimePreset(latestNode.defaultLifetime, frame),
      };

      const raster = await savePaintStrokeRaster(strokeRaster).catch(() => '');
      if (!raster) return;

      const strokes = [{ ...stroke, raster }, ...latestNode.strokes];
      latestNodesRef.current = latestNodesRef.current.map((candidate) =>
        candidate.id === latestNode.id && candidate.type === NodeType.PAINT
          ? ({ ...candidate, strokes } as AnyNode)
          : candidate,
      );
      updateNode(latestNode.id, { strokes }, true);
    },
    [
      frame,
      paintBrush,
      sceneNode,
      sceneLinearBrushColor,
      selectedPaintLayerIds,
      updateNode,
      viewerChannels,
    ],
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
      strokeBufferRef.current = [scenePos];
      strokeNodeRef.current = paintNode;
      strokeToolRef.current = activePaintTool;
      strokeCloneOffsetRef.current = activePaintTool === 'clone' ? activeCloneOffset : null;
      setStrokePoints([scenePos]);
      if (activePaintTool === 'clone') {
        const nextSessionId = previewSessionRef.current + 1;
        previewSessionRef.current = nextSessionId;
        const snapshotPromise = captureCloneSourceSnapshot(paintNode);
        sourceSnapshotPromiseRef.current = snapshotPromise;
        void snapshotPromise
          .then((snapshot) => {
            if (previewSessionRef.current !== nextSessionId) return;
            setActiveSourceSnapshot(snapshot);
          })
          .catch(() => {
            if (previewSessionRef.current !== nextSessionId) return;
            setActiveSourceSnapshot(null);
          });
      } else {
        sourceSnapshotPromiseRef.current = Promise.resolve<PaintCloneSource | null>(null);
      }
      return true;
    },
    [
      activeCloneOffset,
      activePaintTool,
      activeViewportTool,
      captureCloneSourceSnapshot,
      clearActiveStrokePreview,
      clearNudgePreview,
      frame,
      nudgeRadius,
      nodes,
      paintBrush,
      paintNode,
      selectedNodeId,
      selectedPaintStrokeIds,
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

      const buffer = strokeBufferRef.current;
      if (!buffer) return false;

      const lastPoint = buffer[buffer.length - 1];
      const stampSpacing = paintBrush.size * (paintBrush.spacing / 100);
      const minDistance = Math.max(0.5, Math.min(stampSpacing * 0.5, paintBrush.size * 0.25));
      if (getDistance(lastPoint, scenePos) < minDistance) {
        return true;
      }

      const nextPoints = [...buffer, scenePos];
      strokeBufferRef.current = nextPoints;
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
      paintBrush.size,
      paintBrush.spacing,
      paintNode,
      selectedPaintStrokeIds,
      scheduleStrokePreview,
      updateNode,
      zoom,
    ],
  );

  const finishStroke = useCallback(async (): Promise<boolean> => {
    const buffer = strokeBufferRef.current;
    const strokeNode = strokeNodeRef.current;
    const strokeTool = strokeToolRef.current;
    if (!strokeNode || !strokeTool || !buffer || buffer.length === 0) {
      cancelPendingStrokePreview();
      strokeBufferRef.current = null;
      strokeNodeRef.current = null;
      strokeToolRef.current = null;
      strokeCloneOffsetRef.current = null;
      setStrokePoints(null);
      clearActiveStrokePreview();
      return false;
    }

    const points = buffer;
    cancelPendingStrokePreview();
    const snapshotPromise = sourceSnapshotPromiseRef.current;
    const strokeCloneOffset = strokeCloneOffsetRef.current;
    strokeBufferRef.current = null;
    strokeNodeRef.current = null;
    strokeToolRef.current = null;
    strokeCloneOffsetRef.current = null;
    setStrokePoints(null);
    clearActiveStrokePreview();
    const snapshot = snapshotPromise ? await snapshotPromise : null;
    await commitStroke(strokeNode, strokeTool, points, strokeCloneOffset, snapshot);
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
      void finishStroke();
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
      void finishStroke();
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
        strokeBufferRef.current = null;
        strokeNodeRef.current = null;
        strokeToolRef.current = null;
        strokeCloneOffsetRef.current = null;
        setStrokePoints(null);
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
    if (!paintNode || !activePaintTool || !strokePoints || strokePoints.length === 0) {
      return null;
    }

    const softness = resolvePaintSoftness(paintBrush);
    const parentLayerId = getPaintCreationParentLayerId(paintNode, selectedPaintLayerIds);
    const previewLifetime = resolvePaintLifetimePreset(paintNode.defaultLifetime, frame);
    const previewStroke: PaintStroke = {
      id: '__paint_preview__',
      name: 'Preview',
      tool: activePaintTool,
      visible: true,
      raster: '',
      path: null,
      pointCount: strokePoints.length,
      size: paintBrush.size,
      spacing: paintBrush.spacing,
      softness,
      opacity: paintBrush.opacity,
      color: activePaintTool === 'clone' ? undefined : paintBrush.color,
      alpha: resolvedPaintChannels === 'a' ? paintBrush.alpha : undefined,
      channels: resolvedPaintChannels,
      parentLayerId,
      cloneOffset: activeCloneOffset,
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
      cacheKey: `${activePaintTool}:${paintBrush.channels}:${resolvedPaintChannels}:${paintBrush.alpha}:${paintBrush.spacing}:${strokePoints.length}`,
      cursor: strokePoints.length,
      tool: activePaintTool,
      points: strokePoints,
      size: paintBrush.size,
      spacing: paintBrush.spacing,
      softness,
      opacity: paintBrush.opacity,
      color: sceneLinearBrushColor,
      alpha: paintBrush.alpha,
      channels: resolvedPaintChannels,
      cloneOffset: activeCloneOffset,
      cloneSource: activePaintTool === 'clone' ? activeSourceSnapshot : null,
    };
  }, [
    activeCloneOffset,
    activePaintTool,
    activeSourceSnapshot,
    frame,
    paintBrush,
    paintNode,
    resolvedPaintChannels,
    sceneLinearBrushColor,
    selectedPaintLayerIds,
    strokePoints,
  ]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    cleanupOnToolChange,
    shouldForceOverlays,
    cursorScenePos,
    strokePoints,
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
