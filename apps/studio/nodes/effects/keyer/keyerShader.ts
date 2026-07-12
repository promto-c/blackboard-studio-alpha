import { ACESCG_LUMINANCE_GLSL } from '@/color-management/effectColorMath';

export const KEYER_SHADER = `
precision highp float;

uniform sampler2D u_tDiffuse;
uniform vec2 u_texelSize;

uniform vec3 u_keyColor; // {"label":"Screen Color","type":"color","value":[0.04,0.78,0.12]}
uniform float u_hueLow; // {"label":"Hue Low","min":0.0,"max":1.0,"step":0.001,"value":0.22}
uniform float u_hueHigh; // {"label":"Hue High","min":0.0,"max":1.0,"step":0.001,"value":0.45}
uniform float u_satLow; // {"label":"Saturation Low","min":0.0,"max":1.0,"step":0.001,"value":0.15}
uniform float u_satHigh; // {"label":"Saturation High","min":0.0,"max":1.0,"step":0.001,"value":1.0}
uniform float u_lumaLow; // {"label":"Luminance Low","min":0.0,"max":1.0,"step":0.001,"value":0.0}
uniform float u_lumaHigh; // {"label":"Luminance High","min":0.0,"max":1.0,"step":0.001,"value":1.0}
uniform float u_qualifierSoftness; // {"label":"Qualifier Softness","min":0.0,"max":0.25,"step":0.001,"value":0.035}
uniform float u_keyDensity; // {"label":"Key Density","min":0.0,"max":1.5,"step":0.01,"value":1.0}

uniform float u_clipBlack; // {"label":"Clip Black","min":0.0,"max":0.49,"step":0.001,"value":0.04}
uniform float u_clipWhite; // {"label":"Clip White","min":0.51,"max":1.0,"step":0.001,"value":0.96}
uniform float u_matteDenoise; // {"label":"Matte Denoise","min":0.0,"max":1.0,"step":0.01,"value":0.15}
uniform float u_matteGrow; // {"label":"Matte Grow / Shrink","min":-4.0,"max":4.0,"step":0.1,"value":0.0}
uniform bool u_invertMatte; // {"label":"Invert Matte","value":false}

uniform bool u_despillEnabled; // {"label":"Despill","value":true}
uniform float u_despillAmount; // {"label":"Despill Amount","min":0.0,"max":1.5,"step":0.01,"value":0.65}
uniform float u_despillBias; // {"label":"Despill Bias","min":-1.0,"max":1.0,"step":0.01,"value":0.0}

uniform int u_viewMode; // {"label":"View","type":"segmented","value":0,"options":[{"label":"Result","value":0},{"label":"Matte","value":1},{"label":"Overlay","value":2},{"label":"Spill","value":3},{"label":"Source","value":4}]}

in vec2 v_uv;
out vec4 fragColor;

${ACESCG_LUMINANCE_GLSL}

vec3 rgb_to_hsv(vec3 color) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
    vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

float range_mask(float value, float low, float high, float softness) {
    float feather = max(softness, 0.0001);
    float lowMask = smoothstep(low - feather, low + feather, value);
    float highMask = 1.0 - smoothstep(high - feather, high + feather, value);
    return clamp(lowMask * highMask, 0.0, 1.0);
}

float raw_matte(vec2 uv) {
    vec3 color = texture(u_tDiffuse, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
    vec3 hsv = rgb_to_hsv(max(color, vec3(0.0)));
    float hue = range_mask(hsv.x, u_hueLow, u_hueHigh, u_qualifierSoftness);
    float saturation = range_mask(hsv.y, u_satLow, u_satHigh, u_qualifierSoftness);
    float luminance = range_mask(
        clamp(acescg_luminance(color), 0.0, 1.0),
        u_lumaLow,
        u_lumaHigh,
        u_qualifierSoftness
    );
    float key = clamp(hue * saturation * luminance * u_keyDensity, 0.0, 1.0);
    return 1.0 - key;
}

void main() {
    vec4 source = texture(u_tDiffuse, v_uv);
    float center = raw_matte(v_uv);
    float radius = max(1.0, abs(u_matteGrow));
    vec2 offset = u_texelSize * radius;
    float left = raw_matte(v_uv - vec2(offset.x, 0.0));
    float right = raw_matte(v_uv + vec2(offset.x, 0.0));
    float down = raw_matte(v_uv - vec2(0.0, offset.y));
    float up = raw_matte(v_uv + vec2(0.0, offset.y));

    float averageMatte = (center * 2.0 + left + right + down + up) / 6.0;
    float matte = mix(center, averageMatte, u_matteDenoise);
    if (u_matteGrow > 0.001) {
        matte = max(matte, max(max(left, right), max(down, up)));
    } else if (u_matteGrow < -0.001) {
        matte = min(matte, min(min(left, right), min(down, up)));
    }
    matte = smoothstep(u_clipBlack, max(u_clipBlack + 0.001, u_clipWhite), matte);
    if (u_invertMatte) {
        matte = 1.0 - matte;
    }

    float sourceLuma = acescg_luminance(source.rgb);
    float keyLuma = acescg_luminance(u_keyColor);
    vec3 keyDirection = normalize((u_keyColor - vec3(keyLuma)) + vec3(0.00001));
    float spillExcess = max(dot(source.rgb - vec3(sourceLuma), keyDirection), 0.0);
    float spillWeight = u_despillEnabled
        ? u_despillAmount * spillExcess * (1.0 - matte * 0.65)
        : 0.0;
    vec3 resultColor = source.rgb - keyDirection * spillWeight;
    vec3 biasColor = vec3(max(-u_despillBias, 0.0), 0.0, max(u_despillBias, 0.0));
    resultColor += biasColor * spillWeight * 0.5;

    vec3 displayColor = resultColor;
    if (u_viewMode == 1) {
        displayColor = vec3(matte);
    } else if (u_viewMode == 2) {
        vec3 removedOverlay = mix(source.rgb, vec3(0.05, 0.85, 0.42), 0.72);
        float matteEdge = 1.0 - abs(matte * 2.0 - 1.0);
        vec3 overlay = mix(removedOverlay, source.rgb, matte);
        overlay = mix(overlay, vec3(1.0, 0.78, 0.12), matteEdge * 0.35);
        displayColor = overlay;
    } else if (u_viewMode == 3) {
        displayColor = spillWeight * vec3(0.2, 1.0, 0.55);
    } else if (u_viewMode == 4) {
        displayColor = source.rgb;
    }

    // View modes are RGB diagnostics only. Alpha always carries the keyed result.
    fragColor = vec4(displayColor, source.a * matte);
}
`;
