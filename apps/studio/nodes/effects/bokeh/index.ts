import { NodeType, type BokehBlurNode, type DepthSource, type AnyNode } from '@blackboard/types';
import {
  createShaderNodeDefinition,
  type ShaderUniformMap,
  type RenderContext,
} from '../../nodeFactoryHelpers';
import type { InputPortDescriptor } from '../../NodeDefinition';
import BokehAdjustments from './BokehAdjustments';
import * as Icons from '@blackboard/icons';
import { BokehTool } from './BokehTool';
import { BOKEH_BLUR_SHADER } from './bokehShader';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import * as THREE from 'three';
import React from 'react';

/** Inline SVG icon for the bokeh focus-pick tool (eye/crosshair). */
const FocusDepthIcon: React.ComponentType<{ className?: string }> = ({ className }) =>
  React.createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      className: className ?? 'h-5 w-5',
      fill: 'none',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      strokeWidth: 2,
    },
    React.createElement('path', {
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    }),
    React.createElement('path', {
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      d: 'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    }),
  );

const EXCLUDED_UNIFORMS = [
  'u_depthSource',
  'u_previewDepth',
  'u_depthInvert',
  'u_tDepth',
  'u_resolution',
];

const depthSourceMap: Record<DepthSource, number> = {
  uniform: 0,
  luminance: 1,
  radial: 2,
  linear_h: 3,
  linear_v: 4,
  node: 5,
};

export const bokehNode = createShaderNodeDefinition({
  type: NodeType.BOKEH_BLUR,
  name: 'Bokeh Blur',
  description: 'Add a realistic lens blur (Bokeh) effect.',
  IconComponent: Icons.Photo,
  ToolComponent: BokehTool,
  AdjustmentComponent: BokehAdjustments,
  shader: BOKEH_BLUR_SHADER,
  excludedUniforms: EXCLUDED_UNIFORMS,
  additionalUniforms: (node: AnyNode, context: RenderContext): ShaderUniformMap => {
    const bokehNode = node as BokehBlurNode;
    return {
      u_resolution: { value: new THREE.Vector2(context.scene.width, context.scene.height) },
      u_depthSource: { value: depthSourceMap[bokehNode.depthSource] },
      u_previewDepth: { value: !!bokehNode.previewDepth },
      u_depthInvert: { value: !!bokehNode.depthInvert },
    };
  },
  overrides: {
    viewportTools: [
      {
        id: 'bokeh_pick',
        label: 'Pick Focus Depth',
        icon: FocusDepthIcon,
        hotkey: 'P',
        isToggle: true,
      },
    ],
    defaultViewportTool: 'bokeh_pick',
    toolHotkeys: { p: 'bokeh_pick' },
    inputPorts: [
      {
        name: 'depth',
        label: 'Depth Map',
        type: 'data',
        dataSemantic: 'depth',
        processingDomain: 'depth',
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
  },
});
