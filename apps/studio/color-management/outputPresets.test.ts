import { describe, expect, it } from 'vitest';
import type { DisplayViewSelection, ViewerSettings } from '@blackboard/types';
import {
  createDisplayOutputSelection,
  resolveDisplayOutput,
  resolveProjectDisplayOutput,
} from './outputPresets';

const projectDisplayView: DisplayViewSelection = {
  display: 'sRGB - Display',
  view: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  look: 'Studio Look',
};

const currentViewerDisplayView: DisplayViewSelection = {
  display: 'Display P3',
  view: 'Current Viewer HDR',
};

const currentViewerSettings: ViewerSettings = {
  channels: 'R',
  alphaOverlay: true,
  gamutWarning: true,
  showOverlays: true,
  gain: 1.5,
  gamma: 1.2,
  saturation: 0.8,
  lastCustomGain: 1.5,
  lastCustomGamma: 1.2,
  lastCustomSaturation: 0.8,
};

const context = {
  projectDisplayView,
  currentViewerDisplayView,
  currentViewerSettings,
};

describe('display output presets', () => {
  it('creates a neutral project-view render intent for persistent previews', () => {
    expect(resolveProjectDisplayOutput(projectDisplayView)).toEqual({
      finalColorSpace: 'match_viewport',
      displayView: projectDisplayView,
      viewerSettings: {
        channels: 'RGB',
        alphaOverlay: false,
        gamutWarning: false,
        showOverlays: false,
        gain: 1,
        gamma: 1,
        saturation: 1,
        lastCustomGain: 1,
        lastCustomGamma: 1,
        lastCustomSaturation: 1,
      },
    });
  });

  it('keeps normal project export independent from current viewer adjustments', () => {
    const resolved = resolveDisplayOutput({ kind: 'project_view' }, context);

    expect(resolved.finalColorSpace).toBe('match_viewport');
    expect(resolved.displayView).toBe(projectDisplayView);
    expect(resolved.viewerSettings).toMatchObject({
      channels: 'RGB',
      alphaOverlay: false,
      gain: 1,
      gamma: 1,
      saturation: 1,
    });
    expect(resolved.viewerSettings).not.toBe(currentViewerSettings);
  });

  it('uses current viewer adjustments only when explicitly selected', () => {
    const resolved = resolveDisplayOutput({ kind: 'current_viewer' }, context);

    expect(resolved).toEqual({
      finalColorSpace: 'match_viewport',
      displayView: currentViewerDisplayView,
      viewerSettings: {
        ...currentViewerSettings,
        gamutWarning: false,
      },
    });
  });

  it('supports explicit display/view and direct-encoding selections', () => {
    const selectedDisplayView: DisplayViewSelection = {
      display: 'Display P3',
      view: 'HDR Video',
    };

    expect(
      resolveDisplayOutput({ kind: 'display_view', displayView: selectedDisplayView }, context),
    ).toMatchObject({
      finalColorSpace: 'match_viewport',
      displayView: selectedDisplayView,
      viewerSettings: {
        channels: 'RGB',
        gain: 1,
        gamma: 1,
        saturation: 1,
      },
    });

    expect(
      resolveDisplayOutput(
        { kind: 'direct_encoding', colorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
        context,
      ),
    ).toEqual({
      finalColorSpace: 'srgb',
      outputColorSpace: 'sRGB Encoded Rec.709 (sRGB)',
    });
  });

  it('creates parameterized selections from shared defaults', () => {
    expect(
      createDisplayOutputSelection('display_view', {
        projectDisplayView,
        directColorSpace: 'sRGB Encoded Rec.709 (sRGB)',
      }),
    ).toEqual({
      kind: 'display_view',
      displayView: projectDisplayView,
    });
    expect(
      createDisplayOutputSelection('direct_encoding', {
        projectDisplayView,
        directColorSpace: 'sRGB Encoded Rec.709 (sRGB)',
      }),
    ).toEqual({
      kind: 'direct_encoding',
      colorSpace: 'sRGB Encoded Rec.709 (sRGB)',
    });
  });
});
