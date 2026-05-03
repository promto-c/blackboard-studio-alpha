import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import * as Icons from '@blackboard/icons';
import { effectRegistry } from '../effectRegistry';

export const BokehTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.BOKEH_BLUR)!;

  const handleAddNode = () => {
    addNode(NodeType.BOKEH_BLUR);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.Photo className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
