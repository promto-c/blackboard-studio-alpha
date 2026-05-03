import { AnyNode, NodeType, WarpNode } from '@blackboard/types';
import { EffectDefinition, ShaderUniformMap } from '../EffectDefinition';
import {
  createAnimatablePropertyCollector,
  type EffectAnimationBehavior,
} from '../effectAnimationHelpers';
import WarpAdjustments from './WarpAdjustments';
import { Pin } from '@blackboard/icons';
import { WarpTool } from './WarpTool';
import WarpViewportTools from './WarpViewportTools';
import { WARP_SHADER } from './warpShader';
import { getValueAtFrame } from '@blackboard/renderer';

const warpAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const warpNode = node as WarpNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Radius', 'radius', warpNode.radius, 'Warp Settings');
    addProp('Strength', 'strength', warpNode.strength, 'Warp Settings');
    warpNode.pins.forEach((pin, i) => {
      addProp(`Pin ${i} X`, `pins[${i}].translation.x`, pin.translation.x, `Pin ${i}`);
      addProp(`Pin ${i} Y`, `pins[${i}].translation.y`, pin.translation.y, `Pin ${i}`);
    });

    return props;
  },
};

export const warpEffect: EffectDefinition = {
  type: NodeType.WARP,
  name: 'Pin Warp',
  category: 'Effect',
  renderMode: 'warp',
  description: 'Distort image using movable control pins.',
  IconComponent: Pin,
  ToolComponent: WarpTool,
  AdjustmentComponent: WarpAdjustments,
  ViewportToolsComponent: WarpViewportTools,
  animation: warpAnimation,
  defaultViewportTool: 'add_pin',
  flags: {},
  getInitialNodeProps: () => ({
    pins: [],
    radius: 0.3,
    strength: 1.0,
  }),
  getShader: () => WARP_SHADER,
  getUniforms: (node: AnyNode, context) => {
    const warpNode = node as WarpNode;
    const pins = warpNode.pins;
    const maxPins = 64; // Must match shader definition

    // Arrays for uniforms
    const uPositions = new Float32Array(maxPins * 2);
    const uDeltas = new Float32Array(maxPins * 2);

    pins.forEach((pin, i) => {
      if (i >= maxPins) return;
      uPositions[i * 2] = pin.position.x;
      uPositions[i * 2 + 1] = pin.position.y;

      const dx = getValueAtFrame(pin.translation.x, context.frame);
      const dy = getValueAtFrame(pin.translation.y, context.frame);

      uDeltas[i * 2] = dx;
      uDeltas[i * 2 + 1] = dy;
    });

    const uniforms: ShaderUniformMap = {
      u_pinPositions: { value: uPositions },
      u_pinDeltas: { value: uDeltas },
      u_pinCount: { value: pins.length },
      u_radius: { value: getValueAtFrame(warpNode.radius, context.frame) },
      u_strength: { value: getValueAtFrame(warpNode.strength, context.frame) },
    };
    return uniforms;
  },
  toolHotkeys: {
    a: 'add_pin',
    v: 'move_pin',
  },
};
