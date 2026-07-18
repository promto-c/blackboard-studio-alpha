import { NodeType } from '@blackboard/types';
import type { NodeDefinition } from '../../NodeDefinition';
import { createShaderNodeDefinition } from '../../nodeFactoryHelpers';
import { PremultiplyAdjustments, UnpremultiplyAdjustments } from './AlphaMathAdjustments';
import { PremultiplyIcon, UnpremultiplyIcon } from './AlphaMathIcon';
import { AlphaMathShader } from './alphaMathShader';
import { PremultiplyTool, UnpremultiplyTool } from './AlphaMathTools';

type AlphaMathDefinitionOptions = Pick<
  NodeDefinition,
  'type' | 'name' | 'IconComponent' | 'ToolComponent' | 'AdjustmentComponent'
> & {
  description: string;
  shader: string;
};

const createAlphaMathNodeDefinition = ({
  shader,
  ...definition
}: AlphaMathDefinitionOptions): NodeDefinition =>
  createShaderNodeDefinition({
    ...definition,
    category: 'Utility',
    shader,
  });

export const premultiplyNode = createAlphaMathNodeDefinition({
  type: NodeType.PREMULTIPLY,
  name: 'Premultiply',
  description: 'Associate straight RGB with alpha by multiplying RGB by alpha.',
  IconComponent: PremultiplyIcon,
  ToolComponent: PremultiplyTool,
  AdjustmentComponent: PremultiplyAdjustments,
  shader: AlphaMathShader.PREMULTIPLY,
});

export const unpremultiplyNode = createAlphaMathNodeDefinition({
  type: NodeType.UNPREMULTIPLY,
  name: 'Unpremultiply',
  description: 'Restore straight RGB by dividing associated RGB by non-zero alpha.',
  IconComponent: UnpremultiplyIcon,
  ToolComponent: UnpremultiplyTool,
  AdjustmentComponent: UnpremultiplyAdjustments,
  shader: AlphaMathShader.UNPREMULTIPLY,
});
