import * as THREE from 'three';
import type { AnyNode, MatteControlNode } from '@blackboard/types';
import type { ResolveOutputContext } from '@blackboard/renderer';
import { resolveMatteControlSettings } from './matteControlModel';
import {
  MATTE_CONTROL_BLUR_HORIZONTAL_SHADER,
  MATTE_CONTROL_BLUR_VERTICAL_SHADER,
  MATTE_CONTROL_DIRECT_SHADER,
  MATTE_CONTROL_FINAL_SHADER,
  MATTE_CONTROL_MORPH_HORIZONTAL_SHADER,
  MATTE_CONTROL_MORPH_VERTICAL_SHADER,
  MATTE_CONTROL_PREPARE_SHADER,
} from './matteControlShaders';

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

const renderResolvedMatteControl = (
  node: MatteControlNode,
  target: THREE.WebGLRenderTarget,
  sourceTexture: THREE.Texture,
  context: ResolveOutputContext,
): boolean => {
  const settings = resolveMatteControlSettings(node, context.frame);
  const hasMorphology = Math.abs(settings.erodeDilate) >= 1;
  const hasEdgeBlur = settings.edgeBlur >= 0.25;
  if (!hasMorphology && !hasEdgeBlur) {
    const directMaterial = context.getMaterial(
      `${node.id}:matte-control:direct`,
      MATTE_CONTROL_DIRECT_SHADER,
      {
        u_tSource: { value: sourceTexture },
        u_clampBlack: { value: settings.clampBlack },
        u_clampWhite: { value: settings.clampWhite },
        u_invert: { value: settings.invert },
      },
    );
    renderPass(context, directMaterial, target);
    return true;
  }

  if (!context.getScratchRenderTarget) return false;
  const renderScale = context.quality?.resolutionScale ?? 1;
  const scratchSize = {
    width: Math.max(1, Math.round(target.width * renderScale)),
    height: Math.max(1, Math.round(target.height * renderScale)),
  };
  const qualityKey = context.quality?.mode === 'preview' ? 'preview' : 'full';
  let readTarget = context.getScratchRenderTarget(`matte-control:${qualityKey}:read`, scratchSize);
  let writeTarget = context.getScratchRenderTarget(
    `matte-control:${qualityKey}:write`,
    scratchSize,
  );
  const width = Math.max(1, readTarget.width);
  const height = Math.max(1, readTarget.height);
  const sampleLimit = context.quality?.sampleLimit ?? 128;
  const swapTargets = () => {
    [readTarget, writeTarget] = [writeTarget, readTarget];
  };

  const prepare = context.getMaterial(
    `${node.id}:matte-control:prepare`,
    MATTE_CONTROL_PREPARE_SHADER,
    {
      u_tSource: { value: sourceTexture },
    },
  );
  renderPass(context, prepare, readTarget);

  if (hasMorphology) {
    const previewRadius = settings.erodeDilate * renderScale;
    const horizontal = context.getMaterial(
      `${node.id}:matte-control:morph-horizontal`,
      MATTE_CONTROL_MORPH_HORIZONTAL_SHADER,
      {
        u_tMatte: { value: readTarget.texture },
        u_radius: { value: previewRadius },
        u_resolution: { value: width },
        u_sampleLimit: { value: sampleLimit },
      },
    );
    renderPass(context, horizontal, writeTarget);
    swapTargets();

    const vertical = context.getMaterial(
      `${node.id}:matte-control:morph-vertical`,
      MATTE_CONTROL_MORPH_VERTICAL_SHADER,
      {
        u_tMatte: { value: readTarget.texture },
        u_radius: { value: previewRadius },
        u_resolution: { value: height },
        u_sampleLimit: { value: sampleLimit },
      },
    );
    renderPass(context, vertical, writeTarget);
    swapTargets();
  }

  if (hasEdgeBlur) {
    const previewRadius = settings.edgeBlur * renderScale;
    const horizontal = context.getMaterial(
      `${node.id}:matte-control:blur-horizontal`,
      MATTE_CONTROL_BLUR_HORIZONTAL_SHADER,
      {
        u_tMatte: { value: readTarget.texture },
        u_radius: { value: previewRadius },
        u_resolution: { value: width },
        u_sampleLimit: { value: sampleLimit },
      },
    );
    renderPass(context, horizontal, writeTarget);
    swapTargets();

    const vertical = context.getMaterial(
      `${node.id}:matte-control:blur-vertical`,
      MATTE_CONTROL_BLUR_VERTICAL_SHADER,
      {
        u_tMatte: { value: readTarget.texture },
        u_radius: { value: previewRadius },
        u_resolution: { value: height },
        u_sampleLimit: { value: sampleLimit },
      },
    );
    renderPass(context, vertical, writeTarget);
    swapTargets();
  }

  const finalMaterial = context.getMaterial(
    `${node.id}:matte-control:final`,
    MATTE_CONTROL_FINAL_SHADER,
    {
      u_tSource: { value: sourceTexture },
      u_tMatte: { value: readTarget.texture },
      u_clampBlack: { value: settings.clampBlack },
      u_clampWhite: { value: settings.clampWhite },
      u_invert: { value: settings.invert },
    },
  );
  renderPass(context, finalMaterial, target);
  return true;
};

/** Render the complete Matte Control operation in float GPU passes. */
export const renderMatteControlGpu = (
  anyNode: AnyNode,
  target: THREE.WebGLRenderTarget,
  inputTexture: THREE.Texture | undefined,
  context: ResolveOutputContext,
): boolean => {
  const node = anyNode as MatteControlNode;
  const sourceTexture = inputTexture ?? context.getTransparentInputTexture();
  return renderResolvedMatteControl(node, target, sourceTexture, context);
};
