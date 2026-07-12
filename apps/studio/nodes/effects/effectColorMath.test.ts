import { describe, expect, it } from 'vitest';
import { BOKEH_BLUR_SHADER } from './bokeh/bokehShader';
import { KEYER_SHADER } from './keyer/keyerShader';

describe('scene-linear effect shader color math', () => {
  it.each([
    ['bokeh', BOKEH_BLUR_SHADER],
    ['keyer', KEYER_SHADER],
  ])('uses ACEScg luminance for %s', (_name, shader) => {
    expect(shader).toContain('acescg_luminance');
    expect(shader).not.toContain('vec3(0.2126, 0.7152, 0.0722)');
  });
});
