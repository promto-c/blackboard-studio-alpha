export const ChannelShader = {
  EXTRACT: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform int u_channel; // 0:R, 1:G, 2:B, 3:A
out vec4 fragColor;

void main() {
  vec4 src = texture(u_tDiffuse, v_uv);
  float ch = u_channel == 0 ? src.r : u_channel == 1 ? src.g : u_channel == 2 ? src.b : src.a;
  fragColor = vec4(ch, ch, ch, ch);
}
`,

  MERGE: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tR;
uniform sampler2D u_tG;
uniform sampler2D u_tB;
uniform sampler2D u_tA;
uniform int u_sourceChannelR;
uniform int u_sourceChannelG;
uniform int u_sourceChannelB;
uniform int u_sourceChannelA;
out vec4 fragColor;

float sampleChannel(sampler2D tex, int channel) {
  vec4 v = texture(tex, v_uv);
  return channel == 0 ? v.r : channel == 1 ? v.g : channel == 2 ? v.b : v.a;
}

void main() {
  float r = sampleChannel(u_tR, u_sourceChannelR);
  float g = sampleChannel(u_tG, u_sourceChannelG);
  float b = sampleChannel(u_tB, u_sourceChannelB);
  float a = sampleChannel(u_tA, u_sourceChannelA);
  fragColor = vec4(r, g, b, a);
}
`,
} as const;
