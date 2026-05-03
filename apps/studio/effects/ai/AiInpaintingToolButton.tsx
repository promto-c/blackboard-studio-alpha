import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { NodeType, ImageNode } from '@blackboard/types';
import { ToolButton } from '@/components';
import { aiInpaintingTool } from './index';
import * as Icons from '@blackboard/icons';

const AiInpaintingToolButton = () => {
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const { createAiNode } = useEditorActions();
  const selectedNode = useSelectedEditorNode();
  // An inpainting node can be created if an image node is selected and is not already generated.
  const canUseAiInpainting =
    selectedNode?.type === NodeType.IMAGE && !(selectedNode as ImageNode).aiMetadata;

  const handleCreateAiNode = () => {
    if (canUseAiInpainting && selectedNodeId) {
      createAiNode(selectedNodeId);
    } else {
      createAiNode();
    }
  };

  return (
    <ToolButton
      label={aiInpaintingTool.name}
      icon={<Icons.Sparkles className="h-6 w-6" />}
      onClick={handleCreateAiNode}
      badge="Gen"
      title={
        canUseAiInpainting
          ? 'Generate variations of the selected node.'
          : 'Generate a new image from a text prompt.'
      }
    />
  );
};

export default AiInpaintingToolButton;
