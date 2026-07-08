export const ACESCG_LUMINANCE_COEFFICIENTS = [0.2722287168, 0.6740817658, 0.0536895174] as const;

export const getAcesCgLuminance = (color: readonly [number, number, number, ...number[]]): number =>
  color[0] * ACESCG_LUMINANCE_COEFFICIENTS[0] +
  color[1] * ACESCG_LUMINANCE_COEFFICIENTS[1] +
  color[2] * ACESCG_LUMINANCE_COEFFICIENTS[2];

export const ACESCG_LUMINANCE_GLSL = `
const vec3 ACESCG_LUMINANCE_WEIGHTS = vec3(
  0.2722287168,
  0.6740817658,
  0.0536895174
);

float acescg_luminance(vec3 color) {
  return dot(color, ACESCG_LUMINANCE_WEIGHTS);
}
`;

export const SIGNED_POWER_GLSL = `
vec3 signed_power(vec3 color, float exponent) {
  return sign(color) * pow(abs(color), vec3(exponent));
}

vec3 signed_power(vec3 color, vec3 exponent) {
  return sign(color) * pow(abs(color), exponent);
}
`;
