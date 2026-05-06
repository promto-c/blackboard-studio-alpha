import React, { useRef, useMemo, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, EditorTab, SceneNode, ViewerSlotAssignments } from '@blackboard/types';
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
import { buildMergeModel, getMergeSourceNodeId, isMergeNodeId } from '@/utils/mergeNodes';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { isStackAdjustmentType } from '@/utils/nodePredicates';
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
import { SceneNodeCard, OutputNodeCard, StackNodeCard } from './NodeCard';
import MergeNodeCard from './MergeNodeCard';
import ImageImportToolButton from '@/effects/image/ImageImportToolButton';
import ImageSequenceToolButton from '@/effects/image_sequence/ImageSequenceToolButton';
import AiInpaintingToolButton from '@/effects/ai/AiInpaintingToolButton';
import { getActiveNodeJobMap } from '@/features/nodes/NodeProgressBackground';
import { requestRegisteredNodeExecution } from '@/utils/nodeExecutionRegistry';

// --- Types ---

interface Connection {
  sourceNodeId: string;
  targetNodeId: string;
  targetPortName: string;
  isPipe?: boolean;
}

interface DragConnectState {
  sourceNodeId: string;
  cursorX: number;
  cursorY: number;
}

interface StackMagnetTarget {
  targetStackId: string;
  pullX: number;
  pullY: number;
}

interface NodeViewProps {
  sceneNode: SceneNode | undefined;
  nodeStacks: AnyNode[][];
  selectedStackIds: Set<string>;
  selectedNodeId: string | null;
  isSceneSelected: boolean;
  isOutputNodeSelected: boolean;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  fitInsetRight?: number;
}

const STACK_MAGNET_RADIUS = 84;
const STACK_MAGNET_MAX_PULL = 34;

// --- Main Component ---

const NodeView: React.FC<NodeViewProps> = ({
  sceneNode,
  nodeStacks,
  selectedStackIds,
  selectedNodeId,
  isSceneSelected,
  isOutputNodeSelected,
  viewerNodeId,
  viewerSlots,
  fitInsetRight = 0,
}) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const nodePositions = useEditorSelector((s) => s.nodePositions);
  const {
    selectNode,
    toggleNodeVisibility,
    deleteNode,
    updateNode,
    connectNodeInput,
    disconnectNodeInput,
    setNodePosition,
    setNodePositions,
    commitNodePosition,
    autoArrangeNodes,
    toggleNodeStacking,
    stackNodeOntoStack,
    setActiveTab,
  } = useEditorActions();
  const { thumbnailMode } = usePreferences();
  const activeNodeJobMap = useMemo(() => getActiveNodeJobMap(backgroundJobs), [backgroundJobs]);

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

  const mergeModel = useMemo(() => buildMergeModel(nodeStacks), [nodeStacks]);
  const canStackNode = useCallback(
    (nodeId: string) => hasPreviousStackTarget(nodes, nodeId),
    [nodes],
  );

  // Virtual merge node IDs and their positions
  const mergeNodeData = useMemo(() => {
    return mergeModel.mergeNodes.map(({ mergeId, sourceStack }) => {
      const sourceNode = sourceStack[0] as Partial<{
        operator: unknown;
        opacity: unknown;
      }>;
      return {
        mergeId,
        blendMode: sourceNode?.operator,
        opacity: typeof sourceNode?.opacity === 'number' ? sourceNode.opacity : undefined,
      };
    });
  }, [mergeModel]);

  // --- Pipe connections (implicit from node order, with merge handling) ---

  const pipeConnections = useMemo(() => {
    if (!sceneNode) return [];
    const conns: Connection[] = [];

    // "previousExitId" tracks the current output in the main pipeline chain.
    let previousExitId: string = sceneNode.id;

    for (const stack of nodeStacks) {
      const baseNode = stack[0];
      if (baseNode.detachedFromPipe) continue;
      const mergeInfo = mergeModel.info.get(baseNode.id);

      if (mergeInfo?.isMergeSource && mergeInfo.mergeId) {
        // Existing pipeline result -> Merge background
        conns.push({
          sourceNodeId: previousExitId,
          targetNodeId: mergeInfo.mergeId,
          targetPortName: 'merge-input-0',
          isPipe: true,
        });

        // Source branch -> Merge foreground
        conns.push({
          sourceNodeId: baseNode.id,
          targetNodeId: mergeInfo.mergeId,
          targetPortName: 'merge-input-1',
          isPipe: true,
        });

        previousExitId = mergeInfo.mergeId;
        continue;
      }

      conns.push({
        sourceNodeId: previousExitId,
        targetNodeId: baseNode.id,
        targetPortName: 'pipe',
        isPipe: true,
      });
      previousExitId = baseNode.id;
    }

    // Last exit -> Output
    conns.push({
      sourceNodeId: previousExitId,
      targetNodeId: OUTPUT_NODE_ID,
      targetPortName: 'pipe',
      isPipe: true,
    });

    return conns;
  }, [sceneNode, nodeStacks, mergeModel]);

  // --- Explicit connections (from node.inputs) ---

  const explicitConnections = useMemo(() => {
    const conns: Connection[] = [];
    for (const node of nodes) {
      for (const { portName, sourceNodeId } of getInputConnections(node)) {
        conns.push({ sourceNodeId, targetNodeId: node.id, targetPortName: portName });
      }
    }
    return conns;
  }, [nodes]);

  // Merge all connections
  const allConnections = useMemo(
    () => [...pipeConnections, ...explicitConnections],
    [pipeConnections, explicitConnections],
  );

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
      return conn.targetNodeId === OUTPUT_NODE_ID ? null : conn.targetNodeId;
    }
    if (conn.targetPortName.startsWith('merge-input-') && isMergeNodeId(conn.targetNodeId)) {
      return getMergeSourceNodeId(conn.targetNodeId);
    }
    return null;
  }, []);
  const detachPipeConnection = useCallback(
    (conn: Connection): boolean => {
      const targetNodeId = getPipeDetachTargetId(conn);
      if (!targetNodeId) return false;
      updateNode(targetNodeId, { detachedFromPipe: true } as Partial<AnyNode>, true);
      setSelectedConnection(null);
      return true;
    },
    [getPipeDetachTargetId, updateNode],
  );
  const connectionCommands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'flow.graph.deleteSelectedConnection.runtime',
        run: () => {
          if (!selectedConnection) {
            return false;
          }
          if (selectedConnection.isPipe) {
            return detachPipeConnection(selectedConnection);
          }
          disconnectNodeInput(selectedConnection.targetNodeId, selectedConnection.targetPortName);
          setSelectedConnection(null);
          return true;
        },
      },
    ],
    [detachPipeConnection, disconnectNodeInput, selectedConnection],
  );
  const connectionBindings = useMemo<HotkeyBinding[]>(
    () => [
      {
        keys: ['Delete', 'Backspace'],
        command: 'flow.graph.deleteSelectedConnection.runtime',
        scope: 'flow.graph',
        weight: 400,
      },
    ],
    [],
  );
  useRegisterHotkeyCommands('nodeview.runtime', connectionCommands);
  useRegisterHotkeys('nodeview.runtime', connectionBindings);

  // --- Drag-to-connect (port wiring) ---
  const [dragConnectState, setDragConnectState] = useState<DragConnectState | null>(null);

  const handleOutputPortMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedConnection(null);
    setDragConnectState({ sourceNodeId: nodeId, cursorX: e.clientX, cursorY: e.clientY });
  }, []);

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
            if (targetPortName === 'pipe') {
              const targetNode = nodes.find((candidate) => candidate.id === targetNodeId);
              if (targetNode?.detachedFromPipe) {
                updateNode(targetNodeId, { detachedFromPipe: false } as Partial<AnyNode>, true);
              }
            } else {
              connectNodeInput(targetNodeId, targetPortName, dragConnectState.sourceNodeId);
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
      cursorX: (dragConnectState.cursorX - contentRect.left) / viewport.zoom,
      cursorY: (dragConnectState.cursorY - contentRect.top) / viewport.zoom,
    };
  }, [dragConnectState, viewport.zoom]);

  // --- Node dragging ---
  const preDragPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const [stackMagnetTarget, setStackMagnetTarget] = useState<StackMagnetTarget | null>(null);
  const stackMagnetTargetRef = useRef<StackMagnetTarget | null>(null);
  const stackMap = useMemo(() => buildStackMap(nodeStacks), [nodeStacks]);

  const getStackMagnetTarget = useCallback(
    (nodeId: string, x: number, y: number): StackMagnetTarget | null => {
      const draggedStack = nodeStacks.find((stack) => stack[0].id === nodeId);
      const draggedNode = draggedStack?.[0];
      if (!draggedStack || !draggedNode || !isStackAdjustmentType(draggedNode.type)) {
        return null;
      }

      const draggedHeight = estimateNodeHeight(nodeId, stackMap);
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

        const targetHeight = estimateNodeHeight(targetBase.id, stackMap);
        const targetRect = {
          x: targetPos.x,
          y: targetPos.y,
          width: NODE_WIDTH,
          height: targetHeight,
        };
        const distance = getRectGapDistance(draggedRect, targetRect);
        if (distance > STACK_MAGNET_RADIUS) {
          continue;
        }

        const draggedCenter = getRectCenter(draggedRect);
        const targetCenter = getRectCenter(targetRect);
        const deltaX = targetCenter.x - draggedCenter.x;
        const deltaY = targetCenter.y - draggedCenter.y;
        const centerDistance = Math.hypot(deltaX, deltaY);
        const strength = 1 - distance / STACK_MAGNET_RADIUS;
        const pullDistance = STACK_MAGNET_MAX_PULL * strength;
        const pullScale = centerDistance > 0 ? pullDistance / centerDistance : 0;
        const candidate = {
          targetStackId: targetBase.id,
          distance,
          centerDistance,
          pullX: deltaX * pullScale,
          pullY: deltaY * pullScale,
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
          }
        : null;
    },
    [nodePositions, nodeStacks, stackMap],
  );

  const { startDrag: startDragRaw, dragNodeId } = useNodeDrag({
    zoom: viewport.zoom,
    onDrag: (nodeId, x, y) => {
      setNodePosition(nodeId, x, y);
      const nextTarget = getStackMagnetTarget(nodeId, x, y);
      stackMagnetTargetRef.current = nextTarget;
      setStackMagnetTarget(nextTarget);
    },
    onDragEnd: (nodeId) => {
      const target = stackMagnetTargetRef.current;
      stackMagnetTargetRef.current = null;
      setStackMagnetTarget(null);

      if (target && stackNodeOntoStack(nodeId, target.targetStackId)) {
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
      stackMagnetTargetRef.current = null;
      setStackMagnetTarget(null);
      startDragRaw(e, nodeId, x, y);
    },
    [nodePositions, startDragRaw],
  );

  const openAddNodesPanel = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const interactiveElement = target.closest(
        'a, button, input, textarea, select, [role="button"], [data-graph-node], [data-port-input]',
      );
      if (interactiveElement) return;

      event.preventDefault();
      event.stopPropagation();
      setSelectedConnection(null);
      setActiveTab(EditorTab.Tools);
    },
    [setActiveTab],
  );

  const handleExecuteNode = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      requestRegisteredNodeExecution(nodeId);
    },
    [selectNode],
  );

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
      const bounds = computeBounds(positions, stackMap);
      if (bounds) fitAll(bounds, { right: fitInsetRight });
    } else {
      // Fit viewport to existing positions
      const bounds = computeBounds(nodePositions, stackMap);
      if (bounds) fitAll(bounds, { right: fitInsetRight });
    }
    initialLayoutDone.current = true;
  }, [
    autoArrangeNodes,
    containerRef,
    fitAll,
    fitInsetRight,
    layoutTick,
    nodePositions,
    nodes.length,
    stackMap,
  ]);

  // Auto-place new nodes that don't have positions
  useEffect(() => {
    if (!initialLayoutDone.current || nodes.length === 0) return;

    // Collect all node IDs that should have positions
    const expectedIds = new Set<string>();
    if (sceneNode) expectedIds.add(sceneNode.id);
    expectedIds.add(OUTPUT_NODE_ID);
    for (const stack of nodeStacks) {
      expectedIds.add(stack[0].id);
    }
    // Also include virtual merge node IDs
    for (const md of mergeNodeData) {
      expectedIds.add(md.mergeId);
    }

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
      const pipelineOrder = buildPipelineOrder(nodes, nodeStacks);
      const newPositions = placeNewNodes(nodePositions, missing, pipelineOrder, nodeStacks);
      setNodePositions(newPositions, { pushHistory: false });
    }
  }, [mergeNodeData, nodePositions, nodeStacks, nodes, sceneNode, setNodePositions]);

  // --- Render ---

  if (!sceneNode) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-xs text-gray-500">
          <p>Add nodes to see the node graph.</p>
          <div className="mt-4 flex justify-center">
            <div className="flex flex-wrap justify-center gap-2">
              <ImageImportToolButton />
              <ImageSequenceToolButton />
              <AiInpaintingToolButton />
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
        // Click on empty canvas deselects connection
        if (e.target === e.currentTarget || e.target === contentRef.current) {
          setSelectedConnection(null);
        }
      }}
      onDoubleClick={openAddNodesPanel}
      onClick={() => setSelectedConnection(null)}
    >
      {/* Grid background */}
      <CanvasGrid zoom={viewport.zoom} />

      {/* Transformed content node */}
      <div ref={contentRef} style={getTransformStyle()}>
        {/* Connection wires */}
        <ConnectionWires
          connections={allConnections}
          portPositions={portPositions}
          selectedConnection={selectedConnection}
          onSelectConnection={setSelectedConnection}
          onCutConnection={detachPipeConnection}
          dragPreview={dragPreview}
        />

        {/* Scene node */}
        <div
          data-graph-node="true"
          style={{
            position: 'absolute',
            left: getPos(sceneNode.id).x,
            top: getPos(sceneNode.id).y,
            zIndex: dragNodeId === sceneNode.id ? 10 : 1,
          }}
        >
          <SceneNodeCard
            sceneNode={sceneNode}
            isSelected={isSceneSelected}
            onSelect={() => selectNode(sceneNode.id)}
            onDragStart={(e) => {
              if (isPanning.current) return;
              const pos = getPos(sceneNode.id);
              startDrag(e, sceneNode.id, pos.x, pos.y);
            }}
            registerPortRef={registerPortRef}
            onOutputPortMouseDown={(e) => handleOutputPortMouseDown(e, sceneNode.id)}
          />
        </div>

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
            viewerNodeId={viewerNodeId}
            viewerSlots={viewerSlots}
            onSelect={() => selectNode(OUTPUT_NODE_ID)}
            onDragStart={(e) => {
              if (isPanning.current) return;
              const pos = getPos(OUTPUT_NODE_ID);
              startDrag(e, OUTPUT_NODE_ID, pos.x, pos.y);
            }}
            registerPortRef={registerPortRef}
          />
        </div>

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
              data-graph-node="true"
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                zIndex: dragNodeId === baseNode.id ? 10 : isMagnetTarget ? 5 : 1,
                transform: dragPull
                  ? `translate(${dragPull.x}px, ${dragPull.y}px) scale(0.98)`
                  : undefined,
                transition: dragPull ? 'transform 120ms ease-out' : undefined,
              }}
            >
              <StackNodeCard
                stack={stack}
                sceneNode={sceneNode}
                isSelected={isStackSelected}
                isStackMagnetTarget={isMagnetTarget}
                isStackMagnetSource={dragNodeId === baseNode.id && !!stackMagnetTarget}
                selectedNodeId={selectedNodeId}
                thumbnailMode={thumbnailMode}
                connectionMap={connectionMap}
                viewerNodeId={viewerNodeId}
                viewerSlots={viewerSlots}
                isDragTarget={!!dragConnectState && dragConnectState.sourceNodeId !== baseNode.id}
                onSelect={() => selectNode(baseNode.id)}
                onSelectNode={(nodeId) => selectNode(nodeId)}
                onDragStart={(e) => {
                  if (isPanning.current) return;
                  startDrag(e, baseNode.id, pos.x, pos.y);
                }}
                onToggleVisibility={toggleNodeVisibility}
                onToggleStacking={toggleNodeStacking}
                canStackNode={canStackNode}
                onDeleteNode={deleteNode}
                onOutputPortMouseDown={(e) => handleOutputPortMouseDown(e, baseNode.id)}
                registerPortRef={registerPortRef}
                activeNodeJobMap={activeNodeJobMap}
                onExecuteNode={handleExecuteNode}
              />
            </div>
          );
        })}

        {/* Virtual merge nodes */}
        {mergeNodeData.map(({ mergeId, blendMode, opacity }) => {
          const pos = getPos(mergeId);
          const isMergeSelected = selectedNodeId === mergeId;
          return (
            <div
              key={mergeId}
              data-graph-node="true"
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                zIndex: dragNodeId === mergeId ? 10 : 1,
              }}
            >
              <MergeNodeCard
                mergeId={mergeId}
                blendMode={blendMode}
                opacity={opacity}
                isSelected={isMergeSelected}
                viewerNodeId={viewerNodeId}
                viewerSlots={viewerSlots}
                registerPortRef={registerPortRef}
                onSelect={() => selectNode(mergeId)}
                onDragStart={(e) => {
                  if (isPanning.current) return;
                  startDrag(e, mergeId, pos.x, pos.y);
                }}
                inputCount={2}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

function computeBounds(
  positions: Record<string, { x: number; y: number }>,
  stackMap?: Map<string, AnyNode[]>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const entries = Object.entries(positions);
  if (entries.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const [id, pos] of entries) {
    const h = stackMap ? estimateNodeHeight(id, stackMap) : 100;
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + NODE_WIDTH > maxX) maxX = pos.x + NODE_WIDTH;
    if (pos.y + h > maxY) maxY = pos.y + h;
  }

  return { minX, minY, maxX, maxY };
}

type GraphRect = { x: number; y: number; width: number; height: number };

function getRectCenter(rect: GraphRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function getRectGapDistance(a: GraphRect, b: GraphRect): number {
  const horizontalGap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const verticalGap = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.hypot(horizontalGap, verticalGap);
}

export default NodeView;
