import { useMemo } from 'react';
import {
  NodeType,
  RotoShapeType,
  type AnyNode,
  type RotoNode,
  type RotoMotionCueMode,
  type RotoMotionCueScope,
  type RotoPointType,
} from '@blackboard/types';
import { generateBSplinePath } from '@/utils/bspline';
import {
  buildBSplineHeatlineSegments,
  buildPolygonHeatlineSegments,
  clampRotoMotionTrailFrames,
  computeCentralDifferenceSpeeds,
  getGradientTrailStyle,
  getMotionCueTargetPathIds,
  normalizeSpeeds,
  type HeatlineSegment,
} from '@/utils/rotoMotionCue';
import {
  getRotoMotionBlurSampleFrames,
  resolveRotoMotionBlurSettings,
} from '@/utils/rotoMotionBlur';
import type { RotoPointWeightMode } from '@/utils/rotoPointWeights';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import { stabilizePoints } from '@/utils/rotoTracking';
import type {
  GradientTrailPath,
  MotionBlurCuePath,
} from '@/features/viewport/viewportOverlayTypes';

// Pure helper: converts resolved points into an SVG path-data string.
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
  return (
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (closed ? ' Z' : '')
  );
}

interface UseViewportMotionCuesParams {
  rotoMotionCueEnabled: boolean;
  rotoMotionCueMode: RotoMotionCueMode;
  rotoMotionCueScope: RotoMotionCueScope;
  rotoMotionPathVisible: boolean;
  rotoMotionBlurPathVisible: boolean;
  rotoMotionTrailFrames: number;
  selectedNode: AnyNode | undefined;
  selectedRotoPathIds: string[];
  visualFrame: number;
  maxFrames: number;
  rotoPointWeightMode: RotoPointWeightMode;
  stabilizationMatrix: number[][] | null;
}

interface UseViewportMotionCuesResult {
  /** Set of path ids that should display motion cues. */
  motionCueTargetPathIdSet: Set<string>;
  /** Per-path array of SVG gradient-trail elements. */
  gradientTrailsByPath: Map<string, GradientTrailPath[]>;
  /** Per-path array of speed-heatline segments. */
  speedHeatSegmentsByPath: Map<string, HeatlineSegment[]>;
  /** Per-path array of motion-blur sample path overlays. */
  motionBlurCuePathsByPath: Map<string, MotionBlurCuePath[]>;
}

/**
 * Computes roto motion-cue overlays (gradient trails and speed heatlines).
 */
export function useViewportMotionCues({
  rotoMotionCueEnabled,
  rotoMotionCueMode,
  rotoMotionCueScope,
  rotoMotionPathVisible,
  rotoMotionBlurPathVisible,
  rotoMotionTrailFrames,
  selectedNode,
  selectedRotoPathIds,
  visualFrame,
  maxFrames,
  rotoPointWeightMode,
  stabilizationMatrix,
}: UseViewportMotionCuesParams): UseViewportMotionCuesResult {
  const motionCueWindow = useMemo(
    () => clampRotoMotionTrailFrames(rotoMotionTrailFrames),
    [rotoMotionTrailFrames],
  );

  const motionCueTargetPathIds = useMemo(() => {
    if (!rotoMotionCueEnabled || selectedNode?.type !== NodeType.ROTO) return [];
    const rotoNode = selectedNode as RotoNode;
    return getMotionCueTargetPathIds(
      rotoNode.paths.map((path) => path.id),
      selectedRotoPathIds,
      rotoMotionCueScope,
    );
  }, [rotoMotionCueEnabled, selectedNode, selectedRotoPathIds, rotoMotionCueScope]);

  const motionCueTargetPathIdSet = useMemo(
    () => new Set(motionCueTargetPathIds),
    [motionCueTargetPathIds],
  );

  const gradientTrailsByPath = useMemo(() => {
    const byPath = new Map<string, GradientTrailPath[]>();
    if (
      !rotoMotionCueEnabled ||
      !rotoMotionPathVisible ||
      rotoMotionCueMode !== 'gradient_trail' ||
      selectedNode?.type !== NodeType.ROTO
    ) {
      return byPath;
    }

    const rotoNode = selectedNode as RotoNode;
    for (const pathId of motionCueTargetPathIds) {
      const path = rotoNode.paths.find((item) => item.id === pathId);
      if (!path || path.points.length < 2) continue;

      const trails: GradientTrailPath[] = [];
      for (let offset = -motionCueWindow; offset <= motionCueWindow; offset++) {
        if (offset === 0) continue;

        const sampledFrame = Math.max(0, Math.min(maxFrames, visualFrame + offset));
        const resolvedPoints = stabilizePoints(
          resolveRotoPathPointsAtFrame(rotoNode, path, sampledFrame),
          stabilizationMatrix,
        );
        const pathData = getPathDataFromResolvedPoints(
          resolvedPoints,
          path.shapeType,
          path.closed,
          path.pointWeights,
          rotoPointWeightMode,
          path.pointTypes,
          path.pointWeightModes,
        );
        if (!pathData) continue;

        const style = getGradientTrailStyle(offset, motionCueWindow);
        trails.push({
          key: `${path.id}-trail-${offset}-${sampledFrame}`,
          d: pathData,
          stroke: style.stroke,
          opacity: style.opacity,
          strokeWidth: offset === 0 ? 1.2 : 0.95,
        });
      }

      if (trails.length > 0) {
        byPath.set(path.id, trails);
      }
    }
    return byPath;
  }, [
    maxFrames,
    motionCueTargetPathIds,
    motionCueWindow,
    rotoMotionPathVisible,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    selectedNode,
    stabilizationMatrix,
    visualFrame,
    rotoPointWeightMode,
  ]);

  const speedHeatSegmentsByPath = useMemo(() => {
    const byPath = new Map<string, HeatlineSegment[]>();
    if (
      !rotoMotionCueEnabled ||
      !rotoMotionPathVisible ||
      rotoMotionCueMode !== 'speed_heatline' ||
      selectedNode?.type !== NodeType.ROTO
    ) {
      return byPath;
    }

    const rotoNode = selectedNode as RotoNode;
    for (const pathId of motionCueTargetPathIds) {
      const path = rotoNode.paths.find((item) => item.id === pathId);
      if (!path || path.points.length < 2) continue;

      const currentPoints = stabilizePoints(
        resolveRotoPathPointsAtFrame(rotoNode, path, visualFrame),
        stabilizationMatrix,
      );
      if (currentPoints.length < 2) continue;

      const previousFrame = Math.max(0, visualFrame - 1);
      const nextFrame = Math.min(maxFrames, visualFrame + 1);
      const previousPoints = stabilizePoints(
        resolveRotoPathPointsAtFrame(rotoNode, path, previousFrame),
        stabilizationMatrix,
      );
      const nextPoints = stabilizePoints(
        resolveRotoPathPointsAtFrame(rotoNode, path, nextFrame),
        stabilizationMatrix,
      );

      const speeds = computeCentralDifferenceSpeeds(previousPoints, nextPoints);
      const normalizedSpeeds = normalizeSpeeds(speeds);

      const segments =
        path.shapeType === RotoShapeType.BSPLINE
          ? buildBSplineHeatlineSegments(
              currentPoints,
              normalizedSpeeds,
              path.closed,
              96,
              0.92,
              path.pointWeights,
              rotoPointWeightMode,
              path.pointTypes,
              path.pointWeightModes,
            )
          : buildPolygonHeatlineSegments(currentPoints, normalizedSpeeds, path.closed);

      if (segments.length > 0) {
        byPath.set(path.id, segments);
      }
    }
    return byPath;
  }, [
    maxFrames,
    motionCueTargetPathIds,
    rotoMotionPathVisible,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    selectedNode,
    stabilizationMatrix,
    visualFrame,
    rotoPointWeightMode,
  ]);

  const motionBlurCuePathsByPath = useMemo(() => {
    const byPath = new Map<string, MotionBlurCuePath[]>();
    if (
      !rotoMotionCueEnabled ||
      !rotoMotionBlurPathVisible ||
      selectedNode?.type !== NodeType.ROTO
    ) {
      return byPath;
    }

    const rotoNode = selectedNode as RotoNode;
    const motionBlur = resolveRotoMotionBlurSettings(rotoNode.motionBlur);
    if (!motionBlur.enabled || motionBlur.shutter <= 0) {
      return byPath;
    }

    const cueFrames = getRotoMotionBlurSampleFrames(
      visualFrame,
      motionBlur.shutter,
      2,
      motionBlur.phase,
    )
      .map((frame, index) => ({
        frame: Math.max(0, Math.min(maxFrames, frame)),
        label: index === 0 ? 'shutter-open' : 'shutter-close',
      }))
      .filter(
        ({ frame }, index, frames) =>
          Number.isFinite(frame) &&
          Math.abs(frame - visualFrame) >= 1e-4 &&
          frames.findIndex((candidate) => Math.abs(candidate.frame - frame) < 1e-4) === index,
      );

    for (const pathId of motionCueTargetPathIds) {
      const path = rotoNode.paths.find((item) => item.id === pathId);
      if (!path || path.points.length < 2) continue;

      const paths: MotionBlurCuePath[] = [];
      for (const { frame: cueFrame, label } of cueFrames) {
        const resolvedPoints = stabilizePoints(
          resolveRotoPathPointsAtFrame(rotoNode, path, cueFrame),
          stabilizationMatrix,
        );
        const pathData = getPathDataFromResolvedPoints(
          resolvedPoints,
          path.shapeType,
          path.closed,
          path.pointWeights,
          rotoPointWeightMode,
          path.pointTypes,
          path.pointWeightModes,
        );
        if (!pathData) continue;

        paths.push({
          key: `${path.id}-motion-blur-path-${label}-${cueFrame.toFixed(3)}`,
          d: pathData,
          stroke: cueFrame <= visualFrame ? 'rgb(125, 211, 252)' : 'rgb(196, 181, 253)',
          opacity: 0.62,
          strokeWidth: 1,
          strokeDasharray: '6 4',
        });
      }

      if (paths.length > 0) {
        byPath.set(path.id, paths);
      }
    }

    return byPath;
  }, [
    maxFrames,
    motionCueTargetPathIds,
    rotoMotionBlurPathVisible,
    rotoMotionCueEnabled,
    selectedNode,
    stabilizationMatrix,
    visualFrame,
    rotoPointWeightMode,
  ]);

  return {
    motionCueTargetPathIdSet,
    gradientTrailsByPath,
    speedHeatSegmentsByPath,
    motionBlurCuePathsByPath,
  };
}
