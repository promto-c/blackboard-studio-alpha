import * as THREE from 'three';
import type { RendererMaskLayer, ResolveOutputContext } from '@blackboard/renderer';
import { BlurShader } from '../../effects/blur/blurShader';

const COMPOSITE_MASK_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tBase;
uniform sampler2D u_tLayer;
uniform float u_opacity;
uniform int u_operation;
out vec4 fragColor;

void main() {
  float base = texture(u_tBase, v_uv).r;
  float layer = clamp(texture(u_tLayer, v_uv).a * u_opacity, 0.0, 1.0);
  float mask = u_operation == 0
    ? layer + base * (1.0 - layer)
    : base * (1.0 - layer);
  fragColor = vec4(mask, mask, mask, 1.0);
}
`;

const ACCUMULATE_MASK_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tSample;
uniform float u_weight;
out vec4 fragColor;

void main() {
  float mask = texture(u_tSample, v_uv).a * u_weight;
  fragColor = vec4(mask, mask, mask, mask);
}
`;

const renderPass = (
  context: ResolveOutputContext,
  material: THREE.ShaderMaterial,
  target: THREE.WebGLRenderTarget,
) => {
  context.applyNoBlending(material);
  context.quad.material = material;
  context.renderer.setRenderTarget(target);
  context.renderer.render(context.scene, context.camera);
};

export const renderFloatRotoMask = (
  nodeId: string,
  layers: readonly RendererMaskLayer[],
  context: ResolveOutputContext,
): THREE.Texture | null => {
  if (!context.getScratchRenderTarget) return null;

  let maskRead = context.getScratchRenderTarget('roto-mask-a');
  let maskWrite = context.getScratchRenderTarget('roto-mask-b');
  let blurHorizontal: THREE.WebGLRenderTarget | undefined;
  let blurVertical: THREE.WebGLRenderTarget | undefined;
  const getBlurHorizontal = () =>
    (blurHorizontal ??= context.getScratchRenderTarget!('roto-blur-h'));
  const getBlurVertical = () => (blurVertical ??= context.getScratchRenderTarget!('roto-blur-v'));
  context.clearRenderTargetTransparent(maskRead);

  const width = Math.max(1, maskRead.width);
  const height = Math.max(1, maskRead.height);
  layers.forEach((layer, index) => {
    if (layer.samples.length === 0) return;
    const firstSample = layer.samples[0];
    let layerTexture = firstSample.texture;
    if (layer.samples.length > 1) {
      const accumulationTarget = getBlurVertical();
      context.clearRenderTargetTransparent(accumulationTarget);
      const accumulate = context.getMaterial(
        `${nodeId}:roto-motion-accumulate`,
        ACCUMULATE_MASK_SHADER,
        {
          u_tSample: { value: layerTexture },
          u_weight: { value: 1 },
        },
      );
      accumulate.transparent = true;
      accumulate.blending = THREE.CustomBlending;
      accumulate.blendEquation = THREE.AddEquation;
      accumulate.blendSrc = THREE.OneFactor;
      accumulate.blendDst = THREE.OneFactor;
      context.quad.material = accumulate;
      context.renderer.setRenderTarget(accumulationTarget);
      layer.samples.forEach((sample) => {
        sample.prepare?.();
        accumulate.uniforms.u_tSample.value = sample.texture;
        accumulate.uniforms.u_weight.value = sample.weight;
        context.renderer.render(context.scene, context.camera);
      });
      layerTexture = accumulationTarget.texture;
    } else {
      firstSample.prepare?.();
    }
    if (layer.feather > 0) {
      const horizontalTarget = getBlurHorizontal();
      const verticalTarget = getBlurVertical();
      const horizontal = context.getMaterial(`${nodeId}:roto-feather-h`, BlurShader.GAUSSIAN_H, {
        u_tDiffuse: { value: layerTexture },
        u_radius: { value: layer.feather },
        u_resolution_x: { value: width },
      });
      renderPass(context, horizontal, horizontalTarget);
      const vertical = context.getMaterial(`${nodeId}:roto-feather-v`, BlurShader.GAUSSIAN_V, {
        u_tDiffuse: { value: horizontalTarget.texture },
        u_radius: { value: layer.feather },
        u_resolution_y: { value: height },
      });
      renderPass(context, vertical, verticalTarget);
      layerTexture = verticalTarget.texture;
    }

    const composite = context.getMaterial(
      `${nodeId}:roto-composite:${index}`,
      COMPOSITE_MASK_SHADER,
      {
        u_tBase: { value: maskRead.texture },
        u_tLayer: { value: layerTexture },
        u_opacity: { value: layer.opacity },
        u_operation: { value: layer.operation === 'subtract' ? 1 : 0 },
      },
    );
    renderPass(context, composite, maskWrite);
    [maskRead, maskWrite] = [maskWrite, maskRead];
  });

  return maskRead.texture;
};
