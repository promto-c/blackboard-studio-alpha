/**
 * useWarpInteraction — Encapsulates warp-pin viewport interaction state
 * and mouse handlers, extracted from Viewport.tsx (Phase 2).
 */

import { useState, useCallback } from 'react';
import { NodeType, type WarpNode, type AnyNode, type SceneNode } from '@blackboard/types';
import { getValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

export interface DragPinState {
  pinId: string;
  startX: number;
  startY: number;
  originalDx: number;
  originalDy: number;
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface UseWarpInteractionParams {
  selectedNode: AnyNode | undefined;
  sceneNode: SceneNode | undefined;
  activeViewportTool: string | null;
  zoom: number;
  visualFrame: number;
  nodes: AnyNode[];
  selectedNodeId: string | null;
  updateNode: (nodeId: string, changes: Record<string, unknown>, pushHistory?: boolean) => void;
  setActiveViewportTool: (tool: string | null) => void;
  pushHistory: (entry: { label: string; state: Record<string, unknown> }) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWarpInteraction({
  selectedNode,
  sceneNode,
  activeViewportTool,
  zoom,
  visualFrame,
  nodes,
  selectedNodeId,
  updateNode,
  setActiveViewportTool,
  pushHistory,
}: UseWarpInteractionParams) {
  const [dragPinState, setDragPinState] = useState<DragPinState | null>(null);
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // mouseDown — add pin / start move-pin drag
  // -----------------------------------------------------------------------
  const handleMouseDown = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      mousePos: { x: number; y: number },
      scenePos: { x: number; y: number },
    ): boolean => {
      if (e.button !== 0 || selectedNode?.type !== NodeType.WARP) return false;

      if (activeViewportTool === 'add_pin' && sceneNode) {
        e.preventDefault();
        const u = (scenePos.x + sceneNode.width / 2) / sceneNode.width;
        const v = (-scenePos.y + sceneNode.height / 2) / sceneNode.height;
        const warpNode = selectedNode as WarpNode;
        if (warpNode.pins.length >= 64) {
          alert('Max pins reached');
          return true;
        }
        const newPin = {
          id: `pin_${Date.now()}`,
          position: { x: u, y: v },
          translation: { x: 0, y: 0 },
        };
        updateNode(selectedNode.id, { pins: [...warpNode.pins, newPin] }, true);
        setActiveViewportTool('move_pin');
        return true;
      }

      if (activeViewportTool === 'move_pin' && hoveredPinId) {
        e.preventDefault();
        const pin = (selectedNode as WarpNode).pins.find((p) => p.id === hoveredPinId);
        if (pin) {
          setDragPinState({
            pinId: pin.id,
            startX: mousePos.x,
            startY: mousePos.y,
            originalDx: getValueAtFrame(pin.translation.x, visualFrame),
            originalDy: getValueAtFrame(pin.translation.y, visualFrame),
          });
        }
        return true;
      }

      return false;
    },
    [
      selectedNode,
      activeViewportTool,
      sceneNode,
      hoveredPinId,
      visualFrame,
      updateNode,
      setActiveViewportTool,
    ],
  );

  // -----------------------------------------------------------------------
  // mouseMove — drag pin
  // -----------------------------------------------------------------------
  const handleMouseMove = useCallback(
    (_e: ViewportMouseEvent, mousePos: { x: number; y: number }): boolean => {
      if (!dragPinState || selectedNode?.type !== NodeType.WARP || !sceneNode) return false;

      const dx = (mousePos.x - dragPinState.startX) / zoom;
      const dy = -(mousePos.y - dragPinState.startY) / zoom;
      const du = dx / sceneNode.width;
      const dv = dy / sceneNode.height;

      const warpNode = selectedNode as WarpNode;
      const pinIndex = warpNode.pins.findIndex((p) => p.id === dragPinState.pinId);

      if (pinIndex !== -1) {
        const targetX = dragPinState.originalDx + du;
        const targetY = dragPinState.originalDy + dv;
        const newPins = [...warpNode.pins];
        const pin = newPins[pinIndex];
        newPins[pinIndex] = {
          ...pin,
          translation: {
            x: setKeyframeOnValue(pin.translation.x, visualFrame, targetX),
            y: setKeyframeOnValue(pin.translation.y, visualFrame, targetY),
          },
        };
        updateNode(selectedNode.id, { pins: newPins }, false);
      }
      return true;
    },
    [dragPinState, selectedNode, sceneNode, zoom, visualFrame, updateNode],
  );

  // -----------------------------------------------------------------------
  // mouseUp — commit pin drag
  // -----------------------------------------------------------------------
  const handleMouseUp = useCallback((): boolean => {
    if (!dragPinState) return false;
    pushHistory({ label: 'Move Warp Pin', state: { nodes, selectedNodeId } });
    setDragPinState(null);
    return true;
  }, [dragPinState, pushHistory, nodes, selectedNodeId]);

  // -----------------------------------------------------------------------
  // mouseLeave — commit if drag was in progress
  // -----------------------------------------------------------------------
  const handleMouseLeave = useCallback((): void => {
    if (dragPinState) {
      pushHistory({ label: 'Move Warp Pin', state: { nodes, selectedNodeId } });
      setDragPinState(null);
    }
  }, [dragPinState, pushHistory, nodes, selectedNodeId]);

  // -----------------------------------------------------------------------
  // Tool-change cleanup — clear state when leaving move_pin tool
  // -----------------------------------------------------------------------
  const cleanupOnToolChange = useCallback(
    (previousTool: string | null) => {
      if (previousTool === 'move_pin' && activeViewportTool !== 'move_pin') {
        setDragPinState(null);
      }
    },
    [activeViewportTool],
  );

  const shouldForceOverlays = selectedNode?.type === NodeType.WARP && !!dragPinState;

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    cleanupOnToolChange,
    // Expose state for WarpOverlay + cursor
    dragPinState,
    hoveredPinId,
    setHoveredPinId,
    shouldForceOverlays,
  };
}
