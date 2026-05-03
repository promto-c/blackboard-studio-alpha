import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import * as Icons from '@blackboard/icons';
import { effectRegistry } from '../effectRegistry';

export const BlurTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.BLUR)!;

  const handleAddBlurNode = () => {
    addNode(NodeType.BLUR);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.Blur className="h-6 w-6" />}
      onClick={handleAddBlurNode}
      title={definition.description}
    />
  );
};
