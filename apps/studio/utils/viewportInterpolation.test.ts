import { describe, expect, it } from 'vitest';
import { getViewportImageRendering } from './viewportInterpolation';

describe('viewport interpolation', () => {
  it('maps the preference to explicit browser canvas sampling', () => {
    expect(getViewportImageRendering('nearest')).toBe('pixelated');
    expect(getViewportImageRendering('linear')).toBe('auto');
  });
});
