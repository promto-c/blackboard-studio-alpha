import { describe, expect, it } from 'vitest';
import {
  createDefaultViewerColorManagement,
  hasViewerDisplayOverride,
  resolveDisplayViewSelectionWithConfigFallback,
  resolveCurrentViewerDisplayView,
} from './viewerIntent';

const projectView = {
  display: 'sRGB - Display',
  view: 'ACES 2.0 - SDR 100 nits',
  look: 'Project Look',
};

const runtime = {
  defaultDisplay: 'sRGB - Display',
  defaultView: 'ACES 1.0 - SDR Video',
  displays: ['sRGB - Display', 'P3 - Display'],
  viewsByDisplay: {
    'sRGB - Display': [
      {
        name: 'ACES 1.0 - SDR Video',
        colorSpace: 'ACEScg',
        transform: 'display',
        looks: '',
      },
      {
        name: 'Raw',
        colorSpace: 'Raw',
        transform: 'data',
        looks: '',
      },
    ],
    'P3 - Display': [
      {
        name: 'P3 SDR',
        colorSpace: 'ACEScg',
        transform: 'display',
        looks: 'P3 Look',
      },
    ],
  },
};

describe('viewer color-management intent', () => {
  it('uses project intent until a local viewer override exists', () => {
    const viewer = createDefaultViewerColorManagement();

    expect(resolveCurrentViewerDisplayView(projectView, viewer)).toBe(projectView);
    expect(hasViewerDisplayOverride(viewer)).toBe(false);
  });

  it('resolves a local display/view without mutating project intent', () => {
    const override = {
      display: 'Display P3',
      view: 'HDR Video',
    };
    const viewer = { displayViewOverride: override, autoDetectView: null };

    expect(resolveCurrentViewerDisplayView(projectView, viewer)).toBe(override);
    expect(hasViewerDisplayOverride(viewer)).toBe(true);
    expect(projectView).toEqual({
      display: 'sRGB - Display',
      view: 'ACES 2.0 - SDR 100 nits',
      look: 'Project Look',
    });
  });

  it('uses autoDetectView when no manual override exists', () => {
    const autoView = {
      display: 'sRGB - Display',
      view: 'Video (colorimetric)',
    };
    const viewer = { displayViewOverride: null, autoDetectView: autoView };

    expect(resolveCurrentViewerDisplayView(projectView, viewer)).toBe(autoView);
    // auto-detect is *not* considered a user override
    expect(hasViewerDisplayOverride(viewer)).toBe(false);
  });

  it('prefers displayViewOverride over autoDetectView', () => {
    const override = {
      display: 'Display P3',
      view: 'HDR Video',
    };
    const autoView = {
      display: 'sRGB - Display',
      view: 'Video (colorimetric)',
    };
    const viewer = { displayViewOverride: override, autoDetectView: autoView };

    expect(resolveCurrentViewerDisplayView(projectView, viewer)).toBe(override);
    expect(hasViewerDisplayOverride(viewer)).toBe(true);
  });

  it('falls back to projectDisplayView when both override and autoDetectView are null', () => {
    const viewer = createDefaultViewerColorManagement();
    expect(hasViewerDisplayOverride(viewer)).toBe(false);
    expect(resolveCurrentViewerDisplayView(projectView, viewer)).toBe(projectView);
  });

  it('keeps a valid display/view selection unchanged', () => {
    const selection = {
      display: 'P3 - Display',
      view: 'P3 SDR',
      look: 'P3 Look',
    };

    expect(resolveDisplayViewSelectionWithConfigFallback(selection, runtime)).toBe(selection);
  });

  it('falls back to the config default when the selected view is unavailable', () => {
    expect(
      resolveDisplayViewSelectionWithConfigFallback(
        {
          display: 'sRGB - Display',
          view: 'ACES 2.0 - SDR 100 nits (Rec.709)',
        },
        runtime,
      ),
    ).toEqual({
      display: 'sRGB - Display',
      view: 'ACES 1.0 - SDR Video',
    });
  });

  it('falls back to the config default when the selected display is unavailable', () => {
    expect(
      resolveDisplayViewSelectionWithConfigFallback(
        {
          display: 'Missing Display',
          view: 'Missing View',
        },
        runtime,
      ),
    ).toEqual({
      display: 'sRGB - Display',
      view: 'ACES 1.0 - SDR Video',
    });
  });

  it('removes an unavailable look without changing a valid display/view', () => {
    expect(
      resolveDisplayViewSelectionWithConfigFallback(
        {
          display: 'P3 - Display',
          view: 'P3 SDR',
          look: 'Old Look',
        },
        runtime,
      ),
    ).toEqual({
      display: 'P3 - Display',
      view: 'P3 SDR',
    });
  });
});
