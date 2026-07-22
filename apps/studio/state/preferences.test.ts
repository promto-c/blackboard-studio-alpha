// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultPreferences,
  initTheme,
  loadPreferences,
  savePreferencesToStorage,
} from './preferences';

describe('component style preference', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.componentStyle;
  });

  it('defaults to the glass component system', () => {
    expect(createDefaultPreferences().componentStyle).toBe('glass');
  });

  it('persists and applies the flat component system', () => {
    savePreferencesToStorage({
      ...createDefaultPreferences(),
      componentStyle: 'flat',
    });

    expect(loadPreferences().componentStyle).toBe('flat');

    initTheme();

    expect(document.documentElement.dataset.componentStyle).toBe('flat');
  });
});

describe('viewport background preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('keeps the existing empty viewport background by default', () => {
    expect(createDefaultPreferences()).toMatchObject({
      viewportBackgroundMode: 'none',
      viewportBackgroundColor: [0.08, 0.08, 0.09],
    });
  });

  it('persists a custom viewport background', () => {
    savePreferencesToStorage({
      ...createDefaultPreferences(),
      viewportBackgroundMode: 'custom',
      viewportBackgroundColor: [0.2, 0.4, 0.6],
    });

    expect(loadPreferences()).toMatchObject({
      viewportBackgroundMode: 'custom',
      viewportBackgroundColor: [0.2, 0.4, 0.6],
    });
  });

  it('rejects invalid stored background values', () => {
    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({
        viewportBackgroundMode: 'legacy-alpha',
        viewportBackgroundColor: [2, -1, 0],
      }),
    );

    expect(loadPreferences()).toMatchObject({
      viewportBackgroundMode: 'none',
      viewportBackgroundColor: [0.08, 0.08, 0.09],
    });
  });
});

describe('viewport pixel grid preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('makes the pixel grid fully visible at 800% zoom by default', () => {
    expect(createDefaultPreferences()).toMatchObject({
      viewportPixelGridEnabled: true,
      viewportPixelGridZoomThresholdPercent: 800,
    });
  });

  it('persists the toggle and clamps the zoom threshold', () => {
    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({
        viewportPixelGridEnabled: false,
        viewportPixelGridZoomThresholdPercent: 9999,
      }),
    );

    expect(loadPreferences()).toMatchObject({
      viewportPixelGridEnabled: false,
      viewportPixelGridZoomThresholdPercent: 1600,
    });
  });
});

describe('compare preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults and clamps the compare chord hold delay', () => {
    expect(createDefaultPreferences().compareChordHoldMs).toBe(100);

    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({ compareChordHoldMs: 9999 }),
    );

    expect(loadPreferences().compareChordHoldMs).toBe(500);
  });
});

describe('paint brush preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults and clamps streaming stroke stabilization', () => {
    expect(createDefaultPreferences().paintBrush.stabilization).toBe(30);

    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({ paintBrush: { stabilization: 999 } }),
    );
    expect(loadPreferences().paintBrush.stabilization).toBe(100);
  });
});

describe('interactive preview performance preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to a 1280px proxy and clamps persisted values', () => {
    expect(createDefaultPreferences()).toMatchObject({
      previewMaxDimension: 1280,
      previewOptimizeWhileEditing: true,
      previewOptimizeFrameChanges: true,
      previewRefineDelayMs: 120,
      previewPlaybackMode: 'auto',
      previewSampleLimit: 16,
    });

    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({ previewMaxDimension: 9999 }),
    );

    expect(loadPreferences().previewMaxDimension).toBe(2160);
  });

  it('normalizes temporal preview preferences', () => {
    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({
        previewRefineDelayMs: 9999,
        previewPlaybackMode: 'turbo',
        previewSampleLimit: 999,
      }),
    );

    expect(loadPreferences()).toMatchObject({
      previewRefineDelayMs: 500,
      previewPlaybackMode: 'auto',
      previewSampleLimit: 128,
    });
  });
});
