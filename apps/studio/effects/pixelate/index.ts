import { AnyNode, PixelateNode, NodeType, UniformUIType } from '@blackboard/types';
import { EffectDefinition, ShaderUniformMap } from '../EffectDefinition';
import { uniformSliderAnimation } from '../effectAnimationHelpers';
import PixelateAdjustments from './PixelateAdjustments';
import * as Icons from '@blackboard/icons';
import { PixelateTool } from './PixelateTool';
import { PIXELATE_SHADER } from './pixelateShader';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import { getValueAtFrame } from '@blackboard/renderer';

export const pixelateEffect: EffectDefinition = {
  type: NodeType.PIXELATE,
  name: 'Pixelate',
  category: 'Effect',
  renderMode: 'shader',
  description: 'Add a pixelation and color quantization effect.',
  IconComponent: Icons.Pixelate,
  ToolComponent: PixelateTool,
  AdjustmentComponent: PixelateAdjustments,
  animation: uniformSliderAnimation,
  flags: {},
  getInitialNodeProps: () => ({
    uniforms: parseUniformsFromGLSL(PIXELATE_SHADER),
  }),
  getShader: () => PIXELATE_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const pixelateNode = node as PixelateNode;
    const uniforms: ShaderUniformMap = {};

    for (const key in pixelateNode.uniforms) {
      const uniformData = pixelateNode.uniforms[key];
      if (uniformData.ui === UniformUIType.SLIDER) {
        uniforms[key] = { value: getValueAtFrame(uniformData.value, context.frame) };
      }
    }
    return uniforms;
  },
};
