/**
 * useRotoInteraction — Encapsulates all roto-tool viewport interaction state
 * and mouse handlers, extracted from Viewport.tsx (Phase 2).
 *
 * Owns:
 *  - All roto-specific useState / useRef declarations
 *  - handlePointMouseDown, beginRotoTransformDrag
 *  - Roto sections of handleMouseDown / handleMouseMove / handleMouseUp / handleMouseLeave
 *  - bsplineDrawingState, rotoTransformSelection, and related derived state
 *  - isAdjustingRadius window-level drag effect
 *  - Tool-change cleanup for roto tools
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  NodeType,
  type AnyNode,
  type RotoNode,
  type RotoPath,
  type RotoPointRef,
  type RotoPointType,
  type RotoPointWeightMode,
  RotoPathBlend,
  RotoShapeType,
  RotoDrawMode,
  type AnimatableNumber,
  type RotoRefinement,
} from '@blackboard/types';
import { getLinearValueAtFrame, hasKeyframeAt, setKeyframeOnValue } from '@blackboard/renderer';
import { generateBSplineSegments } from '@/utils/bspline';
import { removeRotoPointTypes, setRotoPointTypes } from '@/utils/rotoPointTypes';
import {
  DEFAULT_ROTO_POINT_WEIGHT,
  ROTO_POINT_WEIGHT_HANDLE_STEP_PX,
  getNormalizedRotoPointWeights,
  materializeRotoPointWeightModes,
  removeRotoPointWeightModes,
  removeRotoPointWeights,
  setRotoPointWeightModes,
  updateRotoPointWeights,
} from '@/utils/rotoPointWeights';
import {
  getRotoCreationParentLayerId,
  isRotoPathVisible,
  prependRotoPath,
} from '@/utils/rotoHierarchy';
import { createRotoRectanglePath, getRotoRectangleCornerPoints } from '@/utils/rotoPathFactory';
import {
  applyRotoTrackingMatrix4ToPoint,
  projectScenePointToRotoLayerLocal,
  projectScenePointToRotoPathBasePoint,
  resolveRotoPathCompositeMatrix,
  resolveRotoPathPointsAtFrame,
  resolveRotoPathTrackOffsetAtFrame,
} from '@/utils/rotoTracking';
import {
  applyRotoTransform,
  getRotoTransformBounds,
  getTransformHandlePosition,
  isTransformBoundsDegenerate,
  getTransformOperationForHandle,
  getTransformOperationLabel,
  type ScenePoint,
  type TransformHandleKind,
  type TransformOperation,
} from '@/utils/rotoTransform';
import type {
  NudgeAffectedPath,
  NudgePreviewPoint,
  RotoTemporalControllerState,
  RotoTemporalControllerValue,
  RotoTransformTargetRef,
  RotoTransformSelection,
  RotoTransformDragState,
} from '@/features/viewport/viewportOverlayTypes';

// Re-export so Viewport can reference without separate import
export type { RotoTransformSelection, RotoTransformDragState };

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

const getRotoPointRefKey = ({ pathId, pointIndex }: RotoPointRef): string =>
  `${pathId}:${pointIndex}`;

const dedupeRotoPointRefs = (pointRefs: readonly RotoPointRef[]): RotoPointRef[] => {
  const seen = new Set<string>();
  const deduped: RotoPointRef[] = [];
  pointRefs.forEach((pointRef) => {
    const key = getRotoPointRefKey(pointRef);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(pointRef);
  });
  return deduped;
};

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const getAnimatableKeyframeFrames = (value: AnimatableNumber): number[] =>
  Array.isArray(value) ? value.map((keyframe) => keyframe.frame) : [];

const getRotoTemporalTargetPointIndices = (
  path: RotoPath,
  selectedPointRefsByPath: Map<string, RotoPointRef[]>,
  hasPointSelection: boolean,
): number[] => {
  if (hasPointSelection) {
    return dedupeRotoPointRefs(selectedPointRefsByPath.get(path.id) ?? [])
      .map((pointRef) => pointRef.pointIndex)
      .filter((pointIndex) => pointIndex >= 0 && pointIndex < path.points.length);
  }

  return path.points.map((_point, pointIndex) => pointIndex);
};

const collectRotoTemporalKeyframeFrames = (
  paths: { path: RotoPath; pointIndices: number[] }[],
): { frames: number[]; hasCurrentKeyframeAt: (frame: number) => boolean } => {
  const frames = new Set<number>();

  paths.forEach(({ path, pointIndices }) => {
    pointIndices.forEach((pointIndex) => {
      const point = path.points[pointIndex];
      if (!point) return;
      getAnimatableKeyframeFrames(point.x).forEach((frame) => frames.add(frame));
      getAnimatableKeyframeFrames(point.y).forEach((frame) => frames.add(frame));
    });
  });

  return {
    frames: Array.from(frames).sort((a, b) => a - b),
    hasCurrentKeyframeAt: (frame: number) => frames.has(frame),
  };
};

type RotoTemporalSampleRange = {
  prevFrame: number;
  nextFrame: number;
};

const getRotoTemporalGeometryValue = (
  value: AnimatableNumber,
  frame: number,
  sampleRange?: RotoTemporalSampleRange,
): number => {
  if (!sampleRange || sampleRange.nextFrame <= sampleRange.prevFrame) {
    return getLinearValueAtFrame(value, frame);
  }

  const rangeValue = clampUnit(
    (frame - sampleRange.prevFrame) / (sampleRange.nextFrame - sampleRange.prevFrame),
  );
  const prevValue = getLinearValueAtFrame(value, sampleRange.prevFrame);
  const nextValue = getLinearValueAtFrame(value, sampleRange.nextFrame);
  return prevValue + (nextValue - prevValue) * rangeValue;
};

const resolveRotoTemporalSamplePoints = (
  node: RotoNode,
  path: RotoPath,
  geometryFrame: number,
  trackingFrame: number,
  sampleRange?: RotoTemporalSampleRange,
): ScenePoint[] => {
  const compositeMatrix = resolveRotoPathCompositeMatrix(node, path, trackingFrame, {
    includeUserTransform: true,
  });

  return path.points.map((point, pointIndex) => {
    const trackOffset = resolveRotoPathTrackOffsetAtFrame(path, trackingFrame, pointIndex);
    return applyRotoTrackingMatrix4ToPoint(compositeMatrix, {
      x: getRotoTemporalGeometryValue(point.x, geometryFrame, sampleRange) + trackOffset.x,
      y: getRotoTemporalGeometryValue(point.y, geometryFrame, sampleRange) + trackOffset.y,
    });
  });
};

const resolveRotoTemporalInputValue = (
  value: number | RotoTemporalControllerValue,
  temporalController: RotoTemporalControllerState,
): RotoTemporalControllerValue => {
  if (typeof value === 'number') {
    return {
      time: clampUnit(value),
      mix: temporalController.hasCurrentKeyframe ? temporalController.mixValue : 1,
    };
  }

  return {
    time: clampUnit(value.time),
    mix: temporalController.hasCurrentKeyframe ? clampUnit(value.mix) : 1,
  };
};

// ---------------------------------------------------------------------------
// Local state types
// ---------------------------------------------------------------------------

export interface DragPointState {
  startScene: { x: number; y: number };
  pathSnapshots: {
    pathId: string;
    originalPath: RotoPath;
    pointIndices: number[];
    startResolvedPoints: { x: number; y: number }[];
  }[];
}

export interface InsertedPointDragState {
  pathId: string;
  pointIndex: number;
}

export interface PointWeightDragState {
  pathId: string;
  pointIndex: number;
  pointIndices: number[];
  startScene: { x: number; y: number };
  handleNormal: ScenePoint;
  originalPath: RotoPath;
  startWeights: number[];
}

export interface PointWeightControlState {
  pathId: string;
  pointIndex: number;
  pointIndices: number[];
}

export interface HoveredSegmentState {
  pathId: string;
  insertIndex: number;
  point: { x: number; y: number };
}

export interface NudgeDragState {
  startScenePos: { x: number; y: number };
  affectedPaths: NudgeAffectedPath[];
}

export interface BsplineDrawingState {
  committedSegments: {
    start: { x: number; y: number };
    c1: { x: number; y: number };
    c2: { x: number; y: number };
    end: { x: number; y: number };
  }[];
  previewSegment:
    | {
        start: { x: number; y: number };
        c1: { x: number; y: number };
        c2: { x: number; y: number };
        end: { x: number; y: number };
      }
    | {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface UseRotoInteractionParams {
  // Core node state
  selectedNode: AnyNode | undefined;
  selectedNodeId: string | null;
  nodes: AnyNode[];
  selectedRotoLayerIds: string[];
  selectedRotoPathIds: string[];
  selectedRotoPointRefs: RotoPointRef[];

  // Viewport state
  zoom: number;
  visualFrame: number;
  activeViewportTool: string | null;
  altPressed: boolean;
  shiftPressed: boolean;
  affineModifierPressed: boolean;
  mouseScenePos: { x: number; y: number } | null;

  // Drawing state from store
  isDrawing: boolean;
  drawingRotoPath: RotoPath | null;
  rotoRefinement: RotoRefinement | null;

  // Preferences
  nudgeRadius: number;
  rotoPointWeightMode: RotoPointWeightMode;

  // Refs
  viewportRef: React.RefObject<HTMLDivElement | null>;
  viewportToSceneCentered: (pos: { x: number; y: number }) => { x: number; y: number };

  // Actions
  updateNode: (nodeId: string, changes: Record<string, unknown>, pushHistory?: boolean) => void;
  pushHistory: (entry: { label: string; state: Record<string, unknown> }) => void;
  setSelectedRotoPathIds: (ids: string[]) => void;
  setSelectedRotoSelection: (selection: {
    layerIds: string[];
    pathIds: string[];
    pointRefs?: RotoPointRef[];
  }) => void;
  setActiveViewportTool: (tool: string | null) => void;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRotoInteraction(params: UseRotoInteractionParams) {
  const {
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
    rotoPointWeightMode,
    viewportRef,
    viewportToSceneCentered,
    updateNode,
    pushHistory,
    setSelectedRotoPathIds,
    setSelectedRotoSelection,
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
  } = params;

  // -----------------------------------------------------------------------
  // State: roto-specific
  // -----------------------------------------------------------------------
  const [drawingState, setDrawingState] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [isHoveringClosePoint, setIsHoveringClosePoint] = useState(false);
  const [bsplinePreviewPoint, setBsplinePreviewPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [hoveredRotoPathId, setHoveredRotoPathId] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<HoveredSegmentState | null>(null);
  const [marqueeState, setMarqueeState] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [dragPointState, setDragPointState] = useState<DragPointState | null>(null);
  const [hoveredPointInfo, setHoveredPointInfo] = useState<{
    pathId: string;
    pointIndex: number;
  } | null>(null);
  const [transformDragState, setTransformDragState] = useState<RotoTransformDragState | null>(null);
  const [hoveredTransformHandle, setHoveredTransformHandle] = useState<TransformHandleKind | null>(
    null,
  );
  const transformDidChangeRef = useRef(false);
  const [nudgeDragState, setNudgeDragState] = useState<NudgeDragState | null>(null);
  const nudgeDidMoveRef = useRef(false);
  const [isAdjustingRadius, setIsAdjustingRadius] = useState(false);
  const radiusAdjustStartRef = useRef<{
    startX: number;
    initialRadius: number;
    center: { x: number; y: number };
  } | null>(null);
  const [nudgePreviewPoints, setNudgePreviewPoints] = useState<NudgePreviewPoint[]>([]);
  const [dragNewPointIndex, setDragNewPointIndex] = useState<number | null>(null);
  const [insertedPointDragState, setInsertedPointDragState] =
    useState<InsertedPointDragState | null>(null);
  const [pointWeightDragState, setPointWeightDragState] = useState<PointWeightDragState | null>(
    null,
  );
  const [pointWeightControlState, setPointWeightControlState] =
    useState<PointWeightControlState | null>(null);
  const [temporalControllerValue, setTemporalControllerValue] =
    useState<RotoTemporalControllerValue | null>(null);

  const setTemporalControllerInputValue = useCallback(
    (value: number | RotoTemporalControllerValue | null): void => {
      setTemporalControllerValue(
        value === null ? null : typeof value === 'number' ? { time: value, mix: 1 } : value,
      );
    },
    [],
  );

  const resolvePathPoints = useCallback(
    (rotoNode: RotoNode, path: RotoPath, frame: number = visualFrame) =>
      resolveRotoPathPointsAtFrame(rotoNode, path, frame),
    [visualFrame],
  );

  const projectScenePointToPathBase = useCallback(
    (
      rotoNode: RotoNode,
      path: RotoPath,
      pointIndex: number,
      point: { x: number; y: number },
      trackOffsetOverride?: { x: number; y: number },
      frame: number = visualFrame,
    ) =>
      projectScenePointToRotoPathBasePoint(
        rotoNode,
        path,
        frame,
        pointIndex,
        point,
        trackOffsetOverride,
      ),
    [visualFrame],
  );

  const projectScenePointToLayerLocal = useCallback(
    (
      rotoNode: RotoNode,
      layerId: string | null | undefined,
      point: { x: number; y: number },
      frame: number = visualFrame,
    ) => projectScenePointToRotoLayerLocal(rotoNode, layerId, frame, point),
    [visualFrame],
  );

  const bakeNudgeDragStateKeyframes = useCallback(
    (rotoNode: RotoNode, state: NudgeDragState): { paths: RotoPath[]; didBake: boolean } => {
      let didBake = false;
      const affectedPathsById = new Map<string, NudgeAffectedPath>(
        state.affectedPaths.map((affectedPath) => [affectedPath.pathId, affectedPath]),
      );

      const paths = rotoNode.paths.map((path) => {
        const affectedPath = affectedPathsById.get(path.id);
        if (!affectedPath) return path;

        let didBakePath = false;
        const points = affectedPath.originalPoints.map((point, pointIndex) => {
          const xKeyed = hasKeyframeAt(point.x, visualFrame);
          const yKeyed = hasKeyframeAt(point.y, visualFrame);
          const resolvedPoint = affectedPath.resolvedStartPoints[pointIndex];
          if ((xKeyed && yKeyed) || !resolvedPoint) return point;

          const projectedPoint = projectScenePointToPathBase(
            rotoNode,
            path,
            pointIndex,
            resolvedPoint,
          );
          didBake = true;
          didBakePath = true;

          return {
            x: xKeyed ? point.x : setKeyframeOnValue(point.x, visualFrame, projectedPoint.x),
            y: yKeyed ? point.y : setKeyframeOnValue(point.y, visualFrame, projectedPoint.y),
          };
        });

        return didBakePath ? { ...path, points } : path;
      });

      return { paths, didBake };
    },
    [projectScenePointToPathBase, visualFrame],
  );

  const selectedRotoPointRefKeySet = useMemo(
    () => new Set(selectedRotoPointRefs.map((pointRef) => getRotoPointRefKey(pointRef))),
    [selectedRotoPointRefs],
  );

  const selectedPointIndicesByPath = useMemo(() => {
    const pointIndicesByPath = new Map<string, number[]>();
    selectedRotoPointRefs.forEach((pointRef) => {
      const pointIndices = pointIndicesByPath.get(pointRef.pathId) ?? [];
      pointIndices.push(pointRef.pointIndex);
      pointIndicesByPath.set(pointRef.pathId, pointIndices);
    });
    return pointIndicesByPath;
  }, [selectedRotoPointRefs]);

  // -----------------------------------------------------------------------
  // Derived: rotoTransformSelection
  // -----------------------------------------------------------------------
  const rotoTransformSelection = useMemo<RotoTransformSelection | null>(() => {
    if (selectedNode?.type !== NodeType.ROTO || activeViewportTool !== 'select') return null;
    if (selectedRotoPathIds.length === 0) return null;

    const rotoNode = selectedNode as RotoNode;
    const refs: RotoTransformTargetRef[] = [];
    const points: ScenePoint[] = [];

    if (selectedRotoPointRefs.length > 0) {
      selectedRotoPointRefs.forEach(({ pathId, pointIndex }) => {
        const path = rotoNode.paths.find((item) => item.id === pathId);
        if (!path || !isRotoPathVisible(rotoNode, path)) return;

        const resolvedPoints = resolveRotoPathPointsAtFrame(rotoNode, path, visualFrame);
        if (
          pointIndex < 0 ||
          pointIndex >= path.points.length ||
          pointIndex >= resolvedPoints.length
        ) {
          return;
        }

        const trackOffset = resolveRotoPathTrackOffsetAtFrame(path, visualFrame, pointIndex);
        refs.push({ pathId: path.id, pointIndex, trackOffset });
        points.push({ x: resolvedPoints[pointIndex].x, y: resolvedPoints[pointIndex].y });
      });

      const bounds = getRotoTransformBounds(points);
      if (!bounds || refs.length === 0) return null;
      return { mode: 'points', refs, points, bounds };
    }

    const selectedPathIdSet = new Set(selectedRotoPathIds);
    rotoNode.paths.forEach((path) => {
      if (!selectedPathIdSet.has(path.id) || !isRotoPathVisible(rotoNode, path)) return;
      const resolvedPoints = resolveRotoPathPointsAtFrame(rotoNode, path, visualFrame);
      resolvedPoints.forEach((point, pointIndex) => {
        const trackOffset = resolveRotoPathTrackOffsetAtFrame(path, visualFrame, pointIndex);
        refs.push({ pathId: path.id, pointIndex, trackOffset });
        points.push({ x: point.x, y: point.y });
      });
    });

    const bounds = getRotoTransformBounds(points);
    if (!bounds || refs.length === 0) return null;
    return { mode: 'paths', refs, points, bounds };
  }, [selectedNode, activeViewportTool, selectedRotoPathIds, selectedRotoPointRefs, visualFrame]);

  const transformHandlesEnabled = useMemo(
    () =>
      !!rotoTransformSelection &&
      !isTransformBoundsDegenerate(rotoTransformSelection.bounds, 2 / zoom),
    [rotoTransformSelection, zoom],
  );

  // -----------------------------------------------------------------------
  // Derived: bsplineDrawingState
  // -----------------------------------------------------------------------
  const bsplineDrawingState = useMemo<BsplineDrawingState | null>(() => {
    if (activeViewportTool !== 'bspline' || !drawingRotoPath || !bsplinePreviewPoint) {
      return null;
    }

    const resolvedPoints =
      selectedNode?.type === NodeType.ROTO
        ? resolveRotoPathPointsAtFrame(selectedNode as RotoNode, drawingRotoPath, visualFrame)
        : [];
    const allPoints = [...resolvedPoints, bsplinePreviewPoint];

    if (allPoints.length < 2) return null;

    if (allPoints.length < 3) {
      const start = allPoints[0];
      const end = allPoints[1];
      return {
        committedSegments: [],
        previewSegment: { start, end },
      };
    }

    const allSegments = generateBSplineSegments(allPoints, false);
    if (!allSegments || allSegments.length === 0) return null;

    const previewSegment = allSegments[allSegments.length - 1];
    const committedSegments = allSegments.slice(0, allSegments.length - 1);

    return {
      committedSegments,
      previewSegment,
    };
  }, [activeViewportTool, drawingRotoPath, bsplinePreviewPoint, selectedNode, visualFrame]);

  // -----------------------------------------------------------------------
  // Derived: transform handle layout
  // -----------------------------------------------------------------------
  const transformHandlePositions = useMemo(() => {
    if (!rotoTransformSelection || !transformHandlesEnabled) return [];
    const handles: TransformHandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    return handles.map((handle) => ({
      handle,
      point: getTransformHandlePosition(rotoTransformSelection.bounds, handle),
    }));
  }, [rotoTransformSelection, transformHandlesEnabled]);

  const transformRotateHandlePoint = useMemo(() => {
    if (!rotoTransformSelection || !transformHandlesEnabled) return null;
    const topCenter = getTransformHandlePosition(rotoTransformSelection.bounds, 'n');
    return { x: topCenter.x, y: topCenter.y - 24 / zoom };
  }, [rotoTransformSelection, transformHandlesEnabled, zoom]);

  const transformIsDegenerate = useMemo(
    () => !!rotoTransformSelection && !transformHandlesEnabled,
    [rotoTransformSelection, transformHandlesEnabled],
  );

  const transformInteractionOperation = useMemo<TransformOperation | null>(() => {
    if (transformDragState) {
      return getTransformOperationForHandle(
        transformDragState.handle,
        affineModifierPressed,
        altPressed,
      );
    }
    if (!hoveredTransformHandle) return null;
    return getTransformOperationForHandle(
      hoveredTransformHandle,
      affineModifierPressed,
      altPressed,
    );
  }, [transformDragState, hoveredTransformHandle, affineModifierPressed, altPressed]);

  const isRotoSelectActive =
    selectedNode?.type === NodeType.ROTO && activeViewportTool === 'select';

  const temporalControllerKey = useMemo(() => {
    const pointKey = selectedRotoPointRefs
      .map((pointRef) => `${pointRef.pathId}:${pointRef.pointIndex}`)
      .sort()
      .join(',');
    return `${selectedNodeId ?? ''}|${visualFrame}|${selectedRotoPathIds.slice().sort().join(',')}|${pointKey}`;
  }, [selectedNodeId, selectedRotoPathIds, selectedRotoPointRefs, visualFrame]);

  useEffect(() => {
    setTemporalControllerValue(null);
  }, [temporalControllerKey]);

  const temporalController = useMemo<RotoTemporalControllerState | null>(() => {
    if (!shiftPressed || !isRotoSelectActive || selectedNode?.type !== NodeType.ROTO) return null;
    if (selectedRotoPathIds.length === 0) return null;
    if (
      dragPointState ||
      transformDragState ||
      nudgeDragState ||
      pointWeightDragState ||
      insertedPointDragState ||
      marqueeState ||
      drawingState ||
      freehandPoints
    ) {
      return null;
    }

    const rotoNode = selectedNode as RotoNode;
    const selectedPathIdSet = new Set(selectedRotoPathIds);
    const selectedPointRefsByPath = new Map<string, RotoPointRef[]>();
    selectedRotoPointRefs.forEach((pointRef) => {
      const refs = selectedPointRefsByPath.get(pointRef.pathId) ?? [];
      refs.push(pointRef);
      selectedPointRefsByPath.set(pointRef.pathId, refs);
    });

    const hasPointSelection = selectedRotoPointRefs.length > 0;
    const targetPaths = rotoNode.paths
      .filter((path) => selectedPathIdSet.has(path.id) && isRotoPathVisible(rotoNode, path))
      .map((path) => ({
        path,
        pointIndices: getRotoTemporalTargetPointIndices(
          path,
          selectedPointRefsByPath,
          hasPointSelection,
        ),
      }))
      .filter(({ pointIndices }) => pointIndices.length > 0);

    if (targetPaths.length === 0) return null;

    const { frames, hasCurrentKeyframeAt } = collectRotoTemporalKeyframeFrames(targetPaths);
    if (frames.length < 2) return null;

    const prevFrame = [...frames].reverse().find((frame) => frame < visualFrame);
    const nextFrame = frames.find((frame) => frame > visualFrame);
    if (prevFrame === undefined || nextFrame === undefined || nextFrame <= prevFrame) return null;

    const hasCurrentKeyframe = hasCurrentKeyframeAt(visualFrame);
    const defaultValue = clampUnit((visualFrame - prevFrame) / (nextFrame - prevFrame));
    const defaultMixValue = hasCurrentKeyframe ? 0 : 1;
    const value = clampUnit(temporalControllerValue?.time ?? defaultValue);
    const mixValue = hasCurrentKeyframe
      ? clampUnit(temporalControllerValue?.mix ?? defaultMixValue)
      : 1;
    const previewFrame = prevFrame + (nextFrame - prevFrame) * value;
    const sampleRange = { prevFrame, nextFrame };

    const paths = targetPaths
      .map(({ path, pointIndices }) => {
        const targetPointIndexSet = new Set(pointIndices);
        const oldPoints = resolveRotoTemporalSamplePoints(rotoNode, path, visualFrame, visualFrame);
        const prevPoints = resolveRotoTemporalSamplePoints(
          rotoNode,
          path,
          prevFrame,
          visualFrame,
          sampleRange,
        );
        const nextPoints = resolveRotoTemporalSamplePoints(
          rotoNode,
          path,
          nextFrame,
          visualFrame,
          sampleRange,
        );
        const sampledPreviewPoints = resolveRotoTemporalSamplePoints(
          rotoNode,
          path,
          previewFrame,
          visualFrame,
          sampleRange,
        );
        const keyedPreviewPoints = resolveRotoTemporalSamplePoints(
          rotoNode,
          path,
          previewFrame,
          visualFrame,
        );
        if (
          oldPoints.length !== path.points.length ||
          prevPoints.length !== path.points.length ||
          nextPoints.length !== path.points.length ||
          sampledPreviewPoints.length !== path.points.length ||
          keyedPreviewPoints.length !== path.points.length
        ) {
          return null;
        }

        const previewPoints = oldPoints.map((point, pointIndex) => {
          if (!targetPointIndexSet.has(pointIndex)) return point;
          const sampledPreviewPoint = sampledPreviewPoints[pointIndex];
          const keyedPreviewPoint = keyedPreviewPoints[pointIndex];
          if (!sampledPreviewPoint || !keyedPreviewPoint) return point;
          return {
            x: keyedPreviewPoint.x + (sampledPreviewPoint.x - keyedPreviewPoint.x) * mixValue,
            y: keyedPreviewPoint.y + (sampledPreviewPoint.y - keyedPreviewPoint.y) * mixValue,
          };
        });
        const motionPoints = pointIndices
          .map((pointIndex) => {
            const prev = prevPoints[pointIndex];
            const old = oldPoints[pointIndex];
            const preview = previewPoints[pointIndex];
            const next = nextPoints[pointIndex];
            if (!prev || !old || !preview || !next) return null;
            return { pointIndex, prev, old, preview, next };
          })
          .filter((point): point is NonNullable<typeof point> => point !== null);

        return {
          path,
          oldPoints,
          prevPoints,
          nextPoints,
          previewPoints,
          targetPointIndices: pointIndices,
          motionPoints,
        };
      })
      .filter((path): path is NonNullable<typeof path> => path !== null);

    if (paths.length === 0) return null;

    return {
      value,
      mixValue,
      defaultValue,
      defaultMixValue,
      hasCurrentKeyframe,
      prevFrame,
      nextFrame,
      paths,
    };
  }, [
    dragPointState,
    drawingState,
    freehandPoints,
    insertedPointDragState,
    isRotoSelectActive,
    marqueeState,
    nudgeDragState,
    pointWeightDragState,
    selectedNode,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    shiftPressed,
    temporalControllerValue,
    transformDragState,
    visualFrame,
  ]);

  const commitTemporalController = useCallback(
    (value: number | RotoTemporalControllerValue): void => {
      if (!temporalController || selectedNode?.type !== NodeType.ROTO) return;
      const rotoNode = selectedNode as RotoNode;
      const resolvedValue = resolveRotoTemporalInputValue(value, temporalController);
      const controllerPathById = new Map<string, RotoTemporalControllerState['paths'][number]>(
        temporalController.paths.map((pathData) => [pathData.path.id, pathData]),
      );

      const newPaths = rotoNode.paths.map((path) => {
        const pathData = controllerPathById.get(path.id);
        if (!pathData) return path;

        const targetPointIndexSet = new Set(pathData.targetPointIndices);
        const previewFrame =
          temporalController.prevFrame +
          (temporalController.nextFrame - temporalController.prevFrame) * resolvedValue.time;
        const sampledPreviewPoints = resolveRotoTemporalSamplePoints(
          rotoNode,
          path,
          previewFrame,
          visualFrame,
          {
            prevFrame: temporalController.prevFrame,
            nextFrame: temporalController.nextFrame,
          },
        );
        const keyedPreviewPoints = resolveRotoTemporalSamplePoints(
          rotoNode,
          path,
          previewFrame,
          visualFrame,
        );
        const nextPoints = path.points.map((point, pointIndex) => {
          if (!targetPointIndexSet.has(pointIndex)) return point;
          const sampledPreviewPoint = sampledPreviewPoints[pointIndex];
          const keyedPreviewPoint = keyedPreviewPoints[pointIndex];
          if (!keyedPreviewPoint || !sampledPreviewPoint) return point;
          const previewPoint = {
            x:
              keyedPreviewPoint.x +
              (sampledPreviewPoint.x - keyedPreviewPoint.x) * resolvedValue.mix,
            y:
              keyedPreviewPoint.y +
              (sampledPreviewPoint.y - keyedPreviewPoint.y) * resolvedValue.mix,
          };
          const projectedPoint = projectScenePointToPathBase(
            rotoNode,
            path,
            pointIndex,
            previewPoint,
          );
          return {
            x: setKeyframeOnValue(point.x, visualFrame, projectedPoint.x),
            y: setKeyframeOnValue(point.y, visualFrame, projectedPoint.y),
          };
        });

        return { ...path, points: nextPoints };
      });

      const newNodes = nodes.map((node) =>
        node.id === rotoNode.id ? ({ ...rotoNode, paths: newPaths } as RotoNode) : node,
      );

      updateNode(rotoNode.id, { paths: newPaths }, false);
      pushHistory({
        label: 'Set Roto Temporal Keyframe',
        state: { nodes: newNodes, selectedNodeId },
      });
      setTemporalControllerValue(null);
    },
    [
      nodes,
      projectScenePointToPathBase,
      pushHistory,
      selectedNode,
      selectedNodeId,
      temporalController,
      updateNode,
      visualFrame,
    ],
  );

  const transformInteractionLabel = useMemo(() => {
    if (!isRotoSelectActive || !rotoTransformSelection || !transformInteractionOperation)
      return null;
    const label = getTransformOperationLabel(transformInteractionOperation);
    if (transformInteractionOperation === 'scale_shear') {
      return `${label} (Ctrl/Cmd edge)`;
    }
    if (transformInteractionOperation === 'perspective') {
      return `${label} (Alt corner)`;
    }
    if (transformInteractionOperation === 'bilinear') {
      return `${label} (Ctrl/Cmd corner)`;
    }
    return label;
  }, [isRotoSelectActive, rotoTransformSelection, transformInteractionOperation]);

  const activeTransformHandle = transformDragState?.handle ?? null;
  const transformHandleSize = 8 / zoom;
  const transformHandleHitSize = Math.max(14 / zoom, transformHandleSize * 2.1);
  const transformMoveHandleRadius = 7 / zoom;
  const transformRotateHitRadius = Math.max(14 / zoom, transformMoveHandleRadius * 2);
  const isMoveTransformActive = activeTransformHandle === 'move';
  const isMoveTransformHovered = hoveredTransformHandle === 'move';
  const isRotateTransformActive = activeTransformHandle === 'rotate';
  const isRotateTransformHovered = hoveredTransformHandle === 'rotate';

  // -----------------------------------------------------------------------
  // beginRotoTransformDrag — SVG handle pointer-down
  // -----------------------------------------------------------------------
  const beginRotoTransformDrag = useCallback(
    (e: React.MouseEvent<SVGElement>, handle: TransformHandleKind) => {
      if (e.button !== 0 || !viewportRef.current) return;
      if (!rotoTransformSelection || selectedNode?.type !== NodeType.ROTO) return;

      const rect = viewportRef.current.getBoundingClientRect();
      const mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const scenePos = viewportToSceneCentered(mousePos);
      const useAffineModifier = e.ctrlKey || e.metaKey;
      const baseOperation = getTransformOperationForHandle(handle, useAffineModifier, e.altKey);

      const selectedPaths = (selectedNode as RotoNode).paths.filter((path) =>
        rotoTransformSelection.refs.some((ref) => ref.pathId === path.id),
      );
      if (selectedPaths.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      transformDidChangeRef.current = false;

      setTransformDragState({
        handle,
        baseOperation,
        startMouse: scenePos,
        startBounds: rotoTransformSelection.bounds,
        startPoints: rotoTransformSelection.points,
        refs: rotoTransformSelection.refs,
        pathSnapshots: selectedPaths.map((path) => ({ pathId: path.id, path })),
        selectionMode: rotoTransformSelection.mode,
      });
    },
    [rotoTransformSelection, selectedNode, viewportToSceneCentered, viewportRef],
  );

  // -----------------------------------------------------------------------
  // handlePointMouseDown — roto control-point pointer-down
  // -----------------------------------------------------------------------
  const handlePointMouseDown = useCallback(
    (e: React.MouseEvent, pathId: string, pointIndex: number) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (e.altKey) {
        const rotoNode = selectedNode as RotoNode;
        const path = rotoNode.paths.find((p) => p.id === pathId);
        if (path) {
          const minPoints = path.closed ? 3 : 2;
          if (path.points.length > minPoints) {
            const newPoints = path.points.filter((_, i) => i !== pointIndex);
            const newPointTypes = removeRotoPointTypes(path.pointTypes, path.points.length, [
              pointIndex,
            ]);
            const newPointWeightModes = removeRotoPointWeightModes(
              path.pointWeightModes,
              path.points.length,
              [pointIndex],
            );
            const newPointWeights = removeRotoPointWeights(path.pointWeights, path.points.length, [
              pointIndex,
            ]);
            const newTrackPoints = path.trackPoints
              ? path.trackPoints.filter((_, i) => i !== pointIndex)
              : undefined;
            const newPaths = rotoNode.paths.map((p) =>
              p.id === pathId
                ? {
                    ...p,
                    points: newPoints,
                    pointTypes: newPointTypes,
                    pointWeightModes: newPointWeightModes,
                    pointWeights: newPointWeights,
                    trackPoints: newTrackPoints,
                  }
                : p,
            );
            updateNode(rotoNode.id, { paths: newPaths }, true);
            setSelectedRotoSelection({ layerIds: [], pathIds: [], pointRefs: [] });
          }
        }
        return;
      }
      const clickedPointRef = { pathId, pointIndex };
      const clickedPointRefKey = getRotoPointRefKey(clickedPointRef);
      const isSelected = selectedRotoPointRefKeySet.has(clickedPointRefKey);
      const nextPointRefs = e.shiftKey
        ? isSelected
          ? selectedRotoPointRefs.filter(
              (pointRef) => getRotoPointRefKey(pointRef) !== clickedPointRefKey,
            )
          : dedupeRotoPointRefs([...selectedRotoPointRefs, clickedPointRef])
        : isSelected
          ? selectedRotoPointRefs
          : [clickedPointRef];

      const nextPathIds = Array.from(new Set(nextPointRefs.map((pointRef) => pointRef.pathId)));
      setSelectedRotoSelection({
        layerIds: [],
        pathIds: nextPathIds,
        pointRefs: nextPointRefs,
      });

      if (e.shiftKey || nextPointRefs.length === 0) {
        return;
      }

      const rect = viewportRef.current!.getBoundingClientRect();
      const mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const scenePos = viewportToSceneCentered(mousePos);
      const pathIdsToDrag = new Set(nextPointRefs.map((pointRef) => pointRef.pathId));
      const pathSnapshots = (selectedNode as RotoNode).paths
        .filter((path) => pathIdsToDrag.has(path.id))
        .map((path) => ({
          pathId: path.id,
          originalPath: path,
          pointIndices: nextPointRefs
            .filter((pointRef) => pointRef.pathId === path.id)
            .map((pointRef) => pointRef.pointIndex),
          startResolvedPoints: resolvePathPoints(selectedNode as RotoNode, path),
        }))
        .filter((pathSnapshot) => pathSnapshot.pointIndices.length > 0);

      if (pathSnapshots.length > 0) {
        setDragPointState({
          startScene: scenePos,
          pathSnapshots,
        });
      }
    },
    [
      selectedNode,
      selectedRotoPointRefs,
      selectedRotoPointRefKeySet,
      setSelectedRotoSelection,
      viewportToSceneCentered,
      viewportRef,
      updateNode,
      resolvePathPoints,
    ],
  );

  const beginPointWeightDrag = useCallback(
    (e: React.MouseEvent, pathId: string, pointIndex: number, handleNormal: ScenePoint): void => {
      if (e.button !== 0 || !e.altKey || selectedNode?.type !== NodeType.ROTO) return;

      e.preventDefault();
      e.stopPropagation();

      const path = (selectedNode as RotoNode).paths.find((candidate) => candidate.id === pathId);
      if (!path) return;

      const pointIndices = selectedPointIndicesByPath.get(pathId) ?? [pointIndex];
      const normalizedWeights = getNormalizedRotoPointWeights(
        path.pointWeights,
        path.points.length,
      );
      const rect = viewportRef.current!.getBoundingClientRect();
      const mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const scenePos = viewportToSceneCentered(mousePos);

      setPointWeightDragState({
        pathId,
        pointIndex,
        pointIndices,
        startScene: scenePos,
        handleNormal,
        originalPath: path,
        startWeights: pointIndices.map(
          (selectedPointIndex) =>
            normalizedWeights[selectedPointIndex] ?? DEFAULT_ROTO_POINT_WEIGHT,
        ),
      });
      setPointWeightControlState({
        pathId,
        pointIndex,
        pointIndices,
      });
    },
    [selectedNode, selectedPointIndicesByPath, viewportRef, viewportToSceneCentered],
  );

  const setSelectedPointWeightMode = useCallback(
    (pathId: string, pointIndices: number[], pointWeightModeValue: RotoPointWeightMode): void => {
      if (selectedNode?.type !== NodeType.ROTO || pointIndices.length === 0) return;

      const rotoNode = selectedNode as RotoNode;
      const path = rotoNode.paths.find((candidate) => candidate.id === pathId);
      if (!path) return;

      const nextPointWeightModes = setRotoPointWeightModes(
        path,
        pointIndices,
        pointWeightModeValue,
      );
      const newPaths = rotoNode.paths.map((candidate) =>
        candidate.id === pathId
          ? {
              ...candidate,
              pointWeightModes: nextPointWeightModes,
            }
          : candidate,
      );
      const newNodes = nodes.map((node) =>
        node.id === selectedNode.id ? ({ ...rotoNode, paths: newPaths } as RotoNode) : node,
      );

      updateNode(selectedNode.id, { paths: newPaths }, false);
      pushHistory({
        label: pointWeightModeValue === 'global' ? 'Set Global Pull' : 'Set Local Pull',
        state: { nodes: newNodes, selectedNodeId },
      });
      setPointWeightControlState((current) =>
        current && current.pathId === pathId
          ? { ...current, pointIndices: [...pointIndices] }
          : current,
      );
    },
    [nodes, pushHistory, selectedNode, selectedNodeId, updateNode],
  );

  const setSelectedPointType = useCallback(
    (pathId: string, pointIndices: number[], pointType: RotoPointType): void => {
      if (selectedNode?.type !== NodeType.ROTO || pointIndices.length === 0) return;

      const rotoNode = selectedNode as RotoNode;
      const path = rotoNode.paths.find((candidate) => candidate.id === pathId);
      if (!path) return;

      const nextPointTypes = setRotoPointTypes(path, pointIndices, pointType);
      const newPaths = rotoNode.paths.map((candidate) =>
        candidate.id === pathId
          ? {
              ...candidate,
              pointTypes: nextPointTypes,
            }
          : candidate,
      );
      const newNodes = nodes.map((node) =>
        node.id === selectedNode.id ? ({ ...rotoNode, paths: newPaths } as RotoNode) : node,
      );

      updateNode(selectedNode.id, { paths: newPaths }, false);
      pushHistory({
        label:
          pointIndices.length === 1
            ? `Set Point Mode: ${pointType}`
            : `Set Point Modes: ${pointType}`,
        state: { nodes: newNodes, selectedNodeId },
      });
      setPointWeightControlState((current) =>
        current && current.pathId === pathId
          ? { ...current, pointIndices: [...pointIndices] }
          : current,
      );
    },
    [nodes, pushHistory, selectedNode, selectedNodeId, updateNode],
  );

  // -----------------------------------------------------------------------
  // isAdjustingRadius window drag effect
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!isAdjustingRadius) return;
    const handleRadiusMouseMove = (e: MouseEvent) => {
      if (radiusAdjustStartRef.current) {
        const dx = e.clientX - radiusAdjustStartRef.current.startX;
        setPreferences({
          nudgeRadius: Math.max(1, Math.min(500, radiusAdjustStartRef.current.initialRadius + dx)),
        });
      }
    };
    const handleRadiusMouseUp = () => {
      setIsAdjustingRadius(false);
      radiusAdjustStartRef.current = null;
    };
    window.addEventListener('mousemove', handleRadiusMouseMove);
    window.addEventListener('mouseup', handleRadiusMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleRadiusMouseMove);
      window.removeEventListener('mouseup', handleRadiusMouseUp);
    };
  }, [isAdjustingRadius, setPreferences]);

  // -----------------------------------------------------------------------
  // Tool-change cleanup
  // -----------------------------------------------------------------------
  const cleanupOnToolChange = useCallback(
    (previousTool: string | null) => {
      if (previousTool === 'bspline' && activeViewportTool !== 'bspline') {
        if (isDrawing) {
          if (drawingRotoPath && drawingRotoPath.points.length >= 2) commitDrawingShape();
          else cancelDrawingShape();
        }
        setBsplinePreviewPoint(null);
      }
      if (previousTool === 'freehand' && activeViewportTool !== 'freehand') {
        if (rotoRefinement) commitRotoRefinement();
        if (freehandPoints) {
          setFreehandPoints(null);
          setIsHoveringClosePoint(false);
        }
      }
      if (activeViewportTool !== 'nudge' && nudgePreviewPoints.length > 0)
        setNudgePreviewPoints([]);
      if (activeViewportTool !== 'select') {
        setHoveredTransformHandle(null);
        if (transformDragState) {
          setTransformDragState(null);
          transformDidChangeRef.current = false;
        }
      }
    },
    [
      activeViewportTool,
      isDrawing,
      drawingRotoPath,
      commitDrawingShape,
      cancelDrawingShape,
      freehandPoints,
      rotoRefinement,
      commitRotoRefinement,
      nudgePreviewPoints.length,
      transformDragState,
    ],
  );

  // Clear hovered transform handle when selection changes
  useEffect(() => {
    if (!rotoTransformSelection) {
      setHoveredTransformHandle(null);
    }
  }, [rotoTransformSelection]);

  useEffect(() => {
    if (!pointWeightControlState) return;
    if (selectedNode?.type !== NodeType.ROTO) {
      setPointWeightControlState(null);
      return;
    }
    if (activeViewportTool !== 'select' && activeViewportTool !== 'nudge') {
      setPointWeightControlState(null);
      return;
    }

    const path = (selectedNode as RotoNode).paths.find(
      (candidate) => candidate.id === pointWeightControlState.pathId,
    );
    if (!path || selectedRotoPathIds.length !== 1 || selectedRotoPathIds[0] !== path.id) {
      setPointWeightControlState(null);
      return;
    }

    const activePointIndices =
      pointWeightDragState?.pathId === path.id
        ? pointWeightDragState.pointIndices
        : (selectedPointIndicesByPath.get(path.id) ?? pointWeightControlState.pointIndices);
    if (
      activePointIndices.length === 0 ||
      pointWeightControlState.pointIndex >= path.points.length ||
      !activePointIndices.includes(pointWeightControlState.pointIndex)
    ) {
      setPointWeightControlState(null);
      return;
    }

    if (
      activePointIndices.length !== pointWeightControlState.pointIndices.length ||
      activePointIndices.some(
        (pointIndex) => !pointWeightControlState.pointIndices.includes(pointIndex),
      )
    ) {
      setPointWeightControlState({
        ...pointWeightControlState,
        pointIndices: [...activePointIndices],
      });
    }
  }, [
    activeViewportTool,
    pointWeightControlState,
    pointWeightDragState,
    selectedNode,
    selectedRotoPathIds,
    selectedPointIndicesByPath,
  ]);

  // -----------------------------------------------------------------------
  // Context menu handler (bspline / freehand commit)
  // -----------------------------------------------------------------------
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeViewportTool === 'bspline' && isDrawing) {
        e.preventDefault();
        commitDrawingShape();
      }
      if (activeViewportTool === 'freehand' && freehandPoints) {
        e.preventDefault();
        setFreehandPoints(null);
        setIsHoveringClosePoint(false);
      }
    },
    [activeViewportTool, isDrawing, commitDrawingShape, freehandPoints],
  );

  const deletePointsInNudgeArea = useCallback((): boolean => {
    if (activeViewportTool !== 'nudge' || selectedNode?.type !== NodeType.ROTO || !mouseScenePos) {
      return false;
    }
    if (nudgeDragState || isAdjustingRadius || selectedRotoPathIds.length === 0) return false;

    const rotoNode = selectedNode as RotoNode;
    const selectedPathIdSet = new Set(selectedRotoPathIds);
    const nudgeRadiusScene = nudgeRadius / zoom;
    let deletedPointCount = 0;

    const newPaths = rotoNode.paths.map((path) => {
      if (!selectedPathIdSet.has(path.id)) return path;

      const resolvedPoints = resolveRotoPathPointsAtFrame(rotoNode, path, visualFrame);
      const indicesToDelete = resolvedPoints.reduce((acc, point, index) => {
        const dist = Math.hypot(point.x - mouseScenePos.x, point.y - mouseScenePos.y);
        if (dist < nudgeRadiusScene) acc.push(index);
        return acc;
      }, [] as number[]);

      if (indicesToDelete.length === 0) return path;

      const minPoints = path.closed ? 3 : 2;
      if (path.points.length - indicesToDelete.length < minPoints) return path;

      const deleteIndexSet = new Set(indicesToDelete);
      deletedPointCount += indicesToDelete.length;

      return {
        ...path,
        points: path.points.filter((_, index) => !deleteIndexSet.has(index)),
        pointTypes: removeRotoPointTypes(path.pointTypes, path.points.length, indicesToDelete),
        pointWeightModes: removeRotoPointWeightModes(
          path.pointWeightModes,
          path.points.length,
          indicesToDelete,
        ),
        pointWeights: removeRotoPointWeights(
          path.pointWeights,
          path.points.length,
          indicesToDelete,
        ),
        trackPoints: path.trackPoints?.filter((_, index) => !deleteIndexSet.has(index)),
      };
    });

    if (deletedPointCount === 0) return false;

    const updatedNode = { ...rotoNode, paths: newPaths } as RotoNode;
    const newNodes = nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node));

    updateNode(updatedNode.id, { paths: newPaths }, false);
    if (selectedRotoPointRefs.length > 0) {
      setSelectedRotoSelection({ layerIds: [], pathIds: [], pointRefs: [] });
    }
    pushHistory({
      label: 'Delete Points in Nudge Area',
      state: { nodes: newNodes, selectedNodeId },
    });

    return true;
  }, [
    activeViewportTool,
    selectedNode,
    mouseScenePos,
    nudgeDragState,
    isAdjustingRadius,
    selectedRotoPathIds,
    nudgeRadius,
    zoom,
    visualFrame,
    nodes,
    updateNode,
    selectedRotoPointRefs.length,
    setSelectedRotoSelection,
    pushHistory,
    selectedNodeId,
  ]);

  // -----------------------------------------------------------------------
  // handleMouseDown — all roto tool interactions
  // -----------------------------------------------------------------------
  const handleMouseDown = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      mousePos: { x: number; y: number },
      scenePos: { x: number; y: number },
    ): boolean => {
      // Alt+click: insert point on hovered segment
      if (e.button === 0 && e.altKey && hoveredSegment && selectedNode?.type === NodeType.ROTO) {
        e.preventDefault();
        e.stopPropagation();
        addRotoPointToPath(hoveredSegment.pathId, hoveredSegment.insertIndex, hoveredSegment.point);
        setInsertedPointDragState({
          pathId: hoveredSegment.pathId,
          pointIndex: hoveredSegment.insertIndex,
        });
        setHoveredSegment(null);
        return true;
      }

      // Freehand tool
      if (
        e.button === 0 &&
        activeViewportTool === 'freehand' &&
        selectedNode?.type === NodeType.ROTO
      ) {
        e.preventDefault();
        setFreehandPoints([scenePos]);
        return true;
      }

      // Nudge tool
      if (
        e.button === 0 &&
        activeViewportTool === 'nudge' &&
        selectedNode?.type === NodeType.ROTO
      ) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          setIsAdjustingRadius(true);
          radiusAdjustStartRef.current = {
            startX: e.clientX,
            initialRadius: nudgeRadius,
            center: scenePos,
          };
          return true;
        }
        const rotoNode = selectedNode as RotoNode;
        const selectedPaths = rotoNode.paths.filter(
          (path) => selectedRotoPathIds.includes(path.id) && isRotoPathVisible(rotoNode, path),
        );
        if (selectedPaths.length === 0) return true;
        const nudgeRadiusScene = nudgeRadius / zoom;
        const affectedPaths: NudgeAffectedPath[] = [];
        selectedPaths.forEach((path) => {
          const affectedIndices: { index: number; dist: number }[] = [];
          const resolvedPoints = resolvePathPoints(rotoNode, path);
          resolvedPoints.forEach((point, index) => {
            const dist = Math.hypot(point.x - scenePos.x, point.y - scenePos.y);
            if (dist < nudgeRadiusScene) affectedIndices.push({ index, dist });
          });
          if (affectedIndices.length > 0)
            affectedPaths.push({
              pathId: path.id,
              originalPoints: path.points,
              resolvedStartPoints: resolvedPoints,
              affectedIndices,
            });
        });
        if (affectedPaths.length > 0) {
          nudgeDidMoveRef.current = false;
          setNudgeDragState({ startScenePos: scenePos, affectedPaths });
        }
        return true;
      }

      // Rectangle tool
      if (
        e.button === 0 &&
        activeViewportTool === 'rectangle' &&
        selectedNode?.type === NodeType.ROTO
      ) {
        e.preventDefault();
        setDrawingState({ start: scenePos, current: scenePos });
        return true;
      }

      // B-spline tool
      if (
        e.button === 0 &&
        activeViewportTool === 'bspline' &&
        selectedNode?.type === NodeType.ROTO
      ) {
        e.preventDefault();
        if (isHoveringClosePoint && drawingRotoPath && drawingRotoPath.points.length >= 3) {
          commitDrawingShape({
            closed: true,
            style: { ...drawingRotoPath.style, mode: RotoDrawMode.FILL },
          });
          setIsHoveringClosePoint(false);
          return true;
        }
        if (!isDrawing) {
          const rotoNode = selectedNode as RotoNode;
          const parentLayerId = getRotoCreationParentLayerId(
            rotoNode,
            selectedRotoLayerIds,
            selectedRotoPathIds,
          );
          const firstPoint = projectScenePointToLayerLocal(rotoNode, parentLayerId, scenePos);
          const newPath: RotoPath = {
            id: `path_drawing_${Date.now()}`,
            name: `Shape ${rotoNode.paths.length + 1}`,
            parentLayerId,
            shapeType: RotoShapeType.BSPLINE,
            points: [{ x: firstPoint.x, y: firstPoint.y }],
            closed: false,
            feather: 0,
            opacity: 100,
            blend: RotoPathBlend.ADD,
            style: { mode: RotoDrawMode.STROKE, strokeWidth: 2 },
          };
          startDrawingShape(newPath as any);
          setBsplinePreviewPoint(scenePos);
        } else {
          addPointToDrawingShape(
            projectScenePointToLayerLocal(
              selectedNode as RotoNode,
              drawingRotoPath?.parentLayerId ?? null,
              scenePos,
            ),
          );
          setBsplinePreviewPoint(scenePos);
        }
        return true;
      }

      // Select tool: marquee
      if (
        e.button === 0 &&
        activeViewportTool === 'select' &&
        selectedNode?.type === NodeType.ROTO
      ) {
        if (e.target !== e.currentTarget) return false;
        e.preventDefault();
        setMarqueeState({ start: scenePos, current: scenePos });
        return true;
      }

      return false;
    },
    [
      hoveredSegment,
      selectedNode,
      activeViewportTool,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      zoom,
      visualFrame,
      nudgeRadius,
      isHoveringClosePoint,
      drawingRotoPath,
      isDrawing,
      addRotoPointToPath,
      commitDrawingShape,
      startDrawingShape,
      addPointToDrawingShape,
    ],
  );

  // -----------------------------------------------------------------------
  // handleMouseMove — roto interactions (exclusive + passive)
  // Returns true when an exclusive drag consumed the event.
  // -----------------------------------------------------------------------
  const handleMouseMove = useCallback(
    (
      e: ViewportMouseEvent,
      mousePos: { x: number; y: number },
      scenePos: { x: number; y: number },
    ): boolean => {
      // --- Exclusive: transform drag ---
      if (transformDragState && selectedNode?.type === NodeType.ROTO) {
        const useAffineModifier = e.ctrlKey || e.metaKey;
        const operation = getTransformOperationForHandle(
          transformDragState.handle,
          useAffineModifier,
          e.altKey,
        );

        const transformedPoints = applyRotoTransform({
          operation,
          handle: transformDragState.handle,
          points: transformDragState.startPoints,
          bounds: transformDragState.startBounds,
          startMouse: transformDragState.startMouse,
          currentMouse: scenePos,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        });

        const didChange = transformedPoints.some((point, index) => {
          const startPoint = transformDragState.startPoints[index];
          return Math.abs(point.x - startPoint.x) > 1e-4 || Math.abs(point.y - startPoint.y) > 1e-4;
        });
        if (!didChange && !transformDidChangeRef.current) return true;

        const editsByPath = new Map<
          string,
          { pointIndex: number; point: ScenePoint; trackOffset: ScenePoint }[]
        >();
        transformDragState.refs.forEach((ref, index) => {
          const point = transformedPoints[index];
          if (!point) return;
          const edits = editsByPath.get(ref.pathId) || [];
          edits.push({ pointIndex: ref.pointIndex, point, trackOffset: ref.trackOffset });
          editsByPath.set(ref.pathId, edits);
        });

        const snapshotsByPathId = new Map<string, RotoPath>(
          transformDragState.pathSnapshots.map((item) => [item.pathId, item.path]),
        );
        const rotoNode = selectedNode as RotoNode;
        const newPaths = rotoNode.paths.map((path) => {
          const snapshot = snapshotsByPathId.get(path.id);
          if (!snapshot) return path;

          const edits = editsByPath.get(path.id);
          if (!edits || edits.length === 0) return snapshot;

          const newPoints = [...snapshot.points];
          edits.forEach((edit) => {
            if (edit.pointIndex < 0 || edit.pointIndex >= snapshot.points.length) return;
            const sourcePoint = snapshot.points[edit.pointIndex];
            const projectedPoint = projectScenePointToPathBase(
              rotoNode,
              snapshot,
              edit.pointIndex,
              edit.point,
              edit.trackOffset,
            );
            newPoints[edit.pointIndex] = {
              x: setKeyframeOnValue(sourcePoint.x, visualFrame, projectedPoint.x),
              y: setKeyframeOnValue(sourcePoint.y, visualFrame, projectedPoint.y),
            };
          });

          return { ...snapshot, points: newPoints };
        });

        updateNode(selectedNode.id, { paths: newPaths }, false);
        transformDidChangeRef.current = didChange;
        return true;
      }

      // --- Passive: segment hover (alt+click insert preview) ---
      if (pointWeightDragState && selectedNode?.type === NodeType.ROTO) {
        const deltaAlongHandle =
          (scenePos.x - pointWeightDragState.startScene.x) * pointWeightDragState.handleNormal.x +
          (scenePos.y - pointWeightDragState.startScene.y) * pointWeightDragState.handleNormal.y;
        const deltaWeight = (deltaAlongHandle * zoom) / ROTO_POINT_WEIGHT_HANDLE_STEP_PX;
        const startWeightByPointIndex = new Map<number, number>(
          pointWeightDragState.pointIndices.map((pointIndex, index) => [
            pointIndex,
            pointWeightDragState.startWeights[index] ?? DEFAULT_ROTO_POINT_WEIGHT,
          ]),
        );
        const nextPointWeights = updateRotoPointWeights(
          pointWeightDragState.originalPath,
          pointWeightDragState.pointIndices,
          (_weight, pointIndex) =>
            (startWeightByPointIndex.get(pointIndex) ?? DEFAULT_ROTO_POINT_WEIGHT) + deltaWeight,
        );
        const nextPointWeightModes = materializeRotoPointWeightModes(
          pointWeightDragState.originalPath,
          pointWeightDragState.pointIndices,
          rotoPointWeightMode,
        );
        const newPaths = (selectedNode as RotoNode).paths.map((path) =>
          path.id === pointWeightDragState.pathId
            ? {
                ...path,
                pointWeights: nextPointWeights,
                pointWeightModes: nextPointWeightModes ?? path.pointWeightModes,
              }
            : path,
        );

        updateNode(selectedNode.id, { paths: newPaths }, false);
        return true;
      }

      // --- Passive: segment hover (alt+click insert preview) ---
      if (altPressed && selectedNode?.type === NodeType.ROTO && selectedRotoPathIds.length === 1) {
        const pathId = selectedRotoPathIds[0];
        const path = (selectedNode as RotoNode).paths.find((p) => p.id === pathId);
        if (path) {
          const points = resolvePathPoints(selectedNode as RotoNode, path);
          let minDist = 10 / zoom;
          let bestIdx = -1;
          let bestPoint = { x: 0, y: 0 };
          const segmentCount = path.closed ? points.length : points.length - 1;
          for (let i = 0; i < segmentCount; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const t = ((scenePos.x - p1.x) * dx + (scenePos.y - p1.y) * dy) / (dx * dx + dy * dy);
            if (t >= 0 && t <= 1) {
              const px = p1.x + t * dx;
              const py = p1.y + t * dy;
              const dist = Math.hypot(px - scenePos.x, py - scenePos.y);
              if (dist < minDist) {
                minDist = dist;
                bestIdx = i + 1;
                bestPoint = { x: px, y: py };
              }
            }
          }
          if (bestIdx !== -1) setHoveredSegment({ pathId, insertIndex: bestIdx, point: bestPoint });
          else setHoveredSegment(null);
        }
      } else if (hoveredSegment) setHoveredSegment(null);

      // --- Exclusive: nudge drag ---
      if (nudgeDragState) {
        const delta = {
          x: scenePos.x - nudgeDragState.startScenePos.x,
          y: scenePos.y - nudgeDragState.startScenePos.y,
        };
        const didMove = Math.abs(delta.x) > 1e-4 || Math.abs(delta.y) > 1e-4;
        if (!didMove && !nudgeDidMoveRef.current) {
          return true;
        }
        if (didMove) {
          nudgeDidMoveRef.current = true;
        }
        const nudgeRadiusScene = nudgeRadius / zoom;
        const newPaths = (selectedNode as RotoNode).paths.map((p) => {
          const affectedPathData = nudgeDragState.affectedPaths.find((ap) => ap.pathId === p.id);
          if (!affectedPathData) return p;
          const newPoints = [...affectedPathData.originalPoints];
          const resolvedPoints = resolvePathPoints(selectedNode as RotoNode, p);

          const newPointsSynced = newPoints.map((pt, i) => {
            const affectedInfo = affectedPathData.affectedIndices.find((idx) => idx.index === i);
            let targetX: number;
            let targetY: number;

            if (affectedInfo) {
              const originalResolvedPoint = affectedPathData.resolvedStartPoints[i];
              const initialDist = affectedInfo.dist;
              const weight = e.shiftKey
                ? 1.0
                : 1.0 - Math.min(1.0, Math.max(0.0, initialDist / nudgeRadiusScene));
              targetX = originalResolvedPoint.x + delta.x * weight;
              targetY = originalResolvedPoint.y + delta.y * weight;
            } else {
              targetX = resolvedPoints[i]?.x ?? getLinearValueAtFrame(pt.x, visualFrame);
              targetY = resolvedPoints[i]?.y ?? getLinearValueAtFrame(pt.y, visualFrame);
            }

            const projectedPoint = projectScenePointToPathBase(selectedNode as RotoNode, p, i, {
              x: targetX,
              y: targetY,
            });
            return {
              x: setKeyframeOnValue(pt.x, visualFrame, projectedPoint.x),
              y: setKeyframeOnValue(pt.y, visualFrame, projectedPoint.y),
            };
          });

          return { ...p, points: newPointsSynced };
        });
        updateNode(selectedNode!.id, { paths: newPaths }, false);
        return true;
      }

      // --- Passive: nudge preview ---
      if (
        activeViewportTool === 'nudge' &&
        !nudgeDragState &&
        selectedNode?.type === NodeType.ROTO &&
        mouseScenePos
      ) {
        const selectedPaths = (selectedNode as RotoNode).paths.filter(
          (p) =>
            selectedRotoPathIds.includes(p.id) && isRotoPathVisible(selectedNode as RotoNode, p),
        );
        const nudgeRadiusScene = nudgeRadius / zoom;
        const previewPoints: NudgePreviewPoint[] = [];
        selectedPaths.forEach((path) => {
          const resolvedPoints = resolvePathPoints(selectedNode as RotoNode, path);
          resolvedPoints.forEach((point, index) => {
            const dist = Math.hypot(point.x - mouseScenePos.x, point.y - mouseScenePos.y);
            if (dist < nudgeRadiusScene) {
              const weight = e.shiftKey ? 1.0 : 1.0 - dist / nudgeRadiusScene;
              previewPoints.push({
                pathId: path.id,
                pointIndex: index,
                weight: weight * weight,
              });
            }
          });
        });
        setNudgePreviewPoints(previewPoints);
      } else if (nudgePreviewPoints.length > 0) setNudgePreviewPoints([]);

      // --- Passive: freehand draw ---
      if (freehandPoints) setFreehandPoints((points) => [...(points || []), scenePos]);

      // --- Exclusive: point drag ---
      if (dragPointState && selectedNode?.type === NodeType.ROTO) {
        const delta = {
          x: scenePos.x - dragPointState.startScene.x,
          y: scenePos.y - dragPointState.startScene.y,
        };
        const pathSnapshotsById = new Map<string, (typeof dragPointState.pathSnapshots)[number]>(
          dragPointState.pathSnapshots.map((pathSnapshot) => [pathSnapshot.pathId, pathSnapshot]),
        );
        const rotoNode = selectedNode as RotoNode;
        const newPaths = rotoNode.paths.map((path) => {
          const pathSnapshot = pathSnapshotsById.get(path.id);
          if (!pathSnapshot) return path;

          const selectedPointIndexSet = new Set(pathSnapshot.pointIndices);
          return {
            ...pathSnapshot.originalPath,
            points: pathSnapshot.originalPath.points.map((pt, idx) => {
              const resolvedStart = pathSnapshot.startResolvedPoints[idx];

              const projectedPoint = projectScenePointToPathBase(
                rotoNode,
                pathSnapshot.originalPath,
                idx,
                selectedPointIndexSet.has(idx)
                  ? { x: resolvedStart.x + delta.x, y: resolvedStart.y + delta.y }
                  : { x: resolvedStart.x, y: resolvedStart.y },
              );

              return {
                x: setKeyframeOnValue(pt.x, visualFrame, projectedPoint.x),
                y: setKeyframeOnValue(pt.y, visualFrame, projectedPoint.y),
              };
            }),
          };
        });
        updateNode(selectedNode.id, { paths: newPaths }, false);
        return true;
      }

      // --- Exclusive: drawing point drag ---
      if (dragNewPointIndex !== null && isDrawing) {
        updateDrawingPoint(
          dragNewPointIndex,
          selectedNode?.type === NodeType.ROTO
            ? projectScenePointToLayerLocal(
                selectedNode as RotoNode,
                drawingRotoPath?.parentLayerId ?? null,
                scenePos,
              )
            : scenePos,
        );
        return true;
      }

      // --- Exclusive: inserted point drag ---
      if (insertedPointDragState && selectedNode?.type === NodeType.ROTO) {
        const { pathId, pointIndex } = insertedPointDragState;
        const rotoNode = selectedNode as RotoNode;
        const pathIndex = rotoNode.paths.findIndex((p) => p.id === pathId);

        if (pathIndex !== -1) {
          const path = rotoNode.paths[pathIndex];
          if (pointIndex < path.points.length) {
            const projectedPoint = projectScenePointToPathBase(
              rotoNode,
              path,
              pointIndex,
              scenePos,
            );

            const newPoints = [...path.points];
            newPoints[pointIndex] = {
              x: setKeyframeOnValue(newPoints[pointIndex].x, visualFrame, projectedPoint.x),
              y: setKeyframeOnValue(newPoints[pointIndex].y, visualFrame, projectedPoint.y),
            };

            const newPaths = [...rotoNode.paths];
            newPaths[pathIndex] = { ...path, points: newPoints };

            updateNode(selectedNode.id, { paths: newPaths }, false);
          }
        }
        return true;
      }

      // --- Passive: marquee / rectangle drawing state ---
      if (marqueeState) setMarqueeState((s) => (s ? { ...s, current: scenePos } : null));
      if (drawingState) setDrawingState((s) => (s ? { ...s, current: scenePos } : null));

      // --- Passive: bspline preview ---
      if (activeViewportTool === 'bspline' && isDrawing && dragNewPointIndex === null)
        setBsplinePreviewPoint(scenePos);
      else if (bsplinePreviewPoint) setBsplinePreviewPoint(null);

      // --- Passive: close-point hover ---
      let hoveringClose = false;
      const threshold = 10 / zoom;
      if (
        activeViewportTool === 'bspline' &&
        isDrawing &&
        drawingRotoPath &&
        drawingRotoPath.points.length >= 3
      ) {
        const firstPointResolved =
          selectedNode?.type === NodeType.ROTO
            ? resolvePathPoints(selectedNode as RotoNode, drawingRotoPath)[0]
            : {
                x: getLinearValueAtFrame(drawingRotoPath.points[0].x, visualFrame),
                y: getLinearValueAtFrame(drawingRotoPath.points[0].y, visualFrame),
              };
        hoveringClose =
          Math.hypot(firstPointResolved.x - scenePos.x, firstPointResolved.y - scenePos.y) <
          threshold;
      } else if (activeViewportTool === 'freehand' && freehandPoints && freehandPoints.length > 10)
        hoveringClose =
          Math.hypot(freehandPoints[0].x - scenePos.x, freehandPoints[0].y - scenePos.y) <
          threshold;
      setIsHoveringClosePoint(hoveringClose);

      return false;
    },
    [
      transformDragState,
      selectedNode,
      visualFrame,
      updateNode,
      pointWeightDragState,
      rotoPointWeightMode,
      altPressed,
      selectedRotoPathIds,
      zoom,
      hoveredSegment,
      nudgeDragState,
      nudgeRadius,
      activeViewportTool,
      mouseScenePos,
      nudgePreviewPoints.length,
      freehandPoints,
      dragPointState,
      isDrawing,
      dragNewPointIndex,
      updateDrawingPoint,
      insertedPointDragState,
      marqueeState,
      drawingState,
      bsplinePreviewPoint,
      drawingRotoPath,
    ],
  );

  // -----------------------------------------------------------------------
  // handleMouseUp — roto interactions
  // -----------------------------------------------------------------------
  const handleMouseUp = useCallback(
    (e: ViewportMouseEvent): boolean => {
      // Transform commit
      if (transformDragState) {
        if (transformDidChangeRef.current) {
          pushHistory({
            label:
              transformDragState.selectionMode === 'points'
                ? 'Transform Roto Points'
                : 'Transform Roto Shapes',
            state: { nodes, selectedNodeId },
          });
        }
        transformDidChangeRef.current = false;
        setTransformDragState(null);
        return true;
      }

      // Radius adjust end
      if (isAdjustingRadius) {
        setIsAdjustingRadius(false);
        radiusAdjustStartRef.current = null;
        return true;
      }

      // Nudge commit
      if (nudgeDragState) {
        if (nudgeDidMoveRef.current) {
          pushHistory({ label: 'Nudge Stroke', state: { nodes, selectedNodeId } });
        } else if (selectedNode?.type === NodeType.ROTO) {
          const rotoNode = selectedNode as RotoNode;
          const { paths, didBake } = bakeNudgeDragStateKeyframes(rotoNode, nudgeDragState);

          if (didBake) {
            const newNodes = nodes.map((node) =>
              node.id === selectedNode.id ? ({ ...rotoNode, paths } as RotoNode) : node,
            );
            updateNode(selectedNode.id, { paths }, false);
            pushHistory({
              label: 'Keyframe Nudge Area',
              state: { nodes: newNodes, selectedNodeId },
            });
          }
        }
        nudgeDidMoveRef.current = false;
        setNudgeDragState(null);
        return true;
      }

      if (pointWeightDragState) {
        pushHistory({
          label:
            pointWeightDragState.pointIndices.length === 1
              ? 'Adjust Point Weight'
              : 'Adjust Point Weights',
          state: { nodes, selectedNodeId },
        });
        setPointWeightDragState(null);
        return true;
      }

      // Drawing point end
      if (dragNewPointIndex !== null) {
        setDragNewPointIndex(null);
        return true;
      }

      // Inserted point end
      if (insertedPointDragState) {
        pushHistory({ label: 'Move Roto Point', state: { nodes, selectedNodeId } });
        setInsertedPointDragState(null);
        return true;
      }

      // Freehand commit
      if (freehandPoints && selectedNode?.type === NodeType.ROTO) {
        const rect = viewportRef.current!.getBoundingClientRect();
        const left = e.clientX - rect.left;
        const top = e.clientY - rect.top;
        if (freehandPoints.length > 3) {
          const distance = Math.hypot(
            freehandPoints[0].x - freehandPoints[freehandPoints.length - 1].x,
            freehandPoints[0].y - freehandPoints[freehandPoints.length - 1].y,
          );
          startRotoRefinement({
            name: `Shape ${(selectedNode as RotoNode).paths.length + 1}`,
            originalPoints: freehandPoints,
            epsilon: 2 / zoom,
            closed: distance < 10 / zoom,
            popupPosition: { left, top },
          });
        }
        setFreehandPoints(null);
        setIsHoveringClosePoint(false);
        return true;
      }

      // Point drag commit
      if (dragPointState) {
        pushHistory({ label: `Move Roto Points`, state: { nodes, selectedNodeId } });
        setDragPointState(null);
        return true;
      }

      // Marquee selection
      if (marqueeState) {
        const isClick =
          Math.abs(marqueeState.start.x - marqueeState.current.x) < 2 / zoom &&
          Math.abs(marqueeState.start.y - marqueeState.current.y) < 2 / zoom;
        if (isClick) {
          if (selectedRotoPointRefs.length > 0) {
            setSelectedRotoSelection({ layerIds: [], pathIds: [], pointRefs: [] });
          } else if (selectedRotoPathIds.length > 0) setSelectedRotoPathIds([]);
        } else {
          const mRect = {
            x1: Math.min(marqueeState.start.x, marqueeState.current.x),
            y1: Math.min(marqueeState.start.y, marqueeState.current.y),
            x2: Math.max(marqueeState.start.x, marqueeState.current.x),
            y2: Math.max(marqueeState.start.y, marqueeState.current.y),
          };
          if (selectedNode?.type === NodeType.ROTO) {
            const selectedPathPointHits = selectedRotoPathIds
              .map((pathId) => {
                const path = (selectedNode as RotoNode).paths.find(
                  (candidate) => candidate.id === pathId,
                );
                if (!path || !isRotoPathVisible(selectedNode as RotoNode, path)) return null;

                const indices = resolvePathPoints(selectedNode as RotoNode, path).reduce(
                  (acc, point, idx) => {
                    if (
                      point.x >= mRect.x1 &&
                      point.x <= mRect.x2 &&
                      point.y >= mRect.y1 &&
                      point.y <= mRect.y2
                    ) {
                      acc.push(idx);
                    }
                    return acc;
                  },
                  [] as number[],
                );

                return indices.length > 0 ? { pathId: path.id, indices } : null;
              })
              .filter((entry): entry is { pathId: string; indices: number[] } => entry !== null);

            if (selectedPathPointHits.length > 0) {
              const marqueePointRefs = selectedPathPointHits.flatMap(({ pathId, indices }) =>
                indices.map((pointIndex) => ({ pathId, pointIndex })),
              );
              const nextPointRefs = e.shiftKey
                ? dedupeRotoPointRefs([...selectedRotoPointRefs, ...marqueePointRefs])
                : marqueePointRefs;
              setSelectedRotoSelection({
                layerIds: [],
                pathIds: Array.from(new Set(nextPointRefs.map((pointRef) => pointRef.pathId))),
                pointRefs: nextPointRefs,
              });
            } else {
              const ids = (selectedNode as RotoNode).paths
                .filter(
                  (path) =>
                    isRotoPathVisible(selectedNode as RotoNode, path) &&
                    resolvePathPoints(selectedNode as RotoNode, path).some(
                      (p) =>
                        p.x >= mRect.x1 && p.x <= mRect.x2 && p.y >= mRect.y1 && p.y <= mRect.y2,
                    ),
                )
                .map((p) => p.id);
              if (ids.length > 0)
                setSelectedRotoPathIds(
                  e.shiftKey ? [...new Set([...selectedRotoPathIds, ...ids])] : ids,
                );
            }
          }
        }
        setMarqueeState(null);
        return true;
      }

      // Rectangle draw commit
      if (drawingState && selectedNode?.type === NodeType.ROTO) {
        const scenePoints = getRotoRectangleCornerPoints(drawingState.start, drawingState.current);
        const width = Math.abs(scenePoints[1].x - scenePoints[0].x);
        const height = Math.abs(scenePoints[2].y - scenePoints[1].y);
        if (width < 2 || height < 2) {
          setDrawingState(null);
          return true;
        }

        const parentLayerId = getRotoCreationParentLayerId(
          selectedNode as RotoNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
        );
        const localPoints = scenePoints.map((point) =>
          projectScenePointToLayerLocal(selectedNode as RotoNode, parentLayerId, point),
        );

        const newPath = createRotoRectanglePath({
          id: `path_${Date.now()}`,
          name: `Shape ${(selectedNode as RotoNode).paths.length + 1}`,
          parentLayerId,
          points: localPoints,
          frame: visualFrame,
        });

        updateNode(selectedNode.id, prependRotoPath(selectedNode as RotoNode, newPath), true);
        setSelectedRotoPathIds([newPath.id]);
        setDrawingState(null);
        setActiveViewportTool('select');
        return true;
      }

      return false;
    },
    [
      transformDragState,
      nodes,
      selectedNodeId,
      pushHistory,
      isAdjustingRadius,
      nudgeDragState,
      pointWeightDragState,
      dragNewPointIndex,
      insertedPointDragState,
      freehandPoints,
      selectedNode,
      zoom,
      selectedRotoPointRefs,
      startRotoRefinement,
      viewportRef,
      dragPointState,
      bakeNudgeDragStateKeyframes,
      marqueeState,
      setSelectedRotoSelection,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      visualFrame,
      setSelectedRotoPathIds,
      drawingState,
      updateNode,
      setActiveViewportTool,
    ],
  );

  // -----------------------------------------------------------------------
  // handleMouseLeave — cleanup roto state
  // -----------------------------------------------------------------------
  const handleMouseLeave = useCallback((): void => {
    if (drawingState) setDrawingState(null);
    if (marqueeState) setMarqueeState(null);
    if (transformDragState) {
      if (transformDidChangeRef.current) {
        pushHistory({
          label:
            transformDragState.selectionMode === 'points'
              ? 'Transform Roto Points'
              : 'Transform Roto Shapes',
          state: { nodes, selectedNodeId },
        });
      }
      setTransformDragState(null);
      transformDidChangeRef.current = false;
    }
    if (dragPointState) {
      pushHistory({ label: `Move Roto Points`, state: { nodes, selectedNodeId } });
      setDragPointState(null);
    }
    if (nudgeDragState) {
      if (nudgeDidMoveRef.current) {
        pushHistory({ label: 'Nudge Stroke', state: { nodes, selectedNodeId } });
      } else if (selectedNode?.type === NodeType.ROTO) {
        const rotoNode = selectedNode as RotoNode;
        const { paths, didBake } = bakeNudgeDragStateKeyframes(rotoNode, nudgeDragState);

        if (didBake) {
          const newNodes = nodes.map((node) =>
            node.id === selectedNode.id ? ({ ...rotoNode, paths } as RotoNode) : node,
          );
          updateNode(selectedNode.id, { paths }, false);
          pushHistory({
            label: 'Keyframe Nudge Area',
            state: { nodes: newNodes, selectedNodeId },
          });
        }
      }
      nudgeDidMoveRef.current = false;
      setNudgeDragState(null);
    }
    if (pointWeightDragState) {
      pushHistory({
        label:
          pointWeightDragState.pointIndices.length === 1
            ? 'Adjust Point Weight'
            : 'Adjust Point Weights',
        state: { nodes, selectedNodeId },
      });
      setPointWeightDragState(null);
    }
    if (dragNewPointIndex !== null) setDragNewPointIndex(null);
    if (insertedPointDragState) {
      pushHistory({ label: 'Move Roto Point', state: { nodes, selectedNodeId } });
      setInsertedPointDragState(null);
    }
    setHoveredTransformHandle(null);
    setNudgePreviewPoints([]);
    if (bsplinePreviewPoint) setBsplinePreviewPoint(null);
    if (freehandPoints) setFreehandPoints(null);
    if (isHoveringClosePoint) setIsHoveringClosePoint(false);
    setHoveredSegment(null);
  }, [
    drawingState,
    marqueeState,
    transformDragState,
    nodes,
    selectedNodeId,
    pushHistory,
    selectedNode,
    updateNode,
    dragPointState,
    nudgeDragState,
    bakeNudgeDragStateKeyframes,
    pointWeightDragState,
    dragNewPointIndex,
    insertedPointDragState,
    bsplinePreviewPoint,
    freehandPoints,
    isHoveringClosePoint,
  ]);

  const shouldForceOverlays =
    selectedNode?.type === NodeType.ROTO &&
    (isDrawing ||
      !!rotoRefinement ||
      !!drawingState ||
      !!freehandPoints ||
      !!dragPointState ||
      !!transformDragState ||
      !!temporalController ||
      !!pointWeightDragState ||
      !!pointWeightControlState ||
      !!insertedPointDragState ||
      !!marqueeState);
  const isEditingRotoPaths =
    selectedNode?.type === NodeType.ROTO &&
    (!!dragPointState ||
      !!transformDragState ||
      !!nudgeDragState ||
      !!pointWeightDragState ||
      !!insertedPointDragState);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------
  return {
    // Event handlers for Viewport to call
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleContextMenu,
    deletePointsInNudgeArea,
    cleanupOnToolChange,
    handlePointMouseDown,
    beginRotoTransformDrag,
    beginPointWeightDrag,
    setSelectedPointWeightMode,
    setSelectedPointType,
    setTemporalControllerValue: setTemporalControllerInputValue,
    commitTemporalController,

    // State for RotoOverlay
    drawingState,
    freehandPoints,
    isHoveringClosePoint,
    bsplinePreviewPoint,
    hoveredRotoPathId,
    setHoveredRotoPathId,
    hoveredSegment,
    marqueeState,
    dragPointState,
    hoveredPointInfo,
    setHoveredPointInfo,
    transformDragState,
    hoveredTransformHandle,
    setHoveredTransformHandle,
    nudgeDragState,
    isAdjustingRadius,
    radiusAdjustStartRef,
    nudgePreviewPoints,
    insertedPointDragState,
    pointWeightDragState,
    pointWeightControlState,
    temporalController,
    dragNewPointIndex,

    // Derived state for RotoOverlay + cursor
    bsplineDrawingState,
    rotoTransformSelection,
    transformHandlesEnabled,
    transformIsDegenerate,
    transformHandlePositions,
    transformRotateHandlePoint,
    transformInteractionOperation,
    transformInteractionLabel,
    activeTransformHandle,
    transformHandleSize,
    transformHandleHitSize,
    transformMoveHandleRadius,
    transformRotateHitRadius,
    isMoveTransformActive,
    isMoveTransformHovered,
    isRotateTransformActive,
    isRotateTransformHovered,
    isRotoSelectActive,
    isEditingRotoPaths,
    shouldForceOverlays,
  };
}
