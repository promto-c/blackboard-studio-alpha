import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  computeScopeHistogram,
  computeScopeWaveform,
  getScopeRenderTarget,
  requiresScopeDisplayCapture,
  resolveScopeProcessingDomain,
} from './scopeAnalysis';

describe('scope analysis domains', () => {
  it('forces technical outputs into the transform-free data domain', () => {
    expect(
      resolveScopeProcessingDomain('display_referred', {
        kind: 'data',
        sourceNodeId: 'depth',
        sourcePort: 'depth',
        semantic: 'depth',
      }),
    ).toBe('data');
    expect(resolveScopeProcessingDomain('scene_linear')).toBe('scene_linear');
    expect(requiresScopeDisplayCapture('display_referred')).toBe(true);
    expect(requiresScopeDisplayCapture('data')).toBe(false);
  });

  it('requires the exact captured viewer output for display-referred scopes', () => {
    const sceneTarget = new THREE.WebGLRenderTarget(1, 1);
    const displayTarget = new THREE.WebGLRenderTarget(1, 1);
    const result = {
      renderTargets: [],
      finalCompositeTarget: sceneTarget,
      displayOutputTarget: displayTarget,
    };

    expect(getScopeRenderTarget(result, 'scene_linear')).toBe(sceneTarget);
    expect(getScopeRenderTarget(result, 'data')).toBe(sceneTarget);
    expect(getScopeRenderTarget(result, 'display_referred')).toBe(displayTarget);
    expect(() =>
      getScopeRenderTarget({ ...result, displayOutputTarget: null }, 'display_referred'),
    ).toThrow(/captureDisplayOutput/);
  });
});

describe('HDR and negative scope behavior', () => {
  const rgba = new Float32Array([-0.5, 0.18, 8, 1, 0.25, 0.5, 1, 1, 0.75, 0.75, 0.75, 0]);

  it('tracks negative and HDR samples outside the plot instead of edge-clamping them', () => {
    const histogram = computeScopeHistogram(rgba, 3, 1, {
      domain: 'scene_linear',
      bins: 8,
      channels: ['red', 'green', 'blue'],
    });

    expect(histogram.channels.red.underflow).toBe(1);
    expect(histogram.channels.blue.overflow).toBe(1);
    expect(histogram.channels.blue.bins[7]).toBe(0);
    expect(histogram.channels.red.bins.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(histogram.channels.green.bins.reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it('uses the same explicit range behavior for waveform density', () => {
    const waveform = computeScopeWaveform(rgba, 3, 1, {
      domain: 'scene_linear',
      columns: 3,
      rows: 8,
      channels: ['red', 'blue'],
    });

    expect(waveform.channels.red.underflow).toBe(1);
    expect(waveform.channels.blue.overflow).toBe(1);
    expect(waveform.channels.red.bins.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(waveform.channels.blue.bins.reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('excludes transparent RGB while retaining transparent alpha samples', () => {
    const histogram = computeScopeHistogram(rgba, 3, 1, {
      domain: 'scene_linear',
      bins: 8,
      channels: ['red', 'alpha'],
    });

    expect(histogram.channels.red.underflow).toBe(1);
    expect(histogram.channels.red.bins.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(histogram.channels.alpha.bins.reduce((sum, count) => sum + count, 0)).toBe(3);
  });
});
