export const ROTO_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tMask;
uniform sampler2D u_tAddMask;
uniform sampler2D u_tSubMask;
uniform int u_alphaMode;
out vec4 fragColor;

void main() {
  float mask = texture(u_tMask, v_uv).r;
  float addMask = texture(u_tAddMask, v_uv).r;
  float subMask = texture(u_tSubMask, v_uv).r;
  float combinedMask = clamp(mask + addMask - subMask, 0.0, 1.0);
  vec4 src = texture(u_tDiffuse, v_uv);
  if (u_alphaMode == 0) {
    // Premultiplied: src.rgb *= mask
    fragColor = vec4(src.rgb * combinedMask, src.a * combinedMask);
  } else {
    // Straight: replace alpha only, keep RGB
    fragColor = vec4(src.rgb, src.a * combinedMask);
  }
}
`;
