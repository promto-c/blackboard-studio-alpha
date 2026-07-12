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
  RendererSceneSize,
  RendererSceneSizeBehavior,
  RendererOcioGpuTexture,
  RendererOcioGpuUniform,
  RendererOcioShaderInfo,
  RendererOcioTransformContext,
  RendererOcioTransformDescriptor,
  RendererOcioTransformDirection,
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
export {
  areProcessingDomainsCompatible,
  assertRendererProcessingDomainsSupported,
  getDataSemanticProcessingDomain,
  isTechnicalProcessingDomain,
  resolveRendererNodeProcessingDomain,
  resolveRendererNodeInputDomain,
} from './processingDomains';

// Straight-alpha CPU compositing and texture upload contract
export {
  STRAIGHT_ALPHA_OVER_GLSL,
  configureRawStraightAlphaTexture,
  configureStraightAlphaTexture,
  destinationOutStraightAlphaPixel,
  sourceOverStraightAlphaPixel,
} from './alpha';

// WebGL runtime helpers
export {
  assertWebGL2Renderer,
  assertFloatRenderTargetSupport,
  createStudioRenderer,
  getRendererRuntimeDiagnostics,
  type RendererRuntimeDiagnostics,
  StudioShaderMaterialCache,
} from './webgl';
export { readRenderTargetPixelRgbaFloat, readRenderTargetRgbaFloat } from './readback';

// Render pipeline
export {
  renderWithSharedPipeline,
  renderViewportFrameWithSharedPipeline,
  renderPipeline,
  type RenderPipelineOptions,
  type RenderPipelineResult,
  type RenderOutputCaptureRequest,
  type PipelineResources,
  type ViewportPipelineResources,
  type ViewportPipelineOptions,
  type ViewportPipelineResult,
  isPromiseLike,
  getSceneRenderTargetOptions,
  getRenderTargetOptionsForOutput,
} from './pipeline';
