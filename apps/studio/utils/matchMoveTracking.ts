import type {
  MatchMoveCameraSettings,
  MatchMoveMode,
  MatchMoveSolveFrame,
  MatchMoveSolveModel,
  MatchMoveSolveResult,
  MatchMoveTrack,
  MatchMoveTrackSample,
  MatchMoveTrackingSettings,
  Point,
} from '@blackboard/types';
import {
  applySolvedTransform,
  buildOpticalFlowPyramid,
  calculateOpticalFlowFromPyramids,
  fitTrackedTransform,
  type SolvedTransformModel,
} from '@/utils/opticalFlow';

export interface MatchMovePixelFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MatchMoveRunOptions {
  getFramePixelData: (frame: number) => Promise<MatchMovePixelFrame | null>;
  tracking: MatchMoveTrackingSettings;
  mode: MatchMoveMode;
  model: MatchMoveSolveModel;
  ransacThreshold?: number;
  camera: MatchMoveCameraSettings;
  signal?: AbortSignal;
  onProgress?: (progress: number, detail: string) => void;
}

export interface MatchMoveRunResult {
  tracks: MatchMoveTrack[];
  solveResult: MatchMoveSolveResult;
}

export interface DetectedFeature {
  x: number;
  y: number;
  score: number;
}

const MATCH_MOVE_COLORS = [
  '#38bdf8',
  '#a3e635',
  '#facc15',
  '#fb7185',
  '#c084fc',
  '#2dd4bf',
  '#f97316',
  '#60a5fa',
];

const IDENTITY_MATRIX_3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const toGray = (data: Uint8ClampedArray, width: number, height: number): Float32Array => {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    gray[index] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  return gray;
};

const clampInteger = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const getGray = (gray: Float32Array, width: number, height: number, x: number, y: number) => {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  return gray[safeY * width + safeX];
};

const getCornerScore = (
  gray: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number => {
  let xx = 0;
  let xy = 0;
  let yy = 0;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const px = x + offsetX;
      const py = y + offsetY;
      const gx =
        (getGray(gray, width, height, px + 1, py) - getGray(gray, width, height, px - 1, py)) * 0.5;
      const gy =
        (getGray(gray, width, height, px, py + 1) - getGray(gray, width, height, px, py - 1)) * 0.5;
      xx += gx * gx;
      xy += gx * gy;
      yy += gy * gy;
    }
  }

  const trace = xx + yy;
  const determinantPart = Math.sqrt((xx - yy) * (xx - yy) + 4 * xy * xy);
  return (trace - determinantPart) * 0.5;
};

export const detectMatchMoveFeatures = (
  frame: MatchMovePixelFrame,
  settings: Pick<
    MatchMoveTrackingSettings,
    'maxFeatures' | 'minFeatureDistance' | 'featureQuality' | 'patchSize'
  >,
): DetectedFeature[] => {
  const maxFeatures = clampInteger(settings.maxFeatures, 4, 2000);
  const minDistance = clampInteger(settings.minFeatureDistance, 4, 200);
  const quality = Math.max(0.001, Math.min(1, settings.featureQuality));
  const radius = clampInteger(Math.floor(settings.patchSize / 2), 2, 16);
  const margin = radius + 2;
  const gray = toGray(frame.data, frame.width, frame.height);
  const candidates: DetectedFeature[] = [];
  let maxScore = 0;

  for (let y = margin; y < frame.height - margin; y += 2) {
    for (let x = margin; x < frame.width - margin; x += 2) {
      const score = getCornerScore(gray, frame.width, frame.height, x, y, radius);
      if (score <= 0) continue;
      maxScore = Math.max(maxScore, score);
      candidates.push({ x, y, score });
    }
  }

  if (maxScore <= 0) return [];

  const threshold = maxScore * quality;
  const selected: DetectedFeature[] = [];
  const minDistanceSq = minDistance * minDistance;

  candidates
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .some((candidate) => {
      const tooClose = selected.some((feature) => {
        const dx = feature.x - candidate.x;
        const dy = feature.y - candidate.y;
        return dx * dx + dy * dy < minDistanceSq;
      });

      if (!tooClose) {
        selected.push(candidate);
      }

      return selected.length >= maxFeatures;
    });

  return selected;
};

const canvasToScenePoint = (point: Point, width: number, height: number): Point => ({
  x: point.x - width / 2,
  y: point.y - height / 2,
});

const sceneToCanvasPoint = (point: Point, width: number, height: number): Point => ({
  x: point.x + width / 2,
  y: point.y + height / 2,
});

const getTrackSampleAtFrame = (track: MatchMoveTrack, frame: number): MatchMoveTrackSample | null =>
  track.samples.find((sample) => sample.frame === frame && sample.status !== 'failed') ?? null;

export const getMatchMoveSampleAtFrame = getTrackSampleAtFrame;

export const getMatchMoveLatestSampleAtOrBefore = (
  track: MatchMoveTrack,
  frame: number,
): MatchMoveTrackSample | null => {
  let latest: MatchMoveTrackSample | null = null;
  for (const sample of track.samples) {
    if (sample.frame <= frame && sample.status !== 'failed') {
      latest = !latest || sample.frame > latest.frame ? sample : latest;
    }
  }
  return latest;
};

export const getMatchMoveSolveFrameAt = (
  result: MatchMoveSolveResult | undefined,
  frame: number,
): MatchMoveSolveFrame | null => {
  if (!result?.frames.length) return null;
  return (
    result.frames.find((solveFrame) => solveFrame.frame === frame) ??
    result.frames.reduce<MatchMoveSolveFrame | null>((best, solveFrame) => {
      if (!best) return solveFrame;
      return Math.abs(solveFrame.frame - frame) < Math.abs(best.frame - frame) ? solveFrame : best;
    }, null)
  );
};

const solveModelToConfig = (model: MatchMoveSolveModel, ransacThreshold?: number) => ({
  translation: true,
  rotation: model !== 'translation',
  scale: model !== 'translation',
  affine: model === 'affine' || model === 'homography',
  perspective: model === 'homography',
  deform: false,
  ransacThreshold,
});

const solvedModelToMatrix = (solved: SolvedTransformModel | null): number[][] => {
  if (!solved) return IDENTITY_MATRIX_3.map((row) => [...row]);

  if (solved.type === 'homography') {
    const m = solved.model;
    return [
      [m[0], m[1], m[2]],
      [m[3], m[4], m[5]],
      [m[6], m[7], m[8]],
    ];
  }

  if (solved.type === 'affine') {
    const m = solved.model;
    return [
      [m[0], m[1], m[2]],
      [m[3], m[4], m[5]],
      [0, 0, 1],
    ];
  }

  if (solved.type === 'similarity') {
    const m = solved.model;
    return [
      [m[0], -m[1], m[2]],
      [m[1], m[0], m[3]],
      [0, 0, 1],
    ];
  }

  return [
    [1, 0, solved.model[0]],
    [0, 1, solved.model[1]],
    [0, 0, 1],
  ];
};

const applyMatrixToPoint = (point: Point, matrix: number[][]): Point => {
  const denominator = matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2];
  if (Math.abs(denominator) < 1e-9) return point;
  return {
    x: (matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2]) / denominator,
    y: (matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2]) / denominator,
  };
};

const decomposeMatrix = (matrix: number[][]) => {
  const scaleX = Math.hypot(matrix[0][0], matrix[1][0]);
  const scaleY = Math.hypot(matrix[0][1], matrix[1][1]);
  const rotation = (Math.atan2(matrix[1][0], matrix[0][0]) * 180) / Math.PI;
  return {
    translate: { x: matrix[0][2], y: matrix[1][2] },
    scale: { x: scaleX, y: scaleY },
    rotation,
  };
};

const createSolveFrame = (
  frame: number,
  model: MatchMoveSolveModel,
  referencePoints: Point[],
  trackedPoints: Point[],
  ransacThreshold?: number,
): MatchMoveSolveFrame => {
  const solved = fitTrackedTransform(
    referencePoints,
    trackedPoints,
    solveModelToConfig(model, ransacThreshold),
  );
  const matrix = solvedModelToMatrix(solved);
  const transformed = solved ? applySolvedTransform(referencePoints, solved) : referencePoints;
  const residuals = transformed.map((point, index) => {
    const tracked = trackedPoints[index] ?? point;
    return Math.hypot(point.x - tracked.x, point.y - tracked.y);
  });
  const residual =
    residuals.length > 0
      ? residuals.reduce((total, value) => total + value, 0) / residuals.length
      : 0;

  return {
    frame,
    model,
    matrix,
    ...decomposeMatrix(matrix),
    residual,
    inliers: residuals.filter((value) => value <= 2.5).length,
    tracked: trackedPoints.length,
  };
};

export const createMatchMoveSolveFrame = createSolveFrame;

const createInitialTracks = (
  features: DetectedFeature[],
  frame: number,
  width: number,
  height: number,
): MatchMoveTrack[] =>
  features.map((feature, index) => {
    const scenePoint = canvasToScenePoint(feature, width, height);
    return {
      id: `track_${index + 1}`,
      name: `Track ${index + 1}`,
      color: MATCH_MOVE_COLORS[index % MATCH_MOVE_COLORS.length],
      reference: scenePoint,
      samples: [{ frame, ...scenePoint, error: 0, status: 'tracked' }],
    };
  });

const getActiveTrackState = (
  tracks: MatchMoveTrack[],
  frame: number,
  width: number,
  height: number,
) =>
  tracks
    .map((track, index) => ({
      index,
      track,
      sample: getTrackSampleAtFrame(track, frame),
    }))
    .filter(
      (entry): entry is { index: number; track: MatchMoveTrack; sample: MatchMoveTrackSample } =>
        !!entry.sample,
    )
    .map((entry) => ({
      ...entry,
      canvasPoint: sceneToCanvasPoint(entry.sample, width, height),
    }));

const hasEnoughSolvePoints = (model: MatchMoveSolveModel, pointCount: number): boolean => {
  if (model === 'homography') return pointCount >= 4;
  if (model === 'affine') return pointCount >= 3;
  if (model === 'similarity') return pointCount >= 2;
  return pointCount >= 1;
};

const getAverageResidual = (frames: MatchMoveSolveFrame[]): number | undefined => {
  if (frames.length === 0) return undefined;
  const values = frames.map((frame) => frame.residual).filter(Number.isFinite);
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const getCameraSummary = (
  mode: MatchMoveMode,
  camera: MatchMoveCameraSettings,
  sourceWidth: number,
  tracks: MatchMoveTrack[],
  solveFrames: MatchMoveSolveFrame[],
) => {
  if (mode !== 'camera_3d') return undefined;
  const focalLengthPx =
    camera.sensorWidthMm > 0 ? (camera.focalLengthMm / camera.sensorWidthMm) * sourceWidth : 0;
  return {
    status: 'needs_solver' as const,
    message:
      '2D feature tracks are ready. Full 3D camera reconstruction needs a SfM/bundle-adjustment backend.',
    focalLengthPx,
    trackCount: tracks.length,
    solvedFrameCount: solveFrames.length,
  };
};

export async function runMatchMoveTracking({
  getFramePixelData,
  tracking,
  mode,
  model,
  ransacThreshold,
  camera,
  signal,
  onProgress,
}: MatchMoveRunOptions): Promise<MatchMoveRunResult> {
  const startFrame = Math.round(tracking.startFrame);
  const endFrame = Math.round(tracking.endFrame);
  const step = endFrame >= startFrame ? 1 : -1;
  const frameDistance = Math.abs(endFrame - startFrame);
  const frameSpan = Math.max(1, frameDistance);
  const firstFrame = await getFramePixelData(startFrame);

  if (!firstFrame) {
    return {
      tracks: [],
      solveResult: {
        status: 'failed',
        message: 'Could not read the source frame.',
        startFrame,
        endFrame,
        model,
        frames: [],
      },
    };
  }

  const features = detectMatchMoveFeatures(firstFrame, tracking);
  let tracks = createInitialTracks(features, startFrame, firstFrame.width, firstFrame.height);
  const solveFrames: MatchMoveSolveFrame[] = [
    {
      frame: startFrame,
      model,
      matrix: IDENTITY_MATRIX_3.map((row) => [...row]),
      translate: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      residual: 0,
      inliers: tracks.length,
      tracked: tracks.length,
    },
  ];

  if (features.length === 0) {
    return {
      tracks,
      solveResult: {
        status: 'failed',
        message: 'No trackable corner features were found in the source frame.',
        sourceWidth: firstFrame.width,
        sourceHeight: firstFrame.height,
        startFrame,
        endFrame,
        model,
        frames: solveFrames,
        camera: getCameraSummary(mode, camera, firstFrame.width, tracks, solveFrames),
      },
    };
  }

  let previousFrame = startFrame;
  let previousPixelData = firstFrame;
  let previousPyramid = buildOpticalFlowPyramid(
    firstFrame.data,
    firstFrame.width,
    firstFrame.height,
  );

  for (
    let frame = startFrame + step;
    step > 0 ? frame <= endFrame : frame >= endFrame;
    frame += step
  ) {
    if (signal?.aborted) break;

    const currentPixelData = await getFramePixelData(frame);
    if (!currentPixelData) break;

    const currentPyramid = buildOpticalFlowPyramid(
      currentPixelData.data,
      currentPixelData.width,
      currentPixelData.height,
    );
    const activeTrackState = getActiveTrackState(
      tracks,
      previousFrame,
      previousPixelData.width,
      previousPixelData.height,
    );

    if (activeTrackState.length === 0) break;

    const trackedCanvasPoints = calculateOpticalFlowFromPyramids(
      previousPyramid,
      currentPyramid,
      activeTrackState.map((entry) => entry.canvasPoint),
    );

    tracks = tracks.map((track, trackIndex) => {
      const activeIndex = activeTrackState.findIndex((entry) => entry.index === trackIndex);
      if (activeIndex === -1) return track;

      const tracked = trackedCanvasPoints[activeIndex];
      const insideFrame =
        tracked.x >= 0 &&
        tracked.y >= 0 &&
        tracked.x < currentPixelData.width &&
        tracked.y < currentPixelData.height;
      const isTracked =
        insideFrame &&
        tracked.error < tracking.maxTrackError &&
        Number.isFinite(tracked.x) &&
        Number.isFinite(tracked.y);
      const scenePoint = canvasToScenePoint(
        tracked,
        currentPixelData.width,
        currentPixelData.height,
      );
      const sample: MatchMoveTrackSample = {
        frame,
        x: scenePoint.x,
        y: scenePoint.y,
        error: tracked.error,
        status: isTracked ? 'tracked' : 'failed',
      };

      return {
        ...track,
        samples: [...track.samples, sample],
      };
    });

    const solvedTrackPairs = tracks
      .map((track) => ({
        reference: track.reference,
        sample: getTrackSampleAtFrame(track, frame),
      }))
      .filter(
        (entry): entry is { reference: Point; sample: MatchMoveTrackSample } => !!entry.sample,
      );

    if (hasEnoughSolvePoints(model, solvedTrackPairs.length)) {
      solveFrames.push(
        createSolveFrame(
          frame,
          model,
          solvedTrackPairs.map((entry) => entry.reference),
          solvedTrackPairs.map((entry) => entry.sample),
          ransacThreshold,
        ),
      );
    }

    previousFrame = frame;
    previousPixelData = currentPixelData;
    previousPyramid = currentPyramid;
    onProgress?.(
      Math.min(99, (Math.abs(frame - startFrame) / frameSpan) * 100),
      `Frame ${frame} of ${endFrame}`,
    );
  }

  const solvedFrameCount = solveFrames.length;
  const completedAllFrames = solvedFrameCount >= frameDistance + 1;
  const status =
    mode === 'camera_3d'
      ? solvedFrameCount > 1
        ? 'partial'
        : 'failed'
      : completedAllFrames
        ? 'solved'
        : solvedFrameCount > 1
          ? 'partial'
          : 'failed';
  const message =
    mode === 'camera_3d'
      ? '2D tracks completed. Full 3D camera solve is documented for a future SfM backend.'
      : undefined;

  return {
    tracks,
    solveResult: {
      status,
      message,
      solvedAt: Date.now(),
      sourceWidth: firstFrame.width,
      sourceHeight: firstFrame.height,
      startFrame,
      endFrame,
      model,
      averageResidual: getAverageResidual(solveFrames),
      frames: solveFrames,
      camera: getCameraSummary(mode, camera, firstFrame.width, tracks, solveFrames),
    },
  };
}

export const transformMatchMovePoint = applyMatrixToPoint;
