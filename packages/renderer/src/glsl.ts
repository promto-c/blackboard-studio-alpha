import { AnyUniform, SegmentedUniformOption, UniformUIType } from '@blackboard/types';
import { STRAIGHT_ALPHA_OVER_GLSL } from './alpha';
import type { RendererInputPort } from './types';

export const RendererShader = {
  VERTEX: `
in vec3 position;
in vec2 uv;
out vec2 v_uv;

void main() {
  v_uv = uv;
  gl_Position = vec4(position, 1.0);
}
`,

  TEXTURE: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
out vec4 fragColor;

void main() {
  fragColor = texture(u_tDiffuse, v_uv);
}
`,

  DATA_VIEW: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform int u_channel;
out vec4 fragColor;

void main() {
  vec4 data = texture(u_tDiffuse, v_uv);
  vec3 display_value = data.rgb;
  if (u_channel == 0) display_value = vec3(data.r);
  if (u_channel == 1) display_value = vec3(data.g);
  if (u_channel == 2) display_value = vec3(data.b);
  if (u_channel == 3) display_value = vec3(data.a);
  fragColor = vec4(display_value, 1.0);
}
`,

  TEXTURE_OPACITY: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform float u_opacity;
out vec4 fragColor;

void main() {
  vec4 tex = texture(u_tDiffuse, v_uv);
  fragColor = vec4(tex.rgb, tex.a * u_opacity);
}
`,

  STRAIGHT_TEXTURE_OVER: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tBackdrop;
uniform sampler2D u_tDiffuse;
uniform float u_opacity;
out vec4 fragColor;

${STRAIGHT_ALPHA_OVER_GLSL}

void main() {
  vec4 dst = texture(u_tBackdrop, v_uv);
  vec4 src = texture(u_tDiffuse, v_uv);
  src.a *= u_opacity;
  fragColor = straight_over(src, dst);
}
`,

  DEFAULT_CUSTOM: `// Blackboard Studio shader example
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
`,
} as const;

const PIPELINE_UNIFORM_NAMES = new Set([
  'u_tDiffuse',
  'u_tPreviousFrame',
  'u_tNextFrame',
  'u_frame',
  'u_time',
  'u_fps',
]);

type UniformMetadata = Record<string, unknown>;

const isMetadata = (value: unknown): value is UniformMetadata =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseMetadata = (source: string | undefined): UniformMetadata => {
  if (!source) return {};
  const parsed: unknown = JSON.parse(source);
  return isMetadata(parsed) ? parsed : {};
};

const getNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const getBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const getLabel = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const getArrayNumber = (value: unknown, index: number, fallback: number): number =>
  Array.isArray(value) ? getNumber(value[index], fallback) : fallback;

const getColor = (value: unknown): [number, number, number] =>
  Array.isArray(value) && value.length >= 3
    ? [getNumber(value[0], 1), getNumber(value[1], 1), getNumber(value[2], 1)]
    : [1, 1, 1];

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

      if (isMetadata(option)) {
        const label =
          typeof option.label === 'string'
            ? option.label
            : typeof option.name === 'string'
              ? option.name
              : String(option.value ?? index);
        const optionValue =
          typeof option.value === 'number' && Number.isFinite(option.value) ? option.value : index;
        return { label, value: optionValue };
      }

      return null;
    })
    .filter((option): option is SegmentedUniformOption => option !== null);
};

export const parseUniformsFromGLSL = (
  shaderCode: string,
  exclude: string[] = [],
): Record<string, AnyUniform> => {
  const uniforms: Record<string, AnyUniform> = {};
  const uniformRegex =
    /uniform\s+(float|vec2|vec3|int|bool)\s+([a-zA-Z0-9_]+)\s*(\[\s*\d+\s*\])?\s*;\s*(\/\/\s*(\{.*\})\s*)?/g;
  let match;

  while ((match = uniformRegex.exec(shaderCode)) !== null) {
    const type = match[1];
    const name = match[2];

    if (exclude.includes(name) || PIPELINE_UNIFORM_NAMES.has(name)) continue;

    let metadata: UniformMetadata = {};

    if (match[5]) {
      try {
        metadata = parseMetadata(match[5]);
      } catch {
        console.error(`Could not parse JSON metadata for uniform ${name}: ${match[5]}`);
      }
    }

    if (type === 'vec2' && Array.isArray(metadata.label) && metadata.label.length === 2) {
      const xName = `${name}_x`;
      const yName = `${name}_y`;

      uniforms[xName] = {
        label: getLabel(metadata.label[0], `${name} X`),
        ui: UniformUIType.SLIDER,
        value: getArrayNumber(metadata.value, 0, 0.5),
        min: getArrayNumber(metadata.min, 0, 0),
        max: getArrayNumber(metadata.max, 0, 1),
        step: getArrayNumber(metadata.step, 0, 0.01),
      };

      uniforms[yName] = {
        label: getLabel(metadata.label[1], `${name} Y`),
        ui: UniformUIType.SLIDER,
        value: getArrayNumber(metadata.value, 1, 0.5),
        min: getArrayNumber(metadata.min, 1, 0),
        max: getArrayNumber(metadata.max, 1, 1),
        step: getArrayNumber(metadata.step, 1, 0.01),
      };
    } else if (metadata.type === 'color' && type === 'vec3') {
      uniforms[name] = {
        label: getLabel(metadata.label, name),
        ui: UniformUIType.COLOR,
        value: getColor(metadata.value),
      };
    } else if (type === 'bool') {
      uniforms[name] = {
        label: getLabel(metadata.label, name),
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
        label: getLabel(metadata.label, name),
        ui: UniformUIType.SEGMENTED,
        value: getNumber(metadata.value, options[0]?.value ?? 0),
        options,
      };
    } else if (
      (type === 'float' || type === 'int') &&
      (metadata.type === 'number' || metadata.type === 'input')
    ) {
      uniforms[name] = {
        label: getLabel(metadata.label, name),
        ui: UniformUIType.NUMBER,
        value: getNumber(metadata.value, 0),
        step: getNumber(metadata.step, type === 'int' ? 1 : 0.01),
      };
    } else if (type === 'float' || type === 'int') {
      uniforms[name] = {
        label: getLabel(metadata.label, name),
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
        metadata = parseMetadata(match[3]);
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
