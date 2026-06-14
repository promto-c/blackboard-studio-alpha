// We support up to 64 pins for the warp effect
export const WARP_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
out vec4 fragColor;

#define MAX_PINS 64

uniform vec2 u_pinPositions[MAX_PINS]; // Original UV positions
uniform vec2 u_pinDeltas[MAX_PINS];    // Movement delta
uniform int u_pinCount;
uniform float u_radius;                // Influence radius (normalized 0-1)
uniform float u_strength;

void main() {
    vec2 displacement = vec2(0.0);
    float totalWeight = 0.0;
    
    // In warp, we want to know: "Which source pixel should allow color for current UV?"
    // Current UV - Displacement = Source UV.
    
    for (int i = 0; i < MAX_PINS; i++) {
        if (i >= u_pinCount) break;
        
        // Distance from current pixel to the original pin position
        // Ideally we track the deformed mesh, but simplified Shepard's method uses original distance
        float dist = distance(v_uv, u_pinPositions[i]);
        
        // Gaussian-like falloff
        float influence = max(0.0, 1.0 - (dist / u_radius));
        influence = smoothstep(0.0, 1.0, influence);
        influence = pow(influence, 2.0); // Sharpen curve
        
        displacement += u_pinDeltas[i] * influence;
    }
    
    // Apply displacement
    vec2 distortedUV = v_uv - (displacement * u_strength);
    
    fragColor = texture(u_tDiffuse, distortedUV);
}
`;
