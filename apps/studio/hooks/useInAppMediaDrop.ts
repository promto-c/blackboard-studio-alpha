import { useCallback } from 'react';
import { NodeType } from '@blackboard/types';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import type { InAppMediaDragPayload } from '@/utils/inAppMediaDrag';
import { getInAppMediaNodeSpec } from '@/utils/inAppMediaSource';

export const useInAppMediaDrop = () => {
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((node) => node.type === NodeType.SCENE),
  );
  const { addNodeWithProps } = useEditorActions();

  return useCallback(
    (payload: InAppMediaDragPayload, graphPosition?: { x: number; y: number }) => {
      const spec = getInAppMediaNodeSpec(
        payload,
        sceneNode && 'width' in sceneNode && 'height' in sceneNode
          ? { width: sceneNode.width, height: sceneNode.height }
          : null,
      );
      if (!spec) return false;

      const nodeId = addNodeWithProps(spec.nodeType, spec.props, {
        name: spec.name,
        ...(graphPosition ? { graphPosition } : {}),
      });
      return !!nodeId;
    },
    [addNodeWithProps, sceneNode],
  );
};
