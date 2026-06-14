import React, { useCallback } from 'react';
import { ToolButton } from '@/components';
import { useEditorActions } from '@/state/editorContext';
import type { NodeType } from '@blackboard/types';
import { nodeRegistry } from './registry';

interface NodeToolButtonProps {
  nodeType: NodeType;
  icon?: React.ReactNode;
  iconClassName?: string;
}

export function NodeToolButton({ nodeType, icon, iconClassName = 'h-6 w-6' }: NodeToolButtonProps) {
  const { addNode, setPreviewNodeType } = useEditorActions();
  const definition = nodeRegistry.get(nodeType)!;
  const Icon = definition.IconComponent;

  const handleMouseEnter = useCallback(() => {
    setPreviewNodeType(nodeType);
  }, [nodeType, setPreviewNodeType]);

  const handleMouseLeave = useCallback(() => {
    setPreviewNodeType(null);
  }, [setPreviewNodeType]);

  const handleClick = useCallback(() => {
    setPreviewNodeType(null);
    addNode(nodeType);
  }, [nodeType, addNode, setPreviewNodeType]);

  return (
    <ToolButton
      label={definition.name}
      icon={icon ?? <Icon className={iconClassName} />}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={definition.description}
    />
  );
}
