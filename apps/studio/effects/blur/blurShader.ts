export const BLUR_H_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_x;
out vec4 fragColor;

void main() {
    if (u_radius < 0.1) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(1.0 / u_resolution_x, 0.0);
    vec4 sum = vec4(0.0);
    
    float sigma = u_radius / 2.0;
    float two_sigma_sq = 2.0 * sigma * sigma;
    float spread = u_radius / 4.0;
    
    // Unrolled loop for 9 samples with dynamic weights
    float w0 = 1.0;
    float d1 = 1.0 * spread; float w1 = exp(-(d1 * d1) / two_sigma_sq);
    float d2 = 2.0 * spread; float w2 = exp(-(d2 * d2) / two_sigma_sq);
    float d3 = 3.0 * spread; float w3 = exp(-(d3 * d3) / two_sigma_sq);
    float d4 = 4.0 * spread; float w4 = exp(-(d4 * d4) / two_sigma_sq);
    
    float total_weight = w0 + 2.0 * (w1 + w2 + w3 + w4);

    sum += texture(u_tDiffuse, v_uv - d4 * texel_size) * w4;
    sum += texture(u_tDiffuse, v_uv - d3 * texel_size) * w3;
    sum += texture(u_tDiffuse, v_uv - d2 * texel_size) * w2;
    sum += texture(u_tDiffuse, v_uv - d1 * texel_size) * w1;
    sum += texture(u_tDiffuse, v_uv) * w0;
    sum += texture(u_tDiffuse, v_uv + d1 * texel_size) * w1;
    sum += texture(u_tDiffuse, v_uv + d2 * texel_size) * w2;
    sum += texture(u_tDiffuse, v_uv + d3 * texel_size) * w3;
    sum += texture(u_tDiffuse, v_uv + d4 * texel_size) * w4;
    
    fragColor = vec4(sum.rgb / total_weight, texture(u_tDiffuse, v_uv).a);
}
`;

export const BLUR_V_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_radius;
uniform float u_resolution_y;
out vec4 fragColor;

void main() {
    if (u_radius < 0.1) {
        fragColor = texture(u_tDiffuse, v_uv);
        return;
    }

    vec2 texel_size = vec2(0.0, 1.0 / u_resolution_y);
    vec4 sum = vec4(0.0);
    
    float sigma = u_radius / 2.0;
    float two_sigma_sq = 2.0 * sigma * sigma;
    float spread = u_radius / 4.0;
    
    // Unrolled loop for 9 samples with dynamic weights
    float w0 = 1.0;
    float d1 = 1.0 * spread; float w1 = exp(-(d1 * d1) / two_sigma_sq);
    float d2 = 2.0 * spread; float w2 = exp(-(d2 * d2) / two_sigma_sq);
    float d3 = 3.0 * spread; float w3 = exp(-(d3 * d3) / two_sigma_sq);
    float d4 = 4.0 * spread; float w4 = exp(-(d4 * d4) / two_sigma_sq);
    
    float total_weight = w0 + 2.0 * (w1 + w2 + w3 + w4);

    sum += texture(u_tDiffuse, v_uv - d4 * texel_size) * w4;
    sum += texture(u_tDiffuse, v_uv - d3 * texel_size) * w3;
    sum += texture(u_tDiffuse, v_uv - d2 * texel_size) * w2;
    sum += texture(u_tDiffuse, v_uv - d1 * texel_size) * w1;
    sum += texture(u_tDiffuse, v_uv) * w0;
    sum += texture(u_tDiffuse, v_uv + d1 * texel_size) * w1;
    sum += texture(u_tDiffuse, v_uv + d2 * texel_size) * w2;
    sum += texture(u_tDiffuse, v_uv + d3 * texel_size) * w3;
    sum += texture(u_tDiffuse, v_uv + d4 * texel_size) * w4;
    
    fragColor = vec4(sum.rgb / total_weight, texture(u_tDiffuse, v_uv).a);
}
`;

export const BOX_BLUR_H_SHADER = `
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
    vec3 result = vec3(0.0);
    float kernel_size = r * 2.0 + 1.0;
    
    for (float i = -r; i <= r; i++) {
        result += texture(u_tDiffuse, v_uv + texel_size * i).rgb;
    }
    
    fragColor = vec4(result / kernel_size, texture(u_tDiffuse, v_uv).a);
}
`;

export const BOX_BLUR_V_SHADER = `
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
    vec3 result = vec3(0.0);
    float kernel_size = r * 2.0 + 1.0;
    
    for (float i = -r; i <= r; i++) {
        result += texture(u_tDiffuse, v_uv + texel_size * i).rgb;
    }
    
    fragColor = vec4(result / kernel_size, texture(u_tDiffuse, v_uv).a);
}
`;
