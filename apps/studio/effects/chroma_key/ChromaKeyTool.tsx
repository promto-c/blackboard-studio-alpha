import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { ChromaKeyIcon } from './ChromaKeyIcon';
import { effectRegistry } from '../effectRegistry';

export const ChromaKeyTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.CHROMA_KEY)!;

  const handleAddNode = () => {
    addNode(NodeType.CHROMA_KEY);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<ChromaKeyIcon className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
