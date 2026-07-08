import { describe, expect, it } from 'vitest';
import { getViewportBackgroundStyle } from './ViewportBackground';

describe('viewport background styles', () => {
  it('leaves the existing workspace background untouched for none', () => {
    expect(getViewportBackgroundStyle('none', [0, 0, 0])).toBeUndefined();
  });

  it('provides distinct transparency and alignment patterns', () => {
    const checkerboard = getViewportBackgroundStyle('checkerboard', [0, 0, 0]);
    const grid = getViewportBackgroundStyle('grid', [0, 0, 0]);

    expect(checkerboard?.backgroundImage).toContain('linear-gradient(45deg');
    expect(grid?.backgroundImage).toContain('linear-gradient(90deg');
    expect(checkerboard?.backgroundImage).not.toBe(grid?.backgroundImage);
  });

  it('converts normalized custom colors to CSS RGB', () => {
    expect(getViewportBackgroundStyle('custom', [0.2, 0.4, 0.6])).toEqual({
      backgroundColor: 'rgb(51 102 153)',
    });
  });
});
