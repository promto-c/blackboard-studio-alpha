import React, { useRef, useEffect, useCallback, useState } from 'react';

interface NodeDragState {
  nodeId: string;
  startX: number;
  startY: number;
  startNodeX: number;
  startNodeY: number;
}

interface UseNodeDragOptions {
  zoom: number;
  onDrag: (nodeId: string, x: number, y: number) => void;
  onDragEnd?: (nodeId: string) => void;
}

const DRAG_THRESHOLD_PX = 4;

export function useNodeDrag({ zoom, onDrag, onDragEnd }: UseNodeDragOptions) {
  const [armedDragState, setArmedDragState] = useState<NodeDragState | null>(null);
  const [dragState, setDragState] = useState<NodeDragState | null>(null);
  const armedRef = useRef<NodeDragState | null>(null);
  const dragRef = useRef<NodeDragState | null>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent, nodeId: string, nodeX: number, nodeY: number) => {
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();
      const state: NodeDragState = {
        nodeId,
        startX: e.clientX,
        startY: e.clientY,
        startNodeX: nodeX,
        startNodeY: nodeY,
      };
      armedRef.current = state;
      dragRef.current = null;
      setArmedDragState(state);
      setDragState(null);
    },
    [],
  );

  useEffect(() => {
    if (!armedDragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const armed = armedRef.current;
      if (!armed) return;

      const screenDx = e.clientX - armed.startX;
      const screenDy = e.clientY - armed.startY;

      if (!dragRef.current && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) {
        return;
      }

      if (!dragRef.current) {
        dragRef.current = armed;
        setDragState(armed);
      }

      onDrag(armed.nodeId, armed.startNodeX + screenDx / zoom, armed.startNodeY + screenDy / zoom);
    };

    const handleMouseUp = () => {
      const activeDrag = dragRef.current;
      if (activeDrag && onDragEnd) {
        onDragEnd(activeDrag.nodeId);
      }
      armedRef.current = null;
      dragRef.current = null;
      setArmedDragState(null);
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [armedDragState, zoom, onDrag, onDragEnd]);

  return {
    startDrag,
    isDragging: dragState !== null,
    dragNodeId: dragState?.nodeId ?? null,
  };
}
