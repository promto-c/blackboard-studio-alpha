import { AnyNode, ChromaKeyNode, NodeType, UniformUIType } from '@blackboard/types';
import { EffectDefinition, ShaderUniformMap } from '../EffectDefinition';
import { uniformSliderAnimation } from '../effectAnimationHelpers';
import ChromaKeyAdjustments from './ChromaKeyAdjustments';
import { ChromaKeyIcon } from './ChromaKeyIcon';
import { ChromaKeyTool } from './ChromaKeyTool';
import { CHROMA_KEY_SHADER } from './chromaKeyShader';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';

export const chromaKeyEffect: EffectDefinition = {
  type: NodeType.CHROMA_KEY,
  name: 'Keying',
  category: 'Effect',
  renderMode: 'shader',
  description: 'Remove a specific background color (Green Screen).',
  IconComponent: ChromaKeyIcon,
  ToolComponent: ChromaKeyTool,
  AdjustmentComponent: ChromaKeyAdjustments,
  animation: uniformSliderAnimation,
  flags: {},
  getInitialNodeProps: () => ({
    uniforms: parseUniformsFromGLSL(CHROMA_KEY_SHADER),
  }),
  getShader: () => CHROMA_KEY_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const keyNode = node as ChromaKeyNode;
    const uniforms: ShaderUniformMap = {};

    for (const key in keyNode.uniforms) {
      const uniformData = keyNode.uniforms[key];

      if (uniformData.ui === UniformUIType.SLIDER) {
        uniforms[key] = { value: getValueAtFrame(uniformData.value, context.frame) };
      } else if (uniformData.ui === UniformUIType.COLOR) {
        uniforms[key] = {
          value: new THREE.Color(...(uniformData.value as [number, number, number])),
        };
      }
    }
    return uniforms;
  },
};
