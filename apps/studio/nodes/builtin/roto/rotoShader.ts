export const ROTO_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tMask;
uniform int u_alphaMode;
uniform bool u_invert;
out vec4 fragColor;

void main() {
  float mask = texture(u_tMask, v_uv).r;
  float combinedMask = u_invert ? 1.0 - mask : mask;
  vec4 src = texture(u_tDiffuse, v_uv);
  if (u_alphaMode == 0) {
    fragColor = vec4(src.rgb, src.a * combinedMask);
  } else if (u_alphaMode == 1) {
    fragColor = vec4(src.rgb, combinedMask);
  } else {
    fragColor = vec4(src.rgb, combinedMask + src.a * (1.0 - combinedMask));
  }
}
`;
