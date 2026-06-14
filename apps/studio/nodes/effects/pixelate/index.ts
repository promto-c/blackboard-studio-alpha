import { NodeType } from '@blackboard/types';
import { createShaderNodeDefinition } from '../../nodeFactoryHelpers';
import PixelateAdjustments from './PixelateAdjustments';
import * as Icons from '@blackboard/icons';
import { PixelateTool } from './PixelateTool';
import { PIXELATE_SHADER } from './pixelateShader';

export const pixelateNode = createShaderNodeDefinition({
  type: NodeType.PIXELATE,
  name: 'Pixelate',
  description: 'Add a pixelation and color quantization effect.',
  IconComponent: Icons.Pixelate,
  ToolComponent: PixelateTool,
  AdjustmentComponent: PixelateAdjustments,
  shader: PIXELATE_SHADER,
});
