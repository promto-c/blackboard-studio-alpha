import React from 'react';
import { BlendMode, MergeNode, NodeType } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import MergeAdjustments from '@/features/nodes/MergeAdjustments';
import * as Icons from '@blackboard/icons';
import { MergeTool } from './MergeTool';

export const mergeNode: NodeDefinition = {
  type: NodeType.MERGE,
  name: 'Merge',
  category: 'Effect',
  renderMode: 'merge',
  description: 'Blend a source input over an explicit main input.',
  IconComponent: Icons.Merge,
  ToolComponent: MergeTool,
  AdjustmentComponent: ({ node }) => React.createElement(MergeAdjustments, { nodeId: node.id }),
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
