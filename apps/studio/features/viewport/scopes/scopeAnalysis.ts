import type { RenderOutputDomain } from '@blackboard/types';
import type { ViewportPipelineResult } from '@blackboard/renderer';
import type * as THREE from 'three';

export type ScopeProcessingDomain = 'scene_linear' | 'display_referred' | 'data';
export type ScopeChannel = 'red' | 'green' | 'blue' | 'luma' | 'alpha';

export interface ScopeValueRange {
  min: number;
  max: number;
}

export interface ScopeChannelDistribution {
  bins: Uint32Array;
  underflow: number;
  overflow: number;
  invalid: number;
}

export interface ScopeHistogram {
  domain: ScopeProcessingDomain;
  range: ScopeValueRange;
  channels: Record<ScopeChannel, ScopeChannelDistribution>;
}

export interface ScopeWaveform extends ScopeHistogram {
  columns: number;
  rows: number;
}

export interface ScopeAnalysisOptions {
  domain: ScopeProcessingDomain;
  range?: ScopeValueRange;
  bins?: number;
  channels?: readonly ScopeChannel[];
  includeTransparent?: boolean;
}

export interface ScopeWaveformOptions extends ScopeAnalysisOptions {
  columns?: number;
  rows?: number;
}

export const DEFAULT_SCOPE_RANGES: Readonly<Record<ScopeProcessingDomain, ScopeValueRange>> = {
  scene_linear: { min: -0.25, max: 4 },
  display_referred: { min: 0, max: 1 },
  data: { min: 0, max: 1 },
};

const CHANNELS: readonly ScopeChannel[] = ['red', 'green', 'blue', 'luma', 'alpha'];
const ACESCG_LUMA = [0.2722287, 0.6740818, 0.0536895] as const;
const DISPLAY_LUMA = [0.2126, 0.7152, 0.0722] as const;

const createDistribution = (binCount: number): ScopeChannelDistribution => ({
  bins: new Uint32Array(binCount),
  underflow: 0,
  overflow: 0,
  invalid: 0,
});

const createDistributions = (binCount: number): Record<ScopeChannel, ScopeChannelDistribution> => ({
  red: createDistribution(binCount),
  green: createDistribution(binCount),
  blue: createDistribution(binCount),
  luma: createDistribution(binCount),
  alpha: createDistribution(binCount),
});

const assertRange = (range: ScopeValueRange): ScopeValueRange => {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min) {
    throw new Error('Scope range must contain finite values with max greater than min.');
  }
  return range;
};

const getChannelValue = (
  rgba: ArrayLike<number>,
  offset: number,
  channel: ScopeChannel,
  domain: ScopeProcessingDomain,
): number => {
  if (channel === 'red') return rgba[offset];
  if (channel === 'green') return rgba[offset + 1];
  if (channel === 'blue') return rgba[offset + 2];
  if (channel === 'alpha') return rgba[offset + 3];
  const coefficients = domain === 'scene_linear' ? ACESCG_LUMA : DISPLAY_LUMA;
  return (
    rgba[offset] * coefficients[0] +
    rgba[offset + 1] * coefficients[1] +
    rgba[offset + 2] * coefficients[2]
  );
};

const addSample = (
  distribution: ScopeChannelDistribution,
  value: number,
  range: ScopeValueRange,
) => {
  if (!Number.isFinite(value)) {
    distribution.invalid += 1;
    return;
  }
  if (value < range.min) {
    distribution.underflow += 1;
    return;
  }
  if (value > range.max) {
    distribution.overflow += 1;
    return;
  }

  const normalized = (value - range.min) / (range.max - range.min);
  const bin = Math.min(
    distribution.bins.length - 1,
    Math.floor(normalized * distribution.bins.length),
  );
  distribution.bins[bin] += 1;
};

const resolveOptions = (options: ScopeAnalysisOptions) => {
  const bins = Math.max(2, Math.floor(options.bins ?? 256));
  return {
    bins,
    range: assertRange(options.range ?? DEFAULT_SCOPE_RANGES[options.domain]),
    channels: options.channels ?? CHANNELS,
    includeTransparent: options.includeTransparent ?? false,
  };
};

const assertDimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Scope dimensions must be positive integers.');
  }
};

export const resolveScopeProcessingDomain = (
  requestedDomain: Exclude<ScopeProcessingDomain, 'data'>,
  outputDomain?: RenderOutputDomain,
): ScopeProcessingDomain => (outputDomain?.kind === 'data' ? 'data' : requestedDomain);

export const requiresScopeDisplayCapture = (domain: ScopeProcessingDomain): boolean =>
  domain === 'display_referred';

export const getScopeRenderTarget = (
  result: ViewportPipelineResult,
  domain: ScopeProcessingDomain,
): THREE.WebGLRenderTarget => {
  const target =
    domain === 'display_referred' ? result.displayOutputTarget : result.finalCompositeTarget;
  if (!target) {
    throw new Error(
      domain === 'display_referred'
        ? 'Display-referred scopes require captureDisplayOutput.'
        : 'Scope analysis requires a rendered composite target.',
    );
  }
  return target;
};

export const computeScopeHistogram = (
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: ScopeAnalysisOptions,
): ScopeHistogram => {
  assertDimensions(width, height);
  if (rgba.length < width * height * 4) {
    throw new Error('Scope input does not contain enough RGBA samples.');
  }
  const resolved = resolveOptions(options);
  const distributions = createDistributions(resolved.bins);

  for (let offset = 0; offset < width * height * 4; offset += 4) {
    resolved.channels.forEach((channel) => {
      if (!resolved.includeTransparent && channel !== 'alpha' && rgba[offset + 3] <= 0) {
        return;
      }
      addSample(
        distributions[channel],
        getChannelValue(rgba, offset, channel, options.domain),
        resolved.range,
      );
    });
  }

  return {
    domain: options.domain,
    range: resolved.range,
    channels: distributions,
  };
};

export const computeScopeWaveform = (
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: ScopeWaveformOptions,
): ScopeWaveform => {
  assertDimensions(width, height);
  if (rgba.length < width * height * 4) {
    throw new Error('Scope input does not contain enough RGBA samples.');
  }
  const columns = Math.max(1, Math.floor(options.columns ?? Math.min(width, 512)));
  const rows = Math.max(2, Math.floor(options.rows ?? 256));
  const resolved = resolveOptions({ ...options, bins: columns * rows });
  const distributions = createDistributions(columns * rows);
  const rangeSize = resolved.range.max - resolved.range.min;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const column = Math.min(columns - 1, Math.floor((x / width) * columns));

      resolved.channels.forEach((channel) => {
        if (!resolved.includeTransparent && channel !== 'alpha' && rgba[offset + 3] <= 0) {
          return;
        }
        const value = getChannelValue(rgba, offset, channel, options.domain);
        const distribution = distributions[channel];
        if (!Number.isFinite(value)) {
          distribution.invalid += 1;
        } else if (value < resolved.range.min) {
          distribution.underflow += 1;
        } else if (value > resolved.range.max) {
          distribution.overflow += 1;
        } else {
          const normalized = (value - resolved.range.min) / rangeSize;
          const row = Math.min(rows - 1, Math.floor((1 - normalized) * rows));
          distribution.bins[row * columns + column] += 1;
        }
      });
    }
  }

  return {
    domain: options.domain,
    range: resolved.range,
    channels: distributions,
    columns,
    rows,
  };
};
