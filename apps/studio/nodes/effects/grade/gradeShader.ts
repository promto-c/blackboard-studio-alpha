export const GRADE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gain;
uniform float u_gamma;
out vec4 fragColor;

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 tex = texture(u_tDiffuse, v_uv);
  
  // Brightness
  vec3 color = tex.rgb + u_brightness;
  
  // Contrast
  color = (color - 0.5) * u_contrast + 0.5;
  
  // Saturation
  float luma_val = luminance(color);
  color = mix(vec3(luma_val), color, u_saturation);

  // Gain / Gamma
  color = max(color * u_gain, vec3(0.0));
  color = pow(color, vec3(1.0 / max(u_gamma, 0.0001)));

  fragColor = vec4(color, tex.a);
}
`;
