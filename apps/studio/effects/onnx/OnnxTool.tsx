import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import * as Icons from '@blackboard/icons';

export const OnnxTool: React.FC = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.ONNX_MODEL)!;

  return (
    <ToolButton
      label={definition.name}
      icon={<Icons.CubeTransparent className="h-5 w-5" />}
      onClick={() => addNode(NodeType.ONNX_MODEL)}
      title={definition.description}
    />
  );
};
