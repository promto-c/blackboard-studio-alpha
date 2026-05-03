import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import { Text } from '@blackboard/icons';

export const TextTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.TEXT)!;

  const handleAddNode = () => {
    addNode(NodeType.TEXT);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Text className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
