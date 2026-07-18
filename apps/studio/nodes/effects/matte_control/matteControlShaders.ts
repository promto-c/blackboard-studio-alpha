export const MATTE_CONTROL_PREPARE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tSource;
out vec4 fragColor;

void main() {
  float matte = clamp(texture(u_tSource, v_uv).a, 0.0, 1.0);
  fragColor = vec4(matte);
}
`;

const createMorphologyShader = (axis: 'x' | 'y') => `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tMatte;
uniform float u_radius;
uniform float u_resolution;
uniform int u_sampleLimit;
out vec4 fragColor;

void main() {
  float matte = texture(u_tMatte, v_uv).r;
  int radius = int(round(min(abs(u_radius), 32.0)));
  int sampleCount = min(radius, max(u_sampleLimit, 1));
  vec2 texel = ${axis === 'x' ? 'vec2(1.0 / max(u_resolution, 1.0), 0.0)' : 'vec2(0.0, 1.0 / max(u_resolution, 1.0))'};

  for (int i = 1; i <= 32; i++) {
    if (i > sampleCount) break;
    float distance = float(i) * float(radius) / float(max(sampleCount, 1));
    vec2 offset = texel * distance;
    float negativeSample = texture(u_tMatte, clamp(v_uv - offset, vec2(0.0), vec2(1.0))).r;
    float positiveSample = texture(u_tMatte, clamp(v_uv + offset, vec2(0.0), vec2(1.0))).r;
    if (u_radius > 0.0) {
      matte = max(matte, max(negativeSample, positiveSample));
    } else {
      matte = min(matte, min(negativeSample, positiveSample));
    }
  }

  fragColor = vec4(matte);
}
`;

const createEdgeBlurShader = (axis: 'x' | 'y') => `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tMatte;
uniform float u_radius;
uniform float u_resolution;
uniform int u_sampleLimit;
out vec4 fragColor;

void main() {
  float sigma = u_radius * 0.5;
  if (sigma < 0.125) {
    float matte = texture(u_tMatte, v_uv).r;
    fragColor = vec4(matte);
    return;
  }

  vec2 texel = ${axis === 'x' ? 'vec2(1.0 / max(u_resolution, 1.0), 0.0)' : 'vec2(0.0, 1.0 / max(u_resolution, 1.0))'};
  int sampleRadius = int(ceil(min(sigma * 3.0, 96.0)));
  int sampleCount = min(sampleRadius, max(u_sampleLimit, 1));
  float inverseTwoSigmaSquared = 1.0 / (2.0 * sigma * sigma);
  float weightedMatte = texture(u_tMatte, v_uv).r;
  float totalWeight = 1.0;

  for (int i = 1; i <= 96; i++) {
    if (i > sampleCount) break;
    float distance = float(i) * float(sampleRadius) / float(max(sampleCount, 1));
    float weight = exp(-(distance * distance) * inverseTwoSigmaSquared);
    vec2 offset = texel * distance;
    weightedMatte += texture(u_tMatte, clamp(v_uv - offset, vec2(0.0), vec2(1.0))).r * weight;
    weightedMatte += texture(u_tMatte, clamp(v_uv + offset, vec2(0.0), vec2(1.0))).r * weight;
    totalWeight += 2.0 * weight;
  }

  fragColor = vec4(weightedMatte / totalWeight);
}
`;

export const MATTE_CONTROL_MORPH_HORIZONTAL_SHADER = createMorphologyShader('x');
export const MATTE_CONTROL_MORPH_VERTICAL_SHADER = createMorphologyShader('y');
export const MATTE_CONTROL_BLUR_HORIZONTAL_SHADER = createEdgeBlurShader('x');
export const MATTE_CONTROL_BLUR_VERTICAL_SHADER = createEdgeBlurShader('y');

/** Exact single-pass path when morphology and edge blur are disabled. */
export const MATTE_CONTROL_DIRECT_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tSource;
uniform float u_clampBlack;
uniform float u_clampWhite;
uniform bool u_invert;
out vec4 fragColor;

void main() {
  vec4 source = texture(u_tSource, v_uv);
  float matte = clamp(source.a, 0.0, 1.0);
  float range = max(u_clampWhite - u_clampBlack, 0.000001);
  matte = clamp((matte - u_clampBlack) / range, 0.0, 1.0);
  if (u_invert) matte = 1.0 - matte;

  fragColor = vec4(source.rgb, matte);
}
`;

export const MATTE_CONTROL_FINAL_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tSource;
uniform sampler2D u_tMatte;
uniform float u_clampBlack;
uniform float u_clampWhite;
uniform bool u_invert;
out vec4 fragColor;

void main() {
  vec4 source = texture(u_tSource, v_uv);
  float matte = texture(u_tMatte, v_uv).r;
  float range = max(u_clampWhite - u_clampBlack, 0.000001);
  matte = clamp((matte - u_clampBlack) / range, 0.0, 1.0);
  if (u_invert) matte = 1.0 - matte;

  fragColor = vec4(source.rgb, matte);
}
`;

export const MATTE_CONTROL_SHADER_SOURCE = [
  '// Prepare alpha',
  MATTE_CONTROL_PREPARE_SHADER,
  '// Direct single-pass output',
  MATTE_CONTROL_DIRECT_SHADER,
  '// Horizontal morphology',
  MATTE_CONTROL_MORPH_HORIZONTAL_SHADER,
  '// Vertical morphology',
  MATTE_CONTROL_MORPH_VERTICAL_SHADER,
  '// Horizontal edge blur',
  MATTE_CONTROL_BLUR_HORIZONTAL_SHADER,
  '// Vertical edge blur',
  MATTE_CONTROL_BLUR_VERTICAL_SHADER,
  '// Clamp / invert / output',
  MATTE_CONTROL_FINAL_SHADER,
].join('\n\n');
