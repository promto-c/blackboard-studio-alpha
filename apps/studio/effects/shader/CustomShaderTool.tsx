import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import * as Icons from '@blackboard/icons';

export const CustomShaderTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.CUSTOM_SHADER)!;

  const handleAddNode = () => {
    addNode(NodeType.CUSTOM_SHADER);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.CodeBracket className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
