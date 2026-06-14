export const PAINT_OVER_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tPaint;
uniform sampler2D u_tPaintAlpha;
uniform int u_input_transform; // 0: sRGB -> Linear, 1: No-op, 2: Linear -> sRGB
out vec4 fragColor;

void main() {
  vec4 src = texture(u_tDiffuse, v_uv);
  vec4 paint = texture(u_tPaint, v_uv);
  float paintAlpha = texture(u_tPaintAlpha, v_uv).r;
  // Blend paint over source using paintAlpha
  vec3 blended = mix(src.rgb, paint.rgb, paintAlpha);
  float outAlpha = src.a * (1.0 - paintAlpha) + paintAlpha;
  fragColor = vec4(blended, outAlpha);
}
`;
