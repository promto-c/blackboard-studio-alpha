import { describe, expect, it } from 'vitest';
import { PAINT_OVER_SHADER } from './paintShader';

describe('paint shader', () => {
  it('uses RGB stroke coverage and independent alpha-edit coverage', () => {
    expect(PAINT_OVER_SHADER).toContain('float alphaCoverage = alphaPaint.a;');
    expect(PAINT_OVER_SHADER).toContain('vec4 colorComposite = straight_over(paint, src);');
    expect(PAINT_OVER_SHADER).toContain(
      'colorComposite.a = mix(colorComposite.a, alphaPaint.r, alphaCoverage);',
    );
    expect(PAINT_OVER_SHADER).toContain('if (src.a <= 0.000001)');
    expect(PAINT_OVER_SHADER).not.toContain('float paintAlpha = texture(u_tPaintAlpha, v_uv).r;');
  });
});
