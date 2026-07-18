import { NodeType, type AnyNode, type MatteControlNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import type { NodeDefinition } from '../../NodeDefinition';
import {
  createAnimatablePropertyCollector,
  type NodeAnimationBehavior,
} from '../../animationHelpers';
import { MatteControlAdjustments } from './MatteControlAdjustments';
import { MatteControlTool } from './MatteControlTool';
import { renderMatteControlGpu } from './matteControlGpu';
import { createDefaultMatteControlSettings } from './matteControlModel';

const matteControlAnimation: NodeAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const matteNode = node as MatteControlNode;
    const { props, addProp } = createAnimatablePropertyCollector();
    addProp(
      'Erode / Dilate',
      'matteControl.erodeDilate',
      matteNode.matteControl.erodeDilate,
      'Matte',
    );
    addProp('Edge Blur', 'matteControl.edgeBlur', matteNode.matteControl.edgeBlur, 'Matte');
    addProp('Clamp Black', 'matteControl.clampBlack', matteNode.matteControl.clampBlack, 'Matte');
    addProp('Clamp White', 'matteControl.clampWhite', matteNode.matteControl.clampWhite, 'Matte');
    return props;
  },
};

export const matteControlNode: NodeDefinition = {
  type: NodeType.MATTE_CONTROL,
  name: 'Matte Control',
  category: 'Utility',
  renderMode: 'mask',
  processingDomain: 'scene_linear',
  description: 'Refine image alpha with erode/dilate, edge blur, clamp, and invert controls.',
  IconComponent: Icons.Alpha,
  ToolComponent: MatteControlTool,
  AdjustmentComponent: MatteControlAdjustments,
  flags: {},
  adaptivePreview: { resolutionScale: true, sampleLimit: true },
  animation: matteControlAnimation,
  getInitialNodeProps: (): Omit<MatteControlNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    matteControl: createDefaultMatteControlSettings(),
  }),
  renderOutput: (node: AnyNode, target, inputTexture, context) =>
    renderMatteControlGpu(node, target, inputTexture, context),
};
