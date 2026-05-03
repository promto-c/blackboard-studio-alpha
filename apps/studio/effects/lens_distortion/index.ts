import { AnyNode, LensDistortionNode, NodeType, UniformUIType } from '@blackboard/types';
import { EffectDefinition, ShaderUniformMap } from '../EffectDefinition';
import { uniformSliderAnimation } from '../effectAnimationHelpers';
import LensDistortionAdjustments from './LensDistortionAdjustments';
import { LensDistortionIcon } from './LensDistortionIcon';
import { LensDistortionTool } from './LensDistortionTool';
import { LENS_DISTORTION_SHADER } from './lensDistortionShader';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';

export const lensDistortionEffect: EffectDefinition = {
  type: NodeType.LENS_DISTORTION,
  name: 'Lens Distortion',
  category: 'Effect',
  renderMode: 'shader',
  description: 'Simulates lens distortion effects like barrel or pincushion.',
  IconComponent: LensDistortionIcon,
  ToolComponent: LensDistortionTool,
  AdjustmentComponent: LensDistortionAdjustments,
  animation: uniformSliderAnimation,
  flags: {},
  getInitialNodeProps: () => ({
    uniforms: parseUniformsFromGLSL(LENS_DISTORTION_SHADER),
  }),
  getShader: () => LENS_DISTORTION_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const distortionNode = node as LensDistortionNode;
    const uniforms: ShaderUniformMap = {};

    const processedKeys = new Set();
    for (const key in distortionNode.uniforms) {
      if (processedKeys.has(key)) continue;
      if (key.endsWith('_x')) {
        const baseKey = key.slice(0, -2);
        const yKey = `${baseKey}_y`;
        const xUniform = distortionNode.uniforms[key];
        const yUniform = distortionNode.uniforms[yKey];
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
        const uniformData = distortionNode.uniforms[key];
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
