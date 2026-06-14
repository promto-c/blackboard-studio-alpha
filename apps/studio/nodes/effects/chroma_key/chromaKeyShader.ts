export const CHROMA_KEY_SHADER = `
precision highp float;

uniform sampler2D u_tDiffuse;
uniform vec3 u_keyColor; // {"label": "Key Color", "type": "color", "value": [0.0, 1.0, 0.0]}
uniform float u_similarity; // {"label": "Similarity", "min": 0.0, "max": 1.0, "step": 0.001, "value": 0.4}
uniform float u_smoothness; // {"label": "Smoothness", "min": 0.0, "max": 1.0, "step": 0.001, "value": 0.08}
uniform float u_spill; // {"label": "Spill Suppression", "min": 0.0, "max": 1.0, "step": 0.01, "value": 0.1}

in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec4 tex = texture(u_tDiffuse, v_uv);
    
    float dist = distance(tex.rgb, u_keyColor);
    
    float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, dist);
    
    // Simple spill suppression: desaturate if close to key color
    float spillVal = 1.0 - smoothstep(u_similarity, u_similarity + 0.2, dist);
    float gray = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
    
    // Blend towards gray based on spill amount
    tex.rgb = mix(tex.rgb, vec3(gray), spillVal * u_spill);
    
    fragColor = vec4(tex.rgb, tex.a * alpha);
}
`;
