const createAlphaMathShader = (rgbOperation: string) => `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
out vec4 fragColor;

void main() {
  vec4 source = texture(u_tDiffuse, v_uv);
  ${rgbOperation}
  fragColor = source;
}
`;

/**
 * Avoid amplifying floating-point noise when an associated image contains
 * effectively zero alpha. Alpha itself is always preserved.
 */
export const UNPREMULTIPLY_ALPHA_EPSILON = 1e-6;

export const AlphaMathShader = {
  PREMULTIPLY: createAlphaMathShader('source.rgb *= source.a;'),
  UNPREMULTIPLY: createAlphaMathShader(
    `source.rgb = abs(source.a) > ${UNPREMULTIPLY_ALPHA_EPSILON} ? source.rgb / source.a : vec3(0.0);`,
  ),
} as const;
