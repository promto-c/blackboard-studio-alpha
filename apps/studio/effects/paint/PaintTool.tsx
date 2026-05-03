import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';

const PaintTool: React.FC = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.PAINT)!;
  const Icon = definition.IconComponent;

  return (
    <ToolButton
      label={definition.name}
      icon={<Icon className="h-6 w-6" />}
      onClick={() => addNode(NodeType.PAINT)}
      title={definition.description}
    />
  );
};

export default PaintTool;
