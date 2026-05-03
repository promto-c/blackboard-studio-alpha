import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import { RotoIcon } from './RotoIcon';

export const RotoTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.ROTO)!;

  const handleAddNode = () => {
    addNode(NodeType.ROTO);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<RotoIcon className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
