export const LIQUID_GLASS_SHADER = `
/*
 * Liquid Glass Refraction Effect
 */
precision highp float;

uniform sampler2D u_tDiffuse;
uniform float u_ior; // {"label":"IOR", "min": 1.0, "max": 2.0, "step": 0.01, "value": 1.33}
uniform float u_turbulence; // {"label":"Turbulence", "min": 0.0, "max": 0.1, "step": 0.001, "value": 0.01}
uniform float u_scale; // {"label":"Scale", "min": 1.0, "max": 20.0, "step": 0.1, "value": 5.0}
uniform float u_chroma; // {"label":"Chromatic Aberration", "min": 0.0, "max": 0.1, "step": 0.001, "value": 0.01}
uniform float u_phase; // {"label":"Phase", "min": 0.0, "max": 10.0, "step": 0.01, "value": 0.0}

in vec2 v_uv;
out vec4 fragColor;

// 2D Simplex Noise
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
    float noise = snoise(v_uv * u_scale + u_phase) * u_turbulence;
    vec2 d = vec2(0.001, 0.0);
    float noise_x = snoise((v_uv + d.xy) * u_scale + u_phase) * u_turbulence;
    float noise_y = snoise((v_uv + d.yx) * u_scale + u_phase) * u_turbulence;
    
    // Using the noise gradient to simulate a normal map for refraction
    vec3 normal = normalize(vec3(noise_x - noise, noise_y - noise, 0.1));
    vec3 viewDir = vec3(0.0, 0.0, -1.0);
    vec3 refracted = refract(viewDir, normal, 1.0 / u_ior);
    vec2 offset = refracted.xy;

    // Apply chromatic aberration
    float r = texture(u_tDiffuse, v_uv + offset * (1.0 + u_chroma)).r;
    float g = texture(u_tDiffuse, v_uv + offset).g;
    float b = texture(u_tDiffuse, v_uv + offset * (1.0 - u_chroma)).b;
    float a = texture(u_tDiffuse, v_uv + offset).a;
    
    fragColor = vec4(r, g, b, a);
}
`;
