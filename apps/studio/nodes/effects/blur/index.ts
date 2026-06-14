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
  description: 'Add a blur adjustment node.',
  IconComponent: Icons.Blur,
  ToolComponent: BlurTool,
  AdjustmentComponent: BlurAdjustments,
  flags: {},
  animation: blurAnimation,
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
    if (sigma < 1) return 1;
    // Downsample when sigma > 20 to keep kernel small
    return Math.min(1, 20 / sigma);
  },
};
