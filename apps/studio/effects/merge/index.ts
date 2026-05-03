import React from 'react';
import { BlendMode, MergeNode, NodeType } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import MergeAdjustments from '@/features/nodes/MergeAdjustments';
import * as Icons from '@blackboard/icons';
import { MergeTool } from './MergeTool';

export const mergeEffect: EffectDefinition = {
  type: NodeType.MERGE,
  name: 'Merge',
  category: 'Effect',
  renderMode: 'merge',
  description: 'Blend an optional source input over the current pipeline.',
  IconComponent: Icons.Merge,
  ToolComponent: MergeTool,
  AdjustmentComponent: ({ node }) =>
    React.createElement(MergeAdjustments, { node: node as MergeNode }),
  flags: {
    isRenderable: true,
  },
  inputPorts: [
    {
      name: 'source',
      label: 'Source',
      type: 'texture',
      required: false,
      description: 'Optional source to blend over the current pipeline.',
    },
  ],
  getInitialNodeProps: (): Omit<MergeNode, 'id' | 'name' | 'visible' | 'type'> => ({
    opacity: 100,
    operator: BlendMode.OVER,
  }),
};
