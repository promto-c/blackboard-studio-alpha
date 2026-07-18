import React, { useRef, useMemo, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import {
  AnyNode,
  EditorTab,
  type FlowEdge,
  NodePositions,
  NodeType,
  type OutputNode,
  SceneNode,
  ViewerSlotAssignments,
} from '@blackboard/types';
import {
  buildPipelineOrder,
  placeNewNodes,
  NODE_WIDTH,
  estimateNodeHeight,
  buildStackMap,
} from '@/utils/autoLayoutGraph';
import { useCanvasViewport } from '@/hooks/useCanvasViewport';
import { useNodeDrag } from '@/hooks/useNodeDrag';
import { usePreferences } from '@/state/preferencesContext';
import { getOutputTechnicalChannelPort } from '@/color-management';

import { getSelectedNodeIdsForGrouping, OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { isStackableNode } from '@/utils/nodePredicates';
import { hasPreviousStackTarget } from '@/utils/nodeStacks';
import {
  useHotkeyScope,
  useRegisterHotkeyCommands,
  useRegisterHotkeys,
  type HotkeyBinding,
  type HotkeyCommand,
} from '@/hotkeys';
import CanvasGrid from './CanvasGrid';
import ConnectionWires from './ConnectionWires';
import { SceneNodeCard, OutputNodeCard, StackNodeCard, PreviewNodeCard } from './NodeCard';
import {
  computePreviewEntry,
  computeGraphPreviewPosition,
} from '@/features/nodes/previewPlaceholder';
import MediaSourceImportToolButton from '@/nodes/builtin/media_source/MediaSourceImportToolButton';
import ImageSequenceToolButton from '@/nodes/builtin/image_sequence/ImageSequenceToolButton';
import { getActiveNodeJobMap } from '@/features/nodes/NodeProgressBackground';
import { requestRegisteredNodeExecution } from '@/utils/nodeExecutionRegistry';
import { useInAppMediaDrop } from '@/hooks/useInAppMediaDrop';
import { hasInAppMediaDrag, readInAppMediaDrag } from '@/utils/inAppMediaDrag';
import { buildNodePortColorMap } from './nodePortVisuals';
import {
  GRAPH_INTERACTIVE_TARGET_SELECTOR,
  isGraphCanvasBackgroundTarget,
  resolveVisibleGraphNodeId,
  shouldCancelWireCutGesture,
} from './nodeViewState';
import { getWireCutConnectionIds, makePolylinePath, type GraphPoint } from './wireGeometry';
import {
  collectUpstreamEdgeIds,
  collectUpstreamEdgeIdsForNodes,
  collectUpstreamNodeIds,
} from '@/utils/flowTopology';
import { resolveViewerRouting } from '@/utils/viewerSlots';
// --- Types ---

interface DragConnectState {
  sourceNodeId: string;
  sourcePortName: string;
  cursorX: number;
  cursorY: number;
}

interface StackMagnetTarget {
  targetStackId: string;
  pullX: number;
  pullY: number;
  placeholderHeight: number;
}

interface MarqueeSelectionState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  hasDragged: boolean;
}

interface WireCutGestureState {
  points: GraphPoint[];
  intersectedConnectionIds: Set<string>;
  startConnectionId: string | null;
  hasDragged: boolean;
  canceled: boolean;
}

interface NodeViewProps {
  sceneNode: SceneNode | undefined;
  nodeStacks: AnyNode[][];
  selectedStackIds: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  isSceneSelected: boolean;
  isOutputNodeSelected: boolean;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  fitInsetRight?: number;
}

const STACK_MAGNET_RADIUS = 36;
const STACK_MAGNET_MIN_HORIZONTAL_OVERLAP = 0.55;
const STACK_MAGNET_PLACEHOLDER_GAP = 2;

function NodeView({
  sceneNode,
  nodeStacks,
  selectedStackIds,
  selectedNodeId,
  selectedNodeIds,
  isSceneSelected,
  isOutputNodeSelected,
  viewerNodeId,
  viewerSlots,
  fitInsetRight = 0,
}: NodeViewProps) {
  const nodes = useEditorSelector((s) => s.nodes);
  const portColors = useMemo(() => buildNodePortColorMap(nodes), [nodes]);
  const activeFlow = useEditorSelector((s) => {
    const flowId = s.activeFlowId ?? s.rootFlowId;
    return flowId ? s.flows[flowId] : null;
  });
  const outputNode = activeFlow?.nodes.find(
    (node): node is OutputNode => node.id === activeFlow.outputNodeId,
  );
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const previewNodeType = useEditorSelector((s) => s.previewNodeType);
  const isCompareActive = useEditorSelector((s) => s.compareView.isActive);
  const compareSlotA = useEditorSelector((s) => s.compareView.slotA);
  const compareSlotB = useEditorSelector((s) => s.compareView.slotB);
  const nodePositions = useEditorSelector((s) => {
    const flowId = s.activeFlowId ?? s.rootFlowId;
    return (flowId ? s.nodePositionsByFlow[flowId] : undefined) ?? {};
  });
  const {
    selectNode,
    selectNodes,
    toggleNodeSelection,
    toggleNodeEnabled,
    deleteNode,
    connectNodeInput,
    disconnectNodeInput,
    disconnectNodeInputs,
    setNodePosition,
    setNodePositions,
    commitNodePosition,
    autoArrangeNodes,
    toggleNodeStacking,
    stackNodeOntoStack,
    groupSelectedNodes,
    openGroupNode,
    setActiveTab,
    pasteNodesFromClipboard,
    setPendingNodePosition,
  } = useEditorActions();
  const { thumbnailMode } = usePreferences();
  const activeTab = useEditorSelector((s) => s.activeTab);
  const activeNodeJobMap = useMemo(() => getActiveNodeJobMap(backgroundJobs), [backgroundJobs]);
  const canGroupSelection = useMemo(
    () => getSelectedNodeIdsForGrouping(nodes, selectedNodeIds).length > 0,
    [nodes, selectedNodeIds],
  );
  const selectNodeFromPointer = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        toggleNodeSelection(nodeId);
        return;
      }
      selectNode(nodeId);
    },
    [selectNode, toggleNodeSelection],
  );

  // --- Canvas viewport (pan/zoom) ---
  const {
    viewport,
    containerRef,
    getTransformStyle,
    fitAll,
    handleMouseDown,
    getCursorStyle,
    isPanning,
  } = useCanvasViewport();
  const addInAppMediaToFlow = useInAppMediaDrop();
  const [isInAppMediaDragOver, setIsInAppMediaDragOver] = useState(false);
  const inAppMediaDragDepthRef = useRef(0);

  const handleInAppMediaDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasInAppMediaDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    inAppMediaDragDepthRef.current += 1;
    setIsInAppMediaDragOver(true);
  }, []);

  const handleInAppMediaDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasInAppMediaDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleInAppMediaDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isInAppMediaDragOver) return;
      event.preventDefault();
      event.stopPropagation();
      inAppMediaDragDepthRef.current = Math.max(0, inAppMediaDragDepthRef.current - 1);
      if (inAppMediaDragDepthRef.current === 0) setIsInAppMediaDragOver(false);
    },
    [isInAppMediaDragOver],
  );

  const handleInAppMediaDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const payload = readInAppMediaDrag(event.dataTransfer);
      if (!payload) return;
      event.preventDefault();
      event.stopPropagation();
      inAppMediaDragDepthRef.current = 0;
      setIsInAppMediaDragOver(false);

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      addInAppMediaToFlow(payload, {
        x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
      });
    },
    [addInAppMediaToFlow, containerRef, viewport.panX, viewport.panY, viewport.zoom],
  );
  useHotkeyScope({ id: 'flow.graph', parentId: 'flow', ref: containerRef });

  // --- Port position tracking ---
  const portRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [portPositions, setPortPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const marqueeSelectionRef = useRef<MarqueeSelectionState | null>(null);
  const [wireCutGesture, setWireCutGesture] = useState<WireCutGestureState | null>(null);
  const wireCutGestureRef = useRef<WireCutGestureState | null>(null);
  const wireCutClickSuppressedUntilRef = useRef(0);
  const [isWireCutModifierPressed, setIsWireCutModifierPressed] = useState(false);
  const suppressNextCanvasClickRef = useRef(false);
  const lastGraphPointerPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      setIsWireCutModifierPressed(event.ctrlKey || event.metaKey);
    };
    const resetModifier = () => setIsWireCutModifierPressed(false);

    window.addEventListener('keydown', updateModifier);
    window.addEventListener('keyup', updateModifier);
    window.addEventListener('blur', resetModifier);
    return () => {
      window.removeEventListener('keydown', updateModifier);
      window.removeEventListener('keyup', updateModifier);
      window.removeEventListener('blur', resetModifier);
    };
  }, []);

  const registerPortRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) portRefs.current.set(key, el);
    else portRefs.current.delete(key);
  }, []);

  // Measure port positions in canvas-space
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const contentRect = content.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();

    portRefs.current.forEach((el, key) => {
      const rect = el.getBoundingClientRect();
      // Convert screen coords to canvas-space (before zoom+pan transform)
      next.set(key, {
        x: (rect.left + rect.width / 2 - contentRect.left) / viewport.zoom,
        y: (rect.top + rect.height / 2 - contentRect.top) / viewport.zoom,
      });
    });
    setPortPositions(next);
  }, [nodes, layoutTick, nodePositions, viewport.zoom, viewport.panX, viewport.panY]);

  // Debounced layout recalc
  useEffect(() => {
    const observer = new ResizeObserver(() => setLayoutTick((v) => v + 1));
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const timer = setTimeout(() => setLayoutTick((v) => v + 1), 200);
    return () => clearTimeout(timer);
  }, [nodes]);

  const canStackNode = useCallback(
    (nodeId: string) => hasPreviousStackTarget(nodes, nodeId),
    [nodes],
  );
  const graphNodeIds = useMemo(() => {
    const ids = new Set<string>([OUTPUT_NODE_ID]);
    for (const stack of nodeStacks) {
      ids.add(stack[0].id);
    }
    return ids;
  }, [nodeStacks]);

  const connections = useMemo(() => activeFlow?.edges ?? [], [activeFlow]);

  const connectedInputKeys = useMemo(
    () =>
      new Set(
        connections.map((connection) => `${connection.targetNodeId}:${connection.targetPort}`),
      ),
    [connections],
  );

  const selectedGraphNodeId = useMemo(
    () => resolveVisibleGraphNodeId(selectedNodeId, nodeStacks),
    [nodeStacks, selectedNodeId],
  );
  const viewerRouting = useMemo(
    () =>
      resolveViewerRouting(viewerNodeId, viewerSlots, {
        isActive: isCompareActive,
        slotA: compareSlotA,
        slotB: compareSlotB,
      }),
    [compareSlotA, compareSlotB, isCompareActive, viewerNodeId, viewerSlots],
  );
  const viewerGraphNodeIds = useMemo(
    () =>
      viewerRouting.targetNodeIds
        .map((nodeId) => resolveVisibleGraphNodeId(nodeId, nodeStacks))
        .filter((nodeId): nodeId is string => !!nodeId),
    [nodeStacks, viewerRouting.targetNodeIds],
  );
  const compareViewerSlots = useMemo(
    () =>
      new Set(
        viewerRouting.compare ? [viewerRouting.compare.slotA, viewerRouting.compare.slotB] : [],
      ),
    [viewerRouting.compare],
  );
  const highlightedConnectionKeys = useMemo(
    () => collectUpstreamEdgeIds(connections, selectedGraphNodeId),
    [connections, selectedGraphNodeId],
  );
  const flowingConnectionKeys = useMemo(
    () => collectUpstreamEdgeIdsForNodes(connections, viewerGraphNodeIds),
    [connections, viewerGraphNodeIds],
  );

  // --- Connection selection ---
  const [selectedConnection, setSelectedConnection] = useState<FlowEdge | null>(null);
  const cutConnection = useCallback(
    (connection: FlowEdge): boolean => {
      disconnectNodeInput(connection.targetNodeId, connection.targetPort);
      setSelectedConnection(null);
      return true;
    },
    [disconnectNodeInput],
  );
  const updateGraphPointerPosition = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      lastGraphPointerPositionRef.current = {
        x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
      };
    },
    [containerRef, viewport.panX, viewport.panY, viewport.zoom],
  );
  const getGraphPastePosition = useCallback((): { x: number; y: number } | null => {
    if (lastGraphPointerPositionRef.current) return lastGraphPointerPositionRef.current;
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: (rect.width / 2 - viewport.panX) / viewport.zoom,
      y: (rect.height / 2 - viewport.panY) / viewport.zoom,
    };
  }, [containerRef, viewport.panX, viewport.panY, viewport.zoom]);
  const connectionCommands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'flow.graph.deleteSelectedConnection.runtime',
        run: () => {
          if (!selectedConnection) {
            return false;
          }
          return cutConnection(selectedConnection);
        },
      },
      {
        id: 'flow.graph.groupSelectedNodes.runtime',
        run: () => {
          if (!canGroupSelection) return false;
          groupSelectedNodes();
          return true;
        },
      },
      {
        id: 'flow.graph.pasteNodes.runtime',
        run: () => {
          void pasteNodesFromClipboard({ position: getGraphPastePosition() });
          return true;
        },
      },
    ],
    [
      canGroupSelection,
      cutConnection,
      getGraphPastePosition,
      groupSelectedNodes,
      pasteNodesFromClipboard,
      selectedConnection,
    ],
  );
  const connectionBindings = useMemo<HotkeyBinding[]>(
    () => [
      {
        keys: ['Delete', 'Backspace'],
        command: 'flow.graph.deleteSelectedConnection.runtime',
        scope: 'flow.graph',
        weight: 400,
      },
      {
        keys: ['Mod+G'],
        command: 'flow.graph.groupSelectedNodes.runtime',
        scope: 'flow.graph',
        weight: 400,
      },
      {
        keys: 'Mod+V',
        command: 'flow.graph.pasteNodes.runtime',
        scope: 'flow.graph',
        weight: 450,
      },
    ],
    [],
  );
  useRegisterHotkeyCommands('nodeview.runtime', connectionCommands);
  useRegisterHotkeys('nodeview.runtime', connectionBindings);

  // --- Drag-to-connect (port wiring) ---
  const [dragConnectState, setDragConnectState] = useState<DragConnectState | null>(null);

  const handleOutputPortMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, sourcePortName = 'output') => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedConnection(null);
      setDragConnectState({
        sourceNodeId: nodeId,
        sourcePortName,
        cursorX: e.clientX,
        cursorY: e.clientY,
      });
    },
    [],
  );

  useEffect(() => {
    if (!dragConnectState) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragConnectState((prev) =>
        prev ? { ...prev, cursorX: e.clientX, cursorY: e.clientY } : null,
      );
    };

    const handleMouseUp = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target) {
        const portEl = target.closest('[data-port-input]');
        if (portEl) {
          const targetNodeId = portEl.getAttribute('data-node-id');
          const targetPortName = portEl.getAttribute('data-port-name');
          if (targetNodeId && targetPortName && targetNodeId !== dragConnectState.sourceNodeId) {
            connectNodeInput(
              targetNodeId,
              targetPortName,
              dragConnectState.sourceNodeId,
              dragConnectState.sourcePortName,
            );
          }
        }
      }
      setDragConnectState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragConnectState, connectNodeInput]);

  // Convert drag preview cursor to canvas-space for wire rendering
  const dragPreview = useMemo(() => {
    if (!dragConnectState || !contentRef.current) return null;
    const contentRect = contentRef.current.getBoundingClientRect();
    return {
      sourceNodeId: dragConnectState.sourceNodeId,
      sourcePortName: dragConnectState.sourcePortName,
      cursorX: (dragConnectState.cursorX - contentRect.left) / viewport.zoom,
      cursorY: (dragConnectState.cursorY - contentRect.top) / viewport.zoom,
    };
  }, [dragConnectState, viewport.zoom]);

  // --- Node dragging ---
  const preDragPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const multiDragStartPositionsRef = useRef<NodePositions | null>(null);
  const [stackMagnetTarget, setStackMagnetTarget] = useState<StackMagnetTarget | null>(null);
  const [stackMagnetDropCommitId, setStackMagnetDropCommitId] = useState<string | null>(null);
  const stackMagnetTargetRef = useRef<StackMagnetTarget | null>(null);
  const stackNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const stackMap = useMemo(() => buildStackMap(nodeStacks), [nodeStacks]);

  // ── Graph view preview (ghost card while hovering a tool button) ────
  const previewInfo = useMemo<{
    nodeType: NodeType;
    name: string;
    isMerge: boolean;
    position: { x: number; y: number };
  } | null>(() => {
    const entry = computePreviewEntry(
      previewNodeType,
      nodeStacks,
      activeFlow
        ? collectUpstreamNodeIds(activeFlow.edges, activeFlow.outputNodeId)
        : new Set<string>(),
    );
    if (!entry) return null;

    const position = computeGraphPreviewPosition(
      nodeStacks,
      nodePositions,
      stackMap,
      selectedNodeId,
    );
    return { ...entry, position };
  }, [activeFlow, previewNodeType, nodeStacks, nodePositions, stackMap, selectedNodeId]);

  useEffect(() => {
    if (!stackMagnetDropCommitId) return;
    const frame = window.requestAnimationFrame(() => setStackMagnetDropCommitId(null));
    return () => window.cancelAnimationFrame(frame);
  }, [stackMagnetDropCommitId]);

  const registerStackNodeRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) stackNodeRefs.current.set(key, el);
    else stackNodeRefs.current.delete(key);
  }, []);

  const getRenderedStackHeight = useCallback((nodeId: string, fallbackHeight: number): number => {
    const el = stackNodeRefs.current.get(nodeId);
    if (!el) return fallbackHeight;

    let height = el.offsetHeight || fallbackHeight;
    const activeTarget = stackMagnetTargetRef.current;
    if (activeTarget?.targetStackId === nodeId) {
      const placeholderEl = el.querySelector<HTMLElement>('[data-stack-magnet-placeholder]');
      const placeholderHeight = placeholderEl?.offsetHeight ?? activeTarget.placeholderHeight;
      const placeholderGap = placeholderEl ? STACK_MAGNET_PLACEHOLDER_GAP : 0;
      height -= placeholderHeight + placeholderGap;
    }

    return Math.max(0, height);
  }, []);

  const getStackMagnetTarget = useCallback(
    (nodeId: string, x: number, y: number): StackMagnetTarget | null => {
      const draggedStack = nodeStacks.find((stack) => stack[0].id === nodeId);
      const draggedNode = draggedStack?.[0];
      if (!draggedStack || !draggedNode || !isStackableNode(draggedNode)) {
        return null;
      }

      const draggedHeight = getRenderedStackHeight(nodeId, estimateNodeHeight(nodeId, stackMap));
      const draggedRect = {
        x,
        y,
        width: NODE_WIDTH,
        height: draggedHeight,
      };

      let best: {
        targetStackId: string;
        distance: number;
        centerDistance: number;
        pullX: number;
        pullY: number;
        placeholderHeight: number;
      } | null = null;

      for (const targetStack of nodeStacks) {
        const targetBase = targetStack[0];
        if (targetBase.id === nodeId || targetStack.some((node) => node.id === nodeId)) {
          continue;
        }

        const targetPos = nodePositions[targetBase.id];
        if (!targetPos) {
          continue;
        }

        const targetHeight = getRenderedStackHeight(
          targetBase.id,
          estimateNodeHeight(targetBase.id, stackMap),
        );
        const targetRect = {
          x: targetPos.x,
          y: targetPos.y,
          width: NODE_WIDTH,
          height: targetHeight,
        };
        const placeholderRect = {
          x: targetRect.x,
          y: targetRect.y + targetRect.height,
          width: NODE_WIDTH,
          height: draggedHeight,
        };
        const draggedCenter = getRectCenter(draggedRect);
        const placeholderCenter = getRectCenter(placeholderRect);
        const deltaX = placeholderCenter.x - draggedCenter.x;
        const deltaY = placeholderCenter.y - draggedCenter.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance > STACK_MAGNET_RADIUS) {
          continue;
        }

        const overlap = getRectOverlap(draggedRect, placeholderRect);
        const minWidth = Math.min(draggedRect.width, placeholderRect.width);
        const hasEnoughOverlap = overlap.width >= minWidth * STACK_MAGNET_MIN_HORIZONTAL_OVERLAP;
        if (!hasEnoughOverlap) {
          continue;
        }

        const anchorDistance = distance;
        const strength = smoothStep(1 - distance / STACK_MAGNET_RADIUS);
        const candidate = {
          targetStackId: targetBase.id,
          distance,
          centerDistance: anchorDistance,
          pullX: deltaX * strength,
          pullY: deltaY * strength,
          placeholderHeight: draggedHeight,
        };

        if (
          !best ||
          candidate.distance < best.distance ||
          (candidate.distance === best.distance && candidate.centerDistance < best.centerDistance)
        ) {
          best = candidate;
        }
      }

      return best
        ? {
            targetStackId: best.targetStackId,
            pullX: best.pullX,
            pullY: best.pullY,
            placeholderHeight: best.placeholderHeight,
          }
        : null;
    },
    [getRenderedStackHeight, nodePositions, nodeStacks, stackMap],
  );

  const getSelectedDragPositionIds = useCallback(
    (nodeId: string): string[] => {
      const selectedPositionIds = new Set<string>();

      for (const stack of nodeStacks) {
        const baseNode = stack[0];
        if (selectedStackIds.has(baseNode.id) && nodePositions[baseNode.id]) {
          selectedPositionIds.add(baseNode.id);
        }
      }

      for (const selectedId of selectedNodeIds) {
        if (graphNodeIds.has(selectedId) && nodePositions[selectedId]) {
          selectedPositionIds.add(selectedId);
        }
      }

      if (!selectedPositionIds.has(nodeId)) {
        return nodePositions[nodeId] ? [nodeId] : [];
      }

      return Array.from(selectedPositionIds);
    },
    [graphNodeIds, nodePositions, nodeStacks, selectedNodeIds, selectedStackIds],
  );

  const { startDrag: startDragRaw, dragNodeId } = useNodeDrag({
    zoom: viewport.zoom,
    onDrag: (nodeId, x, y) => {
      setStackMagnetDropCommitId(null);
      const multiDragStartPositions = multiDragStartPositionsRef.current;
      const sourceStartPosition = multiDragStartPositions?.[nodeId];

      if (multiDragStartPositions && sourceStartPosition) {
        const deltaX = x - sourceStartPosition.x;
        const deltaY = y - sourceStartPosition.y;
        const nextPositions = { ...nodePositions };

        for (const draggedNodeId of Object.keys(multiDragStartPositions)) {
          const startPosition = multiDragStartPositions[draggedNodeId];
          if (!startPosition) continue;
          nextPositions[draggedNodeId] = {
            x: startPosition.x + deltaX,
            y: startPosition.y + deltaY,
          };
        }

        setNodePositions(nextPositions, { pushHistory: false });
        stackMagnetTargetRef.current = null;
        setStackMagnetTarget(null);
        return;
      }

      setNodePosition(nodeId, x, y);
      const nextTarget = getStackMagnetTarget(nodeId, x, y);
      stackMagnetTargetRef.current = nextTarget;
      setStackMagnetTarget(nextTarget);
    },
    onDragEnd: (nodeId) => {
      const target = stackMagnetTargetRef.current;
      stackMagnetTargetRef.current = null;
      setStackMagnetTarget(null);
      multiDragStartPositionsRef.current = null;

      if (target && stackNodeOntoStack(nodeId, target.targetStackId)) {
        setStackMagnetDropCommitId(target.targetStackId);
        preDragPositionsRef.current = null;
        return;
      }

      if (preDragPositionsRef.current) {
        commitNodePosition(preDragPositionsRef.current);
        preDragPositionsRef.current = null;
      }
    },
  });

  const startDrag = useCallback(
    (e: React.MouseEvent, nodeId: string, x: number, y: number) => {
      preDragPositionsRef.current = { ...nodePositions };
      const selectedDragPositionIds = getSelectedDragPositionIds(nodeId);
      multiDragStartPositionsRef.current =
        selectedDragPositionIds.length > 1
          ? Object.fromEntries(
              selectedDragPositionIds.map((selectedId) => [
                selectedId,
                { ...nodePositions[selectedId] },
              ]),
            )
          : null;
      stackMagnetTargetRef.current = null;
      setStackMagnetDropCommitId(null);
      setStackMagnetTarget(null);
      startDragRaw(e, nodeId, x, y);
    },
    [getSelectedDragPositionIds, nodePositions, startDragRaw],
  );

  const openAddNodesPanel = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const interactiveElement = target.closest(GRAPH_INTERACTIVE_TARGET_SELECTOR);
      if (interactiveElement) return;

      event.preventDefault();
      event.stopPropagation();
      setSelectedConnection(null);

      // Save the graph-space position so the next node created from the
      // tools panel lands at the double-click position on the canvas.
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setPendingNodePosition({
          x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
          y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
        });
      }

      setActiveTab(EditorTab.Tools);
    },
    [
      containerRef,
      setActiveTab,
      setPendingNodePosition,
      viewport.panX,
      viewport.panY,
      viewport.zoom,
    ],
  );

  const handleExecuteNode = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      requestRegisteredNodeExecution(nodeId);
    },
    [selectNode],
  );

  const getContainerPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef],
  );

  const containerPointToGraphPoint = useCallback(
    (point: { x: number; y: number }): { x: number; y: number } => ({
      x: (point.x - viewport.panX) / viewport.zoom,
      y: (point.y - viewport.panY) / viewport.zoom,
    }),
    [viewport.panX, viewport.panY, viewport.zoom],
  );

  const getGraphPoint = useCallback(
    (clientX: number, clientY: number): GraphPoint | null => {
      const containerPoint = getContainerPoint(clientX, clientY);
      return containerPoint ? containerPointToGraphPoint(containerPoint) : null;
    },
    [containerPointToGraphPoint, getContainerPoint],
  );

  const startWireCutGesture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): boolean => {
      if (
        event.button !== 0 ||
        (!event.ctrlKey && !event.metaKey) ||
        isPanning.current ||
        dragConnectState
      ) {
        return false;
      }

      const target = event.target;
      if (!(target instanceof Element)) return false;
      const startWire = target.closest('[data-connection-wire]');
      if (!startWire && !isGraphCanvasBackgroundTarget(target)) return false;

      const start = getGraphPoint(event.clientX, event.clientY);
      if (!start) return false;

      event.preventDefault();
      setSelectedConnection(null);
      const nextGesture: WireCutGestureState = {
        points: [start],
        intersectedConnectionIds: new Set(),
        startConnectionId: startWire?.getAttribute('data-connection-id') ?? null,
        hasDragged: false,
        canceled: false,
      };
      wireCutGestureRef.current = nextGesture;
      setWireCutGesture(nextGesture);
      return true;
    },
    [dragConnectState, getGraphPoint, isPanning],
  );

  const hasWireCutPointerGesture = wireCutGesture !== null;
  const isWireCutGestureActive = !!wireCutGesture && !wireCutGesture.canceled;
  useEffect(() => {
    if (!hasWireCutPointerGesture) return;

    const handleMouseMove = (event: MouseEvent) => {
      const point = getGraphPoint(event.clientX, event.clientY);
      if (!point) return;
      const current = wireCutGestureRef.current;
      if (!current || current.canceled) return;
      const lastPoint = current.points[current.points.length - 1];
      if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) * viewport.zoom < 2) return;

      const points = [...current.points, point];
      const startPoint = points[0];
      const hasDragged =
        current.hasDragged ||
        Math.hypot(point.x - startPoint.x, point.y - startPoint.y) * viewport.zoom >= 4;
      const nextGesture: WireCutGestureState = {
        points,
        startConnectionId: current.startConnectionId,
        hasDragged,
        canceled: false,
        intersectedConnectionIds: hasDragged
          ? getWireCutConnectionIds(connections, portPositions, points, 5 / viewport.zoom)
          : new Set(),
      };
      wireCutGestureRef.current = nextGesture;
      setWireCutGesture(nextGesture);
    };

    const finishGesture = () => {
      const finalGesture = wireCutGestureRef.current;
      wireCutGestureRef.current = null;
      setWireCutGesture(null);
      wireCutClickSuppressedUntilRef.current = Date.now() + 500;

      if (!finalGesture || finalGesture.canceled) return;
      const connectionIds = finalGesture.hasDragged
        ? finalGesture.intersectedConnectionIds
        : finalGesture.startConnectionId
          ? new Set([finalGesture.startConnectionId])
          : new Set<string>();
      if (connectionIds.size === 0) return;

      disconnectNodeInputs(
        connections
          .filter((connection) => connectionIds.has(connection.id))
          .map((connection) => ({
            nodeId: connection.targetNodeId,
            portName: connection.targetPort,
          })),
      );
      setSelectedConnection(null);
    };

    const cancelGesture = (event: KeyboardEvent) => {
      if (!shouldCancelWireCutGesture(event)) return;

      const current = wireCutGestureRef.current;
      if (!current || current.canceled) return;
      const canceledGesture: WireCutGestureState = {
        ...current,
        intersectedConnectionIds: new Set(),
        canceled: true,
      };
      wireCutGestureRef.current = canceledGesture;
      setWireCutGesture(canceledGesture);
    };

    const cancelGestureOnBlur = () => {
      wireCutGestureRef.current = null;
      setWireCutGesture(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', finishGesture);
    window.addEventListener('keyup', cancelGesture);
    window.addEventListener('blur', cancelGestureOnBlur);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishGesture);
      window.removeEventListener('keyup', cancelGesture);
      window.removeEventListener('blur', cancelGestureOnBlur);
    };
  }, [
    connections,
    disconnectNodeInputs,
    getGraphPoint,
    hasWireCutPointerGesture,
    portPositions,
    viewport.zoom,
  ]);

  const selectNodesInMarquee = useCallback(
    (selection: MarqueeSelectionState) => {
      const start = containerPointToGraphPoint({ x: selection.startX, y: selection.startY });
      const end = containerPointToGraphPoint({ x: selection.currentX, y: selection.currentY });
      const selectionRect = getNormalizedRect(start.x, start.y, end.x, end.y);
      const nextSelectedIds = new Set(selection.additive ? selectedNodeIds : []);

      for (const stack of nodeStacks) {
        const baseNode = stack[0];
        const position = nodePositions[baseNode.id];
        if (!position) continue;

        const stackRect = {
          x: position.x,
          y: position.y,
          width: NODE_WIDTH,
          height: getRenderedStackHeight(baseNode.id, estimateNodeHeight(baseNode.id, stackMap)),
        };
        if (rectsIntersect(selectionRect, stackRect)) {
          nextSelectedIds.add(baseNode.id);
        }
      }

      const outputPosition = nodePositions[OUTPUT_NODE_ID];
      if (outputPosition) {
        const outputRect = {
          x: outputPosition.x,
          y: outputPosition.y,
          width: NODE_WIDTH,
          height: estimateNodeHeight(OUTPUT_NODE_ID, stackMap),
        };
        if (rectsIntersect(selectionRect, outputRect)) {
          nextSelectedIds.add(OUTPUT_NODE_ID);
        }
      }

      selectNodes(Array.from(nextSelectedIds) as string[]);
    },
    [
      containerPointToGraphPoint,
      getRenderedStackHeight,
      nodePositions,
      nodeStacks,
      selectNodes,
      selectedNodeIds,
      stackMap,
    ],
  );

  const startMarqueeSelection = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isPanning.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const interactiveElement = target.closest(GRAPH_INTERACTIVE_TARGET_SELECTOR);
      if (interactiveElement) return;

      const start = getContainerPoint(event.clientX, event.clientY);
      if (!start) return;

      event.preventDefault();
      setSelectedConnection(null);
      const nextSelection = {
        startX: start.x,
        startY: start.y,
        currentX: start.x,
        currentY: start.y,
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
        hasDragged: false,
      };
      marqueeSelectionRef.current = nextSelection;
      setMarqueeSelection(nextSelection);
    },
    [getContainerPoint, isPanning],
  );

  useEffect(() => {
    if (!marqueeSelection) return;

    const handleMouseMove = (event: MouseEvent) => {
      const point = getContainerPoint(event.clientX, event.clientY);
      if (!point) return;

      setMarqueeSelection((current) => {
        if (!current) return null;
        const distance = Math.hypot(point.x - current.startX, point.y - current.startY);
        const nextSelection = {
          ...current,
          currentX: point.x,
          currentY: point.y,
          hasDragged: current.hasDragged || distance >= 4,
        };
        marqueeSelectionRef.current = nextSelection;
        return nextSelection;
      });
    };

    const handleMouseUp = () => {
      const finalSelection = marqueeSelectionRef.current;
      marqueeSelectionRef.current = null;
      setMarqueeSelection(null);
      if (!finalSelection?.hasDragged) return;

      suppressNextCanvasClickRef.current = true;
      selectNodesInMarquee(finalSelection);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [getContainerPoint, marqueeSelection, selectNodesInMarquee]);

  // --- Auto-layout initialization ---
  const initialLayoutDone = useRef(false);

  useEffect(() => {
    if (nodes.length === 0 || initialLayoutDone.current) return;

    const container = containerRef.current;
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;

    // Check if we need auto-layout (no positions stored, or positions are empty)
    const hasPositions = Object.keys(nodePositions).length > 0;
    if (!hasPositions) {
      const positions = autoArrangeNodes({ pushHistory: false });
      // Fit viewport to show all nodes
      const bounds = computeBounds(positions, stackMap, graphNodeIds);
      if (bounds) fitAll(bounds, { right: fitInsetRight });
    } else {
      // Fit viewport to existing positions
      const bounds = computeBounds(nodePositions, stackMap, graphNodeIds);
      if (bounds) fitAll(bounds, { right: fitInsetRight });
    }
    initialLayoutDone.current = true;
  }, [
    autoArrangeNodes,
    containerRef,
    fitAll,
    fitInsetRight,
    graphNodeIds,
    layoutTick,
    nodePositions,
    nodes.length,
    stackMap,
  ]);

  // Auto-place new nodes that don't have positions
  useEffect(() => {
    if (!initialLayoutDone.current || nodes.length === 0) return;

    // Collect all node IDs that should have positions
    const expectedIds = graphNodeIds;

    // Find missing positions
    const missing: string[] = [];
    for (const id of expectedIds) {
      if (!nodePositions[id]) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      // Place new nodes between their pipeline neighbours, shifting
      // downstream nodes so nothing overlaps.
      const pipelineOrder = buildPipelineOrder(nodeStacks);
      const newPositions = placeNewNodes(nodePositions, missing, pipelineOrder, nodeStacks);
      setNodePositions(newPositions, { pushHistory: false });
    }
  }, [graphNodeIds, nodePositions, nodeStacks, nodes, setNodePositions]);

  // --- Render ---

  if (!sceneNode && nodeStacks.length === 0) {
    return (
      <div
        ref={containerRef}
        className="relative flex h-full items-center justify-center p-4"
        onDragEnter={handleInAppMediaDragEnter}
        onDragOver={handleInAppMediaDragOver}
        onDragLeave={handleInAppMediaDragLeave}
        onDrop={handleInAppMediaDrop}
      >
        <div className="text-center text-xs text-gray-500">
          <p>Add nodes to see the node graph.</p>
          <div className="mt-4 flex justify-center">
            <div className="flex flex-wrap justify-center gap-2">
              <MediaSourceImportToolButton />
              <ImageSequenceToolButton />
            </div>
          </div>
        </div>
        {isInAppMediaDragOver ? (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border border-dashed border-primary-300/60 bg-primary-300/10 text-sm font-medium text-primary-100 backdrop-blur-sm">
            Drop media into Flow
          </div>
        ) : null}
      </div>
    );
  }

  const getPos = (id: string) => nodePositions[id] || { x: 0, y: 0 };

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden relative"
      style={{
        cursor: isWireCutModifierPressed || isWireCutGestureActive ? 'crosshair' : getCursorStyle(),
      }}
      onMouseDown={(e) => {
        handleMouseDown(e);
        if (startWireCutGesture(e)) return;
        startMarqueeSelection(e);
        if (isGraphCanvasBackgroundTarget(e.target)) {
          setSelectedConnection(null);
        }
      }}
      onMouseUp={(event) => {
        if (event.button === 0 && isPanning.current) {
          suppressNextCanvasClickRef.current = true;
        }
      }}
      onMouseMove={updateGraphPointerPosition}
      onDragEnter={handleInAppMediaDragEnter}
      onDragOver={handleInAppMediaDragOver}
      onDragLeave={handleInAppMediaDragLeave}
      onDrop={handleInAppMediaDrop}
      onDoubleClick={openAddNodesPanel}
      onClickCapture={(event) => {
        if (wireCutClickSuppressedUntilRef.current < Date.now()) {
          wireCutClickSuppressedUntilRef.current = 0;
          return;
        }
        wireCutClickSuppressedUntilRef.current = 0;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressNextCanvasClickRef.current) {
          suppressNextCanvasClickRef.current = false;
          event.preventDefault();
          return;
        }

        if (!isGraphCanvasBackgroundTarget(event.target)) return;

        setSelectedConnection(null);
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
          selectNode(null);
        }
      }}
    >
      {/* Grid background */}
      <CanvasGrid zoom={viewport.zoom} />

      {isInAppMediaDragOver ? (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border border-dashed border-primary-300/60 bg-primary-300/10 text-sm font-medium text-primary-100 backdrop-blur-sm">
          Drop media into Flow
        </div>
      ) : null}

      {marqueeSelection?.hasDragged ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-30 rounded border border-primary-300/80 bg-primary-400/15 shadow-[0_0_0_1px_rgb(var(--color-primary-900)/0.35)]"
          style={getMarqueeSelectionStyle(marqueeSelection)}
        />
      ) : null}

      {sceneNode ? (
        <div className="absolute left-3 top-10 z-20" data-graph-node="true">
          <SceneNodeCard
            sceneNode={sceneNode}
            isSelected={isSceneSelected}
            onSelect={() => selectNode(sceneNode.id)}
            onDragStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          />
        </div>
      ) : null}

      {/* Transformed content node */}
      <div ref={contentRef} style={getTransformStyle()}>
        {/* Connection wires */}
        <ConnectionWires
          connections={connections}
          portPositions={portPositions}
          selectedConnection={selectedConnection}
          onSelectConnection={setSelectedConnection}
          dragPreview={dragPreview}
          portColors={portColors}
          highlightedConnectionKeys={highlightedConnectionKeys}
          flowingConnectionKeys={flowingConnectionKeys}
          cutPreviewConnectionIds={
            isWireCutGestureActive ? wireCutGesture.intersectedConnectionIds : undefined
          }
          isCutGestureArmed={isWireCutModifierPressed || isWireCutGestureActive}
        />

        {isWireCutGestureActive && wireCutGesture.hasDragged ? (
          <svg
            aria-hidden="true"
            data-wire-cut-path="true"
            className="pointer-events-none absolute left-0 top-0"
            style={{ overflow: 'visible', width: 1, height: 1, zIndex: 20 }}
          >
            <path
              d={makePolylinePath(wireCutGesture.points)}
              fill="none"
              stroke="#f87171"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.18}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={makePolylinePath(wireCutGesture.points)}
              fill="none"
              stroke="#fca5a5"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="7 4"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        {/* Output node */}
        <div
          data-graph-node="true"
          style={{
            position: 'absolute',
            left: getPos(OUTPUT_NODE_ID).x,
            top: getPos(OUTPUT_NODE_ID).y,
            zIndex: dragNodeId === OUTPUT_NODE_ID ? 10 : 1,
          }}
        >
          <OutputNodeCard
            isSelected={isOutputNodeSelected}
            isDragTarget={!!dragConnectState}
            isConnected={connectedInputKeys.has(`${OUTPUT_NODE_ID}:pipe`)}
            technicalChannels={outputNode?.technicalChannels ?? []}
            connectedTechnicalPorts={
              new Set(
                (outputNode?.technicalChannels ?? [])
                  .map((channel) => getOutputTechnicalChannelPort(channel.id))
                  .filter((portName) => connectedInputKeys.has(`${OUTPUT_NODE_ID}:${portName}`)),
              )
            }
            viewerNodeId={viewerNodeId}
            viewerSlots={viewerSlots}
            compareViewerSlots={compareViewerSlots}
            onSelect={(event) => selectNodeFromPointer(event, OUTPUT_NODE_ID)}
            onDragStart={(e) => {
              if (isPanning.current) return;
              const pos = getPos(OUTPUT_NODE_ID);
              startDrag(e, OUTPUT_NODE_ID, pos.x, pos.y);
            }}
            registerPortRef={registerPortRef}
          />
        </div>

        {/* Preview ghost card / generic placeholder */}
        {previewInfo || (activeTab === EditorTab.Tools && nodeStacks.length > 0) ? (
          <div
            data-graph-node="true"
            style={{
              position: 'absolute',
              left:
                previewInfo?.position.x ??
                computeGraphPreviewPosition(nodeStacks, nodePositions, stackMap, selectedNodeId).x,
              top:
                previewInfo?.position.y ??
                computeGraphPreviewPosition(nodeStacks, nodePositions, stackMap, selectedNodeId).y,
              zIndex: 1,
            }}
          >
            {previewInfo ? (
              <PreviewNodeCard
                nodeType={previewInfo.nodeType}
                name={previewInfo.name}
                isMerge={previewInfo.isMerge}
              />
            ) : (
              <PreviewNodeCard nodeType={NodeType.SCENE} name="Add Node" />
            )}
          </div>
        ) : null}

        {/* Stack nodes */}
        {nodeStacks.map((stack) => {
          const baseNode = stack[0];
          const isStackSelected = selectedStackIds.has(baseNode.id);
          const pos = getPos(baseNode.id);
          const isMagnetTarget =
            !!stackMagnetTarget &&
            stackMagnetTarget.targetStackId === baseNode.id &&
            dragNodeId !== baseNode.id;
          const dragPull =
            dragNodeId === baseNode.id && stackMagnetTarget
              ? { x: stackMagnetTarget.pullX, y: stackMagnetTarget.pullY }
              : null;

          return (
            <div
              key={baseNode.id}
              ref={(el) => registerStackNodeRef(baseNode.id, el)}
              data-graph-node="true"
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                zIndex: dragNodeId === baseNode.id ? 10 : isMagnetTarget ? 5 : 1,
                transform: dragPull
                  ? `translate3d(${dragPull.x}px, ${dragPull.y}px, 0) scale(0.98)`
                  : undefined,
                willChange: dragPull ? 'transform' : undefined,
              }}
            >
              <StackNodeCard
                stack={stack}
                sceneNode={sceneNode}
                isSelected={isStackSelected}
                isStackMagnetTarget={isMagnetTarget}
                isStackMagnetSource={dragNodeId === baseNode.id && !!stackMagnetTarget}
                isStackMagnetDropCommit={stackMagnetDropCommitId === baseNode.id}
                stackMagnetPlaceholderHeight={
                  isMagnetTarget ? stackMagnetTarget.placeholderHeight : 0
                }
                selectedNodeId={selectedNodeId}
                selectedNodeIds={selectedNodeIds}
                thumbnailMode={thumbnailMode}
                connectedInputKeys={connectedInputKeys}
                viewerNodeId={viewerNodeId}
                viewerSlots={viewerSlots}
                compareViewerSlots={compareViewerSlots}
                isDragTarget={!!dragConnectState && dragConnectState.sourceNodeId !== baseNode.id}
                onSelect={(event) => selectNodeFromPointer(event, baseNode.id)}
                onSelectNode={(event, nodeId) => selectNodeFromPointer(event, nodeId)}
                onOpenGroupNode={openGroupNode}
                onDragStart={(e) => {
                  if (isPanning.current) return;
                  startDrag(e, baseNode.id, pos.x, pos.y);
                }}
                onToggleEnabled={toggleNodeEnabled}
                onToggleStacking={toggleNodeStacking}
                canStackNode={canStackNode}
                onDeleteNode={deleteNode}
                onOutputPortMouseDown={handleOutputPortMouseDown}
                registerPortRef={registerPortRef}
                activeNodeJobMap={activeNodeJobMap}
                onExecuteNode={handleExecuteNode}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function computeBounds(
  positions: Record<string, { x: number; y: number }>,
  stackMap?: Map<string, AnyNode[]>,
  includedIds?: Set<string>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const entries = Object.entries(positions);
  if (entries.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasIncludedPosition = false;

  for (const [id, pos] of entries) {
    if (includedIds && !includedIds.has(id)) continue;
    hasIncludedPosition = true;
    const h = stackMap ? estimateNodeHeight(id, stackMap) : 100;
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + NODE_WIDTH > maxX) maxX = pos.x + NODE_WIDTH;
    if (pos.y + h > maxY) maxY = pos.y + h;
  }

  if (!hasIncludedPosition) return null;

  return { minX, minY, maxX, maxY };
}

type GraphRect = { x: number; y: number; width: number; height: number };

function getNormalizedRect(x1: number, y1: number, x2: number, y2: number): GraphRect {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    width: Math.max(x1, x2) - x,
    height: Math.max(y1, y2) - y,
  };
}

function getMarqueeSelectionStyle(selection: MarqueeSelectionState): React.CSSProperties {
  const rect = getNormalizedRect(
    selection.startX,
    selection.startY,
    selection.currentX,
    selection.currentY,
  );
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function rectsIntersect(a: GraphRect, b: GraphRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function getRectCenter(rect: GraphRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function getRectOverlap(a: GraphRect, b: GraphRect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

export default NodeView;
