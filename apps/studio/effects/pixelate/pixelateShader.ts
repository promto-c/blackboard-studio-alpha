export const PIXELATE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;

uniform float u_pixelSize; // {"label": "Block Count", "min": 2.0, "max": 512.0, "step": 1.0, "value": 64.0}
uniform int u_colorCount; // {"label": "Color Count", "min": 2, "max": 256, "step": 1, "value": 16}
out vec4 fragColor;

void main() {
    // Pixelation effect
    vec2 uv_pixelated = floor(v_uv * u_pixelSize) / u_pixelSize;
    vec4 color = texture(u_tDiffuse, uv_pixelated);

    // Limited color palette (quantization)
    color.r = floor(color.r * float(u_colorCount - 1) + 0.5) / float(u_colorCount - 1);
    color.g = floor(color.g * float(u_colorCount - 1) + 0.5) / float(u_colorCount - 1);
    color.b = floor(color.b * float(u_colorCount - 1) + 0.5) / float(u_colorCount - 1);

    fragColor = color;
}
`;
