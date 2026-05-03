import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import * as Icons from '@blackboard/icons';

export const ComfyTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.COMFY)!;

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.ComputerDesktop className="h-6 w-6" />}
      onClick={() => addNode(NodeType.COMFY)}
      title={definition.description}
    />
  );
};
