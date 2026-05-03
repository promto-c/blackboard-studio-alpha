/**
 * RotoOverlay — Renders all roto-tool SVG overlays in the viewport.
 *
 * Extracted from Viewport.tsx to keep per-effect overlay rendering
 * in its own file, registered via `ViewportOverlayComponent`.
 *
 * Covers: nudge tool, transform selection (degenerate + handles),
 * roto paths with motion cues, hovered segment, refinement preview,
 * B-spline drawing + preview, shape rect, freehand, close-point hover,
 * marquee, and tracking points.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type RotoNode,
  type RotoPath,
  type RotoPointRef,
  type RotoPointType,
  RotoShapeType,
  RotoDrawMode,
} from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { generateBSplinePath } from '@/utils/bspline';
import {
  ROTO_POINT_WEIGHT_HANDLE_RADIUS_PX,
  getRotoPointWeight,
  getRotoPointWeightModeForSelection,
  getRotoPointWeightHandleNormal,
  getRotoPointWeightHandlePosition,
  type RotoPointWeightMode,
} from '@/utils/rotoPointWeights';
import { getRotoPointTypeForSelection } from '@/utils/rotoPointTypes';
import { getVisibleRotoPaths } from '@/utils/rotoHierarchy';
import {
  resolveRotoPathPointsAtFrame,
  stabilizePoint,
  stabilizePoints,
} from '@/utils/rotoTracking';
import RotoControlPoint from '@/features/viewport/RotoControlPoint';
import {
  isEdgeTransformHandle,
  type TransformHandleKind,
  type ScenePoint,
} from '@/utils/rotoTransform';
import type { HeatlineSegment } from '@/utils/rotoMotionCue';
import type {
  GradientTrailPath,
  MotionBlurCuePath,
  NudgePreviewPoint,
  RotoTemporalControllerState,
  RotoTemporalControllerValue,
  RotoTransformSelection,
} from '@/features/viewport/viewportOverlayTypes';

function getPathDataFromResolvedPoints(
  points: { x: number; y: number }[],
  shapeType: RotoShapeType,
  closed: boolean,
  pointWeights?: readonly number[],
  pointWeightMode?: RotoPointWeightMode,
  pointTypes?: readonly RotoPointType[],
  pointWeightModes?: readonly (RotoPointWeightMode | null)[],
): string {
  if (points.length < 2) return '';
  if (shapeType === RotoShapeType.BSPLINE) {
    return generateBSplinePath(
      points,
      closed,
      pointWeights,
      pointWeightMode,
      pointTypes,
      pointWeightModes,
    );
  }
  return getLinearPathData(points, closed);
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const yellowOverlay = (alpha: number) => `rgba(255, 255, 0, ${clampUnit(alpha)})`;

const getTemporalCurveEnvelope = (time: number, defaultValue: number): number => {
  const value = clampUnit(time);
  const pivot = clampUnit(defaultValue);

  if (value <= pivot) {
    if (pivot <= 0) return value <= 0 ? 1 : 0;
    return Math.sin((value / pivot) * (Math.PI / 2));
  }

  if (pivot >= 1) return value >= 1 ? 1 : 0;
  return Math.sin(((1 - value) / (1 - pivot)) * (Math.PI / 2));
};

const getLinearPathData = (points: { x: number; y: number }[], closed: boolean): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (closed ? ' Z' : '');

const getRotoPointRefKey = ({ pathId, pointIndex }: RotoPointRef): string =>
  `${pathId}:${pointIndex}`;

type VisiblePathRenderData = {
  path: RotoPath;
  opacityAtFrame: number;
  pathData: string;
  resolvedPoints: { x: number; y: number }[];
  strokeWidthAtFrame: number;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Nudge tool visualisation state (circle + affected-point preview). */
export interface NudgeOverlayState {
  activeViewportTool: string;
  altPressed: boolean;
  isAdjustingRadius: boolean;
  nudgeDragState: unknown | null;
  radiusAdjustCenter: { x: number; y: number } | null;
  radiusAdjustInitialRadius: number | null;
  mouseScenePos: { x: number; y: number } | null;
  nudgeRadius: number;
  nudgePreviewPoints: NudgePreviewPoint[];
}

/** B-spline drawing preview. */
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
      }
    | null;
}

/** Shape-rectangle drawing state. */
export interface ShapeDrawingState {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

/** Marquee selection state. */
export interface MarqueeState {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

/** Transform handle layout info. */
export interface TransformHandlePosition {
  handle: TransformHandleKind;
  point: ScenePoint;
}

export interface RotoOverlayProps {
  /** The currently-selected roto node. */
  node: RotoNode;
  /** Current display frame. */
  frame: number;
  /** Viewport zoom factor. */
  zoom: number;

  // -- Selection ---------------------------------------------------------
  selectedRotoPathIds: string[];
  selectedRotoPointRefs: RotoPointRef[];
  setSelectedRotoPathIds: (ids: string[]) => void;
  isRotoSelectActive: boolean;

  // -- Active viewport tool ----------------------------------------------
  activeViewportTool: string;

  // -- Nudge -------------------------------------------------------------
  nudge: NudgeOverlayState;

  // -- Transform ---------------------------------------------------------
  rotoTransformSelection: RotoTransformSelection | null;
  transformIsDegenerate: boolean;
  transformMoveHandleRadius: number;
  transformRotateHitRadius: number;
  transformHandleSize: number;
  transformHandleHitSize: number;
  transformHandlePositions: TransformHandlePosition[];
  transformRotateHandlePoint: ScenePoint | null;
  transformInteractionLabel: string | null;
  activeTransformHandle: TransformHandleKind | null;
  hoveredTransformHandle: TransformHandleKind | null;
  affineModifierPressed: boolean;
  isMoveTransformActive: boolean;
  isMoveTransformHovered: boolean;
  isRotateTransformActive: boolean;
  isRotateTransformHovered: boolean;
  beginRotoTransformDrag: (e: React.MouseEvent, handle: TransformHandleKind) => void;
  setHoveredTransformHandle: (h: TransformHandleKind | null) => void;

  // -- Path hover --------------------------------------------------------
  hoveredRotoPathId: string | null;
  setHoveredRotoPathId: (id: string | null) => void;

  // -- Point drag / hover ------------------------------------------------
  dragPointState: unknown | null;
  hoveredPointInfo: { pathId: string; pointIndex: number } | null;
  handlePointMouseDown: (e: React.MouseEvent, pathId: string, idx: number) => void;
  beginPointWeightDrag: (
    e: React.MouseEvent,
    pathId: string,
    pointIndex: number,
    handleNormal: ScenePoint,
  ) => void;
  setSelectedPointWeightMode: (
    pathId: string,
    pointIndices: number[],
    pointWeightMode: RotoPointWeightMode,
  ) => void;
  setSelectedPointType: (pathId: string, pointIndices: number[], pointType: RotoPointType) => void;
  setHoveredPointInfo: (info: { pathId: string; pointIndex: number } | null) => void;
  pointWeightDragState: { pathId: string; pointIndices: number[] } | null;
  pointWeightControlState: { pathId: string; pointIndex: number; pointIndices: number[] } | null;
  rotoPointWeightMode: RotoPointWeightMode;
  temporalController: RotoTemporalControllerState | null;
  onTemporalControllerChange: (value: RotoTemporalControllerValue | null) => void;
  onTemporalControllerCommit: (value: RotoTemporalControllerValue) => void;

  // -- Motion cues -------------------------------------------------------
  motionCueTargetPathIdSet: Set<string>;
  rotoMotionCueEnabled: boolean;
  rotoMotionCueMode: string;
  gradientTrailsByPath: Map<string, GradientTrailPath[]>;
  speedHeatSegmentsByPath: Map<string, HeatlineSegment[]>;
  motionBlurCuePathsByPath: Map<string, MotionBlurCuePath[]>;

  // -- Hovered segment (insert-point preview) ----------------------------
  hoveredSegment: { pathId: string; insertIndex: number; point: { x: number; y: number } } | null;

  // -- Roto refinement ---------------------------------------------------
  rotoRefinement: { closed: boolean; targetPathId?: string; epsilon: number } | null;
  refinementSimplifiedPoints: { x: number; y: number }[];

  // -- Drawing -----------------------------------------------------------
  isDrawing: boolean;
  drawingRotoPath: RotoPath | null;
  bsplineDrawingState: BsplineDrawingState | null;
  drawingState: ShapeDrawingState | null;
  freehandPoints: { x: number; y: number }[] | null;
  isHoveringClosePoint: boolean;

  // -- Marquee -----------------------------------------------------------
  marqueeState: MarqueeState | null;

  // -- Tracking ----------------------------------------------------------
  activeTrackingPoints: { x: number; y: number }[] | null;

  // -- Rendering mode ----------------------------------------------------
  /** Render only cursor feedback while overlays are hidden. */
  cursorOnly?: boolean;

  // -- Stabilization ------------------------------------------------------
  stabilizationMatrix: number[][] | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RotoOverlay: React.FC<RotoOverlayProps> = (props) => {
  const {
    node,
    frame,
    zoom,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    setSelectedRotoPathIds,
    isRotoSelectActive,
    activeViewportTool,
    altPressed,
    nudge,
    rotoTransformSelection,
    transformIsDegenerate,
    transformMoveHandleRadius,
    transformRotateHitRadius,
    transformHandleSize,
    transformHandleHitSize,
    transformHandlePositions,
    transformRotateHandlePoint,
    transformInteractionLabel,
    activeTransformHandle,
    hoveredTransformHandle,
    affineModifierPressed,
    isMoveTransformActive,
    isMoveTransformHovered,
    isRotateTransformActive,
    isRotateTransformHovered,
    beginRotoTransformDrag,
    setHoveredTransformHandle,
    hoveredRotoPathId,
    setHoveredRotoPathId,
    dragPointState,
    hoveredPointInfo,
    handlePointMouseDown,
    beginPointWeightDrag,
    setSelectedPointWeightMode,
    setSelectedPointType,
    setHoveredPointInfo,
    pointWeightDragState,
    pointWeightControlState,
    rotoPointWeightMode,
    temporalController,
    onTemporalControllerChange,
    onTemporalControllerCommit,
    motionCueTargetPathIdSet,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    gradientTrailsByPath,
    speedHeatSegmentsByPath,
    motionBlurCuePathsByPath,
    hoveredSegment,
    rotoRefinement,
    refinementSimplifiedPoints,
    isDrawing,
    drawingRotoPath,
    bsplineDrawingState,
    drawingState,
    freehandPoints,
    isHoveringClosePoint,
    marqueeState,
    activeTrackingPoints,
    cursorOnly = false,
    stabilizationMatrix,
  } = props;
  const sp = (p: { x: number; y: number }) => stabilizePoint(p, stabilizationMatrix);
  const pathById = useMemo(() => new Map(node.paths.map((path) => [path.id, path])), [node.paths]);
  const temporalTrackRef = useRef<SVGGraphicsElement | null>(null);
  const temporalDragListenersRef = useRef<{
    move: (event: MouseEvent) => void;
    up: (event: MouseEvent) => void;
  } | null>(null);

  const clearTemporalDragListeners = useCallback(() => {
    const listeners = temporalDragListenersRef.current;
    if (!listeners) return;
    window.removeEventListener('mousemove', listeners.move);
    window.removeEventListener('mouseup', listeners.up);
    temporalDragListenersRef.current = null;
  }, []);

  useEffect(() => clearTemporalDragListeners, [clearTemporalDragListeners]);

  const getTemporalValueFromClientPoint = useCallback(
    (clientX: number, clientY: number): RotoTemporalControllerValue => {
      const trackRect = temporalTrackRef.current?.getBoundingClientRect();
      if (!trackRect || trackRect.width <= 0) {
        return {
          time: temporalController?.value ?? 0,
          mix: temporalController?.mixValue ?? 1,
        };
      }

      const rawTime = clampUnit((clientX - trackRect.left) / trackRect.width);
      if (!temporalController?.hasCurrentKeyframe || trackRect.height <= 0) {
        return { time: rawTime, mix: 1 };
      }

      const envelope = getTemporalCurveEnvelope(rawTime, temporalController.defaultValue);
      const mix =
        envelope <= 0.0001
          ? 1
          : clampUnit(
              (clientY - (trackRect.bottom - trackRect.height * envelope)) /
                (trackRect.height * envelope),
            );
      return { time: rawTime, mix };
    },
    [
      temporalController?.defaultValue,
      temporalController?.hasCurrentKeyframe,
      temporalController?.mixValue,
      temporalController?.value,
    ],
  );

  const beginTemporalControllerDrag = useCallback(
    (event: React.MouseEvent<SVGElement>): void => {
      if (event.button !== 0 || !temporalController) return;
      event.preventDefault();
      event.stopPropagation();

      clearTemporalDragListeners();
      onTemporalControllerChange(getTemporalValueFromClientPoint(event.clientX, event.clientY));

      const move = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        onTemporalControllerChange(
          getTemporalValueFromClientPoint(moveEvent.clientX, moveEvent.clientY),
        );
      };
      const up = (upEvent: MouseEvent) => {
        upEvent.preventDefault();
        const value = getTemporalValueFromClientPoint(upEvent.clientX, upEvent.clientY);
        onTemporalControllerChange(value);
        onTemporalControllerCommit(value);
        clearTemporalDragListeners();
      };
      temporalDragListenersRef.current = { move, up };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [
      clearTemporalDragListeners,
      getTemporalValueFromClientPoint,
      onTemporalControllerChange,
      onTemporalControllerCommit,
      temporalController,
    ],
  );
  const selectedPathIdSet = useMemo(() => new Set(selectedRotoPathIds), [selectedRotoPathIds]);
  const selectedPointRefKeySet = useMemo(
    () => new Set(selectedRotoPointRefs.map((pointRef) => getRotoPointRefKey(pointRef))),
    [selectedRotoPointRefs],
  );
  const singleSelectedPathId = selectedRotoPathIds.length === 1 ? selectedRotoPathIds[0] : null;
  const visiblePaths = useMemo(() => getVisibleRotoPaths(node), [node]);
  const temporalPreviewPointsByPathId = useMemo(() => {
    if (!temporalController || cursorOnly) return new Map<string, { x: number; y: number }[]>();

    return new Map(
      temporalController.paths.map((pathData) => [
        pathData.path.id,
        stabilizePoints(pathData.previewPoints, stabilizationMatrix),
      ]),
    );
  }, [cursorOnly, stabilizationMatrix, temporalController]);
  const visiblePathRenderData = useMemo<VisiblePathRenderData[]>(
    () =>
      visiblePaths.map((path) => {
        const resolvedPoints =
          temporalPreviewPointsByPathId.get(path.id) ??
          stabilizePoints(resolveRotoPathPointsAtFrame(node, path, frame), stabilizationMatrix);

        return {
          path,
          opacityAtFrame: clampUnit(getValueAtFrame(path.opacity, frame) / 100),
          pathData: getPathDataFromResolvedPoints(
            resolvedPoints,
            path.shapeType,
            path.closed,
            path.pointWeights,
            rotoPointWeightMode,
            path.pointTypes,
            path.pointWeightModes,
          ),
          resolvedPoints,
          strokeWidthAtFrame: getValueAtFrame(path.style.strokeWidth, frame),
        };
      }),
    [
      frame,
      node,
      rotoPointWeightMode,
      stabilizationMatrix,
      temporalPreviewPointsByPathId,
      visiblePaths,
    ],
  );
  const visiblePathRenderDataById = useMemo(
    () => new Map(visiblePathRenderData.map((pathData) => [pathData.path.id, pathData])),
    [visiblePathRenderData],
  );
  const shouldHideTransformSelectionOverlay = activeTransformHandle !== null;
  const nudgePreviewResolvedPoints = useMemo(
    () =>
      nudge.nudgePreviewPoints
        .map(({ pathId, pointIndex, weight }) => {
          const cachedPoint = visiblePathRenderDataById.get(pathId)?.resolvedPoints[pointIndex];
          if (cachedPoint) {
            return { pathId, pointIndex, weight, point: cachedPoint };
          }

          const path = pathById.get(pathId);
          if (!path) return null;

          const resolvedPoint = resolveRotoPathPointsAtFrame(node, path, frame)[pointIndex];
          if (!resolvedPoint) return null;

          return {
            pathId,
            pointIndex,
            weight,
            point: stabilizePoint(resolvedPoint, stabilizationMatrix),
          };
        })
        .filter((point): point is NonNullable<typeof point> => !!point),
    [
      frame,
      node,
      nudge.nudgePreviewPoints,
      pathById,
      stabilizationMatrix,
      visiblePathRenderDataById,
    ],
  );
  const drawingResolvedPoints = useMemo(
    () =>
      drawingRotoPath
        ? stabilizePoints(
            resolveRotoPathPointsAtFrame(node, drawingRotoPath, frame),
            stabilizationMatrix,
          )
        : [],
    [drawingRotoPath, frame, node, stabilizationMatrix],
  );
  const drawingPathData = useMemo(
    () =>
      drawingRotoPath
        ? generateBSplinePath(
            drawingResolvedPoints,
            drawingRotoPath.closed,
            drawingRotoPath.pointWeights,
            rotoPointWeightMode,
            drawingRotoPath.pointTypes,
            drawingRotoPath.pointWeightModes,
          )
        : '',
    [drawingResolvedPoints, drawingRotoPath, rotoPointWeightMode],
  );
  const refinementResolvedPoints = useMemo(
    () => (rotoRefinement ? stabilizePoints(refinementSimplifiedPoints, stabilizationMatrix) : []),
    [refinementSimplifiedPoints, rotoRefinement, stabilizationMatrix],
  );
  const stabilizedFreehandPoints = useMemo(
    () => (freehandPoints ? stabilizePoints(freehandPoints, stabilizationMatrix) : null),
    [freehandPoints, stabilizationMatrix],
  );
  const stabilizedActiveTrackingPoints = useMemo(
    () =>
      activeTrackingPoints ? stabilizePoints(activeTrackingPoints, stabilizationMatrix) : null,
    [activeTrackingPoints, stabilizationMatrix],
  );
  const temporalControllerRenderData = useMemo(() => {
    if (!temporalController || cursorOnly) return null;

    const paths = temporalController.paths.map((pathData) => {
      const oldPoints = stabilizePoints(pathData.oldPoints, stabilizationMatrix);
      const prevPoints = stabilizePoints(pathData.prevPoints, stabilizationMatrix);
      const nextPoints = stabilizePoints(pathData.nextPoints, stabilizationMatrix);
      const previewPoints = stabilizePoints(pathData.previewPoints, stabilizationMatrix);
      const motionPoints = pathData.motionPoints.map((motionPoint) => ({
        pointIndex: motionPoint.pointIndex,
        prev: stabilizePoint(motionPoint.prev, stabilizationMatrix),
        old: stabilizePoint(motionPoint.old, stabilizationMatrix),
        preview: stabilizePoint(motionPoint.preview, stabilizationMatrix),
        next: stabilizePoint(motionPoint.next, stabilizationMatrix),
      }));

      return {
        ...pathData,
        oldPoints,
        prevPoints,
        nextPoints,
        previewPoints,
        motionPoints,
        oldPathData: getPathDataFromResolvedPoints(
          oldPoints,
          pathData.path.shapeType,
          pathData.path.closed,
          pathData.path.pointWeights,
          rotoPointWeightMode,
          pathData.path.pointTypes,
          pathData.path.pointWeightModes,
        ),
        prevPathData: getPathDataFromResolvedPoints(
          prevPoints,
          pathData.path.shapeType,
          pathData.path.closed,
          pathData.path.pointWeights,
          rotoPointWeightMode,
          pathData.path.pointTypes,
          pathData.path.pointWeightModes,
        ),
        nextPathData: getPathDataFromResolvedPoints(
          nextPoints,
          pathData.path.shapeType,
          pathData.path.closed,
          pathData.path.pointWeights,
          rotoPointWeightMode,
          pathData.path.pointTypes,
          pathData.path.pointWeightModes,
        ),
      };
    });
    const allPoints = paths.flatMap((pathData) => [
      ...pathData.prevPoints,
      ...pathData.nextPoints,
      ...pathData.previewPoints,
      ...pathData.oldPoints,
    ]);
    if (allPoints.length === 0) return null;

    const bounds = allPoints.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );
    const boundsWidth = bounds.maxX - bounds.minX;
    const hasCurveControl = temporalController.hasCurrentKeyframe;
    const controllerWidth = Math.max(160 / zoom, Math.min(320 / zoom, boundsWidth + 32 / zoom));
    const controllerHeight = (hasCurveControl ? 74 : 42) / zoom;
    const controllerX = (bounds.minX + bounds.maxX) / 2 - controllerWidth / 2;
    const controllerY = bounds.maxY + 26 / zoom;
    const trackX = controllerX + 15 / zoom;
    const trackTopY = controllerY + (hasCurveControl ? 20 : 15) / zoom;
    const trackY = controllerY + (hasCurveControl ? 52 : 22) / zoom;
    const trackWidth = controllerWidth - 30 / zoom;
    const trackHeight = trackY - trackTopY;
    const knobX = trackX + trackWidth * temporalController.value;
    const knobEnvelope = getTemporalCurveEnvelope(
      temporalController.value,
      temporalController.defaultValue,
    );
    const knobY = hasCurveControl
      ? trackY - trackHeight * knobEnvelope * (1 - temporalController.mixValue)
      : trackY;
    const defaultX = trackX + trackWidth * temporalController.defaultValue;
    const curveSamples = hasCurveControl
      ? Array.from({ length: 25 }, (_item, index) => {
          const sampleTime = index / 24;
          return {
            x: trackX + trackWidth * sampleTime,
            y:
              trackY -
              trackHeight * getTemporalCurveEnvelope(sampleTime, temporalController.defaultValue),
          };
        })
      : [];
    const curveTopPathData = curveSamples
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
    const curveFillPathData =
      curveTopPathData.length > 0
        ? `${curveTopPathData} L ${trackX + trackWidth} ${trackY} L ${trackX} ${trackY} Z`
        : '';

    return {
      ...temporalController,
      paths,
      controllerX,
      controllerY,
      controllerWidth,
      controllerHeight,
      trackX,
      trackY,
      trackTopY,
      trackWidth,
      trackHeight,
      knobX,
      knobY,
      defaultX,
      curveTopPathData,
      curveFillPathData,
    };
  }, [cursorOnly, rotoPointWeightMode, stabilizationMatrix, temporalController, zoom]);
  const shouldRenderSelectPaths = !cursorOnly || isRotoSelectActive;

  return (
    <>
      {/* ── Nudge tool overlay ─────────────────────────────────── */}
      {(nudge.activeViewportTool === 'nudge' || nudge.isAdjustingRadius) &&
        (() => {
          const center =
            nudge.isAdjustingRadius && nudge.radiusAdjustCenter
              ? nudge.radiusAdjustCenter
              : nudge.mouseScenePos;
          if (!center) return null;
          const sCenter = sp(center);
          return (
            <g className="pointer-events-none">
              <circle
                cx={sCenter.x}
                cy={sCenter.y}
                r={nudge.nudgeRadius / zoom}
                fill="none"
                stroke={
                  nudge.isAdjustingRadius
                    ? 'rgba(255, 255, 0, 0.8)'
                    : nudge.nudgeDragState
                      ? 'rgba(255, 255, 0, 0.7)'
                      : 'rgba(255, 255, 0, 0.5)'
                }
                strokeWidth={
                  nudge.isAdjustingRadius || nudge.nudgeDragState ? 1.5 / zoom : 1 / zoom
                }
              />
              {nudge.isAdjustingRadius && nudge.radiusAdjustInitialRadius != null && (
                <circle
                  cx={sCenter.x}
                  cy={sCenter.y}
                  r={nudge.radiusAdjustInitialRadius / zoom}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.3)"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                />
              )}
              <circle cx={sCenter.x} cy={sCenter.y} r={2 / zoom} fill="rgba(255, 255, 0, 0.8)" />
              {nudgePreviewResolvedPoints.map(({ pathId, pointIndex, weight, point }) => {
                return (
                  <circle
                    key={`${pathId}-${pointIndex}-preview`}
                    cx={point.x}
                    cy={point.y}
                    r={4 / zoom}
                    fill="yellow"
                    fillOpacity={0.3 + weight * 0.7}
                    stroke="yellow"
                    strokeWidth={0.5 / zoom}
                    strokeOpacity={weight}
                  />
                );
              })}
            </g>
          );
        })()}

      {/* ── Transform selection: move target ─ */}
      {isRotoSelectActive && rotoTransformSelection && !shouldHideTransformSelectionOverlay && (
        <>
          {(() => {
            const sCenter = sp({
              x: rotoTransformSelection.bounds.centerX,
              y: rotoTransformSelection.bounds.centerY,
            });

            if (transformIsDegenerate) {
              return cursorOnly ? (
                <g>
                  <circle
                    cx={sCenter.x}
                    cy={sCenter.y}
                    r={transformMoveHandleRadius * 2}
                    fill="transparent"
                    className="pointer-events-auto"
                    onMouseDown={(e) => beginRotoTransformDrag(e, 'move')}
                    onMouseEnter={() => setHoveredTransformHandle('move')}
                    onMouseLeave={() => setHoveredTransformHandle(null)}
                  />
                  <circle
                    cx={sCenter.x}
                    cy={sCenter.y}
                    r={transformMoveHandleRadius * 1.25}
                    fill="none"
                    stroke="rgba(125, 211, 252, 0.95)"
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                    pointerEvents="none"
                  />
                </g>
              ) : (
                <g className="pointer-events-none">
                  <circle
                    cx={sCenter.x}
                    cy={sCenter.y}
                    r={transformMoveHandleRadius * 1.6}
                    fill="rgba(56, 189, 248, 0.12)"
                    stroke="rgba(56, 189, 248, 0.65)"
                    strokeWidth={1 / zoom}
                    pointerEvents="none"
                  />
                  <circle
                    cx={sCenter.x}
                    cy={sCenter.y}
                    r={transformMoveHandleRadius}
                    fill={
                      isMoveTransformActive
                        ? 'rgba(14, 116, 144, 0.95)'
                        : isMoveTransformHovered
                          ? 'rgba(14, 165, 233, 0.95)'
                          : 'rgba(56, 189, 248, 0.2)'
                    }
                    stroke={
                      isMoveTransformActive || isMoveTransformHovered
                        ? 'white'
                        : 'rgba(125, 211, 252, 0.9)'
                    }
                    strokeWidth={(isMoveTransformActive ? 1.4 : 1) / zoom}
                    className="pointer-events-auto"
                    onMouseDown={(e) => beginRotoTransformDrag(e, 'move')}
                    onMouseEnter={() => setHoveredTransformHandle('move')}
                    onMouseLeave={() => setHoveredTransformHandle(null)}
                  />
                </g>
              );
            }

            return null;
          })()}
        </>
      )}

      {/* ── Roto paths (stroke + control points + motion cues) ──────── */}
      {shouldRenderSelectPaths &&
        visiblePathRenderData.map(
          ({ path, opacityAtFrame, pathData, resolvedPoints, strokeWidthAtFrame }) => {
            const isSelected = selectedPathIdSet.has(path.id);
            const isSP = singleSelectedPathId === path.id;
            const canInteractWithPath = isRotoSelectActive && (isSelected || opacityAtFrame > 0);
            const isHovered = canInteractWithPath && path.id === hoveredRotoPathId && !isSelected;
            const canInteractWithPoints = isSelected && activeViewportTool === 'select';
            const canShowPointWeightHandles =
              isSP && (activeViewportTool === 'select' || activeViewportTool === 'nudge');
            const activePointWeightDragIndices =
              pointWeightDragState?.pathId === path.id ? pointWeightDragState.pointIndices : [];
            const pointWeightHandleIndices =
              activePointWeightDragIndices.length > 0
                ? activePointWeightDragIndices
                : selectedRotoPointRefs.length > 0
                  ? selectedRotoPointRefs
                      .filter((pointRef) => pointRef.pathId === path.id)
                      .map((pointRef) => pointRef.pointIndex)
                  : altPressed
                    ? resolvedPoints.map((_point, pointIndex) => pointIndex)
                    : [];
            const pointWeightHandleIndexSet = new Set(pointWeightHandleIndices);
            const showPointWeightHandles =
              canShowPointWeightHandles &&
              !cursorOnly &&
              (altPressed || activePointWeightDragIndices.length > 0) &&
              pointWeightHandleIndices.length > 0;

            const isMotionTarget = motionCueTargetPathIdSet.has(path.id);
            const shouldRenderGradientCue =
              !cursorOnly &&
              isMotionTarget &&
              rotoMotionCueEnabled &&
              rotoMotionCueMode === 'gradient_trail';
            const shouldRenderSpeedCue =
              !cursorOnly &&
              isMotionTarget &&
              rotoMotionCueEnabled &&
              rotoMotionCueMode === 'speed_heatline';

            const defaultStroke = isSelected
              ? cursorOnly
                ? 'transparent'
                : 'yellow'
              : isHovered
                ? cursorOnly
                  ? yellowOverlay(0.75)
                  : yellowOverlay(0.35 + opacityAtFrame * 0.45)
                : cursorOnly
                  ? 'transparent'
                  : yellowOverlay(0.0 + opacityAtFrame * 0.5);
            const gradientTrails = shouldRenderGradientCue
              ? gradientTrailsByPath.get(path.id) || []
              : [];
            const speedHeatSegments = shouldRenderSpeedCue
              ? speedHeatSegmentsByPath.get(path.id) || []
              : [];
            const motionBlurCuePaths =
              !cursorOnly && isMotionTarget && rotoMotionCueEnabled
                ? motionBlurCuePathsByPath.get(path.id) || []
                : [];

            return (
              <g
                key={path.id}
                className={canInteractWithPath ? 'pointer-events-auto' : 'pointer-events-none'}
                onMouseEnter={canInteractWithPath ? () => setHoveredRotoPathId(path.id) : undefined}
                onMouseLeave={canInteractWithPath ? () => setHoveredRotoPathId(null) : undefined}
                onMouseDown={
                  canInteractWithPath
                    ? (e) => {
                        if (e.button !== 0) return;
                        if (e.altKey) return;
                        e.stopPropagation();
                        if (isSelected && !e.shiftKey) {
                          beginRotoTransformDrag(e, 'move');
                          return;
                        }
                        if (e.shiftKey)
                          setSelectedRotoPathIds([...new Set([...selectedRotoPathIds, path.id])]);
                        else setSelectedRotoPathIds([path.id]);
                      }
                    : undefined
                }
              >
                {/* Hit-test stroke (transparent, fat) */}
                <path
                  d={pathData}
                  stroke="transparent"
                  strokeWidth={Math.max(10, strokeWidthAtFrame) / zoom}
                  fill="none"
                  className={canInteractWithPath ? 'cursor-pointer' : ''}
                />

                {/* Motion blur sample paths */}
                {motionBlurCuePaths.length > 0 && (
                  <g pointerEvents="none" strokeLinecap="round" strokeLinejoin="round">
                    {motionBlurCuePaths.map((blurPath) => (
                      <path
                        key={blurPath.key}
                        d={blurPath.d}
                        stroke={blurPath.stroke}
                        strokeWidth={blurPath.strokeWidth / zoom}
                        strokeOpacity={blurPath.opacity}
                        strokeDasharray={
                          blurPath.strokeDasharray ? `${6 / zoom} ${4 / zoom}` : undefined
                        }
                        fill="none"
                      />
                    ))}
                  </g>
                )}

                {/* Gradient trail motion cue */}
                {shouldRenderGradientCue && gradientTrails.length > 0 && (
                  <g pointerEvents="none">
                    {gradientTrails.map((trail) => (
                      <path
                        key={trail.key}
                        d={trail.d}
                        stroke={trail.stroke}
                        strokeWidth={trail.strokeWidth / zoom}
                        strokeOpacity={trail.opacity}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    ))}
                  </g>
                )}

                {/* Speed heatline motion cue */}
                {shouldRenderSpeedCue && speedHeatSegments.length > 0 && (
                  <g
                    pointerEvents="none"
                    strokeWidth={1 / zoom}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {speedHeatSegments.map((segment, segmentIndex) => (
                      <line
                        key={`${path.id}-heat-${segmentIndex}`}
                        x1={segment.x1}
                        y1={segment.y1}
                        x2={segment.x2}
                        y2={segment.y2}
                        stroke={segment.color}
                      />
                    ))}
                  </g>
                )}

                {/* Visible stroke */}
                <path
                  d={pathData}
                  stroke={defaultStroke}
                  strokeWidth={1 / zoom}
                  fill={
                    cursorOnly
                      ? path.closed && isHovered
                        ? 'rgba(255, 255, 0, 0.08)'
                        : 'none'
                      : !path.closed
                        ? 'none'
                        : (path.style.mode === RotoDrawMode.FILL ||
                              path.style.mode === RotoDrawMode.FILL_AND_STROKE) &&
                            isHovered
                          ? 'rgba(255, 255, 0, 0.1)'
                          : 'none'
                  }
                  className={canInteractWithPath ? 'cursor-pointer' : ''}
                />

                {/* Selected: control polygon + control points */}
                {isSelected && (
                  <>
                    {!cursorOnly && path.shapeType === RotoShapeType.BSPLINE && (
                      <path
                        d={getLinearPathData(resolvedPoints, path.closed)}
                        stroke="rgba(255, 255, 0, 0.5)"
                        strokeWidth={1 / zoom}
                        strokeDasharray={`${2 / zoom} ${3 / zoom}`}
                        fill="none"
                      />
                    )}
                    {resolvedPoints.map((p, i) => (
                      <RotoControlPoint
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        zoom={zoom}
                        isSelected={selectedPointRefKeySet.has(
                          getRotoPointRefKey({ pathId: path.id, pointIndex: i }),
                        )}
                        isHovered={
                          canInteractWithPoints &&
                          !dragPointState &&
                          hoveredPointInfo?.pathId === path.id &&
                          hoveredPointInfo.pointIndex === i
                        }
                        onMouseDown={
                          canInteractWithPoints
                            ? (e) => handlePointMouseDown(e, path.id, i)
                            : undefined
                        }
                        onMouseEnter={
                          canInteractWithPoints
                            ? () => setHoveredPointInfo({ pathId: path.id, pointIndex: i })
                            : undefined
                        }
                        onMouseLeave={
                          canInteractWithPoints ? () => setHoveredPointInfo(null) : undefined
                        }
                      />
                    ))}
                    {showPointWeightHandles &&
                      resolvedPoints.map((point, pointIndex) => {
                        if (!pointWeightHandleIndexSet.has(pointIndex)) return null;

                        const handleNormal = getRotoPointWeightHandleNormal(
                          resolvedPoints,
                          pointIndex,
                          path.closed,
                        );
                        const handlePoint = getRotoPointWeightHandlePosition(
                          point,
                          handleNormal,
                          getRotoPointWeight(path.pointWeights, path.points.length, pointIndex),
                          zoom,
                        );
                        const isWeightDragActive =
                          pointWeightDragState?.pathId === path.id &&
                          pointWeightDragState.pointIndices.includes(pointIndex);
                        const handleRadius = ROTO_POINT_WEIGHT_HANDLE_RADIUS_PX / zoom;

                        return (
                          <g
                            key={`weight-${pointIndex}`}
                            className="pointer-events-auto cursor-grab"
                            onMouseDown={(e) =>
                              beginPointWeightDrag(e, path.id, pointIndex, handleNormal)
                            }
                          >
                            <line
                              x1={point.x}
                              y1={point.y}
                              x2={handlePoint.x}
                              y2={handlePoint.y}
                              stroke={
                                isWeightDragActive
                                  ? 'rgba(250, 204, 21, 0.95)'
                                  : 'rgba(255, 255, 255, 0.7)'
                              }
                              strokeWidth={1 / zoom}
                              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                            />
                            <circle
                              cx={handlePoint.x}
                              cy={handlePoint.y}
                              r={handleRadius * 2.1}
                              fill="transparent"
                            />
                            <circle
                              cx={handlePoint.x}
                              cy={handlePoint.y}
                              r={handleRadius}
                              fill={isWeightDragActive ? 'yellow' : 'rgba(0, 0, 0, 0.7)'}
                              stroke="white"
                              strokeWidth={1 / zoom}
                            />
                          </g>
                        );
                      })}
                    {!cursorOnly &&
                      isSP &&
                      pointWeightControlState?.pathId === path.id &&
                      (() => {
                        const anchorPointIndex = pointWeightControlState.pointIndex;
                        const anchorPoint = resolvedPoints[anchorPointIndex];
                        if (!anchorPoint) return null;

                        const handleNormal = getRotoPointWeightHandleNormal(
                          resolvedPoints,
                          anchorPointIndex,
                          path.closed,
                        );
                        const handlePoint = getRotoPointWeightHandlePosition(
                          anchorPoint,
                          handleNormal,
                          getRotoPointWeight(
                            path.pointWeights,
                            path.points.length,
                            anchorPointIndex,
                          ),
                          zoom,
                        );
                        const selectedWeightMode = getRotoPointWeightModeForSelection(
                          path,
                          pointWeightControlState.pointIndices,
                          rotoPointWeightMode,
                        );
                        const selectedPointType = getRotoPointTypeForSelection(
                          path,
                          pointWeightControlState.pointIndices,
                        );
                        const selectedPointWeights = pointWeightControlState.pointIndices.map(
                          (pointIndex) =>
                            getRotoPointWeight(path.pointWeights, path.points.length, pointIndex),
                        );
                        const minPullValue = Math.min(...selectedPointWeights);
                        const maxPullValue = Math.max(...selectedPointWeights);
                        const pullValueLabel =
                          maxPullValue - minPullValue > 0.005
                            ? `Pull ${minPullValue.toFixed(2)}-${maxPullValue.toFixed(2)}`
                            : `Pull ${maxPullValue.toFixed(2)}`;
                        const panelWidth = 152 / zoom;
                        const panelHeight = 58 / zoom;
                        const panelPadding = 2 / zoom;
                        const headerHeight = 10 / zoom;
                        const buttonGap = 2 / zoom;
                        const rowGap = 2 / zoom;
                        const controlsY = panelPadding + headerHeight + rowGap;
                        const rowHeight =
                          (panelHeight - panelPadding * 2 - headerHeight - rowGap * 2) / 2;
                        const rowWidth = panelWidth - panelPadding * 2;
                        const weightButtonWidth = (rowWidth - buttonGap) / 2;
                        const typeButtonWidth = (rowWidth - buttonGap * 2) / 3;
                        const panelFill = 'rgba(10, 10, 10, 0.34)';
                        const panelStroke = 'rgba(255, 255, 255, 0.14)';
                        const rowFill = 'rgba(255, 255, 255, 0.04)';
                        const rowStroke = 'rgba(255, 255, 255, 0.06)';
                        const buttonFillInactive = 'rgba(255, 255, 255, 0.01)';
                        const buttonTextInactive = 'rgba(255, 255, 255, 0.7)';
                        const buttonFillActive = 'rgb(var(--color-primary-500) / 0.28)';
                        const buttonStrokeActive = 'rgb(var(--color-primary-400) / 0.52)';
                        const buttonTextActive = 'rgb(var(--color-primary-50) / 0.98)';
                        const panelX =
                          handlePoint.x +
                          handleNormal.x * (10 / zoom) +
                          (handleNormal.x < -0.15 ? -panelWidth : 0);
                        const panelY =
                          handlePoint.y + handleNormal.y * (10 / zoom) - panelHeight * 0.5;

                        const renderWeightModeButton = (
                          mode: RotoPointWeightMode,
                          label: string,
                          x: number,
                        ) => {
                          const isActive = selectedWeightMode === mode;
                          return (
                            <g
                              key={mode}
                              className="pointer-events-auto cursor-pointer"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedPointWeightMode(
                                  path.id,
                                  pointWeightControlState.pointIndices,
                                  mode,
                                );
                              }}
                            >
                              <rect
                                x={x}
                                y={controlsY}
                                width={weightButtonWidth}
                                height={rowHeight}
                                rx={5 / zoom}
                                fill={isActive ? buttonFillActive : buttonFillInactive}
                                stroke={isActive ? buttonStrokeActive : 'transparent'}
                                strokeWidth={isActive ? 1 / zoom : 0}
                              />
                              <text
                                x={x + weightButtonWidth * 0.5}
                                y={controlsY + rowHeight * 0.58}
                                fill={isActive ? buttonTextActive : buttonTextInactive}
                                fontSize={8.5 / zoom}
                                fontFamily="ui-sans-serif, system-ui, sans-serif"
                                fontWeight={600}
                                textAnchor="middle"
                                pointerEvents="none"
                              >
                                {label}
                              </text>
                            </g>
                          );
                        };

                        const renderPointTypeButton = (
                          pointType: RotoPointType,
                          label: string,
                          x: number,
                        ) => {
                          const isActive = selectedPointType === pointType;
                          return (
                            <g
                              key={pointType}
                              className="pointer-events-auto cursor-pointer"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedPointType(
                                  path.id,
                                  pointWeightControlState.pointIndices,
                                  pointType,
                                );
                              }}
                            >
                              <rect
                                x={x}
                                y={controlsY + rowHeight + rowGap}
                                width={typeButtonWidth}
                                height={rowHeight}
                                rx={5 / zoom}
                                fill={isActive ? buttonFillActive : buttonFillInactive}
                                stroke={isActive ? buttonStrokeActive : 'transparent'}
                                strokeWidth={isActive ? 1 / zoom : 0}
                              />
                              <text
                                x={x + typeButtonWidth * 0.5}
                                y={controlsY + rowHeight + rowGap + rowHeight * 0.58}
                                fill={isActive ? buttonTextActive : buttonTextInactive}
                                fontSize={8.25 / zoom}
                                fontFamily="ui-sans-serif, system-ui, sans-serif"
                                fontWeight={600}
                                textAnchor="middle"
                                pointerEvents="none"
                              >
                                {label}
                              </text>
                            </g>
                          );
                        };

                        return (
                          <g>
                            <foreignObject
                              x={panelX}
                              y={panelY}
                              width={panelWidth}
                              height={panelHeight}
                              style={{ overflow: 'visible', pointerEvents: 'none' }}
                            >
                              <div
                                xmlns="http://www.w3.org/1999/xhtml"
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  borderRadius: `${7 / zoom}px`,
                                  background: 'rgba(10, 10, 10, 0.2)',
                                  backdropFilter: 'blur(14px)',
                                  WebkitBackdropFilter: 'blur(14px)',
                                  pointerEvents: 'none',
                                }}
                              />
                            </foreignObject>
                            <rect
                              x={panelX}
                              y={panelY}
                              width={panelWidth}
                              height={panelHeight}
                              rx={7 / zoom}
                              fill={panelFill}
                              stroke={panelStroke}
                              strokeWidth={1 / zoom}
                            />
                            <g transform={`translate(${panelX}, ${panelY})`}>
                              <text
                                x={panelPadding}
                                y={panelPadding + headerHeight * 0.72}
                                fill="rgba(255, 255, 255, 0.78)"
                                fontSize={10 / zoom}
                                fontFamily="ui-sans-serif, system-ui, sans-serif"
                                fontWeight={600}
                                pointerEvents="none"
                              >
                                {pullValueLabel}
                              </text>
                              <rect
                                x={panelPadding}
                                y={controlsY}
                                width={rowWidth}
                                height={rowHeight}
                                rx={6 / zoom}
                                fill={rowFill}
                                stroke={rowStroke}
                                strokeWidth={1 / zoom}
                              />
                              <rect
                                x={panelPadding}
                                y={controlsY + rowHeight + rowGap}
                                width={rowWidth}
                                height={rowHeight}
                                rx={6 / zoom}
                                fill={rowFill}
                                stroke={rowStroke}
                                strokeWidth={1 / zoom}
                              />
                              {renderWeightModeButton('global', 'Global Pull', panelPadding)}
                              {renderWeightModeButton(
                                'local',
                                'Local Pull',
                                panelPadding + weightButtonWidth + buttonGap,
                              )}
                              {renderPointTypeButton('bspline', 'B-Spl', panelPadding)}
                              {renderPointTypeButton(
                                'cardinal',
                                'Card',
                                panelPadding + typeButtonWidth + buttonGap,
                              )}
                              {renderPointTypeButton(
                                'corner',
                                'Corner',
                                panelPadding + (typeButtonWidth + buttonGap) * 2,
                              )}
                            </g>
                          </g>
                        );
                      })()}
                  </>
                )}
              </g>
            );
          },
        )}

      {/* ── Shift temporal controller ─────────────────────────────── */}
      {temporalControllerRenderData && (
        <g>
          <g pointerEvents="none">
            {temporalControllerRenderData.paths.map((pathData) => (
              <g key={`temporal-path-${pathData.path.id}`}>
                <path
                  d={pathData.prevPathData}
                  stroke="rgba(125, 211, 252, 0.55)"
                  strokeWidth={1.15 / zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={pathData.path.closed ? 'rgba(125, 211, 252, 0.06)' : 'none'}
                />
                <path
                  d={pathData.nextPathData}
                  stroke="rgba(251, 191, 36, 0.55)"
                  strokeWidth={1.15 / zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={pathData.path.closed ? 'rgba(251, 191, 36, 0.05)' : 'none'}
                />
                {pathData.motionPoints.map((motionPoint) => (
                  <g key={`temporal-motion-${pathData.path.id}-${motionPoint.pointIndex}`}>
                    <line
                      x1={motionPoint.prev.x}
                      y1={motionPoint.prev.y}
                      x2={motionPoint.preview.x}
                      y2={motionPoint.preview.y}
                      stroke="rgba(34, 211, 238, 0.75)"
                      strokeWidth={1 / zoom}
                      strokeLinecap="round"
                    />
                    <line
                      x1={motionPoint.preview.x}
                      y1={motionPoint.preview.y}
                      x2={motionPoint.next.x}
                      y2={motionPoint.next.y}
                      stroke="rgba(251, 191, 36, 0.34)"
                      strokeWidth={1 / zoom}
                      strokeLinecap="round"
                      strokeDasharray={`${3 / zoom} ${4 / zoom}`}
                    />
                    <circle
                      cx={motionPoint.prev.x}
                      cy={motionPoint.prev.y}
                      r={2.4 / zoom}
                      fill="rgba(125, 211, 252, 0.72)"
                    />
                    <circle
                      cx={motionPoint.next.x}
                      cy={motionPoint.next.y}
                      r={2.4 / zoom}
                      fill="rgba(251, 191, 36, 0.72)"
                    />
                    <circle
                      cx={motionPoint.preview.x}
                      cy={motionPoint.preview.y}
                      r={3.4 / zoom}
                      fill="rgba(250, 250, 250, 0.9)"
                      stroke="rgba(34, 211, 238, 0.95)"
                      strokeWidth={1 / zoom}
                    />
                  </g>
                ))}
                <path
                  d={pathData.oldPathData}
                  stroke={yellowOverlay(0.48)}
                  strokeWidth={1.1 / zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                  fill={pathData.path.closed ? yellowOverlay(0.035) : 'none'}
                />
              </g>
            ))}
          </g>
          <g
            className="pointer-events-auto cursor-ew-resize"
            onMouseDown={beginTemporalControllerDrag}
          >
            <foreignObject
              x={temporalControllerRenderData.controllerX}
              y={temporalControllerRenderData.controllerY}
              width={temporalControllerRenderData.controllerWidth}
              height={temporalControllerRenderData.controllerHeight}
              style={{ overflow: 'visible', pointerEvents: 'none' }}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: `${8 / zoom}px`,
                  background: 'rgba(3, 7, 18, 0.28)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                }}
              />
            </foreignObject>
            <rect
              x={temporalControllerRenderData.controllerX}
              y={temporalControllerRenderData.controllerY}
              width={temporalControllerRenderData.controllerWidth}
              height={temporalControllerRenderData.controllerHeight}
              rx={8 / zoom}
              fill="rgba(2, 6, 23, 0.42)"
              stroke="rgba(148, 163, 184, 0.3)"
              strokeWidth={1 / zoom}
            />
            <text
              x={temporalControllerRenderData.controllerX + 12 / zoom}
              y={temporalControllerRenderData.controllerY + 12 / zoom}
              fill="rgba(226, 232, 240, 0.82)"
              fontSize={9 / zoom}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={700}
              pointerEvents="none"
            >
              Temporal
            </text>
            <text
              x={
                temporalControllerRenderData.controllerX +
                temporalControllerRenderData.controllerWidth -
                12 / zoom
              }
              y={temporalControllerRenderData.controllerY + 12 / zoom}
              fill="rgba(148, 163, 184, 0.78)"
              fontSize={8 / zoom}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={600}
              textAnchor="end"
              pointerEvents="none"
            >
              {`${Math.round(temporalControllerRenderData.value * 100)}%`}
            </text>
            {temporalControllerRenderData.hasCurrentKeyframe ? (
              <>
                <rect
                  ref={(element) => {
                    temporalTrackRef.current = element;
                  }}
                  x={temporalControllerRenderData.trackX}
                  y={temporalControllerRenderData.trackTopY}
                  width={temporalControllerRenderData.trackWidth}
                  height={temporalControllerRenderData.trackHeight}
                  fill="transparent"
                />
                <path
                  d={temporalControllerRenderData.curveFillPathData}
                  fill="rgba(15, 23, 42, 0.32)"
                  stroke="rgba(148, 163, 184, 0.24)"
                  strokeWidth={1 / zoom}
                  pointerEvents="none"
                />
                <path
                  d={temporalControllerRenderData.curveTopPathData}
                  stroke="rgba(34, 211, 238, 0.48)"
                  strokeWidth={2 / zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  pointerEvents="none"
                />
                <line
                  x1={temporalControllerRenderData.trackX}
                  y1={temporalControllerRenderData.trackY}
                  x2={temporalControllerRenderData.trackX + temporalControllerRenderData.trackWidth}
                  y2={temporalControllerRenderData.trackY}
                  stroke="rgba(71, 85, 105, 0.9)"
                  strokeWidth={4 / zoom}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                <line
                  x1={temporalControllerRenderData.defaultX}
                  y1={temporalControllerRenderData.trackY}
                  x2={temporalControllerRenderData.defaultX}
                  y2={temporalControllerRenderData.trackTopY}
                  stroke="rgba(255, 255, 255, 0.42)"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${2 / zoom} ${3 / zoom}`}
                  pointerEvents="none"
                />
                <line
                  x1={temporalControllerRenderData.knobX}
                  y1={temporalControllerRenderData.trackY}
                  x2={temporalControllerRenderData.knobX}
                  y2={temporalControllerRenderData.knobY}
                  stroke="rgba(34, 211, 238, 0.78)"
                  strokeWidth={3 / zoom}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              </>
            ) : (
              <>
                <rect
                  ref={(element) => {
                    temporalTrackRef.current = element;
                  }}
                  x={temporalControllerRenderData.trackX}
                  y={temporalControllerRenderData.trackY - 7 / zoom}
                  width={temporalControllerRenderData.trackWidth}
                  height={14 / zoom}
                  rx={7 / zoom}
                  fill="transparent"
                />
                <line
                  x1={temporalControllerRenderData.trackX}
                  y1={temporalControllerRenderData.trackY}
                  x2={temporalControllerRenderData.trackX + temporalControllerRenderData.trackWidth}
                  y2={temporalControllerRenderData.trackY}
                  stroke="rgba(71, 85, 105, 0.9)"
                  strokeWidth={5 / zoom}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                <line
                  x1={temporalControllerRenderData.trackX}
                  y1={temporalControllerRenderData.trackY}
                  x2={temporalControllerRenderData.knobX}
                  y2={temporalControllerRenderData.trackY}
                  stroke="rgba(34, 211, 238, 0.9)"
                  strokeWidth={5 / zoom}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                <line
                  x1={temporalControllerRenderData.defaultX}
                  y1={temporalControllerRenderData.trackY - 6 / zoom}
                  x2={temporalControllerRenderData.defaultX}
                  y2={temporalControllerRenderData.trackY + 6 / zoom}
                  stroke="rgba(255, 255, 255, 0.5)"
                  strokeWidth={1 / zoom}
                  pointerEvents="none"
                />
              </>
            )}
            <circle
              cx={temporalControllerRenderData.knobX}
              cy={temporalControllerRenderData.knobY}
              r={7 / zoom}
              fill="rgba(8, 145, 178, 0.96)"
              stroke="white"
              strokeWidth={1.2 / zoom}
              pointerEvents="none"
            />
            <text
              x={temporalControllerRenderData.trackX}
              y={
                temporalControllerRenderData.controllerY +
                temporalControllerRenderData.controllerHeight -
                7 / zoom
              }
              fill="rgba(125, 211, 252, 0.85)"
              fontSize={8 / zoom}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={700}
              pointerEvents="none"
            >
              {`F${temporalControllerRenderData.prevFrame}`}
            </text>
            <text
              x={temporalControllerRenderData.trackX + temporalControllerRenderData.trackWidth}
              y={
                temporalControllerRenderData.controllerY +
                temporalControllerRenderData.controllerHeight -
                7 / zoom
              }
              fill="rgba(251, 191, 36, 0.85)"
              fontSize={8 / zoom}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={700}
              textAnchor="end"
              pointerEvents="none"
            >
              {`F${temporalControllerRenderData.nextFrame}`}
            </text>
          </g>
        </g>
      )}

      {/* ── Transform bounding box + handles (non-degenerate) ───────── */}
      {isRotoSelectActive &&
        rotoTransformSelection &&
        !transformIsDegenerate &&
        !shouldHideTransformSelectionOverlay && (
          <g className="pointer-events-none">
            {(() => {
              const sMin = sp({
                x: rotoTransformSelection.bounds.minX,
                y: rotoTransformSelection.bounds.minY,
              });
              const sMax = sp({
                x: rotoTransformSelection.bounds.minX + rotoTransformSelection.bounds.width,
                y: rotoTransformSelection.bounds.minY + rotoTransformSelection.bounds.height,
              });
              const sBounds = {
                minX: Math.min(sMin.x, sMax.x),
                minY: Math.min(sMin.y, sMax.y),
                width: Math.abs(sMax.x - sMin.x),
                height: Math.abs(sMax.y - sMin.y),
                centerX: (sMin.x + sMax.x) / 2,
                centerY: (sMin.y + sMax.y) / 2,
              };
              const sRotatePoint = transformRotateHandlePoint
                ? sp(transformRotateHandlePoint)
                : null;
              return (
                <>
                  <rect
                    x={sBounds.minX}
                    y={sBounds.minY}
                    width={sBounds.width}
                    height={sBounds.height}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10 / zoom, 6 / zoom)}
                    pointerEvents="stroke"
                    className="pointer-events-auto"
                    onMouseDown={(e) => beginRotoTransformDrag(e, 'move')}
                    onMouseEnter={() => setHoveredTransformHandle('move')}
                    onMouseLeave={() => setHoveredTransformHandle(null)}
                  />
                  <rect
                    x={sBounds.minX}
                    y={sBounds.minY}
                    width={sBounds.width}
                    height={sBounds.height}
                    fill="none"
                    stroke={
                      activeTransformHandle ? 'rgba(56, 189, 248, 1)' : 'rgba(125, 211, 252, 0.95)'
                    }
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  />
                  {transformInteractionLabel && (
                    <text
                      x={sBounds.minX}
                      y={sBounds.minY - 10 / zoom}
                      fill="rgba(186, 230, 253, 0.95)"
                      stroke="rgba(8, 47, 73, 0.95)"
                      strokeWidth={2.5 / zoom}
                      paintOrder="stroke"
                      fontSize={11 / zoom}
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                      pointerEvents="none"
                    >
                      {transformInteractionLabel}
                    </text>
                  )}
                  {sRotatePoint && (
                    <g
                      className="pointer-events-auto"
                      onMouseDown={(e) => beginRotoTransformDrag(e, 'rotate')}
                      onMouseEnter={() => setHoveredTransformHandle('rotate')}
                      onMouseLeave={() => setHoveredTransformHandle(null)}
                    >
                      <line
                        x1={sBounds.centerX}
                        y1={sBounds.minY}
                        x2={sRotatePoint.x}
                        y2={sRotatePoint.y}
                        stroke="rgba(125, 211, 252, 0.9)"
                        strokeWidth={1 / zoom}
                      />
                      <circle
                        cx={sRotatePoint.x}
                        cy={sRotatePoint.y}
                        r={transformRotateHitRadius}
                        fill="transparent"
                      />
                      <circle
                        cx={sRotatePoint.x}
                        cy={sRotatePoint.y}
                        r={transformMoveHandleRadius}
                        fill={
                          isRotateTransformActive
                            ? 'rgba(8, 145, 178, 1)'
                            : isRotateTransformHovered
                              ? 'rgba(14, 165, 233, 0.98)'
                              : 'rgba(2, 132, 199, 0.9)'
                        }
                        stroke={
                          isRotateTransformActive || isRotateTransformHovered
                            ? 'rgba(255,255,255,1)'
                            : 'white'
                        }
                        strokeWidth={(isRotateTransformActive ? 1.4 : 1) / zoom}
                      />
                    </g>
                  )}
                  {transformHandlePositions.map(({ handle, point }) => {
                    const sPoint = sp(point);
                    const isHandleActive = activeTransformHandle === handle;
                    const isHandleHovered = hoveredTransformHandle === handle;
                    const isAffineEdgePreview =
                      isEdgeTransformHandle(handle) && affineModifierPressed;
                    const handleFill = isHandleActive
                      ? 'rgba(8, 145, 178, 1)'
                      : isHandleHovered
                        ? 'rgba(14, 165, 233, 0.98)'
                        : isAffineEdgePreview
                          ? 'rgba(56, 189, 248, 0.95)'
                          : 'rgba(2, 132, 199, 0.9)';
                    return (
                      <g
                        key={`transform-handle-${handle}`}
                        className="pointer-events-auto"
                        onMouseDown={(e) => beginRotoTransformDrag(e, handle)}
                        onMouseEnter={() => setHoveredTransformHandle(handle)}
                        onMouseLeave={() => setHoveredTransformHandle(null)}
                      >
                        <rect
                          x={sPoint.x - transformHandleHitSize / 2}
                          y={sPoint.y - transformHandleHitSize / 2}
                          width={transformHandleHitSize}
                          height={transformHandleHitSize}
                          fill="transparent"
                        />
                        <rect
                          x={sPoint.x - transformHandleSize / 2}
                          y={sPoint.y - transformHandleSize / 2}
                          width={transformHandleSize}
                          height={transformHandleSize}
                          rx={1.5 / zoom}
                          ry={1.5 / zoom}
                          fill={handleFill}
                          stroke={
                            isHandleActive || isHandleHovered ? 'rgba(255,255,255,1)' : 'white'
                          }
                          strokeWidth={(isHandleActive ? 1.4 : 1) / zoom}
                        />
                      </g>
                    );
                  })}
                </>
              );
            })()}
          </g>
        )}

      {!cursorOnly && (
        <>
          {/* ── Hovered segment (insert-point preview) ──────────────── */}
          {hoveredSegment && (
            <g className="pointer-events-none animate-pulse">
              {' '}
              {(() => {
                const sHov = sp(hoveredSegment.point);
                return (
                  <>
                    <circle
                      cx={sHov.x}
                      cy={sHov.y}
                      r={5 / zoom}
                      fill="transparent"
                      stroke="yellow"
                      strokeWidth={1.5 / zoom}
                    />{' '}
                    <circle cx={sHov.x} cy={sHov.y} r={2 / zoom} fill="yellow" />
                  </>
                );
              })()}{' '}
            </g>
          )}

          {/* ── Roto refinement preview ─────────────────────────────── */}
          {rotoRefinement &&
            (() => {
              const pData = generateBSplinePath(refinementResolvedPoints, rotoRefinement.closed);
              return (
                <>
                  {' '}
                  <path
                    d={pData}
                    stroke="yellow"
                    strokeWidth={1 / zoom}
                    fill={rotoRefinement.closed ? 'rgba(255, 255, 0, 0.1)' : 'none'}
                  />{' '}
                  <path
                    d={getLinearPathData(refinementResolvedPoints, false)}
                    stroke="rgba(255, 255, 0, 0.3)"
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${2 / zoom} ${3 / zoom}`}
                    fill="none"
                  />{' '}
                  {refinementResolvedPoints.map((p, i) => (
                    <RotoControlPoint
                      key={`temp-point-${i}`}
                      cx={p.x}
                      cy={p.y}
                      zoom={zoom}
                      isSelected={false}
                      isHovered={false}
                      isTemp={true}
                    />
                  ))}{' '}
                </>
              );
            })()}

          {/* ── Drawing: B-spline path in progress ──────────────────── */}
          {isDrawing && drawingRotoPath && (
            <g>
              <path
                d={drawingPathData}
                stroke="rgba(255, 0, 0, 0.5)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${2 / zoom} ${3 / zoom}`}
                fill="none"
              />
              {bsplineDrawingState ? (
                <>
                  {bsplineDrawingState.committedSegments.length > 0 && (
                    <path
                      d={(() => {
                        const segs = bsplineDrawingState.committedSegments;
                        const s0 = sp(segs[0].start);
                        let d = `M ${s0.x},${s0.y}`;
                        segs.forEach((seg) => {
                          const sc1 = sp(seg.c1);
                          const sc2 = sp(seg.c2);
                          const se = sp(seg.end);
                          d += ` C ${sc1.x},${sc1.y} ${sc2.x},${sc2.y} ${se.x},${se.y}`;
                        });
                        return d;
                      })()}
                      stroke="yellow"
                      strokeWidth={1 / zoom}
                      fill="none"
                    />
                  )}
                  {bsplineDrawingState.previewSegment && (
                    <path
                      d={(() => {
                        const seg = bsplineDrawingState.previewSegment;
                        const sStart = sp(seg.start);
                        const sEnd = sp(seg.end);
                        if ('c1' in seg) {
                          const sc1 = sp(seg.c1);
                          const sc2 = sp(seg.c2);
                          return `M ${sStart.x},${sStart.y} C ${sc1.x},${sc1.y} ${sc2.x},${sc2.y} ${sEnd.x},${sEnd.y}`;
                        }
                        return `M ${sStart.x},${sStart.y} L ${sEnd.x},${sEnd.y}`;
                      })()}
                      stroke="url(#roto-preview-gradient)"
                      strokeWidth={1 / zoom}
                      fill="none"
                    />
                  )}
                </>
              ) : (
                <path d={drawingPathData} stroke="yellow" strokeWidth={1 / zoom} fill="none" />
              )}
              {drawingResolvedPoints.map((p, i) => (
                <RotoControlPoint
                  key={`drawing-${i}`}
                  cx={p.x}
                  cy={p.y}
                  zoom={zoom}
                  isSelected={false}
                  isHovered={false}
                  isDrawing={true}
                />
              ))}
            </g>
          )}

          {/* ── Shape rect drawing ──────────────────────────────────── */}
          {drawingState &&
            (() => {
              const sStart = sp(drawingState.start);
              const sCurrent = sp(drawingState.current);
              return (
                <rect
                  x={Math.min(sStart.x, sCurrent.x)}
                  y={Math.min(sStart.y, sCurrent.y)}
                  width={Math.abs(sCurrent.x - sStart.x)}
                  height={Math.abs(sCurrent.y - sStart.y)}
                  stroke="yellow"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                  fill="none"
                />
              );
            })()}

          {/* ── Freehand polyline ───────────────────────────────────── */}
          {freehandPoints &&
            (() => {
              if (!stabilizedFreehandPoints) return null;
              return (
                <polyline
                  points={stabilizedFreehandPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  stroke="yellow"
                  strokeWidth={1 / zoom}
                  fill="none"
                />
              );
            })()}

          {/* ── Close-point hover indicator ─────────────────────────── */}
          {isHoveringClosePoint &&
            (() => {
              let sPt: { x: number; y: number } | null = null;
              if (
                activeViewportTool === 'bspline' &&
                isDrawing &&
                drawingRotoPath &&
                drawingRotoPath.points.length > 0
              ) {
                sPt = drawingResolvedPoints[0] ?? null;
              } else if (
                activeViewportTool === 'freehand' &&
                stabilizedFreehandPoints &&
                stabilizedFreehandPoints.length > 0
              )
                sPt = stabilizedFreehandPoints[0];
              if (sPt) {
                return (
                  <g className="pointer-events-auto cursor-pointer">
                    {' '}
                    <circle
                      cx={sPt.x}
                      cy={sPt.y}
                      r={10 / zoom}
                      fill="yellow"
                      fillOpacity="0.3"
                    />{' '}
                    <circle
                      cx={sPt.x}
                      cy={sPt.y}
                      r={10 / zoom}
                      fill="none"
                      stroke="yellow"
                      strokeWidth={2 / zoom}
                    />{' '}
                  </g>
                );
              }
              return null;
            })()}

          {/* ── Marquee selection ───────────────────────────────────── */}
          {marqueeState &&
            (() => {
              const sStart = sp(marqueeState.start);
              const sCurrent = sp(marqueeState.current);
              return (
                <rect
                  x={Math.min(sStart.x, sCurrent.x)}
                  y={Math.min(sStart.y, sCurrent.y)}
                  width={Math.abs(sCurrent.x - sStart.x)}
                  height={Math.abs(sCurrent.y - sStart.y)}
                  stroke="yellow"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                  fill="rgba(255, 255, 0, 0.2)"
                />
              );
            })()}

          {/* ── Tracking points ─────────────────────────────────────── */}
          {stabilizedActiveTrackingPoints && (
            <g className="pointer-events-none">
              {stabilizedActiveTrackingPoints.map((p, i) => (
                <circle
                  key={`track-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={2.5 / zoom}
                  fill="#10B981"
                  fillOpacity={0.8}
                  stroke="black"
                  strokeWidth={0.5 / zoom}
                  strokeOpacity={0.5}
                />
              ))}
            </g>
          )}
        </>
      )}
    </>
  );
};

export default React.memo(RotoOverlay);
