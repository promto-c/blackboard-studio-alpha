import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import * as Icons from '@blackboard/icons';

export const PixelateTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.PIXELATE)!;

  const handleAddNode = () => {
    addNode(NodeType.PIXELATE);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.Pixelate className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
