import type { RotoMotionBlurPhase, RotoMotionBlurSettings } from '@blackboard/types';

type ResolvedRotoMotionBlurSettings = Omit<RotoMotionBlurSettings, 'phase'> & {
  phase: RotoMotionBlurPhase;
};

export const DEFAULT_ROTO_MOTION_BLUR: ResolvedRotoMotionBlurSettings = {
  enabled: true,
  shutter: 0.5,
  samples: 16,
  phase: 'centered',
};

const MIN_SAMPLES = 2;
const MAX_SAMPLES = 128;

const isRotoMotionBlurPhase = (value: unknown): value is RotoMotionBlurPhase =>
  value === 'start' || value === 'centered' || value === 'end';

const clampRotoMotionBlurShutter = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

export const clampRotoMotionBlurSamples = (value: number): number =>
  Number.isFinite(value)
    ? Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(value)))
    : DEFAULT_ROTO_MOTION_BLUR.samples;

interface ResolveRotoMotionBlurPreviewSamplesOptions {
  interactivePreviewEnabled?: boolean;
  interactivePreviewActive?: boolean;
  interactivePreviewSamples?: number;
}

export const resolveRotoMotionBlurSettings = (
  settings?: Partial<RotoMotionBlurSettings> | null,
): ResolvedRotoMotionBlurSettings => {
  const phase = isRotoMotionBlurPhase(settings?.phase) ? settings.phase : 'centered';
  const enabled = typeof settings?.enabled === 'boolean' ? settings.enabled : false;
  const shutter = clampRotoMotionBlurShutter(settings?.shutter ?? DEFAULT_ROTO_MOTION_BLUR.shutter);
  const samples = clampRotoMotionBlurSamples(settings?.samples ?? DEFAULT_ROTO_MOTION_BLUR.samples);
  return { enabled, shutter, samples, phase };
};

export const resolveRotoMotionBlurPreviewSamples = (
  samples: number,
  options: ResolveRotoMotionBlurPreviewSamplesOptions = {},
): number => {
  const resolvedSamples = clampRotoMotionBlurSamples(samples);
  if (!options.interactivePreviewEnabled || !options.interactivePreviewActive) {
    return resolvedSamples;
  }

  const interactiveSamples = clampRotoMotionBlurSamples(
    options.interactivePreviewSamples ?? resolvedSamples,
  );
  return Math.min(resolvedSamples, interactiveSamples);
};

export const getRotoMotionBlurSampleWeights = (sampleCount: number): number[] => {
  const safeSampleCount =
    Number.isFinite(sampleCount) && sampleCount > 0 ? Math.round(sampleCount) : 1;
  if (safeSampleCount === 1) return [1];

  const sampleStepWeight = 1 / (safeSampleCount - 1);
  return Array.from({ length: safeSampleCount }, (_, index) =>
    index === 0 || index === safeSampleCount - 1 ? sampleStepWeight * 0.5 : sampleStepWeight,
  );
};

const getShutterIntervalStart = (shutter: number, phase: RotoMotionBlurPhase): number => {
  if (phase === 'start') return 0;
  if (phase === 'end') return -shutter;
  return -shutter * 0.5;
};

/**
 * Returns edge-aligned sample times over the shutter interval.
 */
export const getRotoMotionBlurSampleFrames = (
  currentFrame: number,
  shutter: number,
  samples: number,
  phase: RotoMotionBlurPhase,
): number[] => {
  const safeShutter = clampRotoMotionBlurShutter(shutter);
  const safeSamples = clampRotoMotionBlurSamples(samples);
  if (safeShutter <= 0) return [currentFrame];

  const start = getShutterIntervalStart(safeShutter, phase);
  if (safeSamples === 1) return [currentFrame + start];

  const step = safeShutter / (safeSamples - 1);
  return Array.from({ length: safeSamples }, (_, index) => {
    const shutterT = start + step * index;
    return currentFrame + shutterT;
  });
};
