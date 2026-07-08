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

describe('Roto interactive preview preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to a 1280px proxy and clamps persisted values', () => {
    expect(createDefaultPreferences()).toMatchObject({
      rotoInteractivePreviewMaxDimension: 1280,
      rotoFrameChangePreviewEnabled: true,
      rotoPreviewRefineDelayMs: 120,
      rotoPlaybackPreviewMode: 'auto',
    });

    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({ rotoInteractivePreviewMaxDimension: 9999 }),
    );

    expect(loadPreferences().rotoInteractivePreviewMaxDimension).toBe(2160);
  });

  it('normalizes temporal preview preferences', () => {
    localStorage.setItem(
      'blackboard-studio-preferences',
      JSON.stringify({
        rotoPreviewRefineDelayMs: 9999,
        rotoPlaybackPreviewMode: 'turbo',
      }),
    );

    expect(loadPreferences()).toMatchObject({
      rotoPreviewRefineDelayMs: 500,
      rotoPlaybackPreviewMode: 'auto',
    });
  });
});
