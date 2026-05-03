import { AnyNode, GradeNode, NodeType } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import {
  createAnimatablePropertyCollector,
  type EffectAnimationBehavior,
} from '../effectAnimationHelpers';
import GradeAdjustments from './GradeAdjustments';
import * as Icons from '@blackboard/icons';
import { GradeTool } from './GradeTool';
import { GRADE_SHADER } from './gradeShader';
import { getValueAtFrame } from '@blackboard/renderer';

const gradeAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const gradeNode = node as GradeNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Brightness', 'grade.brightness', gradeNode.grade.brightness, 'Grade');
    addProp('Contrast', 'grade.contrast', gradeNode.grade.contrast, 'Grade');
    addProp('Saturation', 'grade.saturation', gradeNode.grade.saturation, 'Grade');
    addProp('Gain', 'grade.gain', gradeNode.grade.gain, 'Grade');
    addProp('Gamma', 'grade.gamma', gradeNode.grade.gamma, 'Grade');

    return props;
  },
};

export const gradeEffect: EffectDefinition = {
  type: NodeType.GRADE,
  name: 'Grade',
  category: 'Adjustment',
  renderMode: 'shader',
  description: 'Add a color grading adjustment node.',
  IconComponent: Icons.Sun,
  ToolComponent: GradeTool,
  AdjustmentComponent: GradeAdjustments,
  flags: {},
  animation: gradeAnimation,
  getInitialNodeProps: () => ({
    grade: { brightness: 0, contrast: 1, saturation: 1, gain: 1, gamma: 1 },
  }),
  getShader: () => GRADE_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const gradeNode = node as GradeNode;
    const brightness = getValueAtFrame(gradeNode.grade.brightness, context.frame);
    const contrast = getValueAtFrame(gradeNode.grade.contrast, context.frame);
    const saturation = getValueAtFrame(gradeNode.grade.saturation, context.frame);
    const gain = getValueAtFrame(gradeNode.grade.gain, context.frame);
    const gamma = getValueAtFrame(gradeNode.grade.gamma, context.frame);
    return {
      u_brightness: { value: brightness },
      u_contrast: { value: contrast },
      u_saturation: { value: saturation },
      u_gain: { value: gain },
      u_gamma: { value: gamma },
    };
  },
};
