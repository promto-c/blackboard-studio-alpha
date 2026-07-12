import { useCallback, useMemo } from 'react';
import type { AnyNode, ComfyNode, GeneratedOutput, SceneNode } from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { createScene3DSettingsWithAsset } from '@/nodes/builtin/scene_3d/scene3d';
import { getComfyOutputTransform } from './comfyOutputTransform';
import {
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyOutputActivationRegionId,
  getComfyOutputActivationUpdates,
  isComfy3DGeneratedOutput,
} from './comfyOutputActivation';

export const useComfyOutputActivation = (node: ComfyNode | null) => {
  const { addNodeWithProps, updateNode } = useEditorActions();
  const allNodes = useEditorSelector((state) => state.nodes);
  const sceneNode = useMemo(
    () =>
      allNodes.find((candidate: AnyNode) => candidate.type === NodeType.SCENE) as
        | SceneNode
        | undefined,
    [allNodes],
  );

  return useCallback(
    (output: GeneratedOutput) => {
      if (!node) return;

      if (isComfy3DGeneratedOutput(output) && output.scene3dAsset) {
        addNodeWithProps(
          NodeType.SCENE_3D,
          {
            viewportMode: 'scene3d',
            scene3d: createScene3DSettingsWithAsset(
              output.scene3dAsset,
              sceneNode?.width,
              sceneNode?.height,
            ),
          },
          { name: output.label || output.scene3dAsset.fileName },
        );
        return;
      }

      updateNode(
        node.id,
        {
          ...getComfyOutputActivationUpdates(output),
          transform: getComfyOutputTransform({ node, output, sceneNode }),
          generatedOutputs: getComfyGeneratedOutputsForGalleryActivation(node, output),
          selectedViewportPromptRegionId: getComfyOutputActivationRegionId(node, output),
        },
        true,
      );
    },
    [addNodeWithProps, node, sceneNode, updateNode],
  );
};
