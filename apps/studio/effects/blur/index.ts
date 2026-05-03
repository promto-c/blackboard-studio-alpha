import { AnyNode, BlurNode, NodeType, BlurMethod } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import {
  createAnimatablePropertyCollector,
  type EffectAnimationBehavior,
} from '../effectAnimationHelpers';
import BlurAdjustments from './BlurAdjustments';
import * as Icons from '@blackboard/icons';
import { BlurTool } from './BlurTool';
import { BLUR_H_SHADER, BLUR_V_SHADER, BOX_BLUR_H_SHADER, BOX_BLUR_V_SHADER } from './blurShader';
// FIX: Import getValueAtFrame to handle animated properties.
import { getValueAtFrame } from '@blackboard/renderer';

const blurAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const blurNode = node as BlurNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Radius', 'blur.radius', blurNode.blur.radius, 'Blur');

    return props;
  },
};

export const blurEffect: EffectDefinition = {
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
      return { horizontal: BOX_BLUR_H_SHADER, vertical: BOX_BLUR_V_SHADER };
    }
    return { horizontal: BLUR_H_SHADER, vertical: BLUR_V_SHADER };
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
};
