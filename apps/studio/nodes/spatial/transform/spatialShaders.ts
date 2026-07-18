const SPATIAL_RESAMPLING_GLSL = `
ivec2 clamp_sample_coord(vec2 coord, vec2 source_res) {
  vec2 max_coord = max(source_res - vec2(1.0), vec2(0.0));
  return ivec2(clamp(coord, vec2(0.0), max_coord));
}

vec4 sample_texel(sampler2D tex, vec2 coord, vec2 source_res) {
  return texelFetch(tex, clamp_sample_coord(coord, source_res), 0);
}

vec4 sample_nearest(sampler2D tex, vec2 uv, vec2 source_res) {
  return sample_texel(tex, floor(uv * source_res), source_res);
}

float cubic_weight(float x) {
  x = abs(x);
  if (x <= 1.0) {
    return (1.5 * x - 2.5) * x * x + 1.0;
  }
  if (x < 2.0) {
    return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0;
  }
  return 0.0;
}

vec4 sample_cubic(sampler2D tex, vec2 uv, vec2 source_res) {
  vec2 px = uv * source_res - vec2(0.5);
  vec2 base = floor(px);
  vec2 f = px - base;
  vec4 color = vec4(0.0);
  float total = 0.0;

  for (int y = -1; y <= 2; y++) {
    float wy = cubic_weight(float(y) - f.y);
    for (int x = -1; x <= 2; x++) {
      float wx = cubic_weight(float(x) - f.x);
      float w = wx * wy;
      color += sample_texel(tex, base + vec2(float(x), float(y)), source_res) * w;
      total += w;
    }
  }

  return abs(total) > 0.0001 ? color / total : texture(tex, uv);
}

float sinc(float x) {
  x = abs(x);
  if (x < 0.0001) return 1.0;
  float px = 3.141592653589793 * x;
  return sin(px) / px;
}

float lanczos_weight(float x) {
  x = abs(x);
  if (x >= 3.0) return 0.0;
  return sinc(x) * sinc(x / 3.0);
}

vec4 sample_lanczos(sampler2D tex, vec2 uv, vec2 source_res) {
  vec2 px = uv * source_res - vec2(0.5);
  vec2 base = floor(px);
  vec2 f = px - base;
  vec4 color = vec4(0.0);
  float total = 0.0;

  for (int y = -2; y <= 3; y++) {
    float wy = lanczos_weight(float(y) - f.y);
    for (int x = -2; x <= 3; x++) {
      float wx = lanczos_weight(float(x) - f.x);
      float w = wx * wy;
      color += sample_texel(tex, base + vec2(float(x), float(y)), source_res) * w;
      total += w;
    }
  }

  return abs(total) > 0.0001 ? color / total : texture(tex, uv);
}

vec4 sample_spatial(sampler2D tex, vec2 uv, vec2 source_res, int filter_mode) {
  vec2 safe_res = max(source_res, vec2(1.0));
  if (filter_mode == 0) return sample_nearest(tex, uv, safe_res);
  if (filter_mode == 2) return sample_cubic(tex, uv, safe_res);
  if (filter_mode == 3) return sample_lanczos(tex, uv, safe_res);
  return texture(tex, uv);
}
`;

export const SpatialShader = {
  TRANSFORM: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform vec2 u_scene_res;
uniform vec2 u_translate;
uniform vec2 u_scale;
uniform float u_rotation;
uniform vec2 u_pivot;
uniform int u_filter; // 0 nearest, 1 linear, 2 cubic, 3 lanczos
out vec4 fragColor;

${SPATIAL_RESAMPLING_GLSL}

vec2 rotate_point(vec2 p, float radians) {
  float s = sin(radians);
  float c = cos(radians);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec2 scene_px = v_uv * u_scene_res - (u_scene_res * 0.5);
  vec2 safe_scale = vec2(
    abs(u_scale.x) < 0.0001 ? 0.0001 : u_scale.x,
    abs(u_scale.y) < 0.0001 ? 0.0001 : u_scale.y
  );

  vec2 source_px = scene_px - u_translate - u_pivot;
  source_px = rotate_point(source_px, -u_rotation);
  source_px /= safe_scale;
  source_px += u_pivot;

  vec2 source_uv = source_px / u_scene_res + 0.5;
  bool inside = source_uv.x >= 0.0 && source_uv.x <= 1.0 && source_uv.y >= 0.0 && source_uv.y <= 1.0;
  fragColor = inside ? sample_spatial(u_tDiffuse, source_uv, u_scene_res, u_filter) : vec4(0.0);
}
`,

  CROP: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform vec2 u_scene_res;
uniform vec4 u_crop; // left, right, top, bottom in pixels
out vec4 fragColor;

void main() {
  vec2 min_uv = vec2(
    clamp(u_crop.x / u_scene_res.x, 0.0, 1.0),
    clamp(u_crop.w / u_scene_res.y, 0.0, 1.0)
  );
  vec2 max_uv = vec2(
    clamp(1.0 - (u_crop.y / u_scene_res.x), 0.0, 1.0),
    clamp(1.0 - (u_crop.z / u_scene_res.y), 0.0, 1.0)
  );
  bool inside = v_uv.x >= min_uv.x && v_uv.x <= max_uv.x && v_uv.y >= min_uv.y && v_uv.y <= max_uv.y;
  fragColor = inside ? texture(u_tDiffuse, v_uv) : vec4(0.0);
}
`,

  REFORMAT: `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tDiffuse;
uniform vec2 u_scene_res;
uniform vec2 u_target_res;
uniform vec2 u_source_storage_res;
uniform vec2 u_target_storage_res;
uniform int u_mode; // 0 fit, 1 fill, 2 stretch, 3 none
uniform int u_filter; // 0 nearest, 1 linear, 2 cubic, 3 lanczos
out vec4 fragColor;

${SPATIAL_RESAMPLING_GLSL}

void main() {
  vec2 target_res = max(u_target_res, vec2(1.0));
  vec2 source_storage_res = max(u_source_storage_res, vec2(1.0));
  vec2 target_storage_res = max(u_target_storage_res, vec2(1.0));
  vec2 local_px = (v_uv - vec2(0.5)) * target_storage_res;

  vec2 source_uv = vec2(0.5);
  vec2 source_res = u_scene_res;

  if (u_mode == 2) {
    vec2 source_px = (local_px / target_res) * source_res;
    source_uv = source_px / source_storage_res + 0.5;
  } else {
    float scale = 1.0;
    if (u_mode == 0) {
      scale = min(target_res.x / source_res.x, target_res.y / source_res.y);
    } else if (u_mode == 1) {
      scale = max(target_res.x / source_res.x, target_res.y / source_res.y);
    }
    scale = max(scale, 0.0001);
    vec2 source_px = local_px / scale;
    source_uv = source_px / source_storage_res + 0.5;
  }

  bool inside_source =
    source_uv.x >= 0.0 &&
    source_uv.x <= 1.0 &&
    source_uv.y >= 0.0 &&
    source_uv.y <= 1.0;
  fragColor = inside_source
    ? sample_spatial(u_tDiffuse, source_uv, source_storage_res, u_filter)
    : vec4(0.0);
}
`,
} as const;
