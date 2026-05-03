import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import * as Icons from '@blackboard/icons';
import { effectRegistry } from '../effectRegistry';

export const LiquidGlassTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.LIQUID_GLASS)!;

  const handleAddNode = () => {
    addNode(NodeType.LIQUID_GLASS);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.LiquidGlass className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
