import React from 'react';
import { AnyNode, ImageNode } from '@blackboard/types';
import { effectRegistry } from '@/effects/effectRegistry';
import * as Icons from '@blackboard/icons';

const NodeIcon: React.FC<{ node: AnyNode }> = ({ node }) => {
  const isAi = (node as ImageNode).aiMetadata !== undefined;
  if (isAi) {
    return <Icons.Sparkles className="h-4 w-4 text-purple-400" />;
  }

  const Icon = effectRegistry.get(node.type)?.IconComponent ?? Icons.Cog;

  return <Icon className="h-4 w-4 text-gray-400" />;
};

export default NodeIcon;
