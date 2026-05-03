import { AnyNode, LiquidGlassNode, NodeType, UniformUIType } from '@blackboard/types';
import { EffectDefinition, ShaderUniformMap } from '../EffectDefinition';
import { uniformSliderAnimation } from '../effectAnimationHelpers';
import LiquidGlassAdjustments from './LiquidGlassAdjustments';
import * as Icons from '@blackboard/icons';
import { LiquidGlassTool } from './LiquidGlassTool';
import { LIQUID_GLASS_SHADER } from './liquidGlassShader';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';

export const liquidGlassEffect: EffectDefinition = {
  type: NodeType.LIQUID_GLASS,
  name: 'Liquid Glass',
  category: 'Effect',
  renderMode: 'shader',
  description: 'Add a liquid glass refraction effect.',
  IconComponent: Icons.LiquidGlass,
  ToolComponent: LiquidGlassTool,
  AdjustmentComponent: LiquidGlassAdjustments,
  animation: uniformSliderAnimation,
  flags: {},
  getInitialNodeProps: () => ({
    uniforms: parseUniformsFromGLSL(LIQUID_GLASS_SHADER),
  }),
  getShader: () => LIQUID_GLASS_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const glassNode = node as LiquidGlassNode;
    const uniforms: ShaderUniformMap = {};

    const processedKeys = new Set();
    for (const key in glassNode.uniforms) {
      if (processedKeys.has(key)) continue;
      if (key.endsWith('_x')) {
        const baseKey = key.slice(0, -2);
        const yKey = `${baseKey}_y`;
        const xUniform = glassNode.uniforms[key];
        const yUniform = glassNode.uniforms[yKey];
        if (
          yUniform &&
          xUniform.ui === UniformUIType.SLIDER &&
          yUniform.ui === UniformUIType.SLIDER
        ) {
          uniforms[baseKey] = {
            value: new THREE.Vector2(
              getValueAtFrame(xUniform.value, context.frame),
              getValueAtFrame(yUniform.value, context.frame),
            ),
          };
          processedKeys.add(yKey);
        }
      } else if (!key.endsWith('_y')) {
        const uniformData = glassNode.uniforms[key];
        if (uniformData.ui === UniformUIType.COLOR) {
          uniforms[key] = {
            value: new THREE.Color(...(uniformData.value as [number, number, number])),
          };
        } else if (uniformData.ui === UniformUIType.SLIDER) {
          uniforms[key] = { value: getValueAtFrame(uniformData.value, context.frame) };
        }
      }
      processedKeys.add(key);
    }
    return uniforms;
  },
};
