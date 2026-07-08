import { ACESCG_LUMINANCE_GLSL, SIGNED_POWER_GLSL } from '@/color-management/effectColorMath';

export const GRADE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_contrastPivot;
uniform float u_saturation;
uniform vec3 u_lift;
uniform vec3 u_gamma;
uniform vec3 u_gain;
uniform vec3 u_cdlSlope;
uniform vec3 u_cdlOffset;
uniform vec3 u_cdlPower;
uniform float u_cdlSaturation;
uniform int u_outOfGamutMode;
out vec4 fragColor;

${ACESCG_LUMINANCE_GLSL}
${SIGNED_POWER_GLSL}

void main() {
  vec4 tex = texture(u_tDiffuse, v_uv);

  vec3 color = tex.rgb * exp2(u_exposure);
  float pivot = max(u_contrastPivot, 0.000001);
  color = pivot * signed_power(color / pivot, vec3(u_contrast));
  color = signed_power((color + u_lift) * u_gain, 1.0 / max(u_gamma, vec3(0.0001)));

  color = signed_power(color * u_cdlSlope + u_cdlOffset, max(u_cdlPower, vec3(0.0001)));
  float cdlLuma = acescg_luminance(color);
  color = mix(vec3(cdlLuma), color, u_cdlSaturation);

  float luma = acescg_luminance(color);
  color = mix(vec3(luma), color, u_saturation);
  if (u_outOfGamutMode == 1) {
    color = max(color, vec3(0.0));
  }

  fragColor = vec4(color, tex.a);
}
`;
