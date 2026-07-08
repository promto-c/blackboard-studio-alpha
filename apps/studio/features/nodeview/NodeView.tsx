import React, { useRef, useMemo, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import {
  AnyNode,
  EditorTab,
  NodePositions,
  NodeType,
  type OutputNode,
  SceneNode,
  ViewerSlotAssignments,
} from '@blackboard/types';
import { getInputConnections } from '@/utils/connectionGraph';
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

import {
  getOutputPipeEdge,
  getSelectedNodeIdsForGrouping,
  isFlowOutputDetached,
  OUTPUT_NODE_ID,
} from '@/state/editor/flowModel';
import {
  isStackAdjustmentType,
  participatesInImplicitPipeline,
  usesImplicitPipelineInput,
} from '@/utils/nodePredicates';
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
// --- Types ---

interface Connection {
  sourceNodeId: string;
  sourcePortName?: string;
  targetNodeId: string;
  targetPortName: string;
  isPipe?: boolean;
}

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
  const activeFlow = useEditorSelector((s) => {
    const flowId = s.activeFlowId ?? s.rootFlowId;
    return flowId ? s.flows[flowId] : null;
  });
  const outputNode = activeFlow?.nodes.find(
    (node): node is OutputNode => node.id === activeFlow.outputNodeId,
  );
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const previewNodeType = useEditorSelector((s) => s.previewNodeType);
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
    updateNode,
    connectNodeInput,
    disconnectNodeInput,
    setOutputPipeDetached,
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
  const suppressNextCanvasClickRef = useRef(false);
  const lastGraphPointerPositionRef = useRef<{ x: number; y: number } | null>(null);

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
  const outputPipeEdge = useMemo(() => getOutputPipeEdge(activeFlow), [activeFlow]);
  const isOutputDetached = useMemo(() => isFlowOutputDetached(activeFlow), [activeFlow]);

  const graphNodeIds = useMemo(() => {
    const ids = new Set<string>([OUTPUT_NODE_ID]);
    for (const stack of nodeStacks) {
      ids.add(stack[0].id);
    }
    return ids;
  }, [nodeStacks]);

  // --- Pipe connections (implicit from node order) ---

  const pipeConnections = useMemo(() => {
    const conns: Connection[] = [];

    // Scene is a global control, not a pipeline node. "previousExitId" tracks
    // the current output from real graph stacks only.
    let previousExitId: string | null = null;

    for (const stack of nodeStacks) {
      const baseNode = stack[0];
      if (!participatesInImplicitPipeline(baseNode.type)) {
        continue;
      }
      if (baseNode.detachedFromPipe) continue;

      if (previousExitId && usesImplicitPipelineInput(baseNode.type)) {
        conns.push({
          sourceNodeId: previousExitId,
          sourcePortName: 'output',
          targetNodeId: baseNode.id,
          targetPortName: 'pipe',
          isPipe: true,
        });
      }
      previousExitId = baseNode.id;
    }

    // Last implicit pipeline exit -> Output, unless Output has been explicitly rewired/detached.
    if (previousExitId && !outputPipeEdge && !isOutputDetached) {
      conns.push({
        sourceNodeId: previousExitId,
        sourcePortName: 'output',
        targetNodeId: OUTPUT_NODE_ID,
        targetPortName: 'pipe',
        isPipe: true,
      });
    }

    return conns;
  }, [nodeStacks, outputPipeEdge, isOutputDetached]);

  // --- Explicit connections (from node.inputs) ---

  const explicitConnections = useMemo(() => {
    const conns: Connection[] = [];
    for (const node of nodes) {
      for (const { portName, sourceNodeId, sourcePortName } of getInputConnections(node)) {
        conns.push({
          sourceNodeId,
          sourcePortName,
          targetNodeId: node.id,
          targetPortName: portName,
        });
      }
    }
    for (const edge of activeFlow?.edges ?? []) {
      if (edge.targetNodeId !== OUTPUT_NODE_ID) continue;
      conns.push({
        sourceNodeId: edge.sourceNodeId,
        sourcePortName: edge.sourcePort,
        targetNodeId: OUTPUT_NODE_ID,
        targetPortName: edge.targetPort,
      });
    }
    return conns;
  }, [activeFlow, nodes]);

  // Merge all connections
  const allConnections = useMemo(() => {
    const explicitTargetKeys = new Set(
      explicitConnections.map(
        (connection) => `${connection.targetNodeId}:${connection.targetPortName}`,
      ),
    );
    return [
      ...pipeConnections.filter(
        (connection) =>
          !explicitTargetKeys.has(`${connection.targetNodeId}:${connection.targetPortName}`),
      ),
      ...explicitConnections,
    ];
  }, [pipeConnections, explicitConnections]);

  const connectionMap = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const conn of allConnections) {
      map.set(`${conn.targetNodeId}:${conn.targetPortName}`, conn);
    }
    return map;
  }, [allConnections]);

  // --- Connection selection ---
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const getPipeDetachTargetId = useCallback((conn: Connection): string | null => {
    if (!conn.isPipe) return null;
    if (conn.targetPortName === 'pipe') {
      return conn.targetNodeId;
    }
    return null;
  }, []);
  const detachPipeConnection = useCallback(
    (conn: Connection): boolean => {
      const targetNodeId = getPipeDetachTargetId(conn);
      if (!targetNodeId) return false;
      if (targetNodeId === OUTPUT_NODE_ID) {
        setOutputPipeDetached(true);
        setSelectedConnection(null);
        return true;
      }
      updateNode(targetNodeId, { detachedFromPipe: true } as Partial<AnyNode>, true);
      setSelectedConnection(null);
      return true;
    },
    [getPipeDetachTargetId, setOutputPipeDetached, updateNode],
  );
  const canCutConnection = useCallback(
    (conn: Connection): boolean => !conn.isPipe || getPipeDetachTargetId(conn) !== null,
    [getPipeDetachTargetId],
  );
  const cutConnection = useCallback(
    (conn: Connection): boolean => {
      if (conn.isPipe) {
        return detachPipeConnection(conn);
      }
      disconnectNodeInput(conn.targetNodeId, conn.targetPortName);
      setSelectedConnection(null);
      return true;
    },
    [detachPipeConnection, disconnectNodeInput],
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
          if (selectedConnection.isPipe) {
            return cutConnection(selectedConnection);
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
            if (targetPortName === 'pipe' && targetNodeId !== OUTPUT_NODE_ID) {
              const targetNode = nodes.find((candidate) => candidate.id === targetNodeId);
              if (targetNode?.detachedFromPipe) {
                updateNode(targetNodeId, { detachedFromPipe: false } as Partial<AnyNode>, true);
              }
            }
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
  }, [dragConnectState, connectNodeInput, nodes, updateNode]);

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
    const entry = computePreviewEntry(previewNodeType, nodeStacks);
    if (!entry) return null;

    const position = computeGraphPreviewPosition(
      nodeStacks,
      nodePositions,
      stackMap,
      selectedNodeId,
    );
    return { ...entry, position };
  }, [previewNodeType, nodeStacks, nodePositions, stackMap, selectedNodeId]);

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
      if (!draggedStack || !draggedNode || !isStackAdjustmentType(draggedNode.type)) {
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

      const interactiveElement = target.closest(
        'a, button, input, textarea, select, [role="button"], [data-graph-node], [data-port-input], [data-connection-wire]',
      );
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

      const interactiveElement = target.closest(
        'a, button, input, textarea, select, [role="button"], [data-graph-node], [data-port-input], [data-connection-wire]',
      );
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
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-xs text-gray-500">
          <p>Add nodes to see the node graph.</p>
          <div className="mt-4 flex justify-center">
            <div className="flex flex-wrap justify-center gap-2">
              <MediaSourceImportToolButton />
              <ImageSequenceToolButton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const getPos = (id: string) => nodePositions[id] || { x: 0, y: 0 };

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden relative"
      style={{ cursor: getCursorStyle() }}
      onMouseDown={(e) => {
        handleMouseDown(e);
        startMarqueeSelection(e);
        // Click on empty canvas deselects connection
        if (e.target === e.currentTarget || e.target === contentRef.current) {
          setSelectedConnection(null);
        }
      }}
      onMouseMove={updateGraphPointerPosition}
      onDoubleClick={openAddNodesPanel}
      onClick={(event) => {
        if (suppressNextCanvasClickRef.current) {
          suppressNextCanvasClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        setSelectedConnection(null);
        // Prevent bubbling to the outer flow container's selectNode(null) handler
        event.stopPropagation();
      }}
    >
      {/* Grid background */}
      <CanvasGrid zoom={viewport.zoom} />

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
          connections={allConnections}
          portPositions={portPositions}
          selectedConnection={selectedConnection}
          onSelectConnection={setSelectedConnection}
          canCutConnection={canCutConnection}
          onCutConnection={cutConnection}
          dragPreview={dragPreview}
        />

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
            isConnected={connectionMap.has(`${OUTPUT_NODE_ID}:pipe`)}
            technicalChannels={outputNode?.technicalChannels ?? []}
            connectedTechnicalPorts={
              new Set(
                (outputNode?.technicalChannels ?? [])
                  .map((channel) => getOutputTechnicalChannelPort(channel.id))
                  .filter((portName) => connectionMap.has(`${OUTPUT_NODE_ID}:${portName}`)),
              )
            }
            viewerNodeId={viewerNodeId}
            viewerSlots={viewerSlots}
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
                connectionMap={connectionMap}
                viewerNodeId={viewerNodeId}
                viewerSlots={viewerSlots}
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
                onOutputPortMouseDown={(e, sourcePortName) =>
                  handleOutputPortMouseDown(e, baseNode.id, sourcePortName)
                }
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
