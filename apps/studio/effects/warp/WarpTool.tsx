import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import { Pin } from '@blackboard/icons';

export const WarpTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.WARP)!;

  const handleAddNode = () => {
    addNode(NodeType.WARP);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Pin className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
