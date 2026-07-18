import * as THREE from 'three';
import type { AnyNode, MaskedMergeNode, RgbaChannel } from '@blackboard/types';
import {
  getValueAtFrame,
  isPromiseLike,
  resolveRendererNodeOutputPort,
  type ResolveOutputContext,
} from '@blackboard/renderer';
import { MASKED_MERGE_SHADER } from './maskedMergeShader';
import {
  DEFAULT_MASKED_MERGE_ALPHA_OPERATION,
  DEFAULT_MASKED_MERGE_MIX,
} from './maskedMergeDefaults';

const ALPHA_OPERATION_INDEX: Record<MaskedMergeNode['alphaOperation'], number> = {
  replace: 0,
  union: 1,
  subtract: 2,
  intersect: 3,
};

const getMaskChannel = (
  sourceNodeId: string | undefined,
  sourcePortName: string,
  context: ResolveOutputContext,
): RgbaChannel => {
  const sourceNode = context.nodes.find((candidate) => candidate.id === sourceNodeId);
  const sourceDefinition = sourceNode ? context.nodeRegistry.get(sourceNode.type) : undefined;
  return sourceNode && sourceDefinition
    ? (resolveRendererNodeOutputPort(sourceDefinition, sourceNode, sourcePortName)?.channel ?? 'a')
    : 'a';
};

export const renderMaskedMergeGpu = (
  anyNode: AnyNode,
  target: THREE.WebGLRenderTarget,
  inputTexture: THREE.Texture | undefined,
  context: ResolveOutputContext,
): boolean | Promise<boolean> => {
  const node = anyNode as MaskedMergeNode;
  const sourceTexture = inputTexture ?? context.getTransparentInputTexture();
  const maskNodeId = node.inputs?.mask;
  const maskSourceNode = context.nodes.find((candidate) => candidate.id === maskNodeId);
  const maskSourcePort = context.getInputSourcePort(node, 'mask');
  const maskChannel = getMaskChannel(maskNodeId, maskSourcePort, context);
  const maskResult =
    maskNodeId && maskSourceNode?.enabled
      ? context.resolveOutput(maskNodeId, maskSourcePort)
      : undefined;

  const render = (maskTexture: THREE.Texture | undefined): boolean => {
    const material = context.getMaterial(`${node.id}:masked-merge`, MASKED_MERGE_SHADER, {
      u_tSource: { value: sourceTexture },
      u_tMask: { value: maskTexture ?? context.getTransparentInputTexture() },
      u_hasMask: { value: !!maskTexture },
      u_maskChannel: { value: context.getChannelIndex(maskChannel, 'a') },
      u_alphaOperation: {
        value: ALPHA_OPERATION_INDEX[node.alphaOperation ?? DEFAULT_MASKED_MERGE_ALPHA_OPERATION],
      },
      u_mix: {
        value: getValueAtFrame(node.mix ?? DEFAULT_MASKED_MERGE_MIX, context.frame) / 100,
      },
    });
    context.applyNoBlending(material);
    context.quad.material = material;
    context.renderer.setRenderTarget(target);
    context.renderer.render(context.scene, context.camera);
    return true;
  };

  return isPromiseLike(maskResult) ? maskResult.then(render) : render(maskResult);
};
