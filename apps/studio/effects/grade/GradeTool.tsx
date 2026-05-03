import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import * as Icons from '@blackboard/icons';
import { effectRegistry } from '../effectRegistry';

export const GradeTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.GRADE)!;

  const handleAddGradeNode = () => {
    addNode(NodeType.GRADE);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.Sun className="h-6 w-6" />}
      onClick={handleAddGradeNode}
      title={definition.description}
    />
  );
};
