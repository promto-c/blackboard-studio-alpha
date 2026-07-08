import * as THREE from 'three';

export const STRAIGHT_ALPHA_OVER_GLSL = `
vec4 straight_over(vec4 src, vec4 dst) {
  src.a = clamp(src.a, 0.0, 1.0);
  dst.a = clamp(dst.a, 0.0, 1.0);
  if (src.a <= 0.000001) {
    return dst;
  }
  float inv_src_a = 1.0 - src.a;
  float out_a = src.a + dst.a * inv_src_a;
  vec3 weighted_rgb = src.rgb * src.a + dst.rgb * dst.a * inv_src_a;
  vec3 out_rgb = out_a > 0.000001 ? weighted_rgb / out_a : src.rgb;
  return vec4(out_rgb, out_a);
}
`;

export const configureStraightAlphaTexture = <T extends THREE.Texture>(texture: T): T => {
  texture.premultiplyAlpha = false;
  return texture;
};

export const configureRawStraightAlphaTexture = <T extends THREE.Texture>(
  texture: T,
  filter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
): T => {
  configureStraightAlphaTexture(texture);
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

export const sourceOverStraightAlphaPixel = (
  target: Float32Array,
  offset: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void => {
  if (alpha <= 0) return;
  const destinationAlpha = target[offset + 3];
  const outputAlpha = alpha + destinationAlpha * (1 - alpha);
  if (outputAlpha <= 0) {
    target[offset] = 0;
    target[offset + 1] = 0;
    target[offset + 2] = 0;
    target[offset + 3] = 0;
    return;
  }

  const destinationScale = destinationAlpha * (1 - alpha);
  target[offset] = (red * alpha + target[offset] * destinationScale) / outputAlpha;
  target[offset + 1] = (green * alpha + target[offset + 1] * destinationScale) / outputAlpha;
  target[offset + 2] = (blue * alpha + target[offset + 2] * destinationScale) / outputAlpha;
  target[offset + 3] = outputAlpha;
};

export const destinationOutStraightAlphaPixel = (
  target: Float32Array,
  offset: number,
  alpha: number,
): void => {
  target[offset + 3] *= 1 - alpha;
};
