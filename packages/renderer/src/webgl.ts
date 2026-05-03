import * as THREE from 'three';

export type StudioRendererParameters = Omit<THREE.WebGLRendererParameters, 'context'> & {
  pixelRatio?: number;
};

export const assertWebGL2Renderer = (renderer: THREE.WebGLRenderer): void => {
  if (!renderer.capabilities.isWebGL2) {
    throw new Error('Blackboard Studio now requires a WebGL2 renderer.');
  }
};

export const createStudioRenderer = (parameters: StudioRendererParameters): THREE.WebGLRenderer => {
  const canvas = parameters.canvas ?? document.createElement('canvas');
  const { pixelRatio = 1, ...rendererParameters } = parameters;
  const context = canvas.getContext('webgl2', {
    alpha: rendererParameters.alpha,
    antialias: rendererParameters.antialias,
    depth: rendererParameters.depth,
    failIfMajorPerformanceCaveat: rendererParameters.failIfMajorPerformanceCaveat,
    premultipliedAlpha: rendererParameters.premultipliedAlpha,
    preserveDrawingBuffer: rendererParameters.preserveDrawingBuffer,
    stencil: rendererParameters.stencil,
  } as WebGLContextAttributes);

  if (!context) {
    throw new Error('Blackboard Studio now requires WebGL2 support.');
  }

  const renderer = new THREE.WebGLRenderer({
    ...rendererParameters,
    canvas,
    context,
  });
  renderer.setPixelRatio(pixelRatio);
  assertWebGL2Renderer(renderer);
  return renderer;
};

export const createStudioShaderMaterial = (
  parameters: THREE.ShaderMaterialParameters,
): THREE.ShaderMaterial =>
  new THREE.RawShaderMaterial({
    ...parameters,
    glslVersion: THREE.GLSL3,
  });
