/**
 * GLSL shaders for compare mode compositing.
 *
 * Wipe: Renders A on one side, B on the other, with a draggable divider.
 */

// ── Wipe Shader ────────────────────────────────────────────────
// Takes two input textures (u_tSlotA, u_tSlotB) and renders a wipe
// comparison. The divider position (u_divider: 0..1) controls where
// the split occurs. u_orientation: 0 = vertical, 1 = horizontal.

export const WIPE_VERTEX_SHADER = `
varying vec2 v_uv;

void main() {
  v_uv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export const WIPE_FRAGMENT_SHADER = `
varying vec2 v_uv;

uniform sampler2D u_tSlotA;
uniform sampler2D u_tSlotB;
uniform vec2 u_paneSize;
uniform vec2 u_slotATextureSize;
uniform vec2 u_slotBTextureSize;
uniform vec2 u_slotAFrameOrigin;
uniform vec2 u_slotAFrameSize;
uniform vec2 u_slotBFrameOrigin;
uniform vec2 u_slotBFrameSize;
uniform float u_divider;
uniform int u_orientation;   // 0 = vertical, 1 = horizontal
uniform int u_interpolation; // 0 = linear, 1 = nearest

vec2 getSamplingUv(vec2 contentUv, vec2 textureSize) {
  if (u_interpolation == 1) {
    vec2 safeTextureSize = max(textureSize, vec2(1.0));
    vec2 texel = clamp(
      floor(contentUv * safeTextureSize),
      vec2(0.0),
      safeTextureSize - vec2(1.0)
    );
    return (texel + vec2(0.5)) / safeTextureSize;
  }
  return contentUv;
}

vec4 samplePresentedTexture(
  sampler2D textureSampler,
  vec2 textureSize,
  vec2 frameOrigin,
  vec2 frameSize
) {
  vec2 contentUv = (v_uv * u_paneSize - frameOrigin) / frameSize;
  if (contentUv.x < 0.0 || contentUv.x > 1.0 || contentUv.y < 0.0 || contentUv.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(textureSampler, getSamplingUv(contentUv, textureSize));
}

void main() {
  vec4 colorA = samplePresentedTexture(
    u_tSlotA,
    u_slotATextureSize,
    u_slotAFrameOrigin,
    u_slotAFrameSize
  );
  vec4 colorB = samplePresentedTexture(
    u_tSlotB,
    u_slotBTextureSize,
    u_slotBFrameOrigin,
    u_slotBFrameSize
  );

  // For vertical  (orientation=0): pos = v_uv.x (0=left, 1=right)
  // For horizontal (orientation=1): pos = 1.0 - v_uv.y to match viewport
  //   coordinate convention (0=top, 1=bottom) — OpenGL UV has
  //   v_uv.y = 0 at the bottom, inverting the direction.
  float pos = (u_orientation == 0) ? v_uv.x : (1.0 - v_uv.y);
  bool showA = pos < u_divider;

  gl_FragColor = showA ? colorA : colorB;
}
`;

export const VIEWPORT_TEXTURE_VERTEX_SHADER = `
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

attribute vec3 position;
attribute vec2 uv;

varying vec2 v_uv;

void main() {
  v_uv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const VIEWPORT_TEXTURE_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_tDiffuse;
uniform vec2 u_textureSize;
uniform int u_interpolation; // 0 = linear, 1 = nearest

varying vec2 v_uv;

void main() {
  vec2 samplingUv = v_uv;
  if (u_interpolation == 1) {
    vec2 safeTextureSize = max(u_textureSize, vec2(1.0));
    vec2 texel = clamp(
      floor(v_uv * safeTextureSize),
      vec2(0.0),
      safeTextureSize - vec2(1.0)
    );
    samplingUv = (texel + vec2(0.5)) / safeTextureSize;
  }
  gl_FragColor = texture2D(u_tDiffuse, samplingUv);
}
`;
