// @blackboard/renderer — GPU pipeline, shaders, animation, and node predicates

// Types
export type {
  ShaderUniformMap,
  RenderMode,
  RenderContext,
  RendererNodeEntry,
  NodeRegistryLike,
  RendererColorManagement,
  ResolveOutputContext,
  PaintTextureBundle,
  RendererMaskLayer,
  RendererInputPort,
  RendererOutputPort,
  RendererOcioGpuTexture,
  RendererOcioGpuUniform,
  RendererOcioShaderInfo,
} from './types';

// GLSL shaders and utilities
export { RendererShader, parseUniformsFromGLSL, parseInputPortsFromGLSL } from './glsl';

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
export {
  assertWebGL2Renderer,
  assertFloatRenderTargetSupport,
  createStudioRenderer,
  createStudioShaderMaterial,
} from './webgl';

// Render pipeline
export {
  renderWithSharedPipeline,
  renderViewportFrameWithSharedPipeline,
  renderPipeline,
  type RenderPipelineOptions,
  type RenderPipelineResult,
  type PipelineResources,
  type ViewportPipelineResources,
  type ViewportPipelineOptions,
  type ViewportPipelineResult,
  isPromiseLike,
  getSceneRenderTargetOptions,
} from './pipeline';
