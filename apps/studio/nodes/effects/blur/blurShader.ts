// Adaptive separable Gaussian blur.
// Samples at 1-pixel intervals covering ±3 sigma.
// Blurs all 4 channels (RGBA). Uses clamp-to-edge wrapping.
// sigma = radius / 2, coverage = ±3 sigma.
// For large radii the sample count grows naturally.

export const BlurShader = {
  GAUSSIAN_H: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_x;
out vec4 fragColor;

void main() {
    float sigma = u_radius / 2.0;
    if (sigma < 0.5) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(1.0 / u_resolution_x, 0.0);
    int radius_texels = int(ceil(sigma * 3.0));

    float total = 0.0;
    vec4 sum = vec4(0.0);

    float norm = 1.0 / (sqrt(2.0 * 3.14159265) * sigma);
    float inv_two_sigma_sq = 1.0 / (2.0 * sigma * sigma);

    // Center sample
    sum += texture(u_tDiffuse, v_uv) * norm;
    total += norm;

    // Symmetric samples at 1-pixel intervals
    for (int i = 1; i <= 256; i++) {
        if (i > radius_texels) break;
        float d = float(i);
        float w = exp(-(d * d) * inv_two_sigma_sq) * norm;
        vec2 offset = vec2(d * texel_size.x, 0.0);
        sum += texture(u_tDiffuse, v_uv + offset) * w;
        sum += texture(u_tDiffuse, v_uv - offset) * w;
        total += 2.0 * w;
    }

    fragColor = sum / total;
}
`,
  GAUSSIAN_V: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_y;
out vec4 fragColor;

void main() {
    float sigma = u_radius / 2.0;
    if (sigma < 0.5) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(0.0, 1.0 / u_resolution_y);
    int radius_texels = int(ceil(sigma * 3.0));

    float total = 0.0;
    vec4 sum = vec4(0.0);

    float norm = 1.0 / (sqrt(2.0 * 3.14159265) * sigma);
    float inv_two_sigma_sq = 1.0 / (2.0 * sigma * sigma);

    // Center sample
    sum += texture(u_tDiffuse, v_uv) * norm;
    total += norm;

    // Symmetric samples at 1-pixel intervals
    for (int i = 1; i <= 256; i++) {
        if (i > radius_texels) break;
        float d = float(i);
        float w = exp(-(d * d) * inv_two_sigma_sq) * norm;
        vec2 offset = vec2(0.0, d * texel_size.y);
        sum += texture(u_tDiffuse, v_uv + offset) * w;
        sum += texture(u_tDiffuse, v_uv - offset) * w;
        total += 2.0 * w;
    }

    fragColor = sum / total;
}
`,
  BOX_H: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_x;
out vec4 fragColor;

void main() {
    float r = floor(u_radius);
    if (r <= 0.0) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }
    
    vec2 texel_size = vec2(1.0 / u_resolution_x, 0.0);
    vec4 result = vec4(0.0);
    float count = 0.0;
    
    for (float i = -r; i <= r; i++) {
        result += texture(u_tDiffuse, v_uv + texel_size * i);
        count += 1.0;
    }
    
    fragColor = result / count;
}
`,
  BOX_V: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_y;
out vec4 fragColor;

void main() {
    float r = floor(u_radius);
    if (r <= 0.0) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(0.0, 1.0 / u_resolution_y);
    vec4 result = vec4(0.0);
    float count = 0.0;
    
    for (float i = -r; i <= r; i++) {
        result += texture(u_tDiffuse, v_uv + texel_size * i);
        count += 1.0;
    }
    
    fragColor = result / count;
}
`,

  // 3x iterated box blur — composed kernel from convolving 3 identical box blurs.
  // The resulting kernel is piecewise quadratic covering [-3r, 3r], closely
  // approximating a Gaussian. Weights computed via inclusion-exclusion.
  ITERATED_BOX_H: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_x;
out vec4 fragColor;

void main() {
    float r = floor(u_radius);
    if (r <= 0.0) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(1.0 / u_resolution_x, 0.0);
    int R = int(r);
    float norm = float((2 * R + 1) * (2 * R + 1) * (2 * R + 1));
    vec4 result = vec4(0.0);

    for (int i = -192; i <= 192; i++) {
        if (i > 3 * R || i < -3 * R) continue;
        int a = abs(i);
        int n1 = a + 3 * R + 2;
        int n2 = a + R + 1;
        int n3 = a - R;

        float w = float(n1 * (n1 - 1)) / 2.0;
        w -= 3.0 * float(n2 * (n2 - 1)) / 2.0;
        if (n3 >= 2) {
            w += 3.0 * float(n3 * (n3 - 1)) / 2.0;
        }

        result += texture(u_tDiffuse, v_uv + texel_size * float(i)) * w;
    }

    fragColor = result / norm;
}
`,
  ITERATED_BOX_V: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_y;
out vec4 fragColor;

void main() {
    float r = floor(u_radius);
    if (r <= 0.0) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(0.0, 1.0 / u_resolution_y);
    int R = int(r);
    float norm = float((2 * R + 1) * (2 * R + 1) * (2 * R + 1));
    vec4 result = vec4(0.0);

    for (int i = -192; i <= 192; i++) {
        if (i > 3 * R || i < -3 * R) continue;
        int a = abs(i);
        int n1 = a + 3 * R + 2;
        int n2 = a + R + 1;
        int n3 = a - R;

        float w = float(n1 * (n1 - 1)) / 2.0;
        w -= 3.0 * float(n2 * (n2 - 1)) / 2.0;
        if (n3 >= 2) {
            w += 3.0 * float(n3 * (n3 - 1)) / 2.0;
        }

        result += texture(u_tDiffuse, v_uv + texel_size * float(i)) * w;
    }

    fragColor = result / norm;
}
`,
} as const;
