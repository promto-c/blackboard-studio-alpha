import { NodeType } from '@blackboard/types';
import { createShaderNodeDefinition } from '../../nodeFactoryHelpers';
import LensDistortionAdjustments from './LensDistortionAdjustments';
import { LensDistortionIcon } from './LensDistortionIcon';
import { LensDistortionTool } from './LensDistortionTool';
import { LENS_DISTORTION_SHADER } from './lensDistortionShader';

export const lensDistortionNode = createShaderNodeDefinition({
  type: NodeType.LENS_DISTORTION,
  name: 'Lens Distortion',
  description: 'Simulates lens distortion effects like barrel or pincushion.',
  IconComponent: LensDistortionIcon,
  ToolComponent: LensDistortionTool,
  AdjustmentComponent: LensDistortionAdjustments,
  shader: LENS_DISTORTION_SHADER,
  supportsVector2: true,
});
