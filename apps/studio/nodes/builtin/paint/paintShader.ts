import { STRAIGHT_ALPHA_OVER_GLSL } from '@blackboard/renderer';

export const PAINT_OVER_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tPaint;
uniform sampler2D u_tPaintAlpha;
out vec4 fragColor;

${STRAIGHT_ALPHA_OVER_GLSL}

void main() {
  vec4 src = texture(u_tDiffuse, v_uv);
  vec4 paint = texture(u_tPaint, v_uv);
  vec4 alphaPaint = texture(u_tPaintAlpha, v_uv);
  float alphaCoverage = alphaPaint.a;
  vec4 colorComposite = straight_over(paint, src);
  colorComposite.a = mix(colorComposite.a, alphaPaint.r, alphaCoverage);
  fragColor = colorComposite;
}
`;
