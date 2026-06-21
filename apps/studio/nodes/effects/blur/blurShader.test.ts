import { describe, expect, it } from 'vitest';
import { BlurShader } from './blurShader';

describe('scene-data blur shaders', () => {
  it.each([
    ['gaussian', BlurShader.GAUSSIAN_H, BlurShader.GAUSSIAN_V],
    ['box', BlurShader.BOX_H, BlurShader.BOX_V],
    ['iterated box', BlurShader.ITERATED_BOX_H, BlurShader.ITERATED_BOX_V],
  ])('filters unassociated RGBA independently for %s blur', (_name, horizontal, vertical) => {
    expect(horizontal).toContain('texture(u_tDiffuse');
    expect(vertical).toContain('texture(u_tDiffuse');
    expect(horizontal).not.toContain('sample_color.rgb *= sample_color.a');
    expect(vertical).not.toContain('color.rgb /= color.a');
    expect(`${horizontal}\n${vertical}`).not.toContain('premultiplied');
  });
});
