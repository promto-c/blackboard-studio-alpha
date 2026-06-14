import * as THREE from 'three';
import { BlendMode, ImageFitMode, NodeType, OnnxModelNode } from '@blackboard/types';
import { type ResolveOutputContext } from '@blackboard/renderer';
import { NodeDefinition, InputPortDescriptor, OutputPortDescriptor } from '../../NodeDefinition';
import { mediaTransformAnimation } from '../../animationHelpers';
import { GENERIC_ONNX_RECIPE } from '@/services/onnx/modelRegistry';
import { getResolvedInputMetadata } from '@/services/onnx/onnxMetadataCache';
import OnnxAdjustments from './OnnxAdjustments';
import { OnnxTool } from './OnnxTool';
import * as Icons from '@blackboard/icons';
import { createSourceTransformUpdate, sourceMediaNodeFlags } from '../../sourceNodeBehavior';
import { getOnnxInputPortName } from '../../portMapping';

const ONNX_OUTPUT_SHADER = `
  precision highp float;
  uniform sampler2D u_tDiffuse;
  in vec2 v_uv;
  out vec4 fragColor;
  void main() {
    fragColor = texture(u_tDiffuse, v_uv);
  }
`;

export const onnxNode: NodeDefinition = {
  type: NodeType.ONNX_MODEL,
  name: 'ONNX Model',
  category: 'Image',
  renderMode: 'media',
  description: 'Run an installed browser ONNX model and render its output as a node.',
  IconComponent: Icons.CubeTransparent,
  ToolComponent: OnnxTool,
  AdjustmentComponent: OnnxAdjustments,
  animation: mediaTransformAnimation,
  flags: {
    ...sourceMediaNodeFlags,
  },
  nodeExecution: {
    label: 'Run ONNX',
    canExecute: (node) => Boolean((node as OnnxModelNode).modelId),
  },
  getInitialNodeProps: (): Omit<OnnxModelNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    modelId: undefined,
    modelName: GENERIC_ONNX_RECIPE.name,
    modelRepo: GENERIC_ONNX_RECIPE.defaultRepoName,
    variantId: undefined,
    variantLabel: '',
    backend: 'webgpu',
    inputSize: { ...GENERIC_ONNX_RECIPE.defaultInputSize },
    task: GENERIC_ONNX_RECIPE.task,
    inputChannelModes: {},
    inputNormalizationOverrides: {},
    outputNormalizationOverrides: {},
    inputValues: undefined,
    outputs: undefined,
    activeOutputId: undefined,
    resultBehavior: undefined,
    frames: undefined,
    outputFrameSrcs: undefined,
    startFrame: undefined,
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'Raw',
    useOutputSizeAsScene: false,
    lastRunAt: undefined,
    lastError: undefined,
  }),
  inputPorts: (node): InputPortDescriptor[] => {
    const onnxNode = node as OnnxModelNode;
    const modelId = onnxNode.modelId;
    const cached = modelId ? getResolvedInputMetadata(modelId) : null;
    if (cached && cached.length > 0) {
      const imageInputs = cached.filter((meta) => meta.kind === 'image');
      if (imageInputs.length === 0) {
        return [];
      }
      const declaredPortNames = new Set(imageInputs.map((meta) => meta.name));
      return imageInputs.map((meta) => {
        const name =
          imageInputs.length === 1
            ? getOnnxInputPortName(
                onnxNode as { inputs?: Record<string, string> },
                declaredPortNames,
                meta.name,
              )
            : meta.name;
        return {
          name,
          label: meta.name.charAt(0).toUpperCase() + meta.name.slice(1),
          type: 'texture' as const,
          required: true,
          description: `Model input "${meta.name}" (${meta.dimsLabel}, ${meta.type})`,
        };
      });
    }
    return [
      {
        name: getOnnxInputPortName(
          onnxNode as { inputs?: Record<string, string> },
          new Set(['image']),
          'image',
        ),
        label: 'Image',
        type: 'texture',
        required: true,
        description: 'Input image for browser ONNX inference.',
      },
    ];
  },
  outputPorts: (node): OutputPortDescriptor[] => {
    const onnxNode = node as OnnxModelNode;
    return (onnxNode.outputs ?? [])
      .filter((o) => o.kind === 'image')
      .map((o) => ({
        name: o.id,
        label: o.name.charAt(0).toUpperCase() + o.name.slice(1),
        description: `Model output "${o.name}" (${o.type}, ${o.width}x${o.height})`,
      }));
  },
  renderOutput: (
    node: OnnxModelNode,
    target: THREE.WebGLRenderTarget,
    _inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
    portName?: string,
  ): boolean => {
    const output = node.outputs?.find((o) => o.id === portName);
    if (!output?.src) return false;
    const portNode: OnnxModelNode = { ...node, activeOutputId: output.id };
    const texture = context.getMediaTexture(portNode, context.frame);
    if (!texture) return false;
    const material = context.getMaterial(`${node.id}:onnx-output:${portName}`, ONNX_OUTPUT_SHADER, {
      u_tDiffuse: { value: texture },
    });
    context.applyNoBlending(material);
    context.clearRenderTargetTransparent(target);
    (context.quad as THREE.Mesh).material = material;
    context.renderer.setRenderTarget(target);
    context.renderer.render(context.scene, context.camera);
    return true;
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      const onnxNode = node as OnnxModelNode;
      const ids: string[] = [];
      if (onnxNode.src) ids.push(onnxNode.src);
      if (onnxNode.frames) {
        for (const frameSrc of onnxNode.frames) {
          if (frameSrc && !ids.includes(frameSrc)) ids.push(frameSrc);
        }
      }
      // Include all image output asset IDs so they stay cached and available
      // when the user switches between outputs in the UI.
      if (onnxNode.outputs) {
        for (const output of onnxNode.outputs) {
          if (output.kind === 'image' && output.src && !ids.includes(output.src)) {
            ids.push(output.src);
          }
        }
      }
      // Include per-frame srcs from all outputs so frame-specific data
      // is cached and available when switching outputs in sequence mode.
      if (onnxNode.outputFrameSrcs) {
        for (const srcs of Object.values(onnxNode.outputFrameSrcs)) {
          for (const src of srcs) {
            if (src && !ids.includes(src)) {
              ids.push(src);
            }
          }
        }
      }
      return ids;
    },
    checkFrameReady: (node, frame, caches) => {
      const onnxNode = node as OnnxModelNode;
      if (onnxNode.resultBehavior === 'frame_sequence' && onnxNode.frames?.length) {
        const startFrame = onnxNode.startFrame ?? 0;
        const frameIndex = frame - startFrame;
        // When an active output is selected, check frame-specific src from outputFrameSrcs
        if (onnxNode.activeOutputId && onnxNode.outputFrameSrcs) {
          const activeOutput = onnxNode.outputs?.find((o) => o.id === onnxNode.activeOutputId);
          const outputName = activeOutput?.name;
          const frameSrc = outputName
            ? onnxNode.outputFrameSrcs[outputName]?.[frameIndex]
            : undefined;
          return !frameSrc || caches.imageCache.has(frameSrc);
        }
        const frameSrc = onnxNode.frames[frameIndex];
        return !frameSrc || caches.imageCache.has(frameSrc);
      }
      // Static mode with active output: check the output's src
      const activeSrc = onnxNode.activeOutputId
        ? onnxNode.outputs?.find((o) => o.id === onnxNode.activeOutputId)?.src
        : undefined;
      if (activeSrc) {
        return caches.imageCache.has(activeSrc);
      }
      const src = onnxNode.src;
      return !src || caches.imageCache.has(src);
    },
    getMediaTextureKey: (node, frame) => {
      const onnxNode = node as OnnxModelNode;
      if (onnxNode.resultBehavior === 'frame_sequence' && onnxNode.frames?.length) {
        const startFrame = onnxNode.startFrame ?? 0;
        const frameIndex = frame - startFrame;
        // When an active output is selected, use per-frame data from outputFrameSrcs
        if (onnxNode.activeOutputId && onnxNode.outputFrameSrcs) {
          const activeOutput = onnxNode.outputs?.find((o) => o.id === onnxNode.activeOutputId);
          const outputName = activeOutput?.name;
          if (outputName) {
            const frameSrc = onnxNode.outputFrameSrcs[outputName]?.[frameIndex];
            if (frameSrc) return frameSrc;
          }
        }
        return onnxNode.frames[frameIndex] || '';
      }
      // Static mode with active output: use the output's src
      const activeOutput = onnxNode.activeOutputId
        ? onnxNode.outputs?.find((o) => o.id === onnxNode.activeOutputId)
        : undefined;
      if (activeOutput?.kind === 'image' && activeOutput.src) {
        return activeOutput.src;
      }
      return onnxNode.src || '';
    },
    getColorSpace: (node) => (node as OnnxModelNode).colorSpace,
  },
  onNodeUpdate: (node, changes, context) => {
    return createSourceTransformUpdate(node as OnnxModelNode, changes, context) ?? { changes };
  },
};
