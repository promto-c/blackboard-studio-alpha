import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import * as Icons from '@blackboard/icons';
import { effectRegistry } from '../effectRegistry';

export const MergeTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.MERGE)!;

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.Merge className="h-6 w-6" />}
      onClick={() => addNode(NodeType.MERGE)}
      title={definition.description}
    />
  );
};
