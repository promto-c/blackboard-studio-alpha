import { AnyNode, BlurNode, NodeType, BlurMethod } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import {
  createAnimatablePropertyCollector,
  type NodeAnimationBehavior,
} from '../../animationHelpers';
import BlurAdjustments from './BlurAdjustments';
import * as Icons from '@blackboard/icons';
import { BlurTool } from './BlurTool';
import { BlurShader } from './blurShader';
import { getValueAtFrame } from '@blackboard/renderer';

const blurAnimation: NodeAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const blurNode = node as BlurNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Radius', 'blur.radius', blurNode.blur.radius, 'Blur');

    return props;
  },
};

export const blurNode: NodeDefinition = {
  type: NodeType.BLUR,
  name: 'Blur',
  category: 'Adjustment',
  renderMode: 'multipass',
  processingDomain: 'scene_linear',
  alphaInputBehavior: 'propagate',
  description: 'Add a blur adjustment node.',
  IconComponent: Icons.Blur,
  ToolComponent: BlurTool,
  AdjustmentComponent: BlurAdjustments,
  flags: {},
  adaptivePreview: { resolutionScale: true, sampleLimit: true },
  animation: blurAnimation,
  exposableFields: [
    {
      path: 'blur.method',
      label: 'Method',
      section: 'Parameters',
      control: 'select',
      options: [
        { value: BlurMethod.GAUSSIAN, label: 'Gaussian' },
        { value: BlurMethod.BOX, label: 'Box' },
        { value: BlurMethod.ITERATED_BOX, label: '3× Box' },
      ],
    },
    {
      path: 'blur.radius',
      label: 'Radius',
      section: 'Parameters',
      control: 'slider',
      min: 0,
      max: 100,
      step: 0.1,
      animatable: true,
    },
  ],
  getInitialNodeProps: () => ({
    blur: { radius: 5, method: BlurMethod.GAUSSIAN },
  }),
  getShader: (node: AnyNode) => {
    const blurNode = node as BlurNode;
    const method = blurNode.blur?.method || BlurMethod.GAUSSIAN;
    if (method === BlurMethod.BOX) {
      return { horizontal: BlurShader.BOX_H, vertical: BlurShader.BOX_V };
    }
    if (method === BlurMethod.ITERATED_BOX) {
      return { horizontal: BlurShader.ITERATED_BOX_H, vertical: BlurShader.ITERATED_BOX_V };
    }
    return { horizontal: BlurShader.GAUSSIAN_H, vertical: BlurShader.GAUSSIAN_V };
  },
  getUniforms: (node: AnyNode, context) => {
    const blurNode = node as BlurNode;
    const radius = getValueAtFrame(blurNode.blur.radius, context.frame);
    return {
      u_radius: { value: radius },
      u_resolution_x: { value: context.scene.width },
      u_resolution_y: { value: context.scene.height },
    };
  },
  renderScale: (node: AnyNode, context) => {
    const blurNode = node as BlurNode;
    const radius = getValueAtFrame(blurNode.blur.radius, context.frame);
    const sigma = radius / 2.0;
    const largeKernelScale = sigma < 1 ? 1 : Math.min(1, 20 / sigma);
    if (context.quality.mode !== 'preview' || radius <= 0) return largeKernelScale;

    const method = blurNode.blur?.method || BlurMethod.GAUSSIAN;
    const kernelExtent =
      method === BlurMethod.ITERATED_BOX
        ? radius * 3
        : method === BlurMethod.BOX
          ? radius
          : sigma * 3;
    if (kernelExtent <= context.quality.sampleLimit) return largeKernelScale;
    const sampleBudgetScale = context.quality.sampleLimit / Math.max(1, kernelExtent);
    return Math.min(largeKernelScale, sampleBudgetScale, context.quality.resolutionScale);
  },
};
