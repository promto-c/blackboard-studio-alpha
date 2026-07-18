export const MASKED_MERGE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tSource;
uniform sampler2D u_tMask;
uniform bool u_hasMask;
uniform int u_maskChannel;
uniform int u_alphaOperation;
uniform float u_mix;
out vec4 fragColor;

float read_channel(vec4 value, int channel) {
  if (channel == 0) return value.r;
  if (channel == 1) return value.g;
  if (channel == 2) return value.b;
  return value.a;
}

float combine_alpha(float sourceAlpha, float maskAlpha) {
  if (u_alphaOperation == 1) return sourceAlpha + maskAlpha * (1.0 - sourceAlpha);
  if (u_alphaOperation == 2) return sourceAlpha * (1.0 - maskAlpha);
  if (u_alphaOperation == 3) return sourceAlpha * maskAlpha;
  return maskAlpha;
}

void main() {
  vec4 source = texture(u_tSource, v_uv);
  if (!u_hasMask) {
    fragColor = source;
    return;
  }

  float sourceAlpha = clamp(source.a, 0.0, 1.0);
  float maskAlpha = clamp(read_channel(texture(u_tMask, v_uv), u_maskChannel), 0.0, 1.0);
  float combinedAlpha = clamp(combine_alpha(sourceAlpha, maskAlpha), 0.0, 1.0);
  float outputAlpha = mix(sourceAlpha, combinedAlpha, clamp(u_mix, 0.0, 1.0));
  fragColor = vec4(source.rgb, outputAlpha);
}
`;
