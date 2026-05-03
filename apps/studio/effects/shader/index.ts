import { AnyNode, CustomShaderNode, NodeType, UniformUIType } from '@blackboard/types';
import { EffectDefinition, ShaderUniformMap } from '../EffectDefinition';
import { uniformSliderAnimation } from '../effectAnimationHelpers';
import CustomShaderAdjustments from './CustomShaderAdjustments';
import * as Icons from '@blackboard/icons';
import { CustomShaderTool } from './CustomShaderTool';
import { parseInputPortsFromGLSL, parseUniformsFromGLSL } from '@/utils/glsl';
import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';

export const customShaderEffect: EffectDefinition = {
  type: NodeType.CUSTOM_SHADER,
  name: 'Shader',
  category: 'Effect',
  renderMode: 'shader',
  description: 'Add a GLSL shader node.',
  IconComponent: Icons.CodeBracket,
  ToolComponent: CustomShaderTool,
  AdjustmentComponent: CustomShaderAdjustments,
  animation: uniformSliderAnimation,
  flags: {},
  inputPorts: (node) => parseInputPortsFromGLSL((node as CustomShaderNode).fragmentShader),
  getInitialNodeProps: () => ({
    fragmentShader: '',
    uniforms: {},
    promptSuggestionPages: [],
    promptSuggestionPageIndex: 0,
    promptSuggestionsVisible: false,
  }),
  onNodeUpdate: (node, changes) => {
    let label: string | undefined;
    let finalChanges = changes;

    if ('fragmentShader' in changes && typeof changes.fragmentShader === 'string') {
      label = `Update ${node.name} Shader`;
      const newUniforms = parseUniformsFromGLSL(changes.fragmentShader);
      finalChanges = { ...changes, uniforms: newUniforms };
    } else if ('uniforms' in changes) {
      label = `Update ${node.name} Uniforms`;
    }

    return { changes: finalChanges, label };
  },
  getShader: (node: AnyNode) => (node as CustomShaderNode).fragmentShader,
  getUniforms: (node: AnyNode, context) => {
    const shaderNode = node as CustomShaderNode;
    const uniforms: ShaderUniformMap = {
      u_frame: { value: context.frame },
      u_time: { value: context.frame / Math.max(context.fps || 30, 1) },
      u_fps: { value: context.fps || 30 },
    };

    const processedKeys = new Set();
    for (const key in shaderNode.uniforms) {
      if (processedKeys.has(key)) continue;
      if (key.endsWith('_x')) {
        const baseKey = key.slice(0, -2);
        const yKey = `${baseKey}_y`;
        const xUniform = shaderNode.uniforms[key];
        const yUniform = shaderNode.uniforms[yKey];
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
        const uniformData = shaderNode.uniforms[key];
        if (uniformData.ui === UniformUIType.COLOR) {
          uniforms[key] = {
            value: new THREE.Color(...(uniformData.value as [number, number, number])),
          };
        } else if (uniformData.ui === UniformUIType.SLIDER) {
          uniforms[key] = { value: getValueAtFrame(uniformData.value, context.frame) };
        } else {
          uniforms[key] = { value: uniformData.value };
        }
      }
      processedKeys.add(key);
    }
    return uniforms;
  },
};
