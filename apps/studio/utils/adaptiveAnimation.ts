const DEFAULT_FRAME_DURATION_MS = 1000 / 60;
const DEFAULT_DEGRADED_FRAME_DURATION_MS = 30;
const DEFAULT_SLOW_FRAME_THRESHOLD_MS = 100;
const DEFAULT_PRESSURE_HOLD_MS = 150;
const MAX_INTERPOLATION_ELAPSED_MS = 250;

export interface AdaptiveAnimationClock {
  lastCallbackAt: number | null;
  lastUpdateAt: number | null;
  pressureUntil: number;
}

export interface AdaptiveAnimationFrame {
  clock: AdaptiveAnimationClock;
  elapsedMs: number;
  shouldUpdate: boolean;
}

export const createAdaptiveAnimationClock = (): AdaptiveAnimationClock => ({
  lastCallbackAt: null,
  lastUpdateAt: null,
  pressureUntil: 0,
});

/**
 * Keeps full-refresh-rate animation while frames are healthy. After a missed
 * frame, updates temporarily coalesce to 30 fps so expensive consumers get a
 * chance to recover. Elapsed time accumulates across skipped updates.
 */
export const advanceAdaptiveAnimationClock = (
  clock: AdaptiveAnimationClock,
  timestamp: number,
): AdaptiveAnimationFrame => {
  const callbackGap =
    clock.lastCallbackAt === null ? DEFAULT_FRAME_DURATION_MS : timestamp - clock.lastCallbackAt;
  const pressureUntil =
    callbackGap >= DEFAULT_SLOW_FRAME_THRESHOLD_MS
      ? timestamp + DEFAULT_PRESSURE_HOLD_MS
      : clock.pressureUntil;
  const underPressure = timestamp < clock.pressureUntil;
  const elapsedSinceUpdate =
    clock.lastUpdateAt === null ? DEFAULT_FRAME_DURATION_MS : timestamp - clock.lastUpdateAt;
  const shouldUpdate =
    clock.lastUpdateAt === null ||
    !underPressure ||
    elapsedSinceUpdate >= DEFAULT_DEGRADED_FRAME_DURATION_MS;

  return {
    clock: {
      lastCallbackAt: timestamp,
      lastUpdateAt: shouldUpdate ? timestamp : clock.lastUpdateAt,
      pressureUntil,
    },
    elapsedMs: shouldUpdate ? Math.max(0, elapsedSinceUpdate) : 0,
    shouldUpdate,
  };
};

/**
 * Converts a per-60 Hz smoothing amount into a time-correct interpolation
 * amount. Late frames therefore catch up instead of extending the animation.
 */
export const getTimeCorrectedSmoothing = (smoothingPerFrame: number, elapsedMs: number): number => {
  const smoothing = Math.min(1, Math.max(0, smoothingPerFrame));
  const clampedElapsed = Math.min(MAX_INTERPOLATION_ELAPSED_MS, Math.max(0, elapsedMs));
  return 1 - Math.pow(1 - smoothing, clampedElapsed / DEFAULT_FRAME_DURATION_MS);
};
