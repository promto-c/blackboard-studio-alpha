import { AnyNode, BokehBlurNode, DepthSource, NodeType, UniformUIType } from '@blackboard/types';
import { EffectDefinition, InputPortDescriptor, ShaderUniformMap } from '../EffectDefinition';
import { uniformSliderAnimation } from '../effectAnimationHelpers';
import BokehAdjustments from './BokehAdjustments';
import * as Icons from '@blackboard/icons';
import { BokehTool } from './BokehTool';
import { BOKEH_BLUR_SHADER } from './bokehShader';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';
import BokehViewportTools from './BokehViewportTools';

const EXCLUDED_UNIFORMS = [
  'u_depthSource',
  'u_previewDepth',
  'u_depthInvert',
  'u_tDepth',
  'u_resolution',
];

export const bokehEffect: EffectDefinition = {
  type: NodeType.BOKEH_BLUR,
  name: 'Bokeh Blur',
  category: 'Effect',
  renderMode: 'shader',
  description: 'Add a realistic lens blur (Bokeh) effect.',
  IconComponent: Icons.Photo,
  ToolComponent: BokehTool,
  AdjustmentComponent: BokehAdjustments,
  ViewportToolsComponent: BokehViewportTools,
  animation: uniformSliderAnimation,
  defaultViewportTool: 'bokeh_pick',
  flags: {},
  inputPorts: [
    {
      name: 'depth',
      label: 'Depth Map',
      type: 'texture',
      required: false,
      description: 'External node to use as depth map (when Depth Source is "External Node")',
      uniformName: 'u_tDepth',
    } as InputPortDescriptor,
  ],
  getInitialNodeProps: () => ({
    uniforms: parseUniformsFromGLSL(BOKEH_BLUR_SHADER, EXCLUDED_UNIFORMS),
    depthSource: 'luminance' as DepthSource,
    previewDepth: false,
    depthInvert: false,
  }),
  toolHotkeys: {
    p: 'bokeh_pick',
  },
  getShader: () => BOKEH_BLUR_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const bokehNode = node as BokehBlurNode;
    const uniforms: ShaderUniformMap = {};
    const depthSourceMap: Record<DepthSource, number> = {
      uniform: 0,
      luminance: 1,
      radial: 2,
      linear_h: 3,
      linear_v: 4,
      node: 5,
    };

    uniforms['u_resolution'] = {
      value: new THREE.Vector2(context.scene.width, context.scene.height),
    };
    uniforms['u_depthSource'] = { value: depthSourceMap[bokehNode.depthSource] };
    uniforms['u_previewDepth'] = { value: !!bokehNode.previewDepth };
    uniforms['u_depthInvert'] = { value: !!bokehNode.depthInvert };

    for (const key in bokehNode.uniforms) {
      const uniformData = bokehNode.uniforms[key];
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
