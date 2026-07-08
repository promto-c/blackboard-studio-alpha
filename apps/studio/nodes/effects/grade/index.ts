import { AnyNode, GradeNode, NodeType } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import {
  createAnimatablePropertyCollector,
  type NodeAnimationBehavior,
} from '../../animationHelpers';
import GradeAdjustments from './GradeAdjustments';
import * as Icons from '@blackboard/icons';
import { GradeTool } from './GradeTool';
import { GRADE_SHADER } from './gradeShader';
import { getValueAtFrame } from '@blackboard/renderer';
import { Vector3 } from 'three';
import {
  createDefaultGrade,
  getGradeProperty,
  getGradeRgbAtFrame,
  type GradeChannel,
  type GradeRgbPath,
} from './gradeModel';

const RGB_CHANNELS: GradeChannel[] = ['r', 'g', 'b'];
const RGB_CONTROLS: Array<{ label: string; path: GradeRgbPath }> = [
  { label: 'Lift', path: 'lift' },
  { label: 'Gamma', path: 'gamma' },
  { label: 'Gain', path: 'gain' },
  { label: 'CDL Slope', path: 'cdl.slope' },
  { label: 'CDL Offset', path: 'cdl.offset' },
  { label: 'CDL Power', path: 'cdl.power' },
];

const gradeAnimation: NodeAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const gradeNode = node as GradeNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Exposure', 'grade.exposure', gradeNode.grade.exposure, 'Primary');
    addProp('Contrast', 'grade.contrast', gradeNode.grade.contrast, 'Grade');
    addProp('Contrast Pivot', 'grade.contrastPivot', gradeNode.grade.contrastPivot, 'Primary');
    addProp('Saturation', 'grade.saturation', gradeNode.grade.saturation, 'Grade');
    RGB_CONTROLS.forEach(({ label, path }) => {
      RGB_CHANNELS.forEach((channel) => {
        const propertyPath = `${path}.${channel}`;
        addProp(
          `${label} ${channel.toUpperCase()}`,
          `grade.${propertyPath}`,
          getGradeProperty(gradeNode.grade, propertyPath),
          label.startsWith('CDL') ? 'CDL' : 'Lift / Gamma / Gain',
        );
      });
    });
    addProp('CDL Saturation', 'grade.cdl.saturation', gradeNode.grade.cdl.saturation, 'CDL');

    return props;
  },
};

export const gradeNode: NodeDefinition = {
  type: NodeType.GRADE,
  name: 'Grade',
  category: 'Adjustment',
  renderMode: 'shader',
  processingDomain: (node) => (node as GradeNode).grade.processingDomain,
  description: 'Add a color grading adjustment node.',
  IconComponent: Icons.Sun,
  ToolComponent: GradeTool,
  AdjustmentComponent: GradeAdjustments,
  flags: {},
  animation: gradeAnimation,
  getInitialNodeProps: () => ({ grade: createDefaultGrade() }),
  getShader: () => GRADE_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const gradeNode = node as GradeNode;
    const { grade } = gradeNode;
    return {
      u_exposure: { value: getValueAtFrame(grade.exposure, context.frame) },
      u_contrast: { value: getValueAtFrame(grade.contrast, context.frame) },
      u_contrastPivot: { value: getValueAtFrame(grade.contrastPivot, context.frame) },
      u_saturation: { value: getValueAtFrame(grade.saturation, context.frame) },
      u_lift: { value: new Vector3(...getGradeRgbAtFrame(grade.lift, context.frame)) },
      u_gamma: { value: new Vector3(...getGradeRgbAtFrame(grade.gamma, context.frame)) },
      u_gain: { value: new Vector3(...getGradeRgbAtFrame(grade.gain, context.frame)) },
      u_cdlSlope: { value: new Vector3(...getGradeRgbAtFrame(grade.cdl.slope, context.frame)) },
      u_cdlOffset: { value: new Vector3(...getGradeRgbAtFrame(grade.cdl.offset, context.frame)) },
      u_cdlPower: { value: new Vector3(...getGradeRgbAtFrame(grade.cdl.power, context.frame)) },
      u_cdlSaturation: { value: getValueAtFrame(grade.cdl.saturation, context.frame) },
      u_outOfGamutMode: { value: grade.outOfGamut === 'clamp_negative' ? 1 : 0 },
    };
  },
};
