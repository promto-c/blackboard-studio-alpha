import type { MutableRefObject } from 'react';
import {
  HistoryEntry,
  NodeType,
  AnyNode,
  ComfyNode,
  GeneratedOutput,
  ImageNode,
  SceneNode,
  VideoNode,
  ImageSequenceNode,
  BlendMode,
  ImageFitMode,
  EditorTab,
  RotoNode,
  AnimatableNumber,
  TrackingConfig,
  ViewerSlotAssignments,
  type RotoPath,
} from '@blackboard/types';
import {
  SCHEMA_VERSION,
  saveProject,
  loadProjectState,
  saveProjectIndex,
  getProjectIndex,
  deleteProject as deleteProjectFromStorage,
  MAIN_PROJECT_BRANCH_ID,
  createProjectBranchRecord,
  deleteProjectBranchRecords,
  ensureProjectBranches,
  getActiveProjectBranchId,
  getProjectBranches,
  getProjectBranchStorageId,
  initializeProjectBranches,
  setActiveProjectBranchId,
  touchProjectBranch,
  upsertProjectBranch,
  type ProjectBranchRecord,
} from '@/state/persist';
import { saveAsset, deleteAssets, requestReferencePermissions } from '@/state/assetStorage';
import { exportProjectBundle, importProjectBundle } from '@/state/projectTransfer';
import {
  buildPersistedProjectState,
  type StoredProjectState,
} from '@/state/editor/projectSnapshots';
import { buildProjectInitState } from '@/state/editor/actions';
import { getInitialHistoryEntry, getInitialState } from '@/state/editor/initialState';
import { calculateTransformForFitMode, getMedian } from '@/state/editor/selectors';
import {
  type SequenceImportMode,
  readImageDimensions,
  getSequenceProjectName,
  collectImageEntriesFromDirectoryHandle,
  buildImageEntriesFromFiles,
  persistSequenceAssets,
  collectNodeAssetIds,
} from '@/state/editor/utils';
import { getLinearValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';
import {
  applySolvedTransform,
  buildOpticalFlowPyramid,
  calculateOpticalFlowFromPyramids,
  fitTrackedTransform,
  solveTransform,
  type SolvedTransformModel,
} from '@/utils/opticalFlow';
import { getBoundingBox, isPointInPolygon } from '@/utils/bspline';
import { getImportedImageColorSpace, getMediaFileKind } from '@/utils/mediaFiles';
import type { SetState, GetState } from '@/state/editor/slices/types';
import {
  getNodePositionsForFlow,
  getOrderedNodesFromFlow,
  getRootFlow,
  replaceFlowNodes,
} from '@/state/editor/flowModel';
import { getDefaultViewportTool, nodeFlags } from '@/effects/effectHelpers';
import {
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';
import {
  applyRotoTrackingMatrix4ToPoint,
  invertRotoTrackingMatrix4,
  isPendingRotoTrackingLayerTarget,
  materializeRotoTrackingTarget,
  projectScenePointToRotoPathResolvedLocal,
  projectTrackingModelToMatrix4,
  resolveRotoLayerCompositeMatrix,
  resolveRotoPathLocalPointsAtFrame,
  resolveRotoPathPointsAtFrame,
  resolveRotoTrackingSelection,
  updateTrackingTransform,
  type ResolvedRotoTrackingTarget,
  type RotoTrackingTarget,
} from '@/utils/rotoTracking';
import {
  createSourcePixelDataReader,
  resolveSourcePixelSource,
} from '@/state/editor/services/sourcePixelData';
import {
  registerBackgroundJobCancelHandler,
  type BackgroundJobInput,
  type BackgroundJobUpdate,
} from '@/state/editor/services/backgroundJobs';

type RotoTrackingRunOptions = {
  runInBackground?: boolean;
};

type ProjectBranchContext = {
  projectId: string | null;
  branchId: string;
  storageId: string | null;
};

type ComfyApplyTarget = 'current' | 'saved' | 'missing' | 'gallery';

const isComfyNode = (node: AnyNode): node is ComfyNode => node.type === NodeType.COMFY;

const readGeneratedOutputsUpdate = (updates: Partial<AnyNode>): GeneratedOutput[] | undefined => {
  const generatedOutputs = (updates as Partial<ComfyNode>).generatedOutputs;
  return Array.isArray(generatedOutputs) ? generatedOutputs : undefined;
};

const mergeGeneratedOutputs = (
  existingOutputs: GeneratedOutput[] | undefined,
  incomingOutputs: GeneratedOutput[] | undefined,
): GeneratedOutput[] | undefined => {
  if (!incomingOutputs || incomingOutputs.length === 0) return existingOutputs;

  const mergedOutputs = [...(existingOutputs ?? [])];
  const outputIndexById = new Map(mergedOutputs.map((output, index) => [output.id, index]));

  incomingOutputs.forEach((incomingOutput) => {
    const existingIndex = outputIndexById.get(incomingOutput.id);
    if (existingIndex === undefined) {
      outputIndexById.set(incomingOutput.id, mergedOutputs.length);
      mergedOutputs.push(incomingOutput);
      return;
    }

    mergedOutputs[existingIndex] = {
      ...incomingOutput,
      ...mergedOutputs[existingIndex],
    };
  });

  return mergedOutputs;
};

const mergeGeneratedOutputsIntoNodes = (
  nodes: AnyNode[] | undefined,
  nodeId: string,
  generatedOutputs: GeneratedOutput[] | undefined,
): AnyNode[] | undefined => {
  if (!nodes || !generatedOutputs || generatedOutputs.length === 0) return nodes;

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId || !isComfyNode(node)) return node;

    const nextGeneratedOutputs = mergeGeneratedOutputs(node.generatedOutputs, generatedOutputs);
    if (nextGeneratedOutputs === node.generatedOutputs) return node;

    changed = true;
    return {
      ...node,
      generatedOutputs: nextGeneratedOutputs,
    } as ComfyNode;
  });

  return changed ? nextNodes : nodes;
};

const mergeGeneratedOutputsIntoHistory = (
  history: HistoryEntry[],
  nodeId: string,
  generatedOutputs: GeneratedOutput[] | undefined,
): HistoryEntry[] => {
  if (!generatedOutputs || generatedOutputs.length === 0) return history;

  let historyChanged = false;
  const nextHistory = history.map((entry) => {
    const nextNodes = mergeGeneratedOutputsIntoNodes(entry.state.nodes, nodeId, generatedOutputs);
    let nextFlows = entry.state.flows;

    if (entry.state.flows) {
      const rootFlow = getRootFlow(entry.state.flows, entry.state.rootFlowId || null);
      const flowNodes = getOrderedNodesFromFlow(rootFlow);
      const nextFlowNodes = mergeGeneratedOutputsIntoNodes(flowNodes, nodeId, generatedOutputs);
      if (nextFlowNodes && nextFlowNodes !== flowNodes) {
        nextFlows = replaceFlowNodes(
          entry.state.flows,
          entry.state.rootFlowId || null,
          nextFlowNodes,
          rootFlow?.name ?? 'Root Flow',
        );
      }
    }

    if (nextNodes === entry.state.nodes && nextFlows === entry.state.flows) {
      return entry;
    }

    historyChanged = true;
    return {
      ...entry,
      state: {
        ...entry.state,
        ...(nextNodes !== entry.state.nodes ? { nodes: nextNodes } : {}),
        ...(nextFlows !== entry.state.flows ? { flows: nextFlows } : {}),
      },
    };
  });

  return historyChanged ? nextHistory : history;
};

const getActiveHistoryEntryId = (history: HistoryEntry[], historyIndex: number): string | null =>
  history[historyIndex]?.id ?? null;

export function createProjectActions(
  set: SetState,
  get: GetState,
  deps: {
    pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
    debouncedSave: () => void;
    trackingAbortController: MutableRefObject<AbortController | null>;
    startBackgroundJob?: (input: BackgroundJobInput) => string;
    updateBackgroundJob?: (jobId: string, updates: BackgroundJobUpdate) => void;
    finishBackgroundJob?: (jobId: string, updates?: BackgroundJobUpdate) => void;
  },
) {
  // ---------------------------------------------------------------------------
  // Node factory helpers — reduce construction duplication across project actions
  // ---------------------------------------------------------------------------

  const createSceneNode = (opts: {
    width: number;
    height: number;
    maxFrames?: number;
    fps?: number;
  }): SceneNode => ({
    id: `scene_${Date.now()}`,
    type: NodeType.SCENE,
    name: 'Scene',
    visible: true,
    width: opts.width,
    height: opts.height,
    bitDepth: 16,
    colorSpace: 'Linear',
    maxFrames: opts.maxFrames ?? 0,
    fps: opts.fps ?? 30,
  });

  const createImageNode = (opts: {
    name: string;
    src: string;
    width: number;
    height: number;
    colorSpace?: ImageNode['colorSpace'];
    transform?: ImageNode['transform'];
  }): ImageNode => ({
    id: `img_${Date.now()}`,
    type: NodeType.IMAGE,
    name: opts.name,
    visible: true,
    src: opts.src,
    width: opts.width,
    height: opts.height,
    opacity: 100,
    operator: BlendMode.OVER,
    colorSpace: opts.colorSpace ?? 'sRGB',
    transform: opts.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
  });

  const createVideoNode = (opts: {
    name: string;
    src: string;
    width: number;
    height: number;
    duration: number;
    scaleX?: number;
    scaleY?: number;
  }): VideoNode => ({
    id: `vid_${Date.now()}`,
    type: NodeType.VIDEO,
    name: opts.name,
    visible: true,
    src: opts.src,
    width: opts.width,
    height: opts.height,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: {
      x: 0,
      y: 0,
      scaleX: opts.scaleX ?? 1,
      scaleY: opts.scaleY ?? 1,
      fitMode: ImageFitMode.FIT,
    },
    duration: opts.duration,
    loop: true,
  });

  const createSequenceNode = (opts: {
    name: string;
    frames: string[];
    width: number;
    height: number;
    colorSpace?: ImageSequenceNode['colorSpace'];
    scaleX?: number;
    scaleY?: number;
  }): ImageSequenceNode => ({
    id: `seq_${Date.now()}`,
    type: NodeType.IMAGE_SEQUENCE,
    name: opts.name,
    visible: true,
    frames: opts.frames,
    width: opts.width,
    height: opts.height,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: {
      x: 0,
      y: 0,
      scaleX: opts.scaleX ?? 1,
      scaleY: opts.scaleY ?? 1,
      fitMode: ImageFitMode.FIT,
    },
    colorSpace: opts.colorSpace ?? 'sRGB',
    fps: 30,
    startFrame: 0,
    loop: true,
  });

  /** Find the scene node using registry flags instead of hardcoded NodeType check. */
  const findSceneNode = (nodes: AnyNode[]): SceneNode | undefined =>
    nodes.find((n) => nodeFlags(n.type).isSceneLike) as SceneNode | undefined;

  const readVideoMetadata = async (
    file: File,
  ): Promise<{ width: number; height: number; duration: number }> => {
    const objectUrl = URL.createObjectURL(file);

    try {
      return await new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = objectUrl;
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
          });
        video.onerror = () => reject(new Error(`Could not decode video "${file.name}"`));
        video.load();
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  };

  type TrackingPathPoints = { x: AnimatableNumber; y: AnimatableNumber }[];

  type TrackingPathState = {
    path: RotoPath;
    pointCount: number;
  };

  type RotoTrackingJob = {
    id: string;
    finish: (updates: BackgroundJobUpdate) => void;
    update: (updates: BackgroundJobUpdate) => void;
    unregisterCancel?: () => void;
  };

  const getRobustTrackingError = (trackedPoints: readonly { error: number }[]): number => {
    const finiteErrors = trackedPoints
      .map((trackedPoint) => trackedPoint.error)
      .filter((error) => Number.isFinite(error));
    if (finiteErrors.length === 0) return 0;

    const failedPointCount = finiteErrors.filter((error) => error >= 100).length;
    if (failedPointCount / finiteErrors.length >= 0.5) {
      return 100;
    }

    const sortedErrors = finiteErrors.filter((error) => error < 100).sort((a, b) => a - b);
    if (sortedErrors.length === 0) return 100;

    const trimCount = sortedErrors.length >= 5 ? Math.floor(sortedErrors.length * 0.2) : 0;
    const stableErrors =
      trimCount > 0 ? sortedErrors.slice(0, sortedErrors.length - trimCount) : sortedErrors;

    return stableErrors.reduce((sum, error) => sum + error, 0) / stableErrors.length;
  };

  const createRotoTrackingJob = (
    title: string,
    rotoNode: RotoNode,
    enabled: boolean | undefined,
  ): RotoTrackingJob | null => {
    if (
      !enabled ||
      !deps.startBackgroundJob ||
      !deps.updateBackgroundJob ||
      !deps.finishBackgroundJob
    ) {
      return null;
    }

    const { projectId } = get();
    const jobId = deps.startBackgroundJob({
      type: 'tracking',
      title,
      subtitle: rotoNode.name,
      detail: 'Preparing tracking',
      status: 'running',
      progress: 0,
      indeterminate: false,
      cancellable: true,
      source: {
        ...(projectId ? { projectId } : {}),
        nodeId: rotoNode.id,
      },
    });

    return {
      id: jobId,
      update: (updates) => deps.updateBackgroundJob?.(jobId, updates),
      finish: (updates) => deps.finishBackgroundJob?.(jobId, updates),
    };
  };

  const bindRotoTrackingJobCancel = (
    job: RotoTrackingJob | null,
    controller: AbortController,
  ): void => {
    if (!job) return;
    job.unregisterCancel = registerBackgroundJobCancelHandler(job.id, () => {
      controller.abort();
    });
  };

  const formatTrackingProgressDetail = (
    frame: number,
    endFrame: number,
    drift: number | null,
  ): string =>
    drift === null
      ? `Frame ${frame} of ${endFrame}`
      : `Frame ${frame} of ${endFrame} · Drift ${drift.toFixed(1)}`;

  const normalizeTrackingPathPoints = (path: RotoPath): TrackingPathPoints =>
    path.trackPoints && path.trackPoints.length === path.points.length
      ? [...path.trackPoints]
      : path.points.map(() => ({ x: 0, y: 0 }));

  const getTrackingPathStates = (
    rotoNode: RotoNode,
    sourcePathIds: readonly string[],
  ): TrackingPathState[] => {
    const selectedPathIdSet = new Set(sourcePathIds);
    return rotoNode.paths
      .filter((path) => selectedPathIdSet.has(path.id))
      .map((path) => ({ path, pointCount: path.points.length }));
  };

  const getTrackingPathForState = (rotoNode: RotoNode, trackingPath: TrackingPathState): RotoPath =>
    rotoNode.paths.find((path) => path.id === trackingPath.path.id) ?? trackingPath.path;

  const getResolvedTrackingPath = (
    rotoNode: RotoNode,
    trackingPath: TrackingPathState,
    trackPointsByPathId?: Map<string, TrackingPathPoints>,
  ): RotoPath => {
    const path = getTrackingPathForState(rotoNode, trackingPath);
    const overriddenTrackPoints = trackPointsByPathId?.get(path.id);
    return overriddenTrackPoints ? { ...path, trackPoints: overriddenTrackPoints } : path;
  };

  const getResolvedBoundaryPointsAtFrame = (
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

  const getResolvedBoundaryPointsByPathAtFrame = (
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

  const getTargetSourceBoundaryPointsAtFrame = (
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

  const projectPointsIntoTargetParentSpace = (
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

  const buildInternalTrackingPoints = (
    resolvedPathPoints: ReadonlyArray<{
      path: RotoPath;
      points: { x: number; y: number }[];
    }>,
  ): { x: number; y: number }[] => {
    const gridStep = 20;
    let internalPoints: { x: number; y: number }[] = [];

    resolvedPathPoints.forEach(({ path, points }) => {
      if (!path.closed || points.length < 3) {
        return;
      }

      const bbox = getBoundingBox(points);
      for (let y = bbox.minY; y <= bbox.maxY; y += gridStep) {
        for (let x = bbox.minX; x <= bbox.maxX; x += gridStep) {
          if (isPointInPolygon({ x, y }, points)) {
            internalPoints.push({ x, y });
          }
        }
      }
    });

    if (internalPoints.length > 200) {
      const stride = Math.ceil(internalPoints.length / 200);
      internalPoints = internalPoints.filter((_, index) => index % stride === 0);
    }

    return internalPoints;
  };

  const getTargetTrackingData = (
    rotoNode: RotoNode,
    target: ResolvedRotoTrackingTarget,
  ): { [frame: number]: number } | undefined => {
    if (target.kind === 'shape') {
      return rotoNode.paths.find((path) => path.id === target.pathId)?.trackingData;
    }

    return rotoNode.layers?.find((layer) => layer.id === target.layerId)?.trackingData;
  };

  const getTargetSourcePathIds = (
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

  const fitStoredTrackingTransform = (
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

  const updateTrackedPathsOnNode = (
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

  const updateTrackingTargetOnNode = (
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

  const updateProjectIndexModified = (
    projectId: string,
    timestamp = Date.now(),
    thumbnail?: string | null,
  ) => {
    const state = get();
    const index = getProjectIndex();
    saveProjectIndex(
      index.map((entry) =>
        entry.id === projectId
          ? {
              ...entry,
              lastModified: timestamp,
              thumbnail: thumbnail ?? entry.thumbnail,
              thumbnailAssetId: state.thumbnailAssetId ?? entry.thumbnailAssetId,
              schemaVersion: SCHEMA_VERSION,
            }
          : entry,
      ),
    );
  };

  const getProjectBranchContext = (): ProjectBranchContext => {
    const { projectId, activeProjectBranchId } = get();
    const branchId = projectId
      ? activeProjectBranchId || getActiveProjectBranchId(projectId)
      : MAIN_PROJECT_BRANCH_ID;

    return {
      projectId,
      branchId,
      storageId: projectId ? getProjectBranchStorageId(projectId, branchId) : null,
    };
  };

  const isCurrentProjectBranchContext = (context: ProjectBranchContext): boolean => {
    const state = get();
    return (
      state.projectId === context.projectId &&
      (state.activeProjectBranchId || MAIN_PROJECT_BRANCH_ID) === context.branchId
    );
  };

  const setIfCurrentProjectBranch = (
    context: ProjectBranchContext,
    patch: Partial<ReturnType<typeof getInitialState> & { maxFrames: number }>,
  ) => {
    if (!isCurrentProjectBranchContext(context)) return;
    set(() => patch);
  };

  const appendPersistedHistoryEntry = (
    projectState: StoredProjectState,
    nextFlows: StoredProjectState['flows'],
    rootFlowId: string | null,
    nodeId: string,
    label: string,
  ) => {
    const history = Array.isArray(projectState.history) ? projectState.history : [];
    const historyIndex =
      typeof projectState.historyIndex === 'number'
        ? Math.max(0, Math.min(history.length - 1, projectState.historyIndex))
        : history.length - 1;

    return [
      ...history.slice(0, historyIndex + 1),
      {
        id: `roto_track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label,
        state: {
          flows: nextFlows,
          rootFlowId,
          activeFlowId: projectState.activeFlowId || rootFlowId,
          selectedNodeId: nodeId,
        },
      },
    ];
  };

  const applyRotoTrackingResult = async ({
    context,
    rotoNodeId,
    trackedNode,
    trackingLabel,
  }: {
    context: ProjectBranchContext;
    rotoNodeId: string;
    trackedNode: RotoNode;
    trackingLabel: string;
  }): Promise<'current' | 'saved' | 'missing'> => {
    if (isCurrentProjectBranchContext(context)) {
      const state = get();
      if (!state.nodes.some((node) => node.id === rotoNodeId)) return 'missing';

      const nextNodes = state.nodes.map((node) =>
        node.id === rotoNodeId ? (trackedNode as AnyNode) : node,
      );
      set(() => ({ nodes: nextNodes }));
      deps.pushHistory({
        label: trackingLabel,
        state: { nodes: nextNodes, selectedNodeId: rotoNodeId },
      });
      return 'current';
    }

    if (!context.projectId || !context.storageId) return 'missing';

    const projectState = await loadProjectState(context.storageId);
    if (!projectState) return 'missing';

    const rootFlowId = projectState.rootFlowId || null;
    const rootFlow = getRootFlow(projectState.flows || {}, rootFlowId);
    const nodes = getOrderedNodesFromFlow(rootFlow);
    if (!nodes.some((node) => node.id === rotoNodeId)) return 'missing';

    const nextNodes = nodes.map((node) =>
      node.id === rotoNodeId ? (trackedNode as AnyNode) : node,
    );
    const nextFlows = replaceFlowNodes(
      projectState.flows || {},
      rootFlowId,
      nextNodes,
      rootFlow?.name ?? 'Root Flow',
    );
    const nextHistory = appendPersistedHistoryEntry(
      projectState,
      nextFlows,
      rootFlowId,
      rotoNodeId,
      trackingLabel,
    );

    await saveProject(context.storageId, {
      ...projectState,
      flows: nextFlows,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    });

    const timestamp = Date.now();
    touchProjectBranch(context.projectId, context.branchId, timestamp);
    updateProjectIndexModified(context.projectId, timestamp);

    return 'saved';
  };

  const saveOpenProjectBranchSnapshot = async () => {
    const state = get();
    if (!state.projectId) return;

    const timestamp = Date.now();
    const branchId = state.activeProjectBranchId || getActiveProjectBranchId(state.projectId);
    await saveProject(
      getProjectBranchStorageId(state.projectId, branchId),
      buildPersistedProjectState(state),
    );
    touchProjectBranch(state.projectId, branchId, timestamp);
    updateProjectIndexModified(state.projectId, timestamp, state.thumbnail);
  };

  const loadProjectStateIntoEditor = async ({
    projectId,
    branchId,
    projectState,
    branches,
  }: {
    projectId: string;
    branchId: string;
    projectState: StoredProjectState;
    branches: ProjectBranchRecord[];
  }) => {
    const rootFlow = getRootFlow(projectState.flows || {}, projectState.rootFlowId || null);
    const loadedNodes = getOrderedNodesFromFlow(rootFlow);
    try {
      await requestReferencePermissions(collectNodeAssetIds(loadedNodes));
    } catch (error) {
      console.warn('Could not restore all directory permissions for this project.', error);
    }

    const sceneNode = findSceneNode(loadedNodes);
    const maxFrames = sceneNode?.maxFrames ?? 0;
    const fps = sceneNode?.fps || 30;
    const initialState = getInitialState();
    const currentFrame =
      typeof projectState.currentFrame === 'number' && Number.isFinite(projectState.currentFrame)
        ? Math.max(0, Math.min(maxFrames, Math.round(projectState.currentFrame)))
        : initialState.currentFrame;
    const nextViewerSlots = sanitizeViewerSlots(
      projectState.viewerSlots as ViewerSlotAssignments | undefined,
      loadedNodes,
    );
    const nextViewerNodeId = sanitizeViewerNodeId(projectState.viewerNodeId, loadedNodes);
    const nextActiveViewerSlot = sanitizeActiveViewerSlot(
      projectState.activeViewerSlot,
      nextViewerSlots,
      nextViewerNodeId,
    );
    const selectedNodeId = projectState.selectedNodeId || loadedNodes[0]?.id || null;
    const selectedNode = loadedNodes.find((node) => node.id === selectedNodeId) ?? null;
    const nextAiChats = Array.isArray(projectState.aiChats) ? projectState.aiChats : [];
    const nextActiveAiChatId =
      typeof projectState.activeAiChatId === 'string' &&
      nextAiChats.some((chat) => chat.id === projectState.activeAiChatId)
        ? projectState.activeAiChatId
        : nextAiChats[0]?.id || null;
    const newState: Partial<ReturnType<typeof getInitialState> & { maxFrames: number }> = {
      ...initialState,
      projectId,
      activeProjectBranchId: branchId,
      projectBranches: branches,
      flows: projectState.flows || {},
      rootFlowId: projectState.rootFlowId || null,
      activeFlowId: projectState.activeFlowId || projectState.rootFlowId || null,
      nodes: loadedNodes,
      selectedNodeId,
      activeViewportTool: getDefaultViewportTool(selectedNode?.type),
      activeTab: projectState.activeTab || initialState.activeTab,
      aiChats: nextAiChats,
      activeAiChatId: nextActiveAiChatId,
      currentFrame,
      maxFrames,
      fps,
      nodePositions: getNodePositionsForFlow(
        projectState.nodePositionsByFlow || {},
        projectState.rootFlowId || null,
      ),
      nodePositionsByFlow: projectState.nodePositionsByFlow || {},
      viewerNodeId: nextViewerNodeId,
      viewerSlots: nextViewerSlots,
      activeViewerSlot: nextActiveViewerSlot,
      renderSettings: {
        ...initialState.renderSettings,
        ...(projectState.renderSettings || {}),
      },
      viewerSettings: {
        ...initialState.viewerSettings,
        ...(projectState.viewerSettings || {}),
      },
    };
    const initialHistoryForProject: HistoryEntry = {
      id: `init_${Date.now()}`,
      label: 'Initial State',
      state: {
        flows: newState.flows,
        rootFlowId: newState.rootFlowId,
        activeFlowId: newState.activeFlowId,
        selectedNodeId: newState.selectedNodeId,
        viewerNodeId: newState.viewerNodeId,
        viewerSlots: newState.viewerSlots,
        activeViewerSlot: newState.activeViewerSlot,
        zoom: 1,
        pan: { x: 0, y: 0 },
        fps,
      },
    };
    const history =
      projectState.history && projectState.history.length > 0
        ? projectState.history
        : [initialHistoryForProject];
    const historyIndex = projectState.historyIndex ?? 0;
    set((state) => ({
      ...newState,
      backgroundJobs: state.backgroundJobs,
      history,
      historyIndex,
    }));
  };

  const projectActions = {
    setProjectThumbnail: (thumbnail: string | null) => {
      const prevAssetId = get().thumbnailAssetId;
      set(() => ({ thumbnail }));
      if (thumbnail) {
        fetch(thumbnail)
          .then((r) => r.blob())
          .then((blob) => saveAsset(blob))
          .then((assetId) => {
            set(() => ({ thumbnailAssetId: assetId }));
            if (prevAssetId) deleteAssets([prevAssetId]).catch(() => {});
          })
          .catch(() => {});
      } else if (prevAssetId) {
        deleteAssets([prevAssetId]).catch(() => {});
        set(() => ({ thumbnailAssetId: undefined }));
      }
    },

    applyComfyNodeRunResult: async ({
      projectId,
      nodeId,
      updates,
      withHistory = false,
      historyLabel = 'Update Comfy Node',
      noticeLabel,
      galleryNoticeLabel,
      expectedHistoryId,
    }: {
      projectId: string | null;
      nodeId: string;
      updates: Partial<AnyNode>;
      withHistory?: boolean;
      historyLabel?: string;
      noticeLabel?: string;
      galleryNoticeLabel?: string;
      expectedHistoryId?: string | null;
    }): Promise<ComfyApplyTarget> => {
      if (!projectId) return 'missing';

      const state = get();
      const generatedOutputs = readGeneratedOutputsUpdate(updates);
      if (state.projectId === projectId) {
        const targetNode = state.nodes.find((node) => node.id === nodeId);
        if (!targetNode) return 'missing';

        const activeHistoryId = getActiveHistoryEntryId(state.history, state.historyIndex);
        const historyMoved =
          !!expectedHistoryId && !!activeHistoryId && activeHistoryId !== expectedHistoryId;
        const nodeUpdates =
          historyMoved && generatedOutputs && isComfyNode(targetNode)
            ? ({
                generatedOutputs:
                  mergeGeneratedOutputs(targetNode.generatedOutputs, generatedOutputs) ??
                  targetNode.generatedOutputs,
                lastError: undefined,
              } satisfies Partial<ComfyNode>)
            : updates;
        const newNodes = state.nodes.map((node) =>
          node.id === nodeId ? ({ ...node, ...nodeUpdates } as AnyNode) : node,
        );
        const nextHistory = mergeGeneratedOutputsIntoHistory(
          state.history,
          nodeId,
          generatedOutputs,
        );
        set(() => ({
          nodes: newNodes,
          history: nextHistory,
          aiApplyNotice: noticeLabel
            ? {
                id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                nodeId,
                field: 'comfy-output',
                label: historyMoved && galleryNoticeLabel ? galleryNoticeLabel : noticeLabel,
                createdAt: Date.now(),
              }
            : state.aiApplyNotice,
        }));

        if (historyMoved) {
          deps.debouncedSave();
          return 'gallery';
        }

        if (withHistory) {
          deps.pushHistory({
            label: historyLabel,
            state: { nodes: newNodes, selectedNodeId: state.selectedNodeId },
          });
        } else {
          deps.debouncedSave();
        }
        return 'current';
      }

      const projectState = await loadProjectState(projectId);
      if (!projectState) return 'missing';

      const rootFlowId = projectState.rootFlowId || null;
      const rootFlow = getRootFlow(projectState.flows || {}, rootFlowId);
      const nodes = getOrderedNodesFromFlow(rootFlow);
      const targetNode = nodes.find((node) => node.id === nodeId);
      if (!targetNode) return 'missing';

      const history = Array.isArray(projectState.history) ? projectState.history : [];
      const historyIndex =
        typeof projectState.historyIndex === 'number'
          ? Math.max(0, Math.min(history.length - 1, projectState.historyIndex))
          : history.length - 1;
      const activeHistoryId = getActiveHistoryEntryId(history, historyIndex);
      const historyMoved =
        !!expectedHistoryId && !!activeHistoryId && activeHistoryId !== expectedHistoryId;
      const nodeUpdates =
        historyMoved && generatedOutputs && isComfyNode(targetNode)
          ? ({
              generatedOutputs:
                mergeGeneratedOutputs(targetNode.generatedOutputs, generatedOutputs) ??
                targetNode.generatedOutputs,
              lastError: undefined,
            } satisfies Partial<ComfyNode>)
          : updates;

      const nextNodes = nodes.map((node) =>
        node.id === nodeId ? ({ ...node, ...nodeUpdates } as AnyNode) : node,
      );
      const nextFlows = replaceFlowNodes(
        projectState.flows || {},
        rootFlowId,
        nextNodes,
        rootFlow?.name ?? 'Root Flow',
      );
      const nextHistoryBase = mergeGeneratedOutputsIntoHistory(history, nodeId, generatedOutputs);
      const nextHistory =
        withHistory && !historyMoved
          ? [
              ...nextHistoryBase.slice(0, historyIndex + 1),
              {
                id: `comfy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                label: historyLabel,
                state: {
                  flows: nextFlows,
                  rootFlowId,
                  activeFlowId: projectState.activeFlowId || rootFlowId,
                  selectedNodeId: nodeId,
                },
              },
            ]
          : nextHistoryBase;

      await saveProject(projectId, {
        ...projectState,
        flows: nextFlows,
        history: nextHistory,
        historyIndex:
          withHistory && !historyMoved ? nextHistory.length - 1 : projectState.historyIndex,
      });

      const index = getProjectIndex();
      saveProjectIndex(
        index.map((entry) =>
          entry.id === projectId ? { ...entry, lastModified: Date.now() } : entry,
        ),
      );

      return historyMoved ? 'gallery' : 'saved';
    },

    closeProject: () => {
      void (async () => {
        await saveOpenProjectBranchSnapshot();
        set((state) => ({
          ...getInitialState(),
          backgroundJobs: state.backgroundJobs,
          history: [getInitialHistoryEntry()],
          historyIndex: 0,
          maxFrames: 0,
        }));
      })();
    },

    createNewProject: async (file: File) => {
      const newProjectId = `proj_${Date.now()}`;
      const projectName = file.name.split('.').slice(0, -1).join('.') || 'New Project';
      const mediaKind = getMediaFileKind(file);

      const setupProject = (nodes: AnyNode[], selectedId: string, maxFrames = 0) => {
        const { historyEntry, persistedState, nodePositions } = buildProjectInitState({
          nodes,
          selectedNodeId: selectedId,
          fps: 30,
        });
        const branchIndex = initializeProjectBranches(newProjectId);
        set((state) => ({
          ...getInitialState(),
          backgroundJobs: state.backgroundJobs,
          projectId: newProjectId,
          activeProjectBranchId: branchIndex.activeBranchId,
          projectBranches: branchIndex.branches,
          nodes,
          nodePositions,
          nodePositionsByFlow: persistedState.nodePositionsByFlow ?? {},
          selectedNodeId: selectedId,
          activeTab: EditorTab.Flow,
          history: [historyEntry],
          historyIndex: 0,
          maxFrames,
          fps: 30,
        }));
        const index = getProjectIndex();
        saveProjectIndex([
          {
            id: newProjectId,
            name: projectName,
            lastModified: Date.now(),
            schemaVersion: SCHEMA_VERSION,
          },
          ...index,
        ]);
        void saveProject(newProjectId, persistedState);
      };

      if (mediaKind === 'image') {
        const { width, height } = await readImageDimensions(file);
        const assetId = await saveAsset(file);
        const imageNode = createImageNode({
          name: file.name,
          src: assetId,
          width,
          height,
          colorSpace: getImportedImageColorSpace(file),
        });
        const newSceneNode = createSceneNode({ width, height });
        setupProject([newSceneNode, imageNode], imageNode.id, 0);
      } else if (mediaKind === 'video') {
        const { width, height, duration } = await readVideoMetadata(file);
        const assetId = await saveAsset(file);
        const fps = 30;
        const totalFrames = Math.floor(duration * fps);
        const newSceneNode = createSceneNode({
          width,
          height,
          maxFrames: totalFrames,
          fps,
        });
        const videoNode = createVideoNode({
          name: file.name,
          src: assetId,
          width,
          height,
          duration,
        });
        setupProject([newSceneNode, videoNode], videoNode.id, totalFrames);
      }
    },

    createNewProjectFromFiles: async (files: File[]) => {
      const imageEntries = buildImageEntriesFromFiles(files);
      if (imageEntries.length === 0) return;

      const firstEntry = imageEntries[0];
      const { width, height } = await readImageDimensions(firstEntry.file);
      const assetIds = await persistSequenceAssets(imageEntries, 'copy');

      const newProjectId = `proj_${Date.now()}`;
      const projectName = getSequenceProjectName(firstEntry.relativePath);

      const newSceneNode = createSceneNode({ width, height, maxFrames: assetIds.length - 1 });
      const sequenceNode = createSequenceNode({
        name: projectName,
        frames: assetIds,
        width,
        height,
        colorSpace: getImportedImageColorSpace(firstEntry.file),
      });

      const newNodes = [newSceneNode, sequenceNode];
      const { historyEntry, persistedState, nodePositions } = buildProjectInitState({
        nodes: newNodes,
        selectedNodeId: sequenceNode.id,
        fps: 30,
      });
      const branchIndex = initializeProjectBranches(newProjectId);
      set((state) => ({
        ...getInitialState(),
        backgroundJobs: state.backgroundJobs,
        projectId: newProjectId,
        activeProjectBranchId: branchIndex.activeBranchId,
        projectBranches: branchIndex.branches,
        nodes: newNodes,
        nodePositions,
        nodePositionsByFlow: persistedState.nodePositionsByFlow ?? {},
        selectedNodeId: sequenceNode.id,
        activeTab: EditorTab.Flow,
        history: [historyEntry],
        historyIndex: 0,
        maxFrames: assetIds.length - 1,
        fps: 30,
      }));
      const index = getProjectIndex();
      saveProjectIndex([
        {
          id: newProjectId,
          name: projectName,
          lastModified: Date.now(),
          schemaVersion: SCHEMA_VERSION,
        },
        ...index,
      ]);
      void saveProject(newProjectId, persistedState);
    },

    createNewProjectFromDirectory: async (
      directoryHandle: FileSystemDirectoryHandle,
      importMode: SequenceImportMode = 'copy',
    ) => {
      const imageEntries = await collectImageEntriesFromDirectoryHandle(directoryHandle);
      if (imageEntries.length === 0) return;

      const firstEntry = imageEntries[0];
      const { width, height } = await readImageDimensions(firstEntry.file);
      const assetIds = await persistSequenceAssets(imageEntries, importMode, directoryHandle);

      const newProjectId = `proj_${Date.now()}`;
      const projectName = directoryHandle.name || getSequenceProjectName(firstEntry.relativePath);

      const newSceneNode = createSceneNode({ width, height, maxFrames: assetIds.length - 1 });
      const sequenceNode = createSequenceNode({
        name: projectName,
        frames: assetIds,
        width,
        height,
        colorSpace: getImportedImageColorSpace(firstEntry.file),
      });

      const newNodes = [newSceneNode, sequenceNode];
      const { historyEntry, persistedState, nodePositions } = buildProjectInitState({
        nodes: newNodes,
        selectedNodeId: sequenceNode.id,
        fps: 30,
      });
      const branchIndex = initializeProjectBranches(newProjectId);
      set((state) => ({
        ...getInitialState(),
        backgroundJobs: state.backgroundJobs,
        projectId: newProjectId,
        activeProjectBranchId: branchIndex.activeBranchId,
        projectBranches: branchIndex.branches,
        nodes: newNodes,
        nodePositions,
        nodePositionsByFlow: persistedState.nodePositionsByFlow ?? {},
        selectedNodeId: sequenceNode.id,
        activeTab: EditorTab.Flow,
        history: [historyEntry],
        historyIndex: 0,
        maxFrames: assetIds.length - 1,
        fps: 30,
      }));
      const index = getProjectIndex();
      saveProjectIndex([
        {
          id: newProjectId,
          name: projectName,
          lastModified: Date.now(),
          schemaVersion: SCHEMA_VERSION,
        },
        ...index,
      ]);
      void saveProject(newProjectId, persistedState);
    },

    createNewProjectFromDimensions: (name: string, width: number, height: number) => {
      const newProjectId = `proj_${Date.now()}`;
      const newSceneNode = createSceneNode({ width, height, maxFrames: 120 });
      const newNodes: AnyNode[] = [newSceneNode];
      const { historyEntry, persistedState, nodePositions } = buildProjectInitState({
        nodes: newNodes,
        selectedNodeId: newSceneNode.id,
        fps: 30,
      });
      const branchIndex = initializeProjectBranches(newProjectId);
      set((state) => ({
        ...getInitialState(),
        backgroundJobs: state.backgroundJobs,
        projectId: newProjectId,
        activeProjectBranchId: branchIndex.activeBranchId,
        projectBranches: branchIndex.branches,
        nodes: newNodes,
        nodePositions,
        nodePositionsByFlow: persistedState.nodePositionsByFlow ?? {},
        selectedNodeId: newSceneNode.id,
        activeTab: EditorTab.Flow,
        history: [historyEntry],
        historyIndex: 0,
        maxFrames: 120,
        fps: 30,
      }));
      const index = getProjectIndex();
      saveProjectIndex([
        { id: newProjectId, name, lastModified: Date.now(), schemaVersion: SCHEMA_VERSION },
        ...index,
      ]);
      void saveProject(newProjectId, persistedState);
    },

    importProjectFile: async (
      file: File,
      referenceDirectoriesByGroupId?: ReadonlyMap<string, FileSystemDirectoryHandle>,
    ) => {
      const importedProject = await importProjectBundle(file, {
        referenceDirectoriesByGroupId,
      });
      const newProjectId = `proj_${Date.now()}`;
      initializeProjectBranches(newProjectId);
      const index = getProjectIndex();

      saveProjectIndex([
        {
          id: newProjectId,
          name: importedProject.projectName,
          lastModified: Date.now(),
          thumbnail: importedProject.thumbnail ?? undefined,
          schemaVersion: SCHEMA_VERSION,
        },
        ...index,
      ]);

      await saveProject(newProjectId, importedProject.state);
      await projectActions.loadProject(newProjectId);
    },

    exportProjectFile: async (projectId?: string) => {
      const activeProjectId = get().projectId;
      const targetProjectId = projectId ?? activeProjectId;
      if (!targetProjectId) {
        throw new Error('No project is available to export.');
      }

      const indexEntry = getProjectIndex().find((entry) => entry.id === targetProjectId);
      const projectName = indexEntry?.name || 'Project';

      const state =
        activeProjectId === targetProjectId
          ? buildPersistedProjectState(get())
          : await loadProjectState(
              getProjectBranchStorageId(targetProjectId, getActiveProjectBranchId(targetProjectId)),
            );

      if (!state) {
        throw new Error('Could not load the selected project for export.');
      }

      const { blob, filename } = await exportProjectBundle({
        projectName,
        thumbnail: activeProjectId === targetProjectId ? get().thumbnail : indexEntry?.thumbnail,
        state,
      });

      triggerDownload(blob, filename);
    },

    loadProject: async (projectId: string) => {
      const branchIndex = ensureProjectBranches(projectId);
      let branchId = branchIndex.activeBranchId;
      let projectState = await loadProjectState(getProjectBranchStorageId(projectId, branchId));

      if (!projectState && branchId !== 'main') {
        branchId = 'main';
        setActiveProjectBranchId(projectId, branchId);
        projectState = await loadProjectState(projectId);
      }

      if (!projectState) return;

      await loadProjectStateIntoEditor({
        projectId,
        branchId,
        projectState,
        branches: getProjectBranches(projectId),
      });
    },

    createProjectBranch: async (
      name?: string,
      options?: { kind?: 'user' | 'agent' | 'review'; agentRunId?: string },
    ): Promise<string | null> => {
      const state = get();
      if (!state.projectId) return null;

      const sourceBranchId =
        state.activeProjectBranchId || getActiveProjectBranchId(state.projectId);
      await saveOpenProjectBranchSnapshot();

      const branch = createProjectBranchRecord({
        projectId: state.projectId,
        name: name?.trim() || `branch-${new Date().toISOString().slice(0, 10)}`,
        kind: options?.kind ?? 'user',
        parentBranchId: sourceBranchId,
        createdByAgentRunId: options?.agentRunId,
      });
      const branchIndex = upsertProjectBranch(state.projectId, branch, branch.id);
      await saveProject(
        getProjectBranchStorageId(state.projectId, branch.id),
        buildPersistedProjectState(get()),
      );

      set(() => ({
        activeProjectBranchId: branch.id,
        projectBranches: branchIndex.branches,
      }));

      return branch.id;
    },

    switchProjectBranch: async (branchId: string): Promise<void> => {
      const state = get();
      if (!state.projectId || state.activeProjectBranchId === branchId) return;

      const branches = getProjectBranches(state.projectId);
      if (!branches.some((branch) => branch.id === branchId)) return;

      await saveOpenProjectBranchSnapshot();
      const projectState = await loadProjectState(
        getProjectBranchStorageId(state.projectId, branchId),
      );
      if (!projectState) return;

      const branchIndex = setActiveProjectBranchId(state.projectId, branchId);
      await loadProjectStateIntoEditor({
        projectId: state.projectId,
        branchId,
        projectState,
        branches: branchIndex.branches,
      });
    },

    deleteProject: async (projectId: string) => {
      const assetIds = new Set<string>();
      const branches = getProjectBranches(projectId);

      const indexEntry = getProjectIndex().find((e) => e.id === projectId);
      if (indexEntry?.thumbnailAssetId) {
        assetIds.add(indexEntry.thumbnailAssetId);
      }

      for (const branch of branches) {
        const projectState = await loadProjectState(
          getProjectBranchStorageId(projectId, branch.id),
        );
        if (projectState?.flows && projectState.rootFlowId) {
          const persistedNodes = getOrderedNodesFromFlow(
            getRootFlow(projectState.flows, projectState.rootFlowId),
          );
          collectNodeAssetIds(persistedNodes).forEach((assetId) => assetIds.add(assetId));
        }
      }

      if (assetIds.size > 0) await deleteAssets(Array.from(assetIds));
      await Promise.all(
        branches
          .filter((branch) => branch.id !== 'main')
          .map((branch) =>
            deleteProjectFromStorage(getProjectBranchStorageId(projectId, branch.id)),
          ),
      );
      await deleteProjectFromStorage(projectId);
      deleteProjectBranchRecords(projectId);
    },

    loadImage: async (file: File) => {
      const { projectId, nodes } = get();
      if (!projectId || nodes.length === 0) {
        await projectActions.createNewProject(file);
        return;
      }
      const mediaKind = getMediaFileKind(file);

      if (mediaKind === 'image') {
        const { width, height } = await readImageDimensions(file);
        const sceneNode = findSceneNode(get().nodes);
        if (!sceneNode) return;

        const assetId = await saveAsset(file);
        const { scaleX, scaleY } = calculateTransformForFitMode(
          { width, height },
          { width: sceneNode.width, height: sceneNode.height },
          ImageFitMode.FIT,
        );

        const newImageNode = createImageNode({
          name: file.name,
          src: assetId,
          width,
          height,
          colorSpace: getImportedImageColorSpace(file),
          transform: { x: 0, y: 0, scaleX, scaleY, fitMode: ImageFitMode.FIT },
        });
        const newNodes = [...get().nodes, newImageNode];
        set(() => ({
          nodes: newNodes,
          selectedNodeId: newImageNode.id,
          activeTab: EditorTab.Flow,
        }));
        deps.pushHistory({
          label: `Import Node: ${file.name}`,
          state: { nodes: newNodes, selectedNodeId: newImageNode.id },
        });
      } else if (mediaKind === 'video') {
        const { width, height, duration } = await readVideoMetadata(file);
        const fps = get().fps || 30;
        const totalFrames = Math.floor(duration * fps);
        const sceneNode = findSceneNode(get().nodes);
        if (!sceneNode) return;

        const assetId = await saveAsset(file);
        const { scaleX, scaleY } = calculateTransformForFitMode(
          { width, height },
          { width: sceneNode.width, height: sceneNode.height },
          ImageFitMode.FIT,
        );

        const newVideoNode = createVideoNode({
          name: file.name,
          src: assetId,
          width,
          height,
          duration,
          scaleX,
          scaleY,
        });

        const newNodes = [...get().nodes, newVideoNode];
        set((s) => {
          const newMaxFrames = Math.max(s.maxFrames, totalFrames);
          return {
            nodes: newNodes,
            selectedNodeId: newVideoNode.id,
            activeTab: EditorTab.Flow,
            maxFrames: newMaxFrames,
          };
        });
        deps.pushHistory({
          label: `Import Node: ${file.name}`,
          state: { nodes: newNodes, selectedNodeId: newVideoNode.id },
        });
      }
    },

    loadImageSequence: async (files: File[]) => {
      const imageEntries = buildImageEntriesFromFiles(files);
      if (imageEntries.length === 0) return;

      const firstEntry = imageEntries[0];
      const { width, height } = await readImageDimensions(firstEntry.file);
      const assetIds = await persistSequenceAssets(imageEntries, 'copy');
      const sceneNode = findSceneNode(get().nodes);
      if (!sceneNode) return;

      const { scaleX, scaleY } = calculateTransformForFitMode(
        { width, height },
        { width: sceneNode.width, height: sceneNode.height },
        ImageFitMode.FIT,
      );

      const projectName = getSequenceProjectName(firstEntry.relativePath);

      const sequenceNode = createSequenceNode({
        name: projectName,
        frames: assetIds,
        width,
        height,
        colorSpace: getImportedImageColorSpace(firstEntry.file),
        scaleX,
        scaleY,
      });

      const newNodes = [...get().nodes, sequenceNode];
      set((s) => {
        const newMaxFrames = Math.max(s.maxFrames, assetIds.length - 1);
        return {
          nodes: newNodes,
          selectedNodeId: sequenceNode.id,
          activeTab: EditorTab.Flow,
          maxFrames: newMaxFrames,
        };
      });
      deps.pushHistory({
        label: `Import Sequence`,
        state: { nodes: newNodes, selectedNodeId: sequenceNode.id },
      });
    },

    loadImageSequenceFromDirectory: async (
      directoryHandle: FileSystemDirectoryHandle,
      importMode: SequenceImportMode = 'copy',
    ) => {
      const { projectId, nodes } = get();
      if (!projectId || nodes.length === 0) {
        await projectActions.createNewProjectFromDirectory(directoryHandle, importMode);
        return;
      }

      const imageEntries = await collectImageEntriesFromDirectoryHandle(directoryHandle);
      if (imageEntries.length === 0) return;

      const firstEntry = imageEntries[0];
      const { width, height } = await readImageDimensions(firstEntry.file);
      const assetIds = await persistSequenceAssets(imageEntries, importMode, directoryHandle);
      const sceneNode = findSceneNode(get().nodes);
      if (!sceneNode) return;

      const { scaleX, scaleY } = calculateTransformForFitMode(
        { width, height },
        { width: sceneNode.width, height: sceneNode.height },
        ImageFitMode.FIT,
      );

      const sequenceNode = createSequenceNode({
        name: directoryHandle.name || getSequenceProjectName(firstEntry.relativePath),
        frames: assetIds,
        width,
        height,
        colorSpace: getImportedImageColorSpace(firstEntry.file),
        scaleX,
        scaleY,
      });

      const newNodes = [...get().nodes, sequenceNode];
      set((s) => {
        const newMaxFrames = Math.max(s.maxFrames, assetIds.length - 1);
        return {
          nodes: newNodes,
          selectedNodeId: sequenceNode.id,
          activeTab: EditorTab.Flow,
          maxFrames: newMaxFrames,
        };
      });
      deps.pushHistory({
        label: `Import Sequence`,
        state: { nodes: newNodes, selectedNodeId: sequenceNode.id },
      });
    },

    // --- Tracking actions ---

    cancelTracking: () => {
      if (deps.trackingAbortController.current) {
        deps.trackingAbortController.current.abort();
        deps.trackingAbortController.current = null;
      }
    },

    trackRotoSelection: async (
      rotoNodeId: string,
      sourcePathIds: string[],
      target: RotoTrackingTarget,
      sourceId: string,
      direction: 'forward' | 'backward',
      frameCount: number,
      config: TrackingConfig,
      options: RotoTrackingRunOptions = {},
    ) => {
      const projectContext = getProjectBranchContext();
      const { nodes, currentFrame, maxFrames, fps } = get();
      const trackingSource = resolveSourcePixelSource(nodes, rotoNodeId, sourceId);
      if (!trackingSource) return;
      const trackingFps = fps || 30;
      const trackingPixelReader = createSourcePixelDataReader(trackingSource, trackingFps);
      let trackingJob: RotoTrackingJob | null = null;

      try {
        const rotoNode = nodes.find((node) => node.id === rotoNodeId) as RotoNode | undefined;
        if (!rotoNode) return;

        const trackingPaths = getTrackingPathStates(rotoNode, sourcePathIds);
        if (trackingPaths.length === 0) return;

        const step = direction === 'forward' ? 1 : -1;
        const startFrame = currentFrame;
        const endFrame =
          direction === 'forward'
            ? Math.min(maxFrames, currentFrame + frameCount)
            : Math.max(0, currentFrame - frameCount);
        const currentNodes = [...nodes];
        const rotoIndex = currentNodes.findIndex((node) => node.id === rotoNodeId);
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
        const runInBackground = options.runInBackground === true;
        trackingJob = createRotoTrackingJob(trackingLabel, currentRotoNode, runInBackground);
        let processedTrackingFrames = 0;
        let lastProcessedFrame = startFrame;
        let stoppedByDrift: { frame: number; drift: number } | null = null;

        if (rotoIndex !== -1) {
          currentNodes[rotoIndex] = currentRotoNode;
        }

        if (shouldStoreTrackPoints) {
          currentTrackPointsByPathId = new Map(
            trackingPaths.map(({ path }) => [
              path.id,
              normalizeTrackingPathPoints(path).map((trackPoint) => ({
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
              })),
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
        let previousPoints = startResolvedPointsByPath.flatMap(({ points }) => points);
        let previousPixelData = await trackingPixelReader.getFramePixelData(startFrame);
        let previousPyramid = previousPixelData
          ? buildOpticalFlowPyramid(
              previousPixelData.data,
              previousPixelData.width,
              previousPixelData.height,
            )
          : null;
        let internalPoints = buildInternalTrackingPoints(startResolvedPointsByPath);

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
          const boundaryCanvasCoords = previousPoints.map((point) => ({
            x: point.x + halfWidth,
            y: point.y + halfHeight,
          }));
          const internalCanvasCoords = internalPoints.map((point) => ({
            x: point.x + halfWidth,
            y: point.y + halfHeight,
          }));

          const padding = 2;
          const validInternalIndices: number[] = [];
          const validInternalCanvasCoords: { x: number; y: number }[] = [];

          internalCanvasCoords.forEach((point, index) => {
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

          const trackedAllCanvas = calculateOpticalFlowFromPyramids(
            previousPyramid,
            currentPyramid,
            [...boundaryCanvasCoords, ...validInternalCanvasCoords],
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
          trackingDriftMap[frame] = frameDrift;

          const boundaryScenePrev = boundaryCanvasCoords.map((point) => ({
            x: point.x - halfWidth,
            y: point.y - halfHeight,
          }));
          const boundarySceneCurr = trackedBoundaryCanvas.map((point) => ({
            x: point.x - halfWidth,
            y: point.y - halfHeight,
          }));
          const validInternalScenePrev = validInternalIndices.map((index) => internalPoints[index]);
          const validInternalSceneCurr = trackedInternalCanvas.map((point) => ({
            x: point.x - halfWidth,
            y: point.y - halfHeight,
          }));

          const allPrevScene = [...boundaryScenePrev, ...validInternalScenePrev];
          const allCurrScene = [...boundarySceneCurr, ...validInternalSceneCurr];
          const solvedMotionTransform = config.deform
            ? null
            : fitTrackedTransform(allPrevScene, allCurrScene, config);
          const resolvedBoundaryPoints = config.deform
            ? boundarySceneCurr
            : solvedMotionTransform
              ? applySolvedTransform(boundaryScenePrev, solvedMotionTransform)
              : solveTransform(allPrevScene, allCurrScene, boundaryScenePrev, config);

          let nextTrackPointsByPathId: Map<string, TrackingPathPoints> | undefined;
          if (currentTrackPointsByPathId) {
            nextTrackPointsByPathId = new Map<string, TrackingPathPoints>();
            let boundaryOffset = 0;

            trackingPaths.forEach((trackingPath) => {
              const path = getTrackingPathForState(currentRotoNode, trackingPath);
              const currentTrackPoints = currentTrackPointsByPathId?.get(path.id);
              if (!currentTrackPoints) {
                boundaryOffset += trackingPath.pointCount;
                return;
              }

              const updatedTrackPoints = currentTrackPoints.map((trackPoint, pointIndex) => {
                const targetPoint = resolvedBoundaryPoints[boundaryOffset + pointIndex];
                const resolvedLocalPoint = targetPoint
                  ? projectScenePointToRotoPathResolvedLocal(
                      currentRotoNode,
                      path,
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
              });

              nextTrackPointsByPathId.set(path.id, updatedTrackPoints);
              boundaryOffset += trackingPath.pointCount;
            });
          }
          currentTrackPointsByPathId = nextTrackPointsByPathId;

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
          } else if (solvedMotionTransform) {
            internalPoints = applySolvedTransform(internalPoints, solvedMotionTransform);
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
            nodes: [...currentNodes],
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
    },

    smartTrackRotoSelection: async (
      rotoNodeId: string,
      sourcePathIds: string[],
      target: RotoTrackingTarget,
      sourceId: string,
      config: TrackingConfig,
      options: RotoTrackingRunOptions = {},
    ) => {
      const projectContext = getProjectBranchContext();
      const { nodes, currentFrame, fps } = get();
      const rotoNode = nodes.find((node) => node.id === rotoNodeId) as RotoNode | undefined;
      if (!rotoNode) return;

      const trackingPaths = getTrackingPathStates(rotoNode, sourcePathIds);
      if (trackingPaths.length === 0) return;

      const trackingSource = resolveSourcePixelSource(nodes, rotoNodeId, sourceId);
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

        trackingPaths.forEach(({ path }) => {
          path.points.forEach((point) => {
            checkProp(point.x);
            checkProp(point.y);
          });
          path.trackPoints?.forEach((trackPoint) => {
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
        const rotoIndex = currentNodes.findIndex((node) => node.id === rotoNodeId);
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
        const totalSmartSteps = Math.max(1, (rangeLength - 1) * 3);
        let completedSmartSteps = 0;
        let lastProcessedFrame = startFrame;
        let stoppedByDrift: { frame: number; drift: number } | null = null;
        trackingJob = createRotoTrackingJob(trackingLabel, currentRotoNode, runInBackground);

        if (rotoIndex !== -1) {
          currentNodes[rotoIndex] = currentRotoNode;
        }

        if (shouldStoreTrackPoints) {
          currentTrackPointsByPathId = new Map(
            trackingPaths.map(({ path }) => [path.id, normalizeTrackingPathPoints(path)]),
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

          const halfWidth = previousPixelData.width / 2;
          const halfHeight = previousPixelData.height / 2;
          const canvasPoints = previousPoints.map((point) => ({
            x: point.x + halfWidth,
            y: point.y + halfHeight,
          }));

          const trackedCanvas = calculateOpticalFlowFromPyramids(
            previousPyramid,
            currentPyramid,
            canvasPoints,
          );
          const frameDrift = getRobustTrackingError(trackedCanvas);
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

          const flows = trackedCanvas.map((point, index) => ({
            dx: point.x - canvasPoints[index].x,
            dy: point.y - canvasPoints[index].y,
            error: point.error,
          }));
          const validFlows = flows.filter((flow) => flow.error < 15.0);
          const moveSource = validFlows.length > 0 ? validFlows : flows;
          const medianDx = getMedian(moveSource.map((flow) => flow.dx));
          const medianDy = getMedian(moveSource.map((flow) => flow.dy));

          const trackedScene = trackedCanvas.map((point, index) => {
            let dx = flows[index].dx;
            let dy = flows[index].dy;
            if (flows[index].error > 15.0 || Math.hypot(dx - medianDx, dy - medianDy) > 30.0) {
              dx = medianDx;
              dy = medianDy;
            }
            return {
              x: canvasPoints[index].x + dx - halfWidth,
              y: canvasPoints[index].y + dy - halfHeight,
            };
          });

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

            const halfWidth = nextPixelData.width / 2;
            const halfHeight = nextPixelData.height / 2;
            const canvasPoints = nextPoints.map((point) => ({
              x: point.x + halfWidth,
              y: point.y + halfHeight,
            }));

            const trackedCanvas = calculateOpticalFlowFromPyramids(
              nextPyramid,
              currentPyramid,
              canvasPoints,
            );
            const frameDrift = getRobustTrackingError(trackedCanvas);
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

            const flows = trackedCanvas.map((point, index) => ({
              dx: point.x - canvasPoints[index].x,
              dy: point.y - canvasPoints[index].y,
              error: point.error,
            }));
            const validFlows = flows.filter((flow) => flow.error < 15.0);
            const moveSource = validFlows.length > 0 ? validFlows : flows;
            const medianDx = getMedian(moveSource.map((flow) => flow.dx));
            const medianDy = getMedian(moveSource.map((flow) => flow.dy));

            const trackedScene = trackedCanvas.map((point, index) => {
              let dx = flows[index].dx;
              let dy = flows[index].dy;
              if (flows[index].error > 15.0 || Math.hypot(dx - medianDx, dy - medianDy) > 30.0) {
                dx = medianDx;
                dy = medianDy;
              }
              return {
                x: canvasPoints[index].x + dx - halfWidth,
                y: canvasPoints[index].y + dy - halfHeight,
              };
            });

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
          for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
            const forwardPoints = forwardTracks[frame];
            const backwardPoints = backwardTracks[frame];
            if (!forwardPoints || !backwardPoints) continue;

            const t = (frame - startFrame) / rangeLength;
            const blendedPoints = forwardPoints.map((forwardPoint, index) => {
              const backwardPoint = backwardPoints[index];
              return {
                x: forwardPoint.x * (1 - t) + backwardPoint.x * t,
                y: forwardPoint.y * (1 - t) + backwardPoint.y * t,
              };
            });

            const resolvedBoundaryPoints = blendedPoints;
            const storedTransform = fitStoredTrackingTransform(
              currentRotoNode,
              trackingPaths,
              frame,
              resolvedBoundaryPoints,
              config,
              resolvedTarget,
              currentTrackPointsByPathId,
            );

            let nextTrackPointsByPathId: Map<string, TrackingPathPoints> | undefined;
            if (currentTrackPointsByPathId) {
              nextTrackPointsByPathId = new Map<string, TrackingPathPoints>();
              let boundaryOffset = 0;

              trackingPaths.forEach((trackingPath) => {
                const path = getTrackingPathForState(currentRotoNode, trackingPath);
                const currentTrackPoints = currentTrackPointsByPathId?.get(path.id);
                if (!currentTrackPoints) {
                  boundaryOffset += trackingPath.pointCount;
                  return;
                }

                const updatedTrackPoints = currentTrackPoints.map((trackPoint, pointIndex) => {
                  const targetPoint = resolvedBoundaryPoints[boundaryOffset + pointIndex];
                  const resolvedLocalPoint = targetPoint
                    ? projectScenePointToRotoPathResolvedLocal(
                        currentRotoNode,
                        path,
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
                });

                nextTrackPointsByPathId.set(path.id, updatedTrackPoints);
                boundaryOffset += trackingPath.pointCount;
              });
            }
            currentTrackPointsByPathId = nextTrackPointsByPathId;

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
              detail: `Blending frame ${frame} of ${endFrame}`,
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
    },

    clearRotoTrackingTarget: (rotoNodeId: string, target: RotoTrackingTarget) => {
      if (isPendingRotoTrackingLayerTarget(target)) return;

      const { nodes, selectedNodeId } = get();
      const rotoIndex = nodes.findIndex((node) => node.id === rotoNodeId);
      if (rotoIndex === -1) return;

      const rotoNode = nodes[rotoIndex] as RotoNode;
      const trackedPathIds = new Set(getTargetSourcePathIds(rotoNode, target));
      const nextPaths = rotoNode.paths.map((path) => {
        if (
          !trackedPathIds.has(path.id) &&
          !(target.kind === 'shape' && path.id === target.pathId)
        ) {
          return path;
        }

        return {
          ...path,
          trackPoints: undefined,
          trackingData: undefined,
          trackingTransform:
            target.kind === 'shape' && path.id === target.pathId
              ? undefined
              : path.trackingTransform,
        };
      });
      const nextLayers =
        target.kind === 'layer'
          ? (rotoNode.layers ?? []).map((layer) =>
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

      set(() => ({ nodes: newNodes }));
      deps.pushHistory({
        label: target.kind === 'layer' ? 'Clear Layer Tracking Data' : 'Clear Tracking Data',
        state: { nodes: newNodes, selectedNodeId },
      });
    },
  };

  return projectActions;
}
