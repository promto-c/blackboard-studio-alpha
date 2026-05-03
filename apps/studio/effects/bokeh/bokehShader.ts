/*
 * Advanced Lens Bokeh
 */
export const BOKEH_BLUR_SHADER = `
precision highp float;

uniform sampler2D u_tDiffuse;
uniform sampler2D u_tDepth;

// --- Procedural Depth ---
uniform int u_depthSource; // 0:Uniform, 1:Luminance, 2:Radial, 3:LinearH, 4:LinearV, 5:Node
uniform bool u_depthInvert;
uniform float u_depthContrast; // {"label":"Depth Contrast","min":0.1,"max":5.0,"step":0.01,"value":1.0}
uniform float u_depthBias; // {"label":"Depth Bias","min":-1.0,"max":1.0,"step":0.01,"value":0.0}
uniform bool u_previewDepth;

// --- Resolution ---
uniform vec2 u_resolution;

// --- Focus / Depth of Field ---
uniform float u_focusDepth;  // {"label":"Focus Position","min":0.0,"max":1.0,"step":0.001,"value":0.5}
uniform float u_focusWidth;  // {"label":"Focus Width (Range)","min":0.0,"max":1.0,"step":0.001,"value":0.1}
uniform float u_maxCoC;      // {"label":"Max Blur Size","min":0.0,"max":100.0,"step":1.0,"value":20.0}

// --- Shape Controls ---
uniform int u_shapeType;     // {"label":"Shape","min":0,"max":5,"step":1,"value":0} 
// 0:Circle, 1:Hexagon, 2:Octagon, 3:Star, 4:Heart, 5:Ring
uniform int u_starPoints;    // {"label":"Star Points","min":3,"max":8,"step":1,"value":5}
uniform float u_roundness;   // {"label":"Roundness","min":0.01,"max":1.0,"step":0.01,"value":0.5}
uniform float u_anamorphic;  // {"label":"Anamorphic Ratio","min":0.2,"max":4.0,"step":0.01,"value":1.0}

// --- Vintage Characteristics ---
uniform float u_swirl;       // {"label":"Swirl Intensity","min":-5.0,"max":5.0,"step":0.01,"value":0.0}
uniform float u_catEye;      // {"label":"Cat Eye (Radial Squash)","min":0.0,"max":1.0,"step":0.01,"value":0.0}

// --- Appearance ---
uniform float u_threshold;   // {"label":"Highlight Threshold","min":0.0,"max":1.0,"step":0.01,"value":0.7}
uniform float u_gain;        // {"label":"Highlight Gain","min":0.0,"max":10.0,"step":0.1,"value":2.0}
uniform float u_chroma;      // {"label":"Aberration","min":0.0,"max":0.5,"step":0.001,"value":0.05}
uniform int u_samples;       // {"label":"Quality (Samples)","min":10,"max":128,"step":1,"value":32}

in vec2 v_uv;
out vec4 fragColor;

#define PI 3.14159265359
#define PI2 6.28318530718
#define MAX_SAMPLES 128

// --- SDF Shapes ---

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdNgon(vec2 p, float r, int n) {
    float k = PI2 / float(n);
    float a = atan(p.y, p.x);
    float l = length(p);
    return l * cos(floor(0.5 + a / k) * k - a) - r;
}

float sdStar(vec2 p, float r, int n, float inner_ratio) {
    float angle = atan(p.y, p.x);
    float len = length(p);
    float k = PI / float(n);
    angle = mod(angle, 2.0 * k);
    if (angle > k) angle -= 2.0 * k;
    p = vec2(cos(angle), sin(angle)) * len;
    vec2 p1 = vec2(r, 0.0);
    vec2 p2 = vec2(r * inner_ratio * cos(k), r * inner_ratio * sin(k));
    vec2 v = p2 - p1;
    vec2 w = p - p1;
    float t = clamp(dot(w, v) / dot(v, v), 0.0, 1.0);
    vec2 d = w - t * v;
    return length(d);
}

float sdHeart(vec2 p, float r) {
    p.y += r * 0.5;
    p.x = abs(p.x);
    if (p.y + p.x > r)
        return sqrt(dot(p - vec2(0.25, 0.75)*r*2.0, p - vec2(0.25, 0.75)*r*2.0)) - r*sqrt(2.0)/4.0;
    return sqrt(dot(p - vec2(0.0, r), p - vec2(0.0, r))) - r;
}

float get_shape_sdf(vec2 p, int type, float r) {
    p.x /= u_anamorphic;
    
    if (type == 0) return sdCircle(p, r);
    if (type == 1) return sdNgon(p, r, 6);
    if (type == 2) return sdNgon(p, r, 8);
    if (type == 3) return sdStar(p, r, u_starPoints, 0.4);
    if (type == 4) return sdHeart(p, r);
    if (type == 5) return abs(sdCircle(p, r)) - (r * 0.2); // Ring
    
    return sdCircle(p, r);
}

float get_luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    vec4 base = texture(u_tDiffuse, v_uv);

    // 1. Calculate Raw Depth
    float depth = 0.5;
    if (u_depthSource == 1) { // Luminance
        depth = 1.0 - get_luminance(base.rgb);
    } else if (u_depthSource == 2) { // Radial
        depth = clamp(length(v_uv - 0.5) * 2.0, 0.0, 1.0);
    } else if (u_depthSource == 3) { // Linear H
        depth = v_uv.x;
    } else if (u_depthSource == 4) { // Linear V
        depth = v_uv.y;
    } else if (u_depthSource == 5) { // External Node
        depth = get_luminance(texture(u_tDepth, v_uv).rgb);
    }

    // 2. Apply Depth Adjustments
    if (u_depthInvert) depth = 1.0 - depth;
    depth = (depth - 0.5) * u_depthContrast + 0.5 + u_depthBias;
    depth = clamp(depth, 0.0, 1.0);

    // Depth Preview Mode
    if (u_previewDepth) {
        // Colorized depth map: Blue is near, Red is far
        vec3 depthCol = mix(vec3(0.0, 0.2, 1.0), vec3(1.0, 0.1, 0.0), depth);
        
        // Overlay focus range as white highlights
        float coc_vis = max(0.0, abs(depth - u_focusDepth) - u_focusWidth);
        if (coc_vis < 0.01) depthCol = mix(depthCol, vec3(1.0), 0.8);
        
        fragColor = vec4(depthCol, 1.0);
        return;
    }

    // 3. Calculate CoC (Circle of Confusion)
    float coc = max(0.0, abs(depth - u_focusDepth) - u_focusWidth);
    coc = clamp(coc * 10.0, 0.0, 1.0) * u_maxCoC;

    if (coc < 0.2) {
        fragColor = base;
        return;
    }

    // 4. Bokeh Sampling Setup
    vec3 acc = vec3(0.0);
    float totalWeight = 0.0;
    vec2 texel = 1.0 / u_resolution;
    float goldenAngle = 2.39996323; 

    // Vintage deformations
    vec2 toCenter = v_uv - 0.5;
    float distFromCenter = length(toCenter);
    vec2 radialDir = normalize(toCenter);
    vec2 tangentDir = vec2(-radialDir.y, radialDir.x);
    
    float swirlAngle = distFromCenter * u_swirl * PI;
    float sSwirl = sin(swirlAngle);
    float cSwirl = cos(cos(swirlAngle));
    
    // Lenticular squash factor (Cat Eye)
    // We reduce the scale of the kernel along the radial direction as we move outwards
    float radialSquash = 1.0 - (distFromCenter * u_catEye);

    for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= u_samples) break;
        
        float r = sqrt(float(i) / float(u_samples));
        float theta = float(i) * goldenAngle;
        
        // Base polar sample
        vec2 offset = vec2(cos(theta), sin(theta)) * r;

        // Apply Swirl (Kernel Rotation based on screen position)
        if (abs(u_swirl) > 0.001) {
            float ox = offset.x;
            float oy = offset.y;
            offset.x = ox * cSwirl - oy * sSwirl;
            offset.y = ox * sSwirl + oy * cSwirl;
        }

        // Apply Cat Eye (Kernel deformation towards edges)
        // Transform kernel into radial/tangent space of the image center to squash it
        if (u_catEye > 0.001 && distFromCenter > 0.001) {
            float rProj = dot(offset, radialDir);
            float tProj = dot(offset, tangentDir);
            offset = radialDir * rProj * radialSquash + tangentDir * tProj;
        }

        float sdf = get_shape_sdf(offset, u_shapeType, 0.8);
        float shapeFactor = 1.0 - smoothstep(0.0, u_roundness * 0.5, sdf);
        
        if (shapeFactor > 0.0) {
            vec2 sampleUV = v_uv + offset * coc * texel;
            vec2 chromaOffset = offset * coc * texel * u_chroma;
            
            vec3 col;
            col.r = texture(u_tDiffuse, sampleUV + chromaOffset).r;
            col.g = texture(u_tDiffuse, sampleUV).g;
            col.b = texture(u_tDiffuse, sampleUV - chromaOffset).b;
            
            float lum = get_luminance(col);
            float boost = smoothstep(u_threshold, 1.0, lum) * u_gain;
            float weight = shapeFactor * (1.0 + boost);
            
            acc += col * weight;
            totalWeight += weight;
        }
    }

    if (totalWeight > 0.0) {
        fragColor = vec4(acc / totalWeight, base.a);
    } else {
        fragColor = base;
    }
}
`;
