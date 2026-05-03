// @blackboard/renderer — GPU pipeline, shaders, animation, and node predicates

// Types
export type {
  ShaderUniformMap,
  RenderMode,
  EffectRenderContext,
  RendererEffectEntry,
  EffectRegistryLike,
} from './types';

// GLSL shaders and utilities
export {
  VERTEX_SHADER,
  TEXTURE_SHADER,
  TRANSFORMED_TEXTURE_SHADER,
  VIEWER_SHADER,
  OCIO_VIEWER_SHADER_TEMPLATE,
  DEFAULT_CUSTOM_SHADER,
  ROTO_SHADER,
  PAINT_OVER_SHADER,
  parseUniformsFromGLSL,
  parseInputPortsFromGLSL,
} from './glsl';

// Animation utilities
export {
  getSegmentTangents,
  clampKeyframeTangents,
  setImmutable,
  getImmutable,
  getSortedKeyframes,
  getValueAtFrame,
  getLinearValueAtFrame,
  hasKeyframeAt,
  setKeyframeOnValue,
  syncRotoKeyframes,
} from './animation';

// Node predicates
export { createNodePredicates, hasStackedFlag } from './nodePredicates';

// WebGL runtime helpers
export { assertWebGL2Renderer, createStudioRenderer, createStudioShaderMaterial } from './webgl';

// Render pipeline
export {
  renderWithSharedPipeline,
  renderViewportFrameWithSharedPipeline,
  type RenderPipelineOptions,
  type RenderPipelineResult,
  type ViewportPipelineResources,
  type ViewportPipelineOptions,
  type ViewportPipelineResult,
} from './pipeline';
