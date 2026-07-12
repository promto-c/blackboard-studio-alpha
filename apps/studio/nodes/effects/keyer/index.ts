import { NodeType } from '@blackboard/types';
import * as THREE from 'three';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import { createShaderNodeDefinition } from '../../nodeFactoryHelpers';
import KeyerAdjustments from './KeyerAdjustments';
import { KeyerIcon } from './KeyerIcon';
import { KeyerSampleOverlay } from './KeyerSampleOverlay';
import { KeyerTool } from './KeyerTool';
import { KEYER_SAMPLE_TOOL_ID } from './keyerModel';
import { KEYER_SHADER } from './keyerShader';

export const keyerNode = createShaderNodeDefinition({
  type: NodeType.KEYER,
  name: 'Keyer',
  description: 'Production chroma keying with HSL qualification, matte finesse, and despill.',
  IconComponent: KeyerIcon,
  ToolComponent: KeyerTool,
  AdjustmentComponent: KeyerAdjustments,
  shader: KEYER_SHADER,
  additionalUniforms: (_node, context) => ({
    u_texelSize: {
      value: new THREE.Vector2(
        1 / Math.max(1, context.scene.width),
        1 / Math.max(1, context.scene.height),
      ),
    },
  }),
  overrides: {
    getInitialNodeProps: () => ({
      uniforms: parseUniformsFromGLSL(KEYER_SHADER),
      matteOverlayWhileAdjusting: true,
    }),
    viewportTools: [
      {
        id: KEYER_SAMPLE_TOOL_ID,
        label: 'Sample Screen Color',
        icon: KeyerIcon,
        hotkey: 'P',
        isToggle: true,
      },
    ],
    defaultViewportTool: KEYER_SAMPLE_TOOL_ID,
    toolHotkeys: { p: KEYER_SAMPLE_TOOL_ID },
    ViewportOverlayComponent: KeyerSampleOverlay,
    getOverlayVisibility: (_node, context) => ({
      forceShowSvg: context.viewport.activeViewportTool === KEYER_SAMPLE_TOOL_ID,
    }),
  },
});
