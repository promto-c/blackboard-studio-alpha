import { NodeType } from '@blackboard/types';
import { createShaderNodeDefinition } from '../../nodeFactoryHelpers';
import LiquidGlassAdjustments from './LiquidGlassAdjustments';
import * as Icons from '@blackboard/icons';
import { LiquidGlassTool } from './LiquidGlassTool';
import { LIQUID_GLASS_SHADER } from './liquidGlassShader';

export const liquidGlassNode = createShaderNodeDefinition({
  type: NodeType.LIQUID_GLASS,
  name: 'Liquid Glass',
  description: 'Add a liquid glass refraction effect.',
  IconComponent: Icons.LiquidGlass,
  ToolComponent: LiquidGlassTool,
  AdjustmentComponent: LiquidGlassAdjustments,
  shader: LIQUID_GLASS_SHADER,
  supportsVector2: true,
});
