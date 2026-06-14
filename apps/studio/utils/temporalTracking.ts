import type { TemporalTrackingConfig } from '@blackboard/types';

const DEFAULT_TEMPORAL_TRACKING_CONFIG: Required<TemporalTrackingConfig> = {
  mode: 'normal',
  smoothingWindow: 5,
  anomalyThreshold: 12,
  repair: 'blend',
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalizeTemporalWindow = (value: number): number => {
  const rounded = Math.round(clamp(Number.isFinite(value) ? value : 5, 1, 21));
  return rounded % 2 === 0 ? rounded + 1 : rounded;
};

export const getTemporalTrackingConfig = (
  temporal?: Partial<TemporalTrackingConfig>,
): Required<TemporalTrackingConfig> => ({
  ...DEFAULT_TEMPORAL_TRACKING_CONFIG,
  ...(temporal ?? {}),
  smoothingWindow: normalizeTemporalWindow(
    temporal?.smoothingWindow ?? DEFAULT_TEMPORAL_TRACKING_CONFIG.smoothingWindow,
  ),
  anomalyThreshold: clamp(
    temporal?.anomalyThreshold ?? DEFAULT_TEMPORAL_TRACKING_CONFIG.anomalyThreshold,
    1,
    96,
  ),
});

const getTemporalModeStrength = (mode: TemporalTrackingConfig['mode']): number => {
  switch (mode) {
    case 'strong':
      return 0.72;
    case 'normal':
      return 0.45;
    case 'off':
      return 0;
  }
};

type TrackingPoint = { x: number; y: number };

export type TemporalTrackingFrame = {
  frame: number;
  points: TrackingPoint[];
  drift?: number | null;
  disagreement?: number | null;
};

export type TemporalTrackingGuardedFrame = TemporalTrackingFrame & {
  confidence: number;
  anomaly: boolean;
  anomalyScore: number;
};

type TemporalScoreInput = {
  drift?: number | null;
  disagreement?: number | null;
  deviation?: number | null;
};

export type TemporalTrackingOnlineState = {
  previousPoints: TrackingPoint[] | null;
  previousVelocity: TrackingPoint[] | null;
};

const cloneTrackingPoints = (points: ReadonlyArray<TrackingPoint>): TrackingPoint[] =>
  points.map((point) => ({ x: point.x, y: point.y }));

const pointListsMatch = (
  first: ReadonlyArray<TrackingPoint> | null | undefined,
  second: ReadonlyArray<TrackingPoint> | null | undefined,
): boolean => !!first && !!second && first.length === second.length;

const blendTrackingPoints = (
  source: ReadonlyArray<TrackingPoint>,
  target: ReadonlyArray<TrackingPoint>,
  weight: number,
): TrackingPoint[] => {
  const resolvedWeight = clamp(weight, 0, 1);
  return source.map((point, index) => ({
    x: point.x * (1 - resolvedWeight) + target[index].x * resolvedWeight,
    y: point.y * (1 - resolvedWeight) + target[index].y * resolvedWeight,
  }));
};

export const getMeanPointDistance = (
  first: ReadonlyArray<TrackingPoint>,
  second: ReadonlyArray<TrackingPoint>,
): number => {
  if (!pointListsMatch(first, second)) return 0;
  return (
    first.reduce(
      (total, point, index) =>
        total + Math.hypot(point.x - second[index].x, point.y - second[index].y),
      0,
    ) / Math.max(1, first.length)
  );
};

const interpolateTrackingPoints = (
  first: ReadonlyArray<TrackingPoint>,
  second: ReadonlyArray<TrackingPoint>,
  t: number,
): TrackingPoint[] => blendTrackingPoints(first, second, t);

const subtractTrackingPoints = (
  current: ReadonlyArray<TrackingPoint>,
  previous: ReadonlyArray<TrackingPoint>,
): TrackingPoint[] =>
  current.map((point, index) => ({
    x: point.x - previous[index].x,
    y: point.y - previous[index].y,
  }));

const addTrackingVelocity = (
  points: ReadonlyArray<TrackingPoint>,
  velocity: ReadonlyArray<TrackingPoint>,
): TrackingPoint[] =>
  points.map((point, index) => ({
    x: point.x + velocity[index].x,
    y: point.y + velocity[index].y,
  }));

const getTemporalFrameScore = (
  input: TemporalScoreInput,
  config: Required<TemporalTrackingConfig>,
): Pick<TemporalTrackingGuardedFrame, 'confidence' | 'anomaly' | 'anomalyScore'> => {
  const anomalyScore = Math.max(
    0,
    ...[input.drift, input.disagreement, input.deviation].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ),
  );
  const confidence = clamp(1 - anomalyScore / config.anomalyThreshold, 0.05, 1);

  return {
    confidence,
    anomaly: anomalyScore > config.anomalyThreshold,
    anomalyScore,
  };
};

const findReliableTemporalFrame = (
  frames: ReadonlyArray<TemporalTrackingGuardedFrame>,
  startIndex: number,
  direction: -1 | 1,
  pointCount: number,
): TemporalTrackingGuardedFrame | null => {
  for (let index = startIndex; index >= 0 && index < frames.length; index += direction) {
    const frame = frames[index];
    if (frame.confidence >= 0.45 && frame.points.length === pointCount) {
      return frame;
    }
  }

  return null;
};

const getInterpolatedRepairTarget = (
  frames: ReadonlyArray<TemporalTrackingGuardedFrame>,
  repairedPoints: ReadonlyArray<TrackingPoint[]>,
  index: number,
): TrackingPoint[] | null => {
  const frame = frames[index];
  const previous = findReliableTemporalFrame(frames, index - 1, -1, frame.points.length);
  const next = findReliableTemporalFrame(frames, index + 1, 1, frame.points.length);

  if (previous && next) {
    const previousPoints = repairedPoints[frames.indexOf(previous)] ?? previous.points;
    const t = clamp(
      (frame.frame - previous.frame) / Math.max(1, next.frame - previous.frame),
      0,
      1,
    );
    return interpolateTrackingPoints(previousPoints, next.points, t);
  }

  if (previous) {
    return repairedPoints[frames.indexOf(previous)] ?? previous.points;
  }

  return next?.points ?? null;
};

const getPredictedRepairTarget = (
  repairedPoints: ReadonlyArray<TrackingPoint[]>,
  index: number,
): TrackingPoint[] | null => {
  const previous = repairedPoints[index - 1];
  const beforePrevious = repairedPoints[index - 2];
  if (!previous || !beforePrevious || !pointListsMatch(previous, beforePrevious)) return null;

  const velocity = subtractTrackingPoints(previous, beforePrevious);
  return addTrackingVelocity(previous, velocity);
};

export const applyTemporalTrackingGuard = (
  frames: ReadonlyArray<TemporalTrackingFrame>,
  temporal?: Partial<TemporalTrackingConfig>,
): TemporalTrackingGuardedFrame[] => {
  const config = getTemporalTrackingConfig(temporal);
  const strength = getTemporalModeStrength(config.mode);
  const guardedFrames: TemporalTrackingGuardedFrame[] = frames.map((frame, index) => {
    const previous = frames[index - 1];
    const next = frames[index + 1];
    const expected =
      previous && next && pointListsMatch(previous.points, next.points)
        ? interpolateTrackingPoints(
            previous.points,
            next.points,
            clamp((frame.frame - previous.frame) / Math.max(1, next.frame - previous.frame), 0, 1),
          )
        : null;
    const score = getTemporalFrameScore(
      {
        drift: frame.drift,
        disagreement: frame.disagreement,
        deviation: expected ? getMeanPointDistance(frame.points, expected) : null,
      },
      config,
    );

    return {
      ...frame,
      points: cloneTrackingPoints(frame.points),
      ...score,
    };
  });

  if (strength <= 0 || frames.length < 2) {
    return guardedFrames.map((frame) => ({
      ...frame,
      confidence: 1,
      anomaly: false,
      anomalyScore: frame.drift ?? 0,
    }));
  }

  const repairedPoints: TrackingPoint[][] = [];
  guardedFrames.forEach((frame, index) => {
    const needsRepair = frame.anomaly || frame.confidence < 0.45;
    let repairTarget: TrackingPoint[] | null = null;

    if (needsRepair && config.repair === 'predict') {
      repairTarget = getPredictedRepairTarget(repairedPoints, index);
    }

    if (needsRepair && !repairTarget) {
      repairTarget = getInterpolatedRepairTarget(guardedFrames, repairedPoints, index);
    }

    if (needsRepair && repairTarget && pointListsMatch(frame.points, repairTarget)) {
      const repairWeight = clamp(strength + (1 - frame.confidence) * 0.35, 0, 0.95);
      repairedPoints[index] = blendTrackingPoints(frame.points, repairTarget, repairWeight);
      return;
    }

    repairedPoints[index] = cloneTrackingPoints(frame.points);
  });

  const radius = Math.floor(config.smoothingWindow / 2);
  return guardedFrames.map((frame, index) => {
    if (radius <= 0) {
      return { ...frame, points: repairedPoints[index] };
    }

    const pointSums = repairedPoints[index].map(() => ({ x: 0, y: 0, weight: 0 }));
    for (
      let neighborIndex = Math.max(0, index - radius);
      neighborIndex <= Math.min(guardedFrames.length - 1, index + radius);
      neighborIndex += 1
    ) {
      const neighborPoints = repairedPoints[neighborIndex];
      if (!pointListsMatch(repairedPoints[index], neighborPoints)) continue;

      const distance = Math.abs(index - neighborIndex);
      const kernelWeight = 1 - distance / (radius + 1);
      const confidenceWeight = Math.max(0.15, guardedFrames[neighborIndex].confidence);
      const weight = kernelWeight * confidenceWeight;
      neighborPoints.forEach((point, pointIndex) => {
        pointSums[pointIndex].x += point.x * weight;
        pointSums[pointIndex].y += point.y * weight;
        pointSums[pointIndex].weight += weight;
      });
    }

    const averagedPoints = pointSums.map((sum, pointIndex) =>
      sum.weight > 0
        ? { x: sum.x / sum.weight, y: sum.y / sum.weight }
        : repairedPoints[index][pointIndex],
    );
    const smoothWeight = frame.anomaly ? strength : strength * 0.3;

    return {
      ...frame,
      points: blendTrackingPoints(repairedPoints[index], averagedPoints, smoothWeight),
    };
  });
};

export const createTemporalTrackingOnlineState = (
  startPoints: ReadonlyArray<TrackingPoint>,
): TemporalTrackingOnlineState => ({
  previousPoints: cloneTrackingPoints(startPoints),
  previousVelocity: null,
});

export const applyOnlineTemporalTrackingGuard = (
  rawPoints: ReadonlyArray<TrackingPoint>,
  state: TemporalTrackingOnlineState,
  drift: number,
  config: Required<TemporalTrackingConfig>,
): TemporalTrackingGuardedFrame => {
  const strength = getTemporalModeStrength(config.mode);
  const previousPoints = state.previousPoints;
  const predictedPoints =
    previousPoints &&
    state.previousVelocity &&
    pointListsMatch(previousPoints, state.previousVelocity)
      ? addTrackingVelocity(previousPoints, state.previousVelocity)
      : null;
  const score = getTemporalFrameScore(
    {
      drift,
      deviation: predictedPoints ? getMeanPointDistance(rawPoints, predictedPoints) : null,
    },
    config,
  );

  let points = cloneTrackingPoints(rawPoints);
  if (strength > 0 && predictedPoints && pointListsMatch(rawPoints, predictedPoints)) {
    const smoothWeight = score.anomaly
      ? clamp(strength + (1 - score.confidence) * 0.25, 0, 0.85)
      : clamp(strength * 0.08 * (1 - score.confidence), 0, 0.2);
    points = blendTrackingPoints(rawPoints, predictedPoints, smoothWeight);
  }

  if (previousPoints && pointListsMatch(points, previousPoints)) {
    state.previousVelocity = subtractTrackingPoints(points, previousPoints);
  } else {
    state.previousVelocity = null;
  }
  state.previousPoints = cloneTrackingPoints(points);

  return {
    frame: 0,
    points,
    drift,
    ...score,
  };
};
