import { describe, expect, it } from 'vitest';
import { BOKEH_BLUR_SHADER } from './bokeh/bokehShader';
import { CHROMA_KEY_SHADER } from './chroma_key/chromaKeyShader';

describe('scene-linear effect shader color math', () => {
  it.each([
    ['bokeh', BOKEH_BLUR_SHADER],
    ['chroma key', CHROMA_KEY_SHADER],
  ])('uses ACEScg luminance for %s', (_name, shader) => {
    expect(shader).toContain('acescg_luminance');
    expect(shader).not.toContain('vec3(0.2126, 0.7152, 0.0722)');
  });
});
