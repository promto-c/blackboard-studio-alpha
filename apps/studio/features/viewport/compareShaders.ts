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
uniform float u_divider;
uniform int u_orientation;   // 0 = vertical, 1 = horizontal

void main() {
  vec4 colorA = texture2D(u_tSlotA, v_uv);
  vec4 colorB = texture2D(u_tSlotB, v_uv);

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

varying vec2 v_uv;

void main() {
  gl_FragColor = texture2D(u_tDiffuse, v_uv);
}
`;
