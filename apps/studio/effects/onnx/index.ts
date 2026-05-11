import {
  BlendMode,
  ImageFitMode,
  ImageTransform,
  NodeType,
  OnnxModelNode,
  SceneNode,
} from '@blackboard/types';
import { EffectDefinition, InputPortDescriptor } from '../EffectDefinition';
import { mediaTransformAnimation } from '../effectAnimationHelpers';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { DEPTH_ANYTHING_V2_RECIPE } from '@/services/onnx/modelRegistry';
import { getResolvedInputMetadata } from '@/services/onnx/onnxMetadataCache';
import OnnxAdjustments from './OnnxAdjustments';
import { OnnxTool } from './OnnxTool';
import * as Icons from '@blackboard/icons';

export const onnxEffect: EffectDefinition = {
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
    isSource: true,
    isRenderable: true,
    isMediaNode: true,
    showDataWindow: true,
    hasThumbnail: true,
  },
  nodeExecution: {
    label: 'Run ONNX',
    canExecute: (node) => Boolean((node as OnnxModelNode).modelId),
  },
  getInitialNodeProps: (): Omit<OnnxModelNode, 'id' | 'name' | 'visible' | 'type'> => ({
    modelId: undefined,
    modelName: DEPTH_ANYTHING_V2_RECIPE.name,
    modelRepo: DEPTH_ANYTHING_V2_RECIPE.defaultRepoName,
    variantId: undefined,
    variantLabel: 'Small ONNX',
    backend: 'webgpu',
    inputSize: { ...DEPTH_ANYTHING_V2_RECIPE.defaultInputSize },
    task: DEPTH_ANYTHING_V2_RECIPE.task,
    inputChannelModes: {},
    inputValues: undefined,
    outputs: undefined,
    activeOutputId: undefined,
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'Raw',
    lastRunAt: undefined,
    lastError: undefined,
  }),
  inputPorts: (node): InputPortDescriptor[] => {
    const modelId = (node as OnnxModelNode).modelId;
    const cached = modelId ? getResolvedInputMetadata(modelId) : null;
    if (cached && cached.length > 0) {
      const imageInputs = cached.filter((meta) => meta.kind === 'image');
      if (imageInputs.length === 0) {
        return [];
      }
      return imageInputs.map((meta) => ({
        name: meta.name,
        label: meta.name.charAt(0).toUpperCase() + meta.name.slice(1),
        type: 'texture' as const,
        required: true,
        description: `Model input "${meta.name}" (${meta.dimsLabel}, ${meta.type})`,
      }));
    }
    return [
      {
        name: 'image',
        label: 'Image',
        type: 'texture',
        required: true,
        description: 'Input image for browser ONNX inference.',
      },
    ];
  },
  getAssetIds: (node) => {
    const src = (node as OnnxModelNode).src;
    return src ? [src] : [];
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      const src = (node as OnnxModelNode).src;
      return src ? [src] : [];
    },
    checkFrameReady: (node, _frame, caches) => {
      const src = (node as OnnxModelNode).src;
      return !src || caches.imageCache.has(src);
    },
    getMediaTextureKey: (node) => (node as OnnxModelNode).src || '',
    getColorSpace: (node) => (node as OnnxModelNode).colorSpace,
  },
  onNodeUpdate: (node, changes, context) => {
    const onnxNode = node as OnnxModelNode;

    if ('transform' in changes && changes.transform && context.sceneNode) {
      const oldTransform = onnxNode.transform;
      const newTransformPartial = changes.transform as Partial<ImageTransform>;
      const sceneNode = context.sceneNode as SceneNode;
      const label = `Transform ${node.name}`;

      if (newTransformPartial.fitMode && newTransformPartial.fitMode !== oldTransform.fitMode) {
        const { scaleX, scaleY } = calculateTransformForFitMode(
          { width: onnxNode.width, height: onnxNode.height },
          { width: sceneNode.width, height: sceneNode.height },
          newTransformPartial.fitMode,
        );
        return {
          changes: {
            ...changes,
            transform: { ...oldTransform, ...newTransformPartial, scaleX, scaleY, x: 0, y: 0 },
          },
          label,
        };
      }

      return {
        changes: {
          ...changes,
          transform: { ...oldTransform, ...newTransformPartial },
        },
        label,
      };
    }

    return { changes };
  },
};
