/**
 * useBokehInteraction — Encapsulates bokeh depth-pick viewport interaction,
 * extracted from Viewport.tsx (Phase 2).
 */

import { useCallback } from 'react';
import { NodeType, type BokehBlurNode, type AnyNode, type SceneNode } from '@blackboard/types';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface UseBokehInteractionParams {
  selectedNode: AnyNode | undefined;
  sceneNode: SceneNode | undefined;
  activeViewportTool: string | null;
  pixelInfo: { x: number; y: number; color: [number, number, number, number] } | null;
  setKeyframe: (
    nodeId: string,
    propertyPath: string,
    value?: number,
    withHistory?: boolean,
  ) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBokehInteraction({
  selectedNode,
  sceneNode,
  activeViewportTool,
  pixelInfo,
  setKeyframe,
}: UseBokehInteractionParams) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, scenePos: { x: number; y: number }): boolean => {
      if (
        e.button !== 0 ||
        selectedNode?.type !== NodeType.BOKEH_BLUR ||
        activeViewportTool !== 'bokeh_pick' ||
        !sceneNode
      ) {
        return false;
      }

      e.preventDefault();
      const bokehNode = selectedNode as BokehBlurNode;
      let depthVal = 0.5;
      const uvX = (scenePos.x + sceneNode.width / 2) / sceneNode.width;
      const uvY = (-scenePos.y + sceneNode.height / 2) / sceneNode.height;
      if (bokehNode.depthSource === 'radial') {
        depthVal = Math.sqrt(Math.pow(uvX - 0.5, 2) + Math.pow(uvY - 0.5, 2)) * 2.0;
      } else if (bokehNode.depthSource === 'linear_h') {
        depthVal = uvX;
      } else if (bokehNode.depthSource === 'linear_v') {
        depthVal = uvY;
      } else if (pixelInfo) {
        depthVal =
          1.0 -
          (0.2126 * pixelInfo.color[0] + 0.7152 * pixelInfo.color[1] + 0.0722 * pixelInfo.color[2]);
      }
      setKeyframe(
        bokehNode.id,
        'uniforms.u_focusDepth.value',
        Math.max(0, Math.min(1, depthVal)),
        true,
      );
      return true;
    },
    [selectedNode, sceneNode, activeViewportTool, pixelInfo, setKeyframe],
  );

  return { handleMouseDown };
}
