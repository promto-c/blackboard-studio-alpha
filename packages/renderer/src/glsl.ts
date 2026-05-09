import { AnyUniform, SegmentedUniformOption, UniformUIType } from '@blackboard/types';
import type { RendererInputPort } from './types';

export const VERTEX_SHADER = `
in vec3 position;
in vec2 uv;
out vec2 v_uv;

void main() {
  v_uv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export const TEXTURE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
out vec4 fragColor;

void main() {
  fragColor = texture(u_tDiffuse, v_uv);
}
`;

export const TEXTURE_OPACITY_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_opacity;
out vec4 fragColor;

void main() {
  vec4 tex = texture(u_tDiffuse, v_uv);
  fragColor = vec4(tex.rgb, tex.a * u_opacity);
}
`;

export const TRANSFORMED_TEXTURE_SHADER = `
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tDiffuse;
uniform float u_opacity;
uniform float u_scale;
uniform vec2 u_offset; // in pixels, from center of scene
uniform vec2 u_scene_res;
uniform vec2 u_image_res;
uniform int u_input_transform; // 0: sRGB -> Linear, 1: No-op, 2: Linear -> sRGB
uniform bool u_flipY;

vec3 srgb_to_linear(vec3 color) {
  return pow(color, vec3(2.2));
}

vec3 linear_to_srgb(vec3 color) {
  return pow(color, vec3(1.0/2.2));
}

void main() {
  // Convert scene UVs to centered pixel coordinates
  vec2 scene_px = v_uv * u_scene_res - (u_scene_res / 2.0);

  // Apply inverse transform to find corresponding point in image space
  // 1. Inverse translate
  vec2 img_space_px = scene_px - u_offset;

  // 2. Inverse scale
  img_space_px /= u_scale;

  // Convert from centered image space to image UV space [0,1]
  vec2 image_uv = img_space_px / u_image_res + 0.5;

  if (u_flipY) {
    image_uv.y = 1.0 - image_uv.y;
  }

  vec4 tex_color = vec4(0.0);
  if (image_uv.x >= 0.0 && image_uv.x <= 1.0 && image_uv.y >= 0.0 && image_uv.y <= 1.0) {
    tex_color = texture(u_tDiffuse, image_uv);
  }

  if (u_input_transform == 0) {
    tex_color.rgb = srgb_to_linear(tex_color.rgb);
  } else if (u_input_transform == 2) {
    tex_color.rgb = linear_to_srgb(tex_color.rgb);
  }

  fragColor = vec4(tex_color.rgb, tex_color.a * u_opacity);
}
`;

export const STRAIGHT_TEXTURE_OVER_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tBackdrop;
uniform sampler2D u_tDiffuse;
uniform float u_opacity;
out vec4 fragColor;

vec4 straight_over(vec4 src, vec4 dst) {
  src.a = clamp(src.a, 0.0, 1.0);
  dst.a = clamp(dst.a, 0.0, 1.0);
  float inv_src_a = 1.0 - src.a;
  float out_a = src.a + dst.a * inv_src_a;
  vec3 weighted_rgb = src.rgb * src.a + dst.rgb * dst.a * inv_src_a;
  vec3 out_rgb = out_a > 0.000001 ? weighted_rgb / out_a : src.rgb;
  return vec4(out_rgb, out_a);
}

void main() {
  vec4 dst = texture(u_tBackdrop, v_uv);
  vec4 src = texture(u_tDiffuse, v_uv);
  src.a *= u_opacity;
  fragColor = straight_over(src, dst);
}
`;

export const STRAIGHT_TRANSFORMED_TEXTURE_OVER_SHADER = `
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tBackdrop;
uniform sampler2D u_tDiffuse;
uniform float u_opacity;
uniform float u_scale;
uniform vec2 u_offset; // in pixels, from center of scene
uniform vec2 u_scene_res;
uniform vec2 u_image_res;
uniform int u_input_transform; // 0: sRGB -> Linear, 1: No-op, 2: Linear -> sRGB
uniform bool u_flipY;

vec3 srgb_to_linear(vec3 color) {
  return pow(color, vec3(2.2));
}

vec3 linear_to_srgb(vec3 color) {
  return pow(color, vec3(1.0/2.2));
}

vec4 straight_over(vec4 src, vec4 dst) {
  src.a = clamp(src.a, 0.0, 1.0);
  dst.a = clamp(dst.a, 0.0, 1.0);
  float inv_src_a = 1.0 - src.a;
  float out_a = src.a + dst.a * inv_src_a;
  vec3 weighted_rgb = src.rgb * src.a + dst.rgb * dst.a * inv_src_a;
  vec3 out_rgb = out_a > 0.000001 ? weighted_rgb / out_a : src.rgb;
  return vec4(out_rgb, out_a);
}

void main() {
  vec4 dst = texture(u_tBackdrop, v_uv);

  vec2 scene_px = v_uv * u_scene_res - (u_scene_res / 2.0);
  vec2 img_space_px = (scene_px - u_offset) / u_scale;
  vec2 image_uv = img_space_px / u_image_res + 0.5;

  if (u_flipY) {
    image_uv.y = 1.0 - image_uv.y;
  }

  vec4 src = vec4(0.0);
  if (image_uv.x >= 0.0 && image_uv.x <= 1.0 && image_uv.y >= 0.0 && image_uv.y <= 1.0) {
    src = texture(u_tDiffuse, image_uv);
  }

  if (u_input_transform == 0) {
    src.rgb = srgb_to_linear(src.rgb);
  } else if (u_input_transform == 2) {
    src.rgb = linear_to_srgb(src.rgb);
  }

  src.a *= u_opacity;
  fragColor = straight_over(src, dst);
}
`;

export const VIEWER_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_gain;
uniform float u_gamma;
uniform float u_saturation;
uniform int u_view_transform; // 0: No-op, 1: Linear -> sRGB
uniform int u_channel; // 0:RGB, 1:R, 2:G, 3:B, 4:A
uniform bool u_ignoreAlpha;
uniform bool u_alphaOverlay;
uniform vec3 u_alphaOverlayColor;
uniform float u_alphaOverlayOpacity;
uniform float u_alphaOverlayBgDarken;
out vec4 fragColor;

vec3 linear_to_srgb_viewer(vec3 color) {
  return pow(color, vec3(1.0/2.2));
}

float luminance_viewer(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    vec4 tex = texture(u_tDiffuse, v_uv);
    vec3 color = tex.rgb;

    // Apply Gain
    color *= u_gain;

    // Apply view transform (e.g. Linear to sRGB)
    if (u_view_transform == 1) {
        color = linear_to_srgb_viewer(color);
    }

    // Apply post-display adjustments (gamma, saturation)
    color = pow(color, vec3(1.0 / u_gamma));
    float luma_val = luminance_viewer(color);
    color = mix(vec3(luma_val), color, u_saturation);

    // Channel selection
    if (u_channel == 1) color = vec3(color.r);
    if (u_channel == 2) color = vec3(color.g);
    if (u_channel == 3) color = vec3(color.b);
    if (u_channel == 4) color = vec3(tex.a);

    if (u_alphaOverlay && u_channel != 4) {
        float matte = clamp(tex.a, 0.0, 1.0);
        float non_matte = 1.0 - matte;
        color *= 1.0 - (clamp(u_alphaOverlayBgDarken, 0.0, 1.0) * non_matte);

        float overlay_mix = clamp(u_alphaOverlayOpacity, 0.0, 1.0) * matte;
        color = mix(color, clamp(u_alphaOverlayColor, 0.0, 1.0), overlay_mix);
    }

    bool should_ignore_alpha = u_ignoreAlpha || (u_alphaOverlay && u_channel != 4);
    float final_alpha = (u_channel == 4 || should_ignore_alpha) ? 1.0 : tex.a;
    fragColor = vec4(clamp(color, 0.0, 1.0), final_alpha);
}
`;

export const OCIO_VIEWER_SHADER_TEMPLATE = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_gain;
uniform float u_gamma;
uniform float u_saturation;
uniform int u_channel; // 0:RGB, 1:R, 2:G, 3:B, 4:A
uniform bool u_alphaOverlay;
uniform vec3 u_alphaOverlayColor;
uniform float u_alphaOverlayOpacity;
uniform float u_alphaOverlayBgDarken;
out vec4 fragColor;

{{OCIO_HEADER}}
{{OCIO_UNIFORMS}}

float luminance_viewer(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    vec4 tex = texture(u_tDiffuse, v_uv);
    vec3 color = tex.rgb;

    // Apply Gain (pre-transform)
    color *= u_gain;

    // Apply OCIO display transform
    {{OCIO_MAIN}}

    // Apply post-display adjustments (gamma, saturation)
    color = pow(color, vec3(1.0 / u_gamma));
    float luma_val = luminance_viewer(color);
    color = mix(vec3(luma_val), color, u_saturation);

    // Channel selection
    if (u_channel == 1) color = vec3(color.r);
    if (u_channel == 2) color = vec3(color.g);
    if (u_channel == 3) color = vec3(color.b);
    if (u_channel == 4) color = vec3(tex.a);

    if (u_alphaOverlay && u_channel != 4) {
        float matte = clamp(tex.a, 0.0, 1.0);
        float non_matte = 1.0 - matte;
        color *= 1.0 - (clamp(u_alphaOverlayBgDarken, 0.0, 1.0) * non_matte);

        float overlay_mix = clamp(u_alphaOverlayOpacity, 0.0, 1.0) * matte;
        color = mix(color, clamp(u_alphaOverlayColor, 0.0, 1.0), overlay_mix);
    }

    float final_alpha = (u_channel == 4 || (u_alphaOverlay && u_channel != 4)) ? 1.0 : tex.a;
    fragColor = vec4(clamp(color, 0.0, 1.0), final_alpha);
}
`;

export const DEFAULT_CUSTOM_SHADER = `// Blackboard Studio shader example
// Notes:
// - This is a fragment shader for WebGL2 / GLSL 300 ES.
// - Do not add a #version line; the renderer provides GLSL 300 ES mode.
// - Uniform UI controls are auto-generated from inline JSON metadata comments.
// - Temporal sampler metadata creates graph input ports. Connect media to the
//   generated port before enabling that temporal sample.

precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tRelativeFrame; // {"label": "Relative Frame", "type": "temporal", "mode": "relative", "frameUniform": "u_relativeFrame"}
uniform float u_time;

uniform float u_mixAmount; // {"label": "Mix Amount", "min": 0.0, "max": 1.0, "step": 0.01, "value": 0.35}
uniform float u_pulseAmount; // {"label": "Time Pulse", "min": 0.0, "max": 0.5, "step": 0.01, "value": 0.0}
uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -2}
uniform float u_temporalMix; // {"label": "Temporal Mix", "min": 0.0, "max": 1.0, "step": 0.01, "value": 0.25}
uniform vec3 u_tintColor; // {"label": "Tint Color", "type": "color", "value": [1.0, 0.55, 0.2]}
uniform vec2 u_offset; // {"label": ["Offset X", "Offset Y"], "min": [-0.25, -0.25], "max": [0.25, 0.25], "step": [0.001, 0.001], "value": [0.0, 0.0]}
uniform bool u_invert; // {"label": "Invert", "value": false}
uniform bool u_useTemporalFrame; // {"label": "Use Temporal Frame", "value": false}
uniform int u_tintMode; // {"label": "Tint Mode", "type": "segment", "value": 0, "options": [{"label": "Multiply", "value": 0}, {"label": "Screen", "value": 1}, {"label": "Replace", "value": 2}]}
out vec4 fragColor;

void main() {
  vec2 sampleUv = clamp(v_uv + u_offset, vec2(0.0), vec2(1.0));
  vec4 source = texture(u_tDiffuse, sampleUv);
  if (u_useTemporalFrame) {
    vec4 temporalSource = texture(u_tRelativeFrame, sampleUv);
    source = mix(source, temporalSource, clamp(u_temporalMix, 0.0, 1.0));
  }
  vec3 multiplyTint = source.rgb * u_tintColor;
  vec3 screenTint = 1.0 - ((1.0 - source.rgb) * (1.0 - u_tintColor));
  vec3 tintTarget = u_tintMode == 1 ? screenTint : u_tintMode == 2 ? u_tintColor : multiplyTint;
  float pulse = 0.5 + 0.5 * sin(u_time * 6.2831853);
  float animatedMix = clamp(u_mixAmount + ((pulse - 0.5) * u_pulseAmount), 0.0, 1.0);
  vec3 tinted = mix(source.rgb, tintTarget, animatedMix);
  fragColor = vec4(u_invert ? 1.0 - tinted : tinted, source.a);
}
`;

export const ROTO_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tMask;
out vec4 fragColor;

void main() {
  vec4 base = texture(u_tDiffuse, v_uv);
  float mask = texture(u_tMask, v_uv).r;

  fragColor = vec4(base.rgb, base.a * mask);
}
`;

export const PAINT_OVER_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform sampler2D u_tPaint;
uniform sampler2D u_tPaintAlpha;
uniform int u_input_transform; // 0: sRGB -> Linear, 1: No-op
out vec4 fragColor;

vec3 srgb_to_linear(vec3 color) {
  return pow(color, vec3(2.2));
}

void main() {
  vec4 base = texture(u_tDiffuse, v_uv);
  vec4 paint = texture(u_tPaint, v_uv);
  vec4 paint_alpha = texture(u_tPaintAlpha, v_uv);

  if (u_input_transform == 0) {
    paint.rgb = srgb_to_linear(paint.rgb);
  }

  float paint_rgb_alpha = clamp(paint.a, 0.0, 1.0);
  vec3 out_rgb = (paint.rgb * paint_rgb_alpha) + (base.rgb * (1.0 - paint_rgb_alpha));

  // Alpha-only paint stores the target alpha in RGB and its coverage in A.
  float alpha_paint_target = clamp(paint_alpha.r, 0.0, 1.0);
  float alpha_paint_mix = clamp(paint_alpha.a, 0.0, 1.0);
  float out_alpha = (alpha_paint_target * alpha_paint_mix) + (base.a * (1.0 - alpha_paint_mix));
  fragColor = vec4(out_rgb, out_alpha);
}
`;

const PIPELINE_UNIFORM_NAMES = new Set([
  'u_tDiffuse',
  'u_tPreviousFrame',
  'u_tNextFrame',
  'u_frame',
  'u_time',
  'u_fps',
]);

export const parseUniformsFromGLSL = (
  shaderCode: string,
  exclude: string[] = [],
): { [key: string]: AnyUniform } => {
  const uniforms: { [key: string]: any } = {};
  const uniformRegex =
    /uniform\s+(float|vec2|vec3|int|bool)\s+([a-zA-Z0-9_]+)\s*(\[\s*\d+\s*\])?\s*;\s*(\/\/\s*(\{.*\})\s*)?/g;
  let match;

  const getNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const getBoolean = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  const parseSegmentOptions = (value: unknown): SegmentedUniformOption[] => {
    if (!Array.isArray(value)) return [];

    return value
      .map((option, index): SegmentedUniformOption | null => {
        if (typeof option === 'string') {
          return { label: option, value: index };
        }

        if (typeof option === 'number' && Number.isFinite(option)) {
          return { label: String(option), value: option };
        }

        if (option && typeof option === 'object') {
          const candidate = option as Record<string, unknown>;
          const label =
            typeof candidate.label === 'string'
              ? candidate.label
              : typeof candidate.name === 'string'
                ? candidate.name
                : String(candidate.value ?? index);
          const optionValue =
            typeof candidate.value === 'number' && Number.isFinite(candidate.value)
              ? candidate.value
              : index;
          return { label, value: optionValue };
        }

        return null;
      })
      .filter((option): option is SegmentedUniformOption => option !== null);
  };

  while ((match = uniformRegex.exec(shaderCode)) !== null) {
    const type = match[1];
    const name = match[2];

    if (exclude.includes(name) || PIPELINE_UNIFORM_NAMES.has(name)) continue;

    let metadata: any = {};

    if (match[5]) {
      try {
        metadata = JSON.parse(match[5]);
      } catch (e) {
        console.error(`Could not parse JSON metadata for uniform ${name}: ${match[5]}`);
      }
    }

    if (type === 'vec2' && Array.isArray(metadata.label) && metadata.label.length === 2) {
      const xName = `${name}_x`;
      const yName = `${name}_y`;
      const xVal = Array.isArray(metadata.value) ? metadata.value[0] : 0.5;
      const yVal = Array.isArray(metadata.value) ? metadata.value[1] : 0.5;
      const min = Array.isArray(metadata.min) ? metadata.min[0] : 0.0;
      const max = Array.isArray(metadata.max) ? metadata.max[0] : 1.0;
      const step = Array.isArray(metadata.step) ? metadata.step[0] : 0.01;

      uniforms[xName] = {
        label: metadata.label[0],
        ui: UniformUIType.SLIDER,
        value: xVal,
        min,
        max,
        step,
      };

      uniforms[yName] = {
        label: metadata.label[1],
        ui: UniformUIType.SLIDER,
        value: yVal,
        min,
        max,
        step,
      };
    } else if (metadata.type === 'color' && type === 'vec3') {
      uniforms[name] = {
        label: metadata.label || name,
        ui: UniformUIType.COLOR,
        value: metadata.value || [1.0, 1.0, 1.0],
      };
    } else if (type === 'bool') {
      uniforms[name] = {
        label: metadata.label || name,
        ui: UniformUIType.TOGGLE,
        value: getBoolean(metadata.value, false),
      };
    } else if (
      (type === 'float' || type === 'int') &&
      (metadata.type === 'segment' || metadata.type === 'segmented') &&
      parseSegmentOptions(metadata.options).length > 0
    ) {
      const options = parseSegmentOptions(metadata.options);
      uniforms[name] = {
        label: metadata.label || name,
        ui: UniformUIType.SEGMENTED,
        value: getNumber(metadata.value, options[0]?.value ?? 0),
        options,
      };
    } else if (
      (type === 'float' || type === 'int') &&
      (metadata.type === 'number' || metadata.type === 'input')
    ) {
      uniforms[name] = {
        label: metadata.label || name,
        ui: UniformUIType.NUMBER,
        value: getNumber(metadata.value, 0),
        step: getNumber(metadata.step, type === 'int' ? 1 : 0.01),
      };
    } else if (type === 'float' || type === 'int') {
      uniforms[name] = {
        label: metadata.label || name,
        ui: UniformUIType.SLIDER,
        value: getNumber(metadata.value, 0.5),
        min: getNumber(metadata.min, 0.0),
        max: getNumber(metadata.max, 1.0),
        step: getNumber(metadata.step, type === 'int' ? 1.0 : 0.01),
      };
    }
  }
  return uniforms;
};

export const parseInputPortsFromGLSL = (shaderCode: string): RendererInputPort[] => {
  const ports: RendererInputPort[] = [];
  const samplerRegex = /uniform\s+sampler2D\s+([a-zA-Z0-9_]+)\s*;\s*(\/\/\s*(\{.*\})\s*)?/g;
  let match;

  while ((match = samplerRegex.exec(shaderCode)) !== null) {
    const name = match[1];
    if (name === 'u_tDiffuse') continue;

    let metadata: Record<string, unknown> = {};
    if (match[3]) {
      try {
        metadata = JSON.parse(match[3]) as Record<string, unknown>;
      } catch {
        metadata = {};
      }
    }

    if (name === 'u_tPreviousFrame' || name === 'u_tNextFrame') {
      const frame = name === 'u_tPreviousFrame' ? -1 : 1;
      ports.push({
        name,
        label: frame < 0 ? 'frame -1' : 'frame +1',
        type: 'texture',
        required: false,
        description: `Source media sampled at playhead frame ${frame >= 0 ? '+' : ''}${frame}.`,
        uniformName: name,
        frameOffset: frame,
      });
      continue;
    }

    const type = typeof metadata.type === 'string' ? metadata.type : '';
    if (type !== 'temporal' && type !== 'frame') continue;

    const frame =
      typeof metadata.frame === 'number' && Number.isFinite(metadata.frame) ? metadata.frame : 0;
    const frameUniform =
      typeof metadata.frameUniform === 'string'
        ? metadata.frameUniform
        : typeof metadata.frameOffsetUniform === 'string'
          ? metadata.frameOffsetUniform
          : typeof metadata.absoluteFrameUniform === 'string'
            ? metadata.absoluteFrameUniform
            : '';
    const mode =
      metadata.mode === 'absolute' || metadata.absolute === true ? 'absolute' : 'relative';
    const label =
      typeof metadata.label === 'string'
        ? metadata.label
        : frameUniform
          ? mode === 'absolute'
            ? `frame from ${frameUniform}`
            : `relative ${frameUniform}`
          : mode === 'absolute'
            ? `frame ${frame}`
            : frame === 0
              ? 'frame'
              : frame > 0
                ? `frame +${frame}`
                : `frame ${frame}`;

    ports.push({
      name,
      label,
      type: 'texture',
      required: false,
      description:
        frameUniform && mode === 'absolute'
          ? `Source media sampled at the timeline frame from ${frameUniform}.`
          : frameUniform
            ? `Source media sampled at playhead frame plus ${frameUniform}.`
            : mode === 'absolute'
              ? `Source media sampled at timeline frame ${frame}.`
              : `Source media sampled at playhead frame ${frame >= 0 ? '+' : ''}${frame}.`,
      uniformName: name,
      ...(frameUniform
        ? mode === 'absolute'
          ? { absoluteFrameUniform: frameUniform }
          : { frameOffsetUniform: frameUniform }
        : mode === 'absolute'
          ? { absoluteFrame: frame }
          : { frameOffset: frame }),
    });
  }

  return ports;
};
