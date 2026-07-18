import React from 'react';
import {
  BlendMode,
  type AnyNode,
  type MaskedMergeNode,
  type MergeNode,
  NodeType,
} from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import MergeAdjustments from '@/features/nodes/MergeAdjustments';
import * as Icons from '@blackboard/icons';
import { MaskedMergeTool, MergeTool } from './MergeTool';
import { MaskedMergeAdjustments } from './MaskedMergeAdjustments';
import { renderMaskedMergeGpu } from './maskedMergeGpu';
import {
  DEFAULT_MASKED_MERGE_ALPHA_OPERATION,
  DEFAULT_MASKED_MERGE_MIX,
} from './maskedMergeDefaults';
import {
  createAnimatablePropertyCollector,
  type NodeAnimationBehavior,
} from '../../animationHelpers';

const mergeAdjustments = ({ node }: { node: AnyNode }) =>
  React.createElement(MergeAdjustments, { nodeId: node.id });

const maskedMergeAnimation: NodeAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const maskedMerge = node as MaskedMergeNode;
    const { props, addProp } = createAnimatablePropertyCollector();
    addProp('Mix', 'mix', maskedMerge.mix, 'Alpha');
    return props;
  },
};

export const mergeNode: NodeDefinition = {
  type: NodeType.MERGE,
  name: 'Merge',
  category: 'Effect',
  renderMode: 'merge',
  processingDomain: 'scene_linear',
  description: 'Blend a source input over an explicit main input.',
  IconComponent: Icons.Merge,
  ToolComponent: MergeTool,
  AdjustmentComponent: mergeAdjustments,
  flags: {
    isRenderable: true,
  },
  inputPorts: [
    {
      name: 'source',
      label: 'Source',
      type: 'texture',
      required: false,
      description: 'Foreground source to blend over the main input.',
    },
    {
      name: 'pipe',
      label: 'Main',
      type: 'texture',
      required: false,
      description: 'Background image to composite under the source.',
    },
  ],
  getInitialNodeProps: (): Omit<MergeNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    opacity: 100,
    operator: BlendMode.OVER,
  }),
};

export const maskedMergeNode: NodeDefinition = {
  type: NodeType.MASKED_MERGE,
  name: 'Masked Merge',
  category: 'Effect',
  renderMode: 'mask',
  processingDomain: 'scene_linear',
  description: 'Replace or combine image alpha from an explicit mask while preserving RGB.',
  IconComponent: Icons.Merge,
  ToolComponent: MaskedMergeTool,
  AdjustmentComponent: MaskedMergeAdjustments,
  flags: {
    isRenderable: true,
  },
  animation: maskedMergeAnimation,
  inputPorts: [
    {
      name: 'pipe',
      label: 'RGBA',
      type: 'texture',
      required: false,
      description: 'Main image. RGB always passes through unchanged.',
    },
    {
      name: 'mask',
      label: 'Alpha / Mask',
      type: 'mask',
      dataSemantic: 'mask',
      channel: 'a',
      processingDomain: 'alpha',
      color: '#d4d4d4',
      required: false,
      description: 'Alpha or mask combined with the RGBA input alpha.',
    },
  ],
  getInitialNodeProps: (): Omit<MaskedMergeNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    mix: DEFAULT_MASKED_MERGE_MIX,
    alphaOperation: DEFAULT_MASKED_MERGE_ALPHA_OPERATION,
  }),
  renderOutput: (node, target, inputTexture, context) =>
    renderMaskedMergeGpu(node, target, inputTexture, context),
};
