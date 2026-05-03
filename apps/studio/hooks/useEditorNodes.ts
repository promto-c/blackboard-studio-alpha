import { NodeType, type AnyNode, type SceneNode } from '@blackboard/types';
import { useEditorSelector } from '@/state/editorContext';

export function useSelectedEditorNode(): AnyNode | undefined {
  return useEditorSelector((state) => state.nodes.find((node) => node.id === state.selectedNodeId));
}

export function useSceneNode(): SceneNode | undefined {
  return useEditorSelector(
    (state) => state.nodes.find((node) => node.type === NodeType.SCENE) as SceneNode | undefined,
  );
}
