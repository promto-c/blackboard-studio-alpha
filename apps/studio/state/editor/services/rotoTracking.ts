import type {
  AnyNode,
  RotoNode,
  AnimatableNumber,
  TrackingConfig,
  RotoPath,
  RotoLayer,
} from '@blackboard/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  applyRotoTrackingMatrix4ToPoint,
  invertRotoTrackingMatrix4,
  keyframeRotoPathScenePointsAtFrame,
  projectScenePointToRotoPathResolvedLocal,
  projectTrackingModelToMatrix4,
  resolveRotoLayerCompositeMatrix,
  resolveRotoPathLocalPointsAtFrame,
  resolveRotoPathPointsAtFrame,
  getRotoMatchTemplateFrames,
  resolveRotoTrackingSelection,
  updateTrackingTransform,
  type ResolvedRotoTrackingTarget,
} from '@/utils/rotoTracking';
import {
  applySolvedTransform,
  buildOpticalFlowPyramid,
  calculateOpticalFlowFromPyramids,
  calculateHybridOpticalFlowFromPyramids,
  fitTrackedTransform,
  solveTransform,
  type HybridOpticalFlowOptions,
  type SolvedTransformModel,
  type TrackResult,
} from '@/utils/opticalFlow';
import { getBoundingBox, isPointInPolygon } from '@/utils/bspline';
import {
  createSourcePixelDataReader,
  resolveSourcePixelSource,
} from '@/state/editor/services/sourcePixelData';
import type {
  BackgroundJobInput,
  BackgroundJobUpdate,
} from '@/state/editor/services/backgroundJobs';
import {
  bindRotoTrackingJobCancel,
  createRotoTrackingJob,
  formatTrackingProgressDetail,
  getRobustTrackingError,
  type RotoTrackingJob,
} from '@/state/editor/services/rotoTrackingJobs';
import {
  materializeRotoTrackingTarget,
  isPendingRotoTrackingLayerTarget,
  type RotoTrackingTarget,
} from '@/utils/rotoTracking';
import { getMedian } from '@/state/editor/selectors';
import { getLinearValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';
import type { GetState, SetState } from '@/state/editor/slices/types';
import type { ProjectBranchContext } from '@/state/editor/services/projectBranch';
import {
  applyOnlineTemporalTrackingGuard,
  applyTemporalTrackingGuard,
  createTemporalTrackingOnlineState,
  getMeanPointDistance,
  getTemporalTrackingConfig,
  type TemporalTrackingFrame,
} from '@/utils/temporalTracking';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RotoTrackingRunOptions = {
  runInBackground?: boolean;
};

export type TrackingPathPoints = { x: AnimatableNumber; y: AnimatableNumber }[];

export type TrackingPathState = {
  path: RotoPath;
  pointCount: number;
};

const DEFAULT_HYBRID_TRACKING_OPTIONS: Required<HybridOpticalFlowOptions> = {
  maxError: 15,
  outlierDistance: 30,
  searchRadius: 18,
  patchRadius: 5,
  minimumNccScore: 0.62,
  coherentFallback: true,
};

const getHybridTrackingOptions = (config: TrackingConfig): HybridOpticalFlowOptions => ({
  ...DEFAULT_HYBRID_TRACKING_OPTIONS,
  ...(config.hybrid ?? {}),
});

const calculateRotoOpticalFlow = (
  previousPyramid: ReturnType<typeof buildOpticalFlowPyramid>,
  currentPyramid: ReturnType<typeof buildOpticalFlowPyramid>,
  points: { x: number; y: number }[],
  config: TrackingConfig,
  targetHints?: readonly { x: number; y: number }[],
): TrackResult[] =>
  config.tracker === 'standard_lk' && !targetHints
    ? calculateOpticalFlowFromPyramids(previousPyramid, currentPyramid, points)
    : calculateHybridOpticalFlowFromPyramids(
        previousPyramid,
        currentPyramid,
        points,
        getHybridTrackingOptions(config),
        targetHints,
      );

type RotoBoundaryTrackStep = {
  points: { x: number; y: number }[];
  drift: number;
};

const trackRotoBoundaryStep = (
  previousPyramid: ReturnType<typeof buildOpticalFlowPyramid>,
  currentPyramid: ReturnType<typeof buildOpticalFlowPyramid>,
  previousPoints: readonly { x: number; y: number }[],
  previousWidth: number,
  previousHeight: number,
  config: TrackingConfig,
  targetHints?: readonly { x: number; y: number }[],
): RotoBoundaryTrackStep => {
  const halfWidth = previousWidth / 2;
  const halfHeight = previousHeight / 2;
  const canvasPoints = previousPoints.map((point) => ({
    x: point.x + halfWidth,
    y: point.y + halfHeight,
  }));
  const canvasTargetHints = targetHints?.map((point) => ({
    x: point.x + halfWidth,
    y: point.y + halfHeight,
  }));
  const trackedCanvas = calculateRotoOpticalFlow(
    previousPyramid,
    currentPyramid,
    canvasPoints,
    config,
    canvasTargetHints,
  );
  const drift = getRobustTrackingError(trackedCanvas);
  const flows = trackedCanvas.map((point, index) => ({
    dx: point.x - canvasPoints[index].x,
    dy: point.y - canvasPoints[index].y,
    error: point.error,
  }));
  const validFlows = flows.filter((flow) => flow.error < 15);
  const moveSource = validFlows.length > 0 ? validFlows : flows;
  const medianDx = getMedian(moveSource.map((flow) => flow.dx));
  const medianDy = getMedian(moveSource.map((flow) => flow.dy));

  return {
    drift,
    points: trackedCanvas.map((_point, index) => {
      let dx = flows[index].dx;
      let dy = flows[index].dy;
      if (flows[index].error > 15 || Math.hypot(dx - medianDx, dy - medianDy) > 30) {
        dx = medianDx;
        dy = medianDy;
      }
      return {
        x: canvasPoints[index].x + dx - halfWidth,
        y: canvasPoints[index].y + dy - halfHeight,
      };
    }),
  };
};

type RotoTemplateTrackResult = {
  templateFrame: number;
  points: { x: number; y: number }[];
  drift: number;
};

const trackRotoTemplateToFrame = async ({
  trackingPixelReader,
  templateFrame,
  destinationFrame,
  templatePoints,
  destinationHints,
  config,
  signal,
  onStep,
}: {
  trackingPixelReader: ReturnType<typeof createSourcePixelDataReader>;
  templateFrame: number;
  destinationFrame: number;
  templatePoints: { x: number; y: number }[];
  destinationHints?: { x: number; y: number }[];
  config: TrackingConfig;
  signal: AbortSignal;
  onStep: (frame: number, points: { x: number; y: number }[], drift: number) => void;
}): Promise<RotoTemplateTrackResult | null> => {
  const step = destinationFrame > templateFrame ? 1 : -1;
  let previousPoints = templatePoints;
  let previousPixelData = await trackingPixelReader.getFramePixelData(templateFrame);
  let previousPyramid = previousPixelData
    ? buildOpticalFlowPyramid(
        previousPixelData.data,
        previousPixelData.width,
        previousPixelData.height,
      )
    : null;
  let maximumDrift = 0;
  const driftTolerance = config.driftTolerance ?? null;

  for (
    let frame = templateFrame + step;
    step > 0 ? frame <= destinationFrame : frame >= destinationFrame;
    frame += step
  ) {
    if (signal.aborted || !previousPixelData || !previousPyramid) return null;
    const currentPixelData = await trackingPixelReader.getFramePixelData(frame);
    if (!currentPixelData) return null;
    const currentPyramid = buildOpticalFlowPyramid(
      currentPixelData.data,
      currentPixelData.width,
      currentPixelData.height,
    );
    const trackedStep = trackRotoBoundaryStep(
      previousPyramid,
      currentPyramid,
      previousPoints,
      previousPixelData.width,
      previousPixelData.height,
      config,
      frame === destinationFrame ? destinationHints : undefined,
    );
    maximumDrift = Math.max(maximumDrift, trackedStep.drift);
    if (driftTolerance !== null && maximumDrift > driftTolerance) {
      return null;
    }

    previousPoints = trackedStep.points;
    previousPixelData = currentPixelData;
    previousPyramid = currentPyramid;
    onStep(frame, trackedStep.points, trackedStep.drift);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    templateFrame,
    points: previousPoints,
    drift: maximumDrift,
  };
};

// ---------------------------------------------------------------------------
// Tracking path helpers
// ---------------------------------------------------------------------------

export const normalizeTrackingPathPoints = (path: RotoPath): TrackingPathPoints =>
  path.trackPoints && path.trackPoints.length === path.points.length
    ? [...path.trackPoints]
    : path.points.map(() => ({ x: 0, y: 0 }));

export const getTrackingPathStates = (
  rotoNode: RotoNode,
  sourcePathIds: readonly string[],
): TrackingPathState[] => {
  const selectedPathIdSet = new Set(sourcePathIds);
  return rotoNode.paths
    .filter((path) => selectedPathIdSet.has(path.id))
    .map((path) => ({ path, pointCount: path.points.length }));
};

export const getTrackingPathForState = (
  rotoNode: RotoNode,
  trackingPath: TrackingPathState,
): RotoPath => rotoNode.paths.find((path) => path.id === trackingPath.path.id) ?? trackingPath.path;

export const getResolvedTrackingPath = (
  rotoNode: RotoNode,
  trackingPath: TrackingPathState,
  trackPointsByPathId?: Map<string, TrackingPathPoints>,
): RotoPath => {
  const path = getTrackingPathForState(rotoNode, trackingPath);
  const overriddenTrackPoints = trackPointsByPathId?.get(path.id);
  return overriddenTrackPoints ? { ...path, trackPoints: overriddenTrackPoints } : path;
};

export const getResolvedBoundaryPointsAtFrame = (
  rotoNode: RotoNode,
  trackingPaths: readonly TrackingPathState[],
  frame: number,
  trackPointsByPathId?: Map<string, TrackingPathPoints>,
): { x: number; y: number }[] =>
  trackingPaths.flatMap(({ path }) =>
    resolveRotoPathPointsAtFrame(
      rotoNode,
      getResolvedTrackingPath(
        rotoNode,
        { path, pointCount: path.points.length },
        trackPointsByPathId,
      ),
      frame,
    ),
  );

export const getResolvedBoundaryPointsByPathAtFrame = (
  rotoNode: RotoNode,
  trackingPaths: readonly TrackingPathState[],
  frame: number,
  trackPointsByPathId?: Map<string, TrackingPathPoints>,
) =>
  trackingPaths.map((trackingPath) => {
    const path = getResolvedTrackingPath(rotoNode, trackingPath, trackPointsByPathId);
    return {
      path,
      points: resolveRotoPathPointsAtFrame(rotoNode, path, frame),
    };
  });

/** Builds an artist-authored pose source without reusing prior tracker output. */
export const createRotoManualTemplateNode = (
  rotoNode: RotoNode,
  sourcePathIds: readonly string[],
  target: ResolvedRotoTrackingTarget,
): RotoNode => {
  const sourcePathIdSet = new Set(sourcePathIds);

  return {
    ...rotoNode,
    paths: rotoNode.paths.map((path) =>
      sourcePathIdSet.has(path.id)
        ? {
            ...path,
            trackPoints: undefined,
            trackingTransform: undefined,
            trackingData: undefined,
          }
        : path,
    ),
    layers:
      target.kind === 'layer'
        ? (rotoNode.layers ?? []).map((layer) =>
            layer.id === target.layerId
              ? { ...layer, trackingTransform: undefined, trackingData: undefined }
              : layer,
          )
        : rotoNode.layers,
  };
};

export const getTargetSourceBoundaryPointsAtFrame = (
  rotoNode: RotoNode,
  trackingPaths: readonly TrackingPathState[],
  frame: number,
  target: ResolvedRotoTrackingTarget,
  trackPointsByPathId?: Map<string, TrackingPathPoints>,
): { x: number; y: number }[] =>
  trackingPaths.flatMap((trackingPath) => {
    const path = getResolvedTrackingPath(rotoNode, trackingPath, trackPointsByPathId);

    if (target.kind === 'shape') {
      return resolveRotoPathLocalPointsAtFrame(path, frame);
    }

    return resolveRotoPathPointsAtFrame(rotoNode, path, frame, {
      excludeUpToLayerId: target.layerId,
    });
  });

// ---------------------------------------------------------------------------
// Coordinate-space helpers
// ---------------------------------------------------------------------------

export const projectPointsIntoTargetParentSpace = (
  rotoNode: RotoNode,
  target: ResolvedRotoTrackingTarget,
  frame: number,
  points: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number }[] => {
  if (target.kind === 'shape') {
    const targetPath = rotoNode.paths.find((path) => path.id === target.pathId);
    const parentMatrix = resolveRotoLayerCompositeMatrix(
      rotoNode,
      targetPath ? (targetPath.parentLayerId ?? null) : null,
      frame,
      { includeUserTransform: true },
    );
    const inverseMatrix = invertRotoTrackingMatrix4(parentMatrix);
    return inverseMatrix
      ? points.map((point) => applyRotoTrackingMatrix4ToPoint(inverseMatrix, point))
      : [...points];
  }

  const inverseMatrix = invertRotoTrackingMatrix4(
    resolveRotoLayerCompositeMatrix(rotoNode, target.layerId, frame, {
      includeSelf: false,
      includeUserTransform: true,
    }),
  );
  return inverseMatrix
    ? points.map((point) => applyRotoTrackingMatrix4ToPoint(inverseMatrix, point))
    : [...points];
};

export const buildInternalTrackingPoints = (
  resolvedPathPoints: ReadonlyArray<{
    path: RotoPath;
    points: { x: number; y: number }[];
  }>,
): { x: number; y: number }[] => {
  let internalPoints: { x: number; y: number }[] = [];

  resolvedPathPoints.forEach(({ path, points }) => {
    if (!path.closed || points.length < 3) {
      return;
    }

    const bbox = getBoundingBox(points);
    const width = Math.max(1, bbox.maxX - bbox.minX);
    const height = Math.max(1, bbox.maxY - bbox.minY);
    const gridStep = Math.max(4, Math.min(20, Math.floor(Math.min(width, height) / 3) || 4));
    const pathInternalPoints: { x: number; y: number }[] = [];

    for (let y = bbox.minY + gridStep / 2; y <= bbox.maxY; y += gridStep) {
      for (let x = bbox.minX + gridStep / 2; x <= bbox.maxX; x += gridStep) {
        const candidate = { x, y };
        if (isPointInPolygon(candidate, points)) {
          pathInternalPoints.push(candidate);
        }
      }
    }

    const centroid = points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
    if (
      isPointInPolygon(centroid, points) &&
      !pathInternalPoints.some(
        (point) => Math.hypot(point.x - centroid.x, point.y - centroid.y) < 2,
      )
    ) {
      pathInternalPoints.push(centroid);
    }

    internalPoints.push(...pathInternalPoints);
  });

  if (internalPoints.length > 200) {
    const stride = Math.ceil(internalPoints.length / 200);
    internalPoints = internalPoints.filter((_, index) => index % stride === 0);
  }

  return internalPoints;
};

// ---------------------------------------------------------------------------
// Target data helpers
// ---------------------------------------------------------------------------

export const getTargetTrackingData = (
  rotoNode: RotoNode,
  target: ResolvedRotoTrackingTarget,
): { [frame: number]: number } | undefined => {
  if (target.kind === 'shape') {
    return rotoNode.paths.find((path) => path.id === target.pathId)?.trackingData;
  }

  return rotoNode.layers?.find((layer) => layer.id === target.layerId)?.trackingData;
};

export const getTargetSourcePathIds = (
  rotoNode: RotoNode,
  target: ResolvedRotoTrackingTarget,
): string[] => {
  if (target.kind === 'shape') {
    return [target.pathId];
  }

  const layer = rotoNode.layers?.find((item) => item.id === target.layerId);
  if (layer?.trackingTransform?.sourcePathIds?.length) {
    return [...layer.trackingTransform.sourcePathIds];
  }

  return resolveRotoTrackingSelection(rotoNode, [target.layerId], []).sourcePathIds;
};

// ---------------------------------------------------------------------------
// Transform fitting
// ---------------------------------------------------------------------------

export const fitStoredTrackingTransform = (
  rotoNode: RotoNode,
  trackingPaths: readonly TrackingPathState[],
  frame: number,
  resolvedBoundaryPoints: { x: number; y: number }[],
  config: TrackingConfig,
  target: ResolvedRotoTrackingTarget,
  trackPointsByPathId?: Map<string, TrackingPathPoints>,
): SolvedTransformModel | null => {
  if (config.deform) {
    return null;
  }

  return fitTrackedTransform(
    getTargetSourceBoundaryPointsAtFrame(
      rotoNode,
      trackingPaths,
      frame,
      target,
      trackPointsByPathId,
    ),
    projectPointsIntoTargetParentSpace(rotoNode, target, frame, resolvedBoundaryPoints),
    { ...config, deform: false },
  );
};

// ---------------------------------------------------------------------------
// Node mutation helpers
// ---------------------------------------------------------------------------

export const updateTrackedPathsOnNode = (
  rotoNode: RotoNode,
  sourcePathIds: readonly string[],
  trackingDriftMap: { [frame: number]: number } | null,
  trackPointsByPathId: Map<string, TrackingPathPoints> | null,
): RotoNode => ({
  ...rotoNode,
  paths: rotoNode.paths.map((path) =>
    sourcePathIds.includes(path.id)
      ? trackPointsByPathId
        ? {
            ...path,
            trackPoints: trackPointsByPathId.get(path.id) ?? path.trackPoints,
            trackingData: trackingDriftMap ?? path.trackingData,
          }
        : {
            ...path,
            trackPoints: undefined,
            trackingData: undefined,
          }
      : path,
  ),
});

export const keyframeTrackedBoundaryPoints = ({
  rotoNode,
  projectionNode = rotoNode,
  trackingPaths,
  currentTrackPointsByPathId,
  frame,
  resolvedBoundaryPoints,
}: {
  rotoNode: RotoNode;
  projectionNode?: RotoNode;
  trackingPaths: readonly TrackingPathState[];
  currentTrackPointsByPathId: Map<string, TrackingPathPoints>;
  frame: number;
  resolvedBoundaryPoints: readonly { x: number; y: number }[];
}): Map<string, TrackingPathPoints> => {
  const nextTrackPointsByPathId = new Map<string, TrackingPathPoints>();
  let boundaryOffset = 0;

  trackingPaths.forEach((trackingPath) => {
    const path = getTrackingPathForState(rotoNode, trackingPath);
    const projectionPath = getTrackingPathForState(projectionNode, trackingPath);
    const currentTrackPoints = currentTrackPointsByPathId.get(path.id);
    if (!currentTrackPoints) {
      boundaryOffset += trackingPath.pointCount;
      return;
    }

    nextTrackPointsByPathId.set(
      path.id,
      currentTrackPoints.map((trackPoint, pointIndex) => {
        const targetPoint = resolvedBoundaryPoints[boundaryOffset + pointIndex];
        const resolvedLocalPoint = targetPoint
          ? projectScenePointToRotoPathResolvedLocal(
              projectionNode,
              projectionPath,
              frame,
              targetPoint,
            )
          : resolveRotoPathLocalPointsAtFrame(path, frame)[pointIndex];
        const baseValueX = getLinearValueAtFrame(path.points[pointIndex].x, frame);
        const baseValueY = getLinearValueAtFrame(path.points[pointIndex].y, frame);

        return {
          x: setKeyframeOnValue(
            trackPoint.x,
            frame,
            (resolvedLocalPoint?.x ?? baseValueX) - baseValueX,
          ),
          y: setKeyframeOnValue(
            trackPoint.y,
            frame,
            (resolvedLocalPoint?.y ?? baseValueY) - baseValueY,
          ),
        };
      }),
    );
    boundaryOffset += trackingPath.pointCount;
  });

  return nextTrackPointsByPathId;
};

export const updateTrackingTargetOnNode = (
  rotoNode: RotoNode,
  target: ResolvedRotoTrackingTarget,
  frame: number,
  trackingDriftMap: { [frame: number]: number },
  sourcePathIds: readonly string[],
  solvedTransform: SolvedTransformModel | null,
): RotoNode => {
  if (!solvedTransform) {
    if (target.kind === 'shape') {
      return {
        ...rotoNode,
        paths: rotoNode.paths.map((path) =>
          path.id === target.pathId
            ? { ...path, trackingTransform: undefined, trackingData: trackingDriftMap }
            : path,
        ),
      };
    }

    return {
      ...rotoNode,
      layers: (rotoNode.layers ?? []).map((layer) =>
        layer.id === target.layerId
          ? { ...layer, trackingTransform: undefined, trackingData: trackingDriftMap }
          : layer,
      ),
    };
  }

  const nextTrackingTransform = updateTrackingTransform(
    target.kind === 'shape'
      ? rotoNode.paths.find((path) => path.id === target.pathId)?.trackingTransform
      : rotoNode.layers?.find((layer) => layer.id === target.layerId)?.trackingTransform,
    frame,
    projectTrackingModelToMatrix4(solvedTransform.model, solvedTransform.type),
    solvedTransform.type,
    [...sourcePathIds],
  );

  if (target.kind === 'shape') {
    return {
      ...rotoNode,
      paths: rotoNode.paths.map((path) =>
        path.id === target.pathId
          ? {
              ...path,
              trackingTransform: nextTrackingTransform,
              trackingData: trackingDriftMap,
            }
          : path,
      ),
    };
  }

  return {
    ...rotoNode,
    layers: (rotoNode.layers ?? []).map((layer) =>
      layer.id === target.layerId
        ? {
            ...layer,
            trackingTransform: nextTrackingTransform,
            trackingData: trackingDriftMap,
          }
        : layer,
    ),
  };
};

// ---------------------------------------------------------------------------
// Type for deps needed by tracking action methods
// ---------------------------------------------------------------------------

export type TrackingActionDeps = {
  trackingAbortController: { current: AbortController | null };
  startBackgroundJob?: (input: BackgroundJobInput) => string;
  updateBackgroundJob?: (jobId: string, updates: BackgroundJobUpdate) => void;
  finishBackgroundJob?: (jobId: string, updates?: BackgroundJobUpdate) => void;
};

// ---------------------------------------------------------------------------
// cancelTracking
// ---------------------------------------------------------------------------

export const cancelTrackingService = (deps: TrackingActionDeps) => {
  if (deps.trackingAbortController.current) {
    deps.trackingAbortController.current.abort();
    deps.trackingAbortController.current = null;
  }
};

// ---------------------------------------------------------------------------
// clearRotoTrackingTarget
// ---------------------------------------------------------------------------

export const clearRotoTrackingTargetService = (
  set: SetState,
  get: GetState,
  deps: { commitMutation: CommitEditorMutation },
  rotoNodeId: string,
  target: RotoTrackingTarget,
) => {
  if (isPendingRotoTrackingLayerTarget(target)) return;

  const { nodes, selectedNodeId } = get();
  const rotoIndex = nodes.findIndex((node: AnyNode) => node.id === rotoNodeId);
  if (rotoIndex === -1) return;

  const rotoNode = nodes[rotoIndex] as RotoNode;
  const trackedPathIds = new Set(getTargetSourcePathIds(rotoNode, target));
  const nextPaths = rotoNode.paths.map((path: RotoPath) => {
    if (!trackedPathIds.has(path.id) && !(target.kind === 'shape' && path.id === target.pathId)) {
      return path;
    }

    return {
      ...path,
      trackPoints: undefined,
      trackingData: undefined,
      trackingTransform:
        target.kind === 'shape' && path.id === target.pathId ? undefined : path.trackingTransform,
    };
  });
  const nextLayers =
    target.kind === 'layer'
      ? (rotoNode.layers ?? []).map((layer: RotoLayer) =>
          layer.id === target.layerId
            ? { ...layer, trackingTransform: undefined, trackingData: undefined }
            : layer,
        )
      : rotoNode.layers;

  const newNodes = [...nodes];
  newNodes[rotoIndex] = {
    ...rotoNode,
    paths: nextPaths,
    ...(nextLayers ? { layers: nextLayers } : {}),
  };

  deps.commitMutation({
    patch: { nodes: newNodes },
    history: {
      label: target.kind === 'layer' ? 'Clear Layer Tracking Data' : 'Clear Tracking Data',
      state: { nodes: newNodes, selectedNodeId },
    },
  });
};

// ---------------------------------------------------------------------------
// trackRotoSelection
// ---------------------------------------------------------------------------

export const trackRotoSelectionService = async (
  get: GetState,
  deps: TrackingActionDeps,
  rotoNodeId: string,
  sourcePathIds: string[],
  target: RotoTrackingTarget,
  sourceId: string,
  direction: 'forward' | 'backward',
  frameCount: number,
  config: TrackingConfig,
  options: RotoTrackingRunOptions = {},
  getProjectBranchContext: () => ProjectBranchContext,
  applyRotoTrackingResult: (params: {
    context: ProjectBranchContext;
    rotoNodeId: string;
    trackedNode: RotoNode;
    trackingLabel: string;
  }) => Promise<'current' | 'saved' | 'missing'>,
  setIfCurrentProjectBranch: (
    context: ProjectBranchContext,
    patch: Record<string, unknown>,
  ) => void,
) => {
  const projectContext = getProjectBranchContext();
  const { nodes, currentFrame, timelineStartFrame, maxFrames, fps, colorManagement } = get();
  const trackingSource = resolveSourcePixelSource(nodes, rotoNodeId, sourceId, colorManagement);
  if (!trackingSource) return;
  const trackingFps = fps || 30;
  const trackingPixelReader = createSourcePixelDataReader(trackingSource, trackingFps);
  let trackingJob: RotoTrackingJob | null = null;

  try {
    const rotoNode = nodes.find((node: AnyNode) => node.id === rotoNodeId) as RotoNode | undefined;
    if (!rotoNode) return;

    const trackingPaths = getTrackingPathStates(rotoNode, sourcePathIds);
    if (trackingPaths.length === 0) return;

    const step = direction === 'forward' ? 1 : -1;
    const startFrame = currentFrame;
    const endFrame =
      direction === 'forward'
        ? Math.min(maxFrames, currentFrame + frameCount)
        : Math.max(timelineStartFrame, currentFrame - frameCount);
    const currentNodes = [...nodes];
    const rotoIndex = currentNodes.findIndex((node: AnyNode) => node.id === rotoNodeId);
    const materializedTarget = materializeRotoTrackingTarget(rotoNode, sourcePathIds, target);
    const resolvedTarget = materializedTarget.target;
    const trackingDriftMap = {
      ...(getTargetTrackingData(materializedTarget.node, resolvedTarget) || {}),
    };
    const shouldStoreTrackPoints = config.deform;
    let currentRotoNode = materializedTarget.node;
    let currentTrackPointsByPathId: Map<string, TrackingPathPoints> | undefined;
    const trackingLabel =
      resolvedTarget.kind === 'layer'
        ? 'Track Roto Layer'
        : sourcePathIds.length > 1
          ? 'Track Roto Shapes'
          : 'Track Roto Shape';
    const totalTrackingFrames = Math.max(1, Math.abs(endFrame - startFrame));
    const driftTolerance = config.driftTolerance;
    const temporalTrackingConfig = getTemporalTrackingConfig(config.temporal);
    const runInBackground = options.runInBackground === true;
    trackingJob = createRotoTrackingJob(
      deps.startBackgroundJob,
      deps.updateBackgroundJob,
      deps.finishBackgroundJob,
      trackingLabel,
      currentRotoNode,
      trackingSource,
      get().projectId ?? null,
    );
    let processedTrackingFrames = 0;
    let lastProcessedFrame = startFrame;
    let stoppedByDrift: { frame: number; drift: number } | null = null;

    if (rotoIndex !== -1) {
      currentNodes[rotoIndex] = currentRotoNode;
    }

    if (shouldStoreTrackPoints) {
      currentTrackPointsByPathId = new Map(
        trackingPaths.map(({ path }: { path: RotoPath }) => [
          path.id,
          normalizeTrackingPathPoints(path).map(
            (trackPoint: { x: AnimatableNumber; y: AnimatableNumber }) => ({
              x: setKeyframeOnValue(
                trackPoint.x,
                startFrame,
                getLinearValueAtFrame(trackPoint.x, startFrame),
              ),
              y: setKeyframeOnValue(
                trackPoint.y,
                startFrame,
                getLinearValueAtFrame(trackPoint.y, startFrame),
              ),
            }),
          ),
        ]),
      );
      currentRotoNode = updateTrackedPathsOnNode(
        currentRotoNode,
        sourcePathIds,
        trackingDriftMap,
        currentTrackPointsByPathId,
      );
    } else {
      currentRotoNode = updateTrackedPathsOnNode(currentRotoNode, sourcePathIds, null, null);
    }

    const startResolvedPointsByPath = getResolvedBoundaryPointsByPathAtFrame(
      currentRotoNode,
      trackingPaths,
      startFrame,
    );
    let previousPoints = startResolvedPointsByPath.flatMap(
      ({ points }: { points: { x: number; y: number }[] }) => points,
    );
    let previousPixelData = await trackingPixelReader.getFramePixelData(startFrame);
    let previousPyramid = previousPixelData
      ? buildOpticalFlowPyramid(
          previousPixelData.data,
          previousPixelData.width,
          previousPixelData.height,
        )
      : null;
    let internalPoints = buildInternalTrackingPoints(startResolvedPointsByPath);
    const temporalTrackingState = createTemporalTrackingOnlineState(previousPoints);

    if (rotoIndex !== -1) {
      currentRotoNode = updateTrackingTargetOnNode(
        currentRotoNode,
        resolvedTarget,
        startFrame,
        trackingDriftMap,
        sourcePathIds,
        fitStoredTrackingTransform(
          currentRotoNode,
          trackingPaths,
          startFrame,
          previousPoints,
          config,
          resolvedTarget,
          currentTrackPointsByPathId,
        ),
      );
      currentNodes[rotoIndex] = currentRotoNode;
    }

    if (deps.trackingAbortController.current) deps.trackingAbortController.current.abort();
    const trackingController = new AbortController();
    deps.trackingAbortController.current = trackingController;
    const signal = trackingController.signal;
    bindRotoTrackingJobCancel(trackingJob, trackingController);

    for (
      let frame = startFrame + step;
      direction === 'forward' ? frame <= endFrame : frame >= endFrame;
      frame += step
    ) {
      if (signal.aborted || !previousPixelData || !previousPyramid) break;

      const currentPixelData = await trackingPixelReader.getFramePixelData(frame);
      if (!currentPixelData) break;
      const currentPyramid = buildOpticalFlowPyramid(
        currentPixelData.data,
        currentPixelData.width,
        currentPixelData.height,
      );

      const halfWidth = previousPixelData.width / 2;
      const halfHeight = previousPixelData.height / 2;
      const boundaryCanvasCoords = previousPoints.map((point: { x: number; y: number }) => ({
        x: point.x + halfWidth,
        y: point.y + halfHeight,
      }));
      const internalCanvasCoords = internalPoints.map((point: { x: number; y: number }) => ({
        x: point.x + halfWidth,
        y: point.y + halfHeight,
      }));

      const padding = 2;
      const validInternalIndices: number[] = [];
      const validInternalCanvasCoords: { x: number; y: number }[] = [];

      internalCanvasCoords.forEach((point: { x: number; y: number }, index: number) => {
        if (
          point.x >= padding &&
          point.x <= previousPixelData.width - padding &&
          point.y >= padding &&
          point.y <= previousPixelData.height - padding
        ) {
          validInternalCanvasCoords.push(point);
          validInternalIndices.push(index);
        }
      });

      const trackedAllCanvas = calculateRotoOpticalFlow(
        previousPyramid,
        currentPyramid,
        [...boundaryCanvasCoords, ...validInternalCanvasCoords],
        config,
      );

      const trackedBoundaryCanvas = trackedAllCanvas.slice(0, previousPoints.length);
      const trackedInternalCanvas = trackedAllCanvas.slice(previousPoints.length);
      const frameDrift = getRobustTrackingError(trackedBoundaryCanvas);
      if (driftTolerance !== null && frameDrift > driftTolerance) {
        stoppedByDrift = { frame, drift: frameDrift };
        trackingJob?.update({
          detail: `Stopped at frame ${frame}: drift ${frameDrift.toFixed(
            1,
          )} exceeded ${driftTolerance.toFixed(1)}`,
          progress: Math.min(99, (processedTrackingFrames / totalTrackingFrames) * 100),
        });
        break;
      }

      const boundaryScenePrev = boundaryCanvasCoords.map((point: { x: number; y: number }) => ({
        x: point.x - halfWidth,
        y: point.y - halfHeight,
      }));
      const boundarySceneCurr = trackedBoundaryCanvas.map(
        (point: { x: number; y: number; error: number }) => ({
          x: point.x - halfWidth,
          y: point.y - halfHeight,
        }),
      );
      const validInternalScenePrev = validInternalIndices.map(
        (index: number) => internalPoints[index],
      );
      const validInternalSceneCurr = trackedInternalCanvas.map(
        (point: { x: number; y: number; error: number }) => ({
          x: point.x - halfWidth,
          y: point.y - halfHeight,
        }),
      );

      const allPrevScene = [...boundaryScenePrev, ...validInternalScenePrev];
      const allCurrScene = [...boundarySceneCurr, ...validInternalSceneCurr];
      const solvedMotionTransform = config.deform
        ? null
        : fitTrackedTransform(allPrevScene, allCurrScene, config);
      const rawResolvedBoundaryPoints = config.deform
        ? boundarySceneCurr
        : solvedMotionTransform
          ? applySolvedTransform(boundaryScenePrev, solvedMotionTransform)
          : solveTransform(allPrevScene, allCurrScene, boundaryScenePrev, config);
      const temporalFrame = applyOnlineTemporalTrackingGuard(
        rawResolvedBoundaryPoints,
        temporalTrackingState,
        frameDrift,
        temporalTrackingConfig,
      );
      const resolvedBoundaryPoints = temporalFrame.points;
      const temporalMotionTransform = config.deform
        ? null
        : (fitTrackedTransform(boundaryScenePrev, resolvedBoundaryPoints, config) ??
          solvedMotionTransform);
      trackingDriftMap[frame] = Math.max(frameDrift, temporalFrame.anomalyScore);

      currentTrackPointsByPathId = currentTrackPointsByPathId
        ? keyframeTrackedBoundaryPoints({
            rotoNode: currentRotoNode,
            trackingPaths,
            currentTrackPointsByPathId,
            frame,
            resolvedBoundaryPoints,
          })
        : undefined;

      if (rotoIndex !== -1) {
        currentRotoNode = updateTrackedPathsOnNode(
          currentRotoNode,
          sourcePathIds,
          currentTrackPointsByPathId ? trackingDriftMap : null,
          currentTrackPointsByPathId ?? null,
        );
        currentRotoNode = updateTrackingTargetOnNode(
          currentRotoNode,
          resolvedTarget,
          frame,
          trackingDriftMap,
          sourcePathIds,
          fitStoredTrackingTransform(
            currentRotoNode,
            trackingPaths,
            frame,
            resolvedBoundaryPoints,
            config,
            resolvedTarget,
            currentTrackPointsByPathId,
          ),
        );
        currentNodes[rotoIndex] = currentRotoNode;
      }

      previousPoints = resolvedBoundaryPoints;
      if (config.deform) {
        internalPoints = validInternalSceneCurr;
      } else if (temporalMotionTransform) {
        internalPoints = applySolvedTransform(internalPoints, temporalMotionTransform);
      }

      previousPixelData = currentPixelData;
      previousPyramid = currentPyramid;
      processedTrackingFrames += 1;
      lastProcessedFrame = frame;
      trackingJob?.update({
        detail: formatTrackingProgressDetail(frame, endFrame, trackingDriftMap[frame] ?? null),
        progress: (processedTrackingFrames / totalTrackingFrames) * 100,
      });

      setIfCurrentProjectBranch(projectContext, {
        nodes: runInBackground
          ? get().nodes.map((n: AnyNode) => (n.id === rotoNodeId ? currentRotoNode : n))
          : [...currentNodes],
        ...(runInBackground
          ? {}
          : {
              currentFrame: frame,
              activeTrackingPoints: [...resolvedBoundaryPoints, ...internalPoints],
            }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (deps.trackingAbortController.current === trackingController) {
      deps.trackingAbortController.current = null;
    }

    await applyRotoTrackingResult({
      context: projectContext,
      rotoNodeId,
      trackedNode: currentRotoNode,
      trackingLabel,
    });

    if (signal.aborted) {
      trackingJob?.finish({
        status: 'cancelled',
        progress: (processedTrackingFrames / totalTrackingFrames) * 100,
        detail: `Cancelled at frame ${lastProcessedFrame}`,
        cancellable: false,
      });
    } else if (stoppedByDrift) {
      trackingJob?.finish({
        status: 'cancelled',
        progress: (processedTrackingFrames / totalTrackingFrames) * 100,
        detail: `Stopped at frame ${stoppedByDrift.frame}: drift ${stoppedByDrift.drift.toFixed(
          1,
        )} exceeded ${driftTolerance?.toFixed(1) ?? 'limit'}`,
        cancellable: false,
      });
    } else {
      trackingJob?.finish({
        status: 'complete',
        progress: 100,
        detail: `Tracked through frame ${lastProcessedFrame}`,
        cancellable: false,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tracking failed';
    trackingJob?.finish({
      status: 'error',
      detail: message,
      error: message,
      cancellable: false,
    });
    throw error;
  } finally {
    trackingJob?.unregisterCancel?.();
    trackingPixelReader.dispose();
    setIfCurrentProjectBranch(projectContext, { activeTrackingPoints: null });
  }
};

// ---------------------------------------------------------------------------
// matchRotoSelectionToCurrentFrame
// ---------------------------------------------------------------------------

export const matchRotoSelectionToCurrentFrameService = async (
  get: GetState,
  deps: TrackingActionDeps,
  rotoNodeId: string,
  sourcePathIds: string[],
  target: RotoTrackingTarget,
  sourceId: string,
  config: TrackingConfig,
  options: RotoTrackingRunOptions = {},
  getProjectBranchContext: () => ProjectBranchContext,
  applyRotoTrackingResult: (params: {
    context: ProjectBranchContext;
    rotoNodeId: string;
    trackedNode: RotoNode;
    trackingLabel: string;
  }) => Promise<'current' | 'saved' | 'missing'>,
  setIfCurrentProjectBranch: (
    context: ProjectBranchContext,
    patch: Record<string, unknown>,
  ) => void,
) => {
  const projectContext = getProjectBranchContext();
  const { nodes, currentFrame, fps, colorManagement } = get();
  const rotoNode = nodes.find((node: AnyNode) => node.id === rotoNodeId) as RotoNode | undefined;
  if (!rotoNode) return;

  const templateFrames = getRotoMatchTemplateFrames(rotoNode, sourcePathIds, currentFrame);
  if (templateFrames.previous === null && templateFrames.next === null) {
    return;
  }

  const trackingSource = resolveSourcePixelSource(nodes, rotoNodeId, sourceId, colorManagement);
  if (!trackingSource) return;

  const materializedTarget = materializeRotoTrackingTarget(rotoNode, sourcePathIds, target);
  const resolvedTarget = materializedTarget.target;
  const manualTemplateNode = createRotoManualTemplateNode(
    materializedTarget.node,
    sourcePathIds,
    resolvedTarget,
  );
  const trackingPaths = getTrackingPathStates(manualTemplateNode, sourcePathIds);
  if (trackingPaths.length === 0) return;
  const destinationHints = templateFrames.hasCurrentKeyframe
    ? getResolvedBoundaryPointsAtFrame(manualTemplateNode, trackingPaths, currentFrame)
    : undefined;

  const trackingPixelReader = createSourcePixelDataReader(trackingSource, fps || 30);
  const trackingLabel =
    sourcePathIds.length > 1 ? 'Match Roto Shapes to Frame' : 'Match Roto Shape to Frame';
  const runInBackground = options.runInBackground === true;
  const candidateTemplateFrames = [templateFrames.previous, templateFrames.next].filter(
    (frame): frame is number => frame !== null,
  );
  const totalSteps = Math.max(
    1,
    candidateTemplateFrames.reduce(
      (sum, templateFrame) => sum + Math.abs(currentFrame - templateFrame),
      0,
    ),
  );
  let completedSteps = 0;
  let trackingJob: RotoTrackingJob | null = null;
  let trackingController: AbortController | null = null;

  try {
    trackingJob = createRotoTrackingJob(
      deps.startBackgroundJob,
      deps.updateBackgroundJob,
      deps.finishBackgroundJob,
      trackingLabel,
      manualTemplateNode,
      trackingSource,
      get().projectId ?? null,
    );

    if (deps.trackingAbortController.current) deps.trackingAbortController.current.abort();
    trackingController = new AbortController();
    deps.trackingAbortController.current = trackingController;
    bindRotoTrackingJobCancel(trackingJob, trackingController);

    const matches: RotoTemplateTrackResult[] = [];
    for (const templateFrame of candidateTemplateFrames) {
      if (trackingController.signal.aborted) break;
      const templatePoints = getResolvedBoundaryPointsAtFrame(
        manualTemplateNode,
        trackingPaths,
        templateFrame,
      );
      const match = await trackRotoTemplateToFrame({
        trackingPixelReader,
        templateFrame,
        destinationFrame: currentFrame,
        templatePoints,
        destinationHints,
        config,
        signal: trackingController.signal,
        onStep: (frame, points, drift) => {
          completedSteps += 1;
          trackingJob?.update({
            detail: `Matching ${templateFrame} → ${currentFrame} · frame ${frame} · drift ${drift.toFixed(1)}`,
            progress: Math.min(99, (completedSteps / totalSteps) * 100),
          });
          if (!runInBackground) {
            setIfCurrentProjectBranch(projectContext, { activeTrackingPoints: points });
          }
        },
      });
      if (match) matches.push(match);
    }

    if (trackingController.signal.aborted) {
      trackingJob.finish({
        status: 'cancelled',
        progress: (completedSteps / totalSteps) * 100,
        detail: `Cancelled while matching frame ${currentFrame}`,
        cancellable: false,
      });
      return;
    }

    const previousMatch = matches.find((match) => match.templateFrame === templateFrames.previous);
    const nextMatch = matches.find((match) => match.templateFrame === templateFrames.next);
    if (!previousMatch && !nextMatch) {
      trackingJob.finish({
        status: 'error',
        detail: `Could not match frame ${currentFrame} from the available template`,
        error: 'Template tracking failed or exceeded the drift tolerance',
        cancellable: false,
      });
      return;
    }

    let resolvedBoundaryPoints: { x: number; y: number }[];
    if (
      previousMatch &&
      nextMatch &&
      templateFrames.previous !== null &&
      templateFrames.next !== null
    ) {
      const blend =
        (currentFrame - templateFrames.previous) / (templateFrames.next - templateFrames.previous);
      resolvedBoundaryPoints = previousMatch.points.map((previousPoint, index) => {
        const nextPoint = nextMatch.points[index] ?? previousPoint;
        return {
          x: previousPoint.x * (1 - blend) + nextPoint.x * blend,
          y: previousPoint.y * (1 - blend) + nextPoint.y * blend,
        };
      });
    } else {
      const onlyMatch = previousMatch ?? nextMatch;
      if (!onlyMatch) return;
      resolvedBoundaryPoints = onlyMatch.points;
    }

    const manualCurrentPoints = getResolvedBoundaryPointsAtFrame(
      manualTemplateNode,
      trackingPaths,
      currentFrame,
    );
    const solvedTransform = config.deform
      ? null
      : fitTrackedTransform(manualCurrentPoints, resolvedBoundaryPoints, config);
    const keyframedBoundaryPoints = config.deform
      ? resolvedBoundaryPoints
      : solvedTransform
        ? applySolvedTransform(manualCurrentPoints, solvedTransform)
        : solveTransform(manualCurrentPoints, resolvedBoundaryPoints, manualCurrentPoints, config);
    const scenePointsByPathId = new Map<string, { x: number; y: number }[]>();
    let boundaryOffset = 0;
    trackingPaths.forEach((trackingPath) => {
      scenePointsByPathId.set(
        trackingPath.path.id,
        keyframedBoundaryPoints.slice(boundaryOffset, boundaryOffset + trackingPath.pointCount),
      );
      boundaryOffset += trackingPath.pointCount;
    });
    const currentRotoNode = keyframeRotoPathScenePointsAtFrame(
      rotoNode,
      currentFrame,
      scenePointsByPathId,
    );

    await applyRotoTrackingResult({
      context: projectContext,
      rotoNodeId,
      trackedNode: currentRotoNode,
      trackingLabel,
    });

    const usedTemplateFrames = [previousMatch?.templateFrame, nextMatch?.templateFrame].filter(
      (frame): frame is number => frame !== undefined,
    );
    trackingJob.finish({
      status: 'complete',
      progress: 100,
      detail: `Matched frame ${currentFrame} from ${usedTemplateFrames.join(' + ')}`,
      cancellable: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Current-frame matching failed';
    trackingJob?.finish({
      status: 'error',
      detail: message,
      error: message,
      cancellable: false,
    });
    throw error;
  } finally {
    if (trackingController && deps.trackingAbortController.current === trackingController) {
      deps.trackingAbortController.current = null;
    }
    trackingJob?.unregisterCancel?.();
    trackingPixelReader.dispose();
    setIfCurrentProjectBranch(projectContext, { activeTrackingPoints: null });
  }
};

// ---------------------------------------------------------------------------
// smartTrackRotoSelection
// ---------------------------------------------------------------------------

export const smartTrackRotoSelectionService = async (
  get: GetState,
  deps: TrackingActionDeps,
  rotoNodeId: string,
  sourcePathIds: string[],
  target: RotoTrackingTarget,
  sourceId: string,
  config: TrackingConfig,
  options: RotoTrackingRunOptions = {},
  getProjectBranchContext: () => ProjectBranchContext,
  applyRotoTrackingResult: (params: {
    context: ProjectBranchContext;
    rotoNodeId: string;
    trackedNode: RotoNode;
    trackingLabel: string;
  }) => Promise<'current' | 'saved' | 'missing'>,
  setIfCurrentProjectBranch: (
    context: ProjectBranchContext,
    patch: Record<string, unknown>,
  ) => void,
) => {
  const projectContext = getProjectBranchContext();
  const { nodes, currentFrame, fps, colorManagement } = get();
  const rotoNode = nodes.find((node: AnyNode) => node.id === rotoNodeId) as RotoNode | undefined;
  if (!rotoNode) return;

  const trackingPaths = getTrackingPathStates(rotoNode, sourcePathIds);
  if (trackingPaths.length === 0) return;

  const trackingSource = resolveSourcePixelSource(nodes, rotoNodeId, sourceId, colorManagement);
  if (!trackingSource) return;
  const trackingFps = fps || 30;
  const trackingPixelReader = createSourcePixelDataReader(trackingSource, trackingFps);
  let trackingJob: RotoTrackingJob | null = null;

  try {
    const keyframes: number[] = [];
    const checkProp = (prop: AnimatableNumber) => {
      if (Array.isArray(prop)) {
        prop.forEach((keyframe) => keyframes.push(keyframe.frame));
      }
    };

    trackingPaths.forEach(({ path }: { path: RotoPath }) => {
      path.points.forEach((point: { x: AnimatableNumber; y: AnimatableNumber }) => {
        checkProp(point.x);
        checkProp(point.y);
      });
      path.trackPoints?.forEach((trackPoint: { x: AnimatableNumber; y: AnimatableNumber }) => {
        checkProp(trackPoint.x);
        checkProp(trackPoint.y);
      });
    });

    const sortedKeys = [...new Set(keyframes)].sort((a, b) => a - b);
    const prevKey = sortedKeys.filter((frame) => frame <= currentFrame).pop();
    const nextKey = sortedKeys.find((frame) => frame > currentFrame);

    if (!(prevKey !== undefined && nextKey !== undefined)) {
      console.warn('Smart Track requires a keyframe before and after the current position.');
      return;
    }

    const startFrame = prevKey;
    const endFrame = nextKey;
    const rangeLength = endFrame - startFrame;
    if (rangeLength <= 1) return;

    const currentNodes = [...nodes];
    const rotoIndex = currentNodes.findIndex((node: AnyNode) => node.id === rotoNodeId);
    const materializedTarget = materializeRotoTrackingTarget(rotoNode, sourcePathIds, target);
    const resolvedTarget = materializedTarget.target;
    const trackingDriftMap = {
      ...(getTargetTrackingData(materializedTarget.node, resolvedTarget) || {}),
    };
    const shouldStoreTrackPoints = config.deform;
    let currentRotoNode = materializedTarget.node;
    let currentTrackPointsByPathId: Map<string, TrackingPathPoints> | undefined;
    const trackingLabel =
      resolvedTarget.kind === 'layer' ? 'Smart Track Roto Layer' : 'Smart Track Roto';
    const runInBackground = options.runInBackground === true;
    const driftTolerance = config.driftTolerance;
    const temporalTrackingConfig = getTemporalTrackingConfig(config.temporal);
    const totalSmartSteps = Math.max(1, (rangeLength - 1) * 3);
    let completedSmartSteps = 0;
    let lastProcessedFrame = startFrame;
    let stoppedByDrift: { frame: number; drift: number } | null = null;
    trackingJob = createRotoTrackingJob(
      deps.startBackgroundJob,
      deps.updateBackgroundJob,
      deps.finishBackgroundJob,
      trackingLabel,
      currentRotoNode,
      trackingSource,
      get().projectId ?? null,
    );

    if (rotoIndex !== -1) {
      currentNodes[rotoIndex] = currentRotoNode;
    }

    if (shouldStoreTrackPoints) {
      currentTrackPointsByPathId = new Map(
        trackingPaths.map(({ path }: { path: RotoPath }) => [
          path.id,
          normalizeTrackingPathPoints(path),
        ]),
      );
      currentRotoNode = updateTrackedPathsOnNode(
        currentRotoNode,
        sourcePathIds,
        trackingDriftMap,
        currentTrackPointsByPathId,
      );
    } else {
      currentRotoNode = updateTrackedPathsOnNode(currentRotoNode, sourcePathIds, null, null);
    }

    const startResolvedPoints = getResolvedBoundaryPointsAtFrame(
      currentRotoNode,
      trackingPaths,
      startFrame,
    );
    const endResolvedPoints = getResolvedBoundaryPointsAtFrame(
      currentRotoNode,
      trackingPaths,
      endFrame,
    );

    if (rotoIndex !== -1) {
      currentRotoNode = updateTrackingTargetOnNode(
        currentRotoNode,
        resolvedTarget,
        startFrame,
        trackingDriftMap,
        sourcePathIds,
        fitStoredTrackingTransform(
          currentRotoNode,
          trackingPaths,
          startFrame,
          startResolvedPoints,
          config,
          resolvedTarget,
          currentTrackPointsByPathId,
        ),
      );
      currentRotoNode = updateTrackingTargetOnNode(
        currentRotoNode,
        resolvedTarget,
        endFrame,
        trackingDriftMap,
        sourcePathIds,
        fitStoredTrackingTransform(
          currentRotoNode,
          trackingPaths,
          endFrame,
          endResolvedPoints,
          config,
          resolvedTarget,
          currentTrackPointsByPathId,
        ),
      );
      currentNodes[rotoIndex] = currentRotoNode;
    }

    if (deps.trackingAbortController.current) deps.trackingAbortController.current.abort();
    const trackingController = new AbortController();
    deps.trackingAbortController.current = trackingController;
    const signal = trackingController.signal;
    bindRotoTrackingJobCancel(trackingJob, trackingController);

    const forwardTracks: { [frame: number]: { x: number; y: number }[] } = {};
    let previousPoints = startResolvedPoints;
    let previousPixelData = await trackingPixelReader.getFramePixelData(startFrame);
    let previousPyramid = previousPixelData
      ? buildOpticalFlowPyramid(
          previousPixelData.data,
          previousPixelData.width,
          previousPixelData.height,
        )
      : null;
    forwardTracks[startFrame] = previousPoints;

    for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
      if (signal.aborted || !previousPixelData || !previousPyramid) break;
      const currentPixelData = await trackingPixelReader.getFramePixelData(frame);
      if (!currentPixelData) break;
      const currentPyramid = buildOpticalFlowPyramid(
        currentPixelData.data,
        currentPixelData.width,
        currentPixelData.height,
      );

      const trackedStep = trackRotoBoundaryStep(
        previousPyramid,
        currentPyramid,
        previousPoints,
        previousPixelData.width,
        previousPixelData.height,
        config,
      );
      const frameDrift = trackedStep.drift;
      if (driftTolerance !== null && frameDrift > driftTolerance) {
        stoppedByDrift = { frame, drift: frameDrift };
        trackingJob?.update({
          detail: `Stopped at frame ${frame}: drift ${frameDrift.toFixed(
            1,
          )} exceeded ${driftTolerance.toFixed(1)}`,
          progress: Math.min(99, (completedSmartSteps / totalSmartSteps) * 100),
        });
        break;
      }
      trackingDriftMap[frame] = frameDrift;
      const trackedScene = trackedStep.points;

      forwardTracks[frame] = trackedScene;
      previousPoints = trackedScene;
      previousPixelData = currentPixelData;
      previousPyramid = currentPyramid;
      completedSmartSteps += 1;
      lastProcessedFrame = frame;
      trackingJob?.update({
        detail: `Forward frame ${frame} of ${endFrame} · Drift ${frameDrift.toFixed(1)}`,
        progress: (completedSmartSteps / totalSmartSteps) * 100,
      });

      if (!runInBackground) {
        setIfCurrentProjectBranch(projectContext, {
          currentFrame: frame,
          activeTrackingPoints: trackedScene,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const backwardTracks: { [frame: number]: { x: number; y: number }[] } = {};
    let nextPoints = endResolvedPoints;
    let nextPixelData = await trackingPixelReader.getFramePixelData(endFrame);
    let nextPyramid = nextPixelData
      ? buildOpticalFlowPyramid(nextPixelData.data, nextPixelData.width, nextPixelData.height)
      : null;
    backwardTracks[endFrame] = nextPoints;

    if (!signal.aborted && !stoppedByDrift) {
      for (let frame = endFrame - 1; frame > startFrame; frame -= 1) {
        if (signal.aborted || !nextPixelData || !nextPyramid) break;
        const currentPixelData = await trackingPixelReader.getFramePixelData(frame);
        if (!currentPixelData) break;
        const currentPyramid = buildOpticalFlowPyramid(
          currentPixelData.data,
          currentPixelData.width,
          currentPixelData.height,
        );

        const trackedStep = trackRotoBoundaryStep(
          nextPyramid,
          currentPyramid,
          nextPoints,
          nextPixelData.width,
          nextPixelData.height,
          config,
        );
        const frameDrift = trackedStep.drift;
        if (driftTolerance !== null && frameDrift > driftTolerance) {
          stoppedByDrift = { frame, drift: frameDrift };
          trackingJob?.update({
            detail: `Stopped at frame ${frame}: drift ${frameDrift.toFixed(
              1,
            )} exceeded ${driftTolerance.toFixed(1)}`,
            progress: Math.min(99, (completedSmartSteps / totalSmartSteps) * 100),
          });
          break;
        }
        trackingDriftMap[frame] = Math.max(trackingDriftMap[frame] ?? 0, frameDrift);
        const trackedScene = trackedStep.points;

        backwardTracks[frame] = trackedScene;
        nextPoints = trackedScene;
        nextPixelData = currentPixelData;
        nextPyramid = currentPyramid;
        completedSmartSteps += 1;
        lastProcessedFrame = frame;
        trackingJob?.update({
          detail: `Backward frame ${frame} of ${startFrame} · Drift ${frameDrift.toFixed(1)}`,
          progress: (completedSmartSteps / totalSmartSteps) * 100,
        });

        if (!runInBackground) {
          setIfCurrentProjectBranch(projectContext, {
            currentFrame: frame,
            activeTrackingPoints: trackedScene,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (!signal.aborted && !stoppedByDrift) {
      const blendedFrames: TemporalTrackingFrame[] = [];

      for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
        const forwardPoints = forwardTracks[frame];
        const backwardPoints = backwardTracks[frame];
        if (!forwardPoints || !backwardPoints) continue;

        const t = (frame - startFrame) / rangeLength;
        const blendedPoints = forwardPoints.map(
          (forwardPoint: { x: number; y: number }, index: number) => {
            const backwardPoint = backwardPoints[index];
            return {
              x: forwardPoint.x * (1 - t) + backwardPoint.x * t,
              y: forwardPoint.y * (1 - t) + backwardPoint.y * t,
            };
          },
        );

        blendedFrames.push({
          frame,
          points: blendedPoints,
          drift: trackingDriftMap[frame] ?? 0,
          disagreement: getMeanPointDistance(forwardPoints, backwardPoints),
        });
      }

      const temporalFrames = applyTemporalTrackingGuard(blendedFrames, temporalTrackingConfig);
      for (const temporalFrame of temporalFrames) {
        const frame = temporalFrame.frame;
        const resolvedBoundaryPoints = temporalFrame.points;
        trackingDriftMap[frame] = Math.max(
          trackingDriftMap[frame] ?? 0,
          temporalFrame.anomalyScore,
        );

        const storedTransform = fitStoredTrackingTransform(
          currentRotoNode,
          trackingPaths,
          frame,
          resolvedBoundaryPoints,
          config,
          resolvedTarget,
          currentTrackPointsByPathId,
        );

        currentTrackPointsByPathId = currentTrackPointsByPathId
          ? keyframeTrackedBoundaryPoints({
              rotoNode: currentRotoNode,
              trackingPaths,
              currentTrackPointsByPathId,
              frame,
              resolvedBoundaryPoints,
            })
          : undefined;

        if (rotoIndex !== -1) {
          currentRotoNode = updateTrackedPathsOnNode(
            currentRotoNode,
            sourcePathIds,
            currentTrackPointsByPathId ? trackingDriftMap : null,
            currentTrackPointsByPathId ?? null,
          );
          currentRotoNode = updateTrackingTargetOnNode(
            currentRotoNode,
            resolvedTarget,
            frame,
            trackingDriftMap,
            sourcePathIds,
            storedTransform,
          );
          currentNodes[rotoIndex] = currentRotoNode;
        }
        completedSmartSteps += 1;
        lastProcessedFrame = frame;
        trackingJob?.update({
          detail: `${temporalFrame.anomaly ? 'Repairing' : 'Blending'} frame ${frame} of ${endFrame}`,
          progress: (completedSmartSteps / totalSmartSteps) * 100,
        });
      }
    }

    if (deps.trackingAbortController.current === trackingController) {
      deps.trackingAbortController.current = null;
    }

    await applyRotoTrackingResult({
      context: projectContext,
      rotoNodeId,
      trackedNode: currentRotoNode,
      trackingLabel,
    });

    if (signal.aborted) {
      trackingJob?.finish({
        status: 'cancelled',
        progress: (completedSmartSteps / totalSmartSteps) * 100,
        detail: `Cancelled at frame ${lastProcessedFrame}`,
        cancellable: false,
      });
    } else if (stoppedByDrift) {
      trackingJob?.finish({
        status: 'cancelled',
        progress: (completedSmartSteps / totalSmartSteps) * 100,
        detail: `Stopped at frame ${stoppedByDrift.frame}: drift ${stoppedByDrift.drift.toFixed(
          1,
        )} exceeded ${driftTolerance?.toFixed(1) ?? 'limit'}`,
        cancellable: false,
      });
    } else {
      trackingJob?.finish({
        status: 'complete',
        progress: 100,
        detail: `Smart tracked ${startFrame}-${endFrame}`,
        cancellable: false,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Smart tracking failed';
    trackingJob?.finish({
      status: 'error',
      detail: message,
      error: message,
      cancellable: false,
    });
    throw error;
  } finally {
    trackingJob?.unregisterCancel?.();
    trackingPixelReader.dispose();
    setIfCurrentProjectBranch(projectContext, { activeTrackingPoints: null });
  }
};
