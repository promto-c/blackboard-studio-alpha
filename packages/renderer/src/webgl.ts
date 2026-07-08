import * as THREE from 'three';
import { RendererShader } from './glsl';

type StudioRendererParameters = Omit<
  THREE.WebGLRendererParameters,
  'context' | 'premultipliedAlpha'
> & {
  pixelRatio?: number;
};

const verifiedFloatRenderers = new WeakSet<THREE.WebGLRenderer>();

export interface RendererRuntimeDiagnostics {
  webgl2: 'supported' | 'unsupported' | 'unverified';
  floatRenderTargets: 'supported' | 'unsupported' | 'unverified';
  rendererCount: number;
  latestFailure: string | null;
}

const rendererRuntimeDiagnostics: RendererRuntimeDiagnostics = {
  webgl2: 'unverified',
  floatRenderTargets: 'unverified',
  rendererCount: 0,
  latestFailure: null,
};

export const getRendererRuntimeDiagnostics = (): RendererRuntimeDiagnostics => ({
  ...rendererRuntimeDiagnostics,
});

export const assertWebGL2Renderer = (renderer: THREE.WebGLRenderer): void => {
  if (!renderer.capabilities.isWebGL2) {
    rendererRuntimeDiagnostics.webgl2 = 'unsupported';
    rendererRuntimeDiagnostics.latestFailure = 'Blackboard Studio requires a WebGL2 renderer.';
    throw new Error('Blackboard Studio now requires a WebGL2 renderer.');
  }
  rendererRuntimeDiagnostics.webgl2 = 'supported';
};

export const assertFloatRenderTargetSupport = (renderer: THREE.WebGLRenderer): void => {
  if (verifiedFloatRenderers.has(renderer)) return;
  try {
    const extensions = renderer.extensions as THREE.WebGLExtensions | undefined;
    if (extensions && !extensions.has('EXT_color_buffer_float')) {
      throw new Error('Blackboard Studio requires floating-point render target support.');
    }

    const gl = renderer.getContext?.();
    if (gl && typeof gl.checkFramebufferStatus === 'function') {
      const previousTarget = renderer.getRenderTarget();
      const probes = [
        { label: 'RGBA16F', type: THREE.HalfFloatType },
        { label: 'RGBA32F', type: THREE.FloatType },
      ] as const;

      try {
        for (const probe of probes) {
          const target = new THREE.WebGLRenderTarget(1, 1, {
            type: probe.type,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
          });
          try {
            renderer.setRenderTarget(target);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
              throw new Error(
                `Blackboard Studio requires ${probe.label} render targets, but framebuffer creation ` +
                  `failed with WebGL status 0x${status.toString(16)}.`,
              );
            }
          } finally {
            target.dispose();
          }
        }
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
    }
    verifiedFloatRenderers.add(renderer);
    rendererRuntimeDiagnostics.floatRenderTargets = 'supported';
  } catch (error) {
    rendererRuntimeDiagnostics.floatRenderTargets = 'unsupported';
    rendererRuntimeDiagnostics.latestFailure =
      error instanceof Error ? error.message : String(error);
    throw error;
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
    premultipliedAlpha: false,
    preserveDrawingBuffer: rendererParameters.preserveDrawingBuffer,
    stencil: rendererParameters.stencil,
  } as WebGLContextAttributes);

  if (!context) {
    rendererRuntimeDiagnostics.latestFailure = 'Blackboard Studio now requires WebGL2 support.';
    throw new Error('Blackboard Studio now requires WebGL2 support.');
  }
  if (!context.getContextAttributes()) {
    rendererRuntimeDiagnostics.latestFailure =
      'Blackboard Studio could not initialize WebGL2 because the context is lost.';
    throw new Error('Blackboard Studio could not initialize WebGL2 because the context is lost.');
  }

  const renderer = new THREE.WebGLRenderer({
    ...rendererParameters,
    canvas,
    context,
    premultipliedAlpha: false,
  });
  renderer.setPixelRatio(pixelRatio);
  assertWebGL2Renderer(renderer);
  assertFloatRenderTargetSupport(renderer);
  rendererRuntimeDiagnostics.rendererCount += 1;
  return renderer;
};

interface StudioShaderMaterialCacheOptions {
  materials: Map<string, THREE.ShaderMaterial>;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  mesh: THREE.Mesh;
}

export class StudioShaderMaterialCache {
  private readonly materials: Map<string, THREE.ShaderMaterial>;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly mesh: THREE.Mesh;

  public constructor({
    materials,
    renderer,
    scene,
    camera,
    mesh,
  }: StudioShaderMaterialCacheOptions) {
    this.materials = materials;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.mesh = mesh;
  }

  public readonly get = (
    id: string,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform>,
  ): THREE.ShaderMaterial => {
    const existing = this.materials.get(id);
    if (existing) {
      Object.assign(existing.uniforms, uniforms);
      if (existing.fragmentShader !== fragmentShader) {
        existing.fragmentShader = fragmentShader;
        existing.needsUpdate = true;
        this.compile(existing);
      }
      return existing;
    }

    const material = new THREE.RawShaderMaterial({
      vertexShader: RendererShader.VERTEX,
      fragmentShader,
      uniforms,
      glslVersion: THREE.GLSL3,
    });
    this.materials.set(id, material);

    try {
      this.compile(material);
      return material;
    } catch (error) {
      this.materials.delete(id);
      material.dispose();
      throw error;
    }
  };

  private compile(material: THREE.ShaderMaterial): void {
    const previousMaterial = this.mesh.material;
    this.mesh.material = material;
    try {
      this.renderer.compile(this.scene, this.camera);
    } finally {
      this.mesh.material = previousMaterial;
    }
  }
}
