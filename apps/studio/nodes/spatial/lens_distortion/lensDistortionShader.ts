export const LENS_DISTORTION_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;

uniform float u_k1; // {"label": "K1 (Barrel/Pincushion)", "min": -0.5, "max": 0.5, "step": 0.001, "value": 0.0}
uniform float u_k2; // {"label": "K2 (Higher Order)", "min": -0.2, "max": 0.2, "step": 0.001, "value": 0.0}
uniform float u_k3; // {"label": "K3 (Higher Order)", "min": -0.1, "max": 0.1, "step": 0.001, "value": 0.0}
uniform float u_strength; // {"label": "Overall Strength", "min": 0.0, "max": 2.0, "step": 0.01, "value": 1.0}
uniform vec2 u_center; // {"label": ["Center X", "Center Y"], "min": 0.0, "max": 1.0, "step": 0.01, "value": [0.5, 0.5]}
out vec4 fragColor;

void main() {
    vec2 p = (v_uv - u_center) * 2.0;

    float r2 = dot(p, p);

    float distortion_amount = u_k1 * r2 + u_k2 * r2 * r2 + u_k3 * r2 * r2 * r2;
    float f = 1.0 + u_strength * distortion_amount;

    vec2 corrected_p = p / max(0.0001, f);

    vec2 uv_to_sample = corrected_p * 0.5 + u_center;

    fragColor = texture(u_tDiffuse, uv_to_sample);
}
`;
