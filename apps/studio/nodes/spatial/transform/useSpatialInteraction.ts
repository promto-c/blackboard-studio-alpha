import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { useState, useCallback, useRef } from 'react';
import { NodeType, type AnyNode, type TransformNode, type SceneNode } from '@blackboard/types';
import { getValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';

export type SpatialDragHandle =
  | 'move'
  | 'rotate'
  | 'pivot'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

export interface SpatialDragValues {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  pivotX: number;
  pivotY: number;
}

interface SpatialDragState {
  handle: SpatialDragHandle;
  startClientX: number;
  startClientY: number;
  values: SpatialDragValues;
  preserveView: boolean;
}

interface SpatialSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseSpatialInteractionParams {
  selectedNode: AnyNode | undefined;
  sceneNode: Pick<SceneNode, 'width' | 'height'> | undefined;
  sourceRect?: SpatialSourceRect | null;
  zoom: number;
  visualFrame: number;
  nodes: AnyNode[];
  selectedNodeId: string | null;
  updateNode: (nodeId: string, changes: Record<string, unknown>) => void;
  commitMutation: CommitEditorMutation;
}

const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const movePivotPreservingView = (
  values: SpatialDragValues,
  deltaX: number,
  deltaY: number,
): SpatialDragValues => {
  const pivotDeltaX = deltaX;
  const pivotDeltaY = -deltaY;
  const radians = (values.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaledX = pivotDeltaX * values.scaleX;
  const scaledY = pivotDeltaY * values.scaleY;
  const rotatedX = cos * scaledX - sin * scaledY;
  const rotatedY = sin * scaledX + cos * scaledY;
  const translateDeltaX = -pivotDeltaX + rotatedX;
  const translateDeltaY = -pivotDeltaY + rotatedY;

  return {
    ...values,
    translateX: values.translateX + translateDeltaX,
    translateY: values.translateY - translateDeltaY,
    pivotX: values.pivotX + deltaX,
    pivotY: values.pivotY + deltaY,
  };
};

export function useSpatialInteraction({
  selectedNode,
  sceneNode,
  sourceRect,
  zoom,
  visualFrame,
  nodes,
  selectedNodeId,
  updateNode,
  commitMutation,
}: UseSpatialInteractionParams) {
  const [dragState, setDragState] = useState<SpatialDragState | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<SpatialDragHandle | null>(null);
  const committedRef = useRef(false);

  const isTransformSelected = selectedNode?.type === NodeType.TRANSFORM;

  const getTransformValues = useCallback((): SpatialDragValues | null => {
    if (!isTransformSelected) return null;
    const t = (selectedNode as TransformNode).transform;
    return {
      translateX: getValueAtFrame(t.translateX, visualFrame),
      translateY: getValueAtFrame(t.translateY, visualFrame),
      scaleX: getValueAtFrame(t.scaleX, visualFrame),
      scaleY: getValueAtFrame(t.scaleY, visualFrame),
      rotation: getValueAtFrame(t.rotation, visualFrame),
      pivotX: getValueAtFrame(t.pivotX, visualFrame),
      pivotY: getValueAtFrame(t.pivotY, visualFrame),
    };
  }, [selectedNode, isTransformSelected, visualFrame]);

  const applyTransform = useCallback(
    (values: SpatialDragValues) => {
      if (!isTransformSelected) return;
      const t = (selectedNode as TransformNode).transform;
      updateNode(selectedNode.id, {
        transform: {
          translateX: setKeyframeOnValue(t.translateX, visualFrame, values.translateX),
          translateY: setKeyframeOnValue(t.translateY, visualFrame, values.translateY),
          scaleX: setKeyframeOnValue(t.scaleX, visualFrame, values.scaleX),
          scaleY: setKeyframeOnValue(t.scaleY, visualFrame, values.scaleY),
          rotation: setKeyframeOnValue(t.rotation, visualFrame, values.rotation),
          pivotX: setKeyframeOnValue(t.pivotX, visualFrame, values.pivotX),
          pivotY: setKeyframeOnValue(t.pivotY, visualFrame, values.pivotY),
        },
      });
    },
    [selectedNode, isTransformSelected, visualFrame, updateNode],
  );

  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent, handle: SpatialDragHandle) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const values = getTransformValues();
      if (!values) return;
      committedRef.current = false;
      setDragState({
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        values,
        preserveView: handle === 'pivot' && e.ctrlKey,
      });
    },
    [getTransformValues],
  );

  const handleGlobalMouseMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState || !sceneNode || !isTransformSelected) return;

      const dx = (clientX - dragState.startClientX) / zoom;
      const dy = -(clientY - dragState.startClientY) / zoom;
      const v = dragState.values;
      const n = { ...v };

      switch (dragState.handle) {
        case 'move':
          n.translateX = v.translateX + dx;
          n.translateY = v.translateY + dy;
          break;

        case 'pivot':
          Object.assign(
            n,
            dragState.preserveView
              ? movePivotPreservingView(v, dx, dy)
              : {
                  pivotX: v.pivotX + dx,
                  pivotY: v.pivotY + dy,
                },
          );
          break;

        case 'rotate':
          n.rotation = v.rotation + (clientX - dragState.startClientX) * 0.3;
          break;

        default: {
          const sourceLeft = (sourceRect?.x ?? 0) - sceneNode.width / 2;
          const sourceRight =
            (sourceRect ? sourceRect.x + sourceRect.width : sceneNode.width) - sceneNode.width / 2;
          const sourceTop = (sourceRect?.y ?? 0) - sceneNode.height / 2;
          const sourceBottom =
            (sourceRect ? sourceRect.y + sourceRect.height : sceneNode.height) -
            sceneNode.height / 2;
          let ox = 0,
            oy = 0;

          if (dragState.handle === 'nw' || dragState.handle === 'n' || dragState.handle === 'ne')
            oy = sourceTop;
          if (dragState.handle === 'sw' || dragState.handle === 's' || dragState.handle === 'se')
            oy = sourceBottom;
          if (dragState.handle === 'nw' || dragState.handle === 'w' || dragState.handle === 'sw')
            ox = sourceLeft;
          if (dragState.handle === 'ne' || dragState.handle === 'e' || dragState.handle === 'se')
            ox = sourceRight;
          if (dragState.handle === 'n' || dragState.handle === 's') ox = 0;
          if (dragState.handle === 'w' || dragState.handle === 'e') oy = 0;

          const offX = ox - v.pivotX;
          const offY = -oy + v.pivotY;

          let sdx = dx;
          let sdy = dy;
          if (dragState.handle === 'n' || dragState.handle === 's') sdx = 0;
          if (dragState.handle === 'w' || dragState.handle === 'e') sdy = 0;

          if (
            Math.abs(offX * v.scaleX) > 0.5 &&
            dragState.handle !== 'n' &&
            dragState.handle !== 's'
          ) {
            n.scaleX = CLAMP(v.scaleX * (1 + sdx / (offX * v.scaleX)), -10, 10);
          }
          if (
            Math.abs(offY * v.scaleY) > 0.5 &&
            dragState.handle !== 'w' &&
            dragState.handle !== 'e'
          ) {
            n.scaleY = CLAMP(v.scaleY * (1 + sdy / (offY * v.scaleY)), -10, 10);
          }

          if (n.scaleX === 0) n.scaleX = 0.01;
          if (n.scaleY === 0) n.scaleY = 0.01;
          break;
        }
      }

      applyTransform(n);
    },
    [dragState, sceneNode, sourceRect, zoom, isTransformSelected, applyTransform],
  );

  const handleMouseUp = useCallback((): boolean => {
    if (!dragState) return false;
    if (!committedRef.current) {
      commitMutation({
        patch: {},
        history: { label: 'Transform', state: { nodes, selectedNodeId } },
      });
      committedRef.current = true;
    }
    setDragState(null);
    return true;
  }, [dragState, nodes, commitMutation, selectedNodeId]);

  const handleMouseLeave = useCallback((): void => {
    if (dragState) {
      handleMouseUp();
    }
  }, [dragState, handleMouseUp]);

  const cleanupOnToolChange = useCallback(
    (_previousTool: string | null) => {
      if (dragState) {
        if (!committedRef.current) {
          commitMutation({
            patch: {},
            history: { label: 'Transform', state: { nodes, selectedNodeId } },
          });
          committedRef.current = true;
        }
        setDragState(null);
      }
    },
    [dragState, nodes, commitMutation, selectedNodeId],
  );

  const shouldForceOverlays = isTransformSelected && !!dragState;

  return {
    handleSvgMouseDown,
    handleGlobalMouseMove,
    handleMouseUp,
    handleMouseLeave,
    cleanupOnToolChange,
    dragState,
    hoveredHandle,
    setHoveredHandle,
    shouldForceOverlays,
    getTransformValues,
  };
}
