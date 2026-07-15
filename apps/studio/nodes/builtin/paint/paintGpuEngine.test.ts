import { describe, expect, it } from 'vitest';
import { getPaintChannelMask, PAINT_STROKE_COMPOSITE_SHADER } from './paintGpuEngine';

describe('paintGpuEngine channel semantics', () => {
  it('keeps RGB and alpha channel selection independent', () => {
    expect(getPaintChannelMask('rgb').toArray()).toEqual([1, 1, 1, 0]);
    expect(getPaintChannelMask('r').toArray()).toEqual([1, 0, 0, 0]);
    expect(getPaintChannelMask('a').toArray()).toEqual([0, 0, 0, 1]);
  });

  it('does not alpha-cut RGB in the stroke compositor', () => {
    expect(PAINT_STROKE_COMPOSITE_SHADER).toContain(
      'mix(current, strokeValue, u_channels * coverage)',
    );
    expect(PAINT_STROKE_COMPOSITE_SHADER).not.toContain('straight_over');
    expect(PAINT_STROKE_COMPOSITE_SHADER).not.toMatch(/rgb\s*\*\s*[^;]*\.a/);
    expect(PAINT_STROKE_COMPOSITE_SHADER).not.toContain('clamp(strokeValue');
  });

  it('treats alpha clearing as an explicit alpha-channel erase', () => {
    expect(PAINT_STROKE_COMPOSITE_SHADER).toContain('vec4(inputValue.rgb, 0.0)');
  });
});
