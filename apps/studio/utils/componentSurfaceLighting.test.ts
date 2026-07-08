// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { getGlassSurfaceLighting, initComponentSurfaceLighting } from './componentSurfaceLighting';

describe('getGlassSurfaceLighting', () => {
  it('makes the nearest rim brighter and thicker', () => {
    const lighting = getGlassSurfaceLighting(50, 2, 100, 40);

    expect(lighting.edges.top.alpha).toBeGreaterThan(lighting.edges.bottom.alpha);
    expect(lighting.edges.top.thickness).toBeGreaterThan(lighting.edges.bottom.thickness);
    expect(lighting.aberrationOpacity).toBeGreaterThan(0.35);
  });

  it('clamps pointer positions outside the surface', () => {
    const lighting = getGlassSurfaceLighting(-20, 100, 100, 40);

    expect(lighting.lightX).toBe(0);
    expect(lighting.lightY).toBe(100);
    expect(lighting.edges.left.alpha).toBeGreaterThan(lighting.edges.right.alpha);
  });

  it('maps the selected segment light to the indicator instead of the whole panel', () => {
    document.documentElement.dataset.componentStyle = 'glass';
    const panel = document.createElement('div');
    panel.className = 'bb-control-well bb-segmented-control';
    const indicator = document.createElement('span');
    indicator.className = 'bb-segmented-selection-indicator';
    panel.append(indicator);
    document.body.append(panel);

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(indicator, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 40,
      left: 100,
      right: 200,
      top: 0,
      width: 100,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const cleanup = initComponentSurfaceLighting();
    indicator.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 110, clientY: 20 }),
    );

    expect(panel.style.getPropertyValue('--bb-light-x')).toBe('55.0%');
    expect(indicator.style.getPropertyValue('--bb-light-x')).toBe('10.0%');

    cleanup();
    panel.remove();
    delete document.documentElement.dataset.componentStyle;
    vi.restoreAllMocks();
  });

  it('maps split-control interaction to its single wrapper surface', () => {
    document.documentElement.dataset.componentStyle = 'glass';
    const splitControl = document.createElement('div');
    splitControl.className = 'bb-split-control';
    const dropdown = document.createElement('button');
    dropdown.className = 'bb-dropdown-surface';
    const action = document.createElement('button');
    action.className = 'bb-dropdown-surface';
    splitControl.append(dropdown, action);
    document.body.append(splitControl);

    vi.spyOn(splitControl, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const cleanup = initComponentSurfaceLighting();
    action.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 20 }),
    );

    expect(splitControl.style.getPropertyValue('--bb-light-x')).toBe('75.0%');
    expect(dropdown.style.getPropertyValue('--bb-light-x')).toBe('');
    expect(action.style.getPropertyValue('--bb-light-x')).toBe('');

    cleanup();
    splitControl.remove();
    delete document.documentElement.dataset.componentStyle;
    vi.restoreAllMocks();
  });

  it('lights standalone segmented surfaces', () => {
    document.documentElement.dataset.componentStyle = 'glass';
    const surface = document.createElement('button');
    surface.className = 'bb-segmented-surface-button';
    document.body.append(surface);

    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      bottom: 80,
      height: 80,
      left: 0,
      right: 80,
      top: 0,
      width: 80,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const cleanup = initComponentSurfaceLighting();
    surface.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 72, clientY: 8 }),
    );

    expect(surface.style.getPropertyValue('--bb-light-x')).toBe('90.0%');
    expect(surface.style.getPropertyValue('--bb-light-y')).toBe('10.0%');

    cleanup();
    surface.remove();
    delete document.documentElement.dataset.componentStyle;
    vi.restoreAllMocks();
  });
});
