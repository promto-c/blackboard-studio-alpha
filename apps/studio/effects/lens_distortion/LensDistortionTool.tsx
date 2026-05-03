import React from 'react';
import { useEditorActions } from '@/state/editorContext';
import { NodeType } from '@blackboard/types';
import { ToolButton } from '@/components';
import { effectRegistry } from '../effectRegistry';
import { LensDistortionIcon } from './LensDistortionIcon';

export const LensDistortionTool = () => {
  const { addNode } = useEditorActions();
  const definition = effectRegistry.get(NodeType.LENS_DISTORTION)!;

  const handleAddNode = () => {
    addNode(NodeType.LENS_DISTORTION);
  };

  return (
    <ToolButton
      label={definition.name}
      icon={<LensDistortionIcon className="h-6 w-6" />}
      onClick={handleAddNode}
      title={definition.description}
    />
  );
};
