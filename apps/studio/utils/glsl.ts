// Re-export core shaders and utilities from @blackboard/renderer
export {
  VERTEX_SHADER,
  TEXTURE_SHADER,
  TRANSFORMED_TEXTURE_SHADER,
  VIEWER_SHADER,
  OCIO_VIEWER_SHADER_TEMPLATE,
  DEFAULT_CUSTOM_SHADER,
  ROTO_SHADER,
  parseUniformsFromGLSL,
  parseInputPortsFromGLSL,
} from '@blackboard/renderer';

// Effect-specific shader re-exports (stay local to apps/studio)
export { GRADE_SHADER } from '@/effects/grade/gradeShader';
export {
  BLUR_H_SHADER,
  BLUR_V_SHADER,
  BOX_BLUR_H_SHADER,
  BOX_BLUR_V_SHADER,
} from '@/effects/blur/blurShader';
export { BOKEH_BLUR_SHADER } from '@/effects/bokeh/bokehShader';
export { LIQUID_GLASS_SHADER } from '@/effects/liquid_glass/liquidGlassShader';
export { PIXELATE_SHADER } from '@/effects/pixelate/pixelateShader';
export { LENS_DISTORTION_SHADER } from '@/effects/lens_distortion/lensDistortionShader';
export { CHROMA_KEY_SHADER } from '@/effects/chroma_key/chromaKeyShader';
export { WARP_SHADER } from '@/effects/warp/warpShader';
