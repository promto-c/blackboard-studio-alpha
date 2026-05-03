import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, NodeType, SceneNode, ViewerSlotAssignments } from '@blackboard/types';
import { ImageThumbnail, LiveThumbnail, ConnectionBadge, ViewerSlotBadges } from '@/components';
import { usePreferences } from '@/state/preferencesContext';
import type { ThumbnailMode } from '@/state/preferencesContext';
import * as Icons from '@blackboard/icons';
import { buildMergeModel } from '@/utils/mergeNodes';
import { getInputConnections } from '@/utils/connectionGraph';
import { effectRegistry } from '@/effects/effectRegistry';
import { NodeActionMenu, NodeAction } from './NodeActionMenu';
import { createStackingAction } from './nodeActionFactories';
import NodeIcon from './NodeIcon';
import {
  getNodeBlendModeLabel,
  getStaticThumbnailAssetId,
  hasMediaThumbnail as nodeHasMediaThumbnail,
} from './nodeVisualHelpers';
import { getActiveNodeJobMap, NodeProgressBackground } from './NodeProgressBackground';

const VisibilityToggle: React.FC<{
  visible: boolean;
  onClick: (e: React.MouseEvent) => void;
}> = ({ visible, onClick }) => (
  <button
    onClick={onClick}
    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded"
    title={visible ? 'Hide' : 'Show'}
  >
    {visible ? <Icons.Eye className="h-4 w-4" /> : <Icons.EyeSlash className="h-4 w-4" />}
  </button>
);

const SPACING = 4; // Reduced spacing from 8 to 4 for compactness

/** Render the thumbnail for a media node stack based on the current thumbnail mode. */
function renderMediaThumbnail(
  stack: AnyNode[],
  baseNode: AnyNode,
  sceneNode: SceneNode,
  thumbnailMode: ThumbnailMode,
) {
  if (thumbnailMode === 'live') {
    return <LiveThumbnail stack={stack} sceneNode={sceneNode} />;
  }
  if (thumbnailMode === 'static') {
    return <LiveThumbnail stack={stack} sceneNode={sceneNode} staticFrame={0} />;
  }

  const assetId = getStaticThumbnailAssetId(baseNode);
  return <ImageThumbnail assetId={assetId} className="w-full h-full object-contain" />;
}

interface DragState {
  id: string;
  yOffset: number;
  startIdx: number;
  currentIdx: number;
  element: HTMLElement;
}

function getInputPortsForNode(node: AnyNode) {
  const inputPorts = effectRegistry.get(node.type)?.inputPorts;
  if (!inputPorts) return [];
  return typeof inputPorts === 'function' ? inputPorts(node) : inputPorts;
}

const getPortLabel = (node: AnyNode, portName: string): string =>
  getInputPortsForNode(node).find((port) => port.name === portName)?.label ?? portName;

/** Renders the vertical pipeline rail on the right side of the node list, connecting nodes in the same pipeline flow. */
const PipelineRail: React.FC<{
  listRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  stacks: AnyNode[][];
  layoutVersion: number;
}> = ({ listRef, itemRefs, stacks, layoutVersion }) => {
  const [segments, setSegments] = useState<
    {
      top: number;
      height: number;
    }[]
  >([]);

  const updateSegments = useCallback(() => {
    if (!listRef.current || stacks.length < 2) {
      setSegments([]);
      return;
    }

    const listRect = listRef.current.getBoundingClientRect();
    const rowRects = stacks
      .map((stack) => itemRefs.current.get(stack[0].id))
      .filter((el): el is HTMLDivElement => !!el)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          top: rect.top - listRect.top,
          bottom: rect.bottom - listRect.top,
        };
      })
      .sort((a, b) => a.top - b.top);

    if (rowRects.length < 2) {
      setSegments([]);
      return;
    }

    const nextSegments = rowRects
      .slice(0, -1)
      .map((rect, index) => {
        const nextRect = rowRects[index + 1];
        const top = rect.bottom;
        const height = nextRect.top - rect.bottom;

        return { top, height };
      })
      .filter((segment) => segment.height > 0);

    setSegments(nextSegments);
  }, [itemRefs, listRef, stacks]);

  useLayoutEffect(() => {
    updateSegments();

    const animationFrameId = window.requestAnimationFrame(updateSegments);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [layoutVersion, updateSegments]);

  if (segments.length === 0) return null;

  return (
    <div className="absolute pointer-events-none right-0 top-0 bottom-0" aria-hidden="true">
      {segments.map((segment, index) => (
        <div
          key={`${segment.top}-${index}`}
          className="absolute right-4 w-px rounded-full bg-gray-300/20"
          style={{ top: segment.top, height: segment.height }}
        />
      ))}
    </div>
  );
};

const NodeInputConnectionChips: React.FC<{
  node: AnyNode;
  allNodes: AnyNode[];
  isSelected: boolean;
  onDisconnect: (nodeId: string, portName: string) => void;
  onConnectPort?: (nodeId: string, portName: string) => void;
  onSelectNode: (nodeId: string) => void;
  onHoverNodeIds: (nodeIds: string[]) => void;
  pendingConnection?: PendingConnection | null;
}> = ({
  node,
  allNodes,
  isSelected,
  onDisconnect,
  onConnectPort,
  onSelectNode,
  onHoverNodeIds,
  pendingConnection,
}) => {
  const connectedInputs = getInputConnections(node);
  const inputPorts = getInputPortsForNode(node);
  const connectedPortNames = new Set(connectedInputs.map((input) => input.portName));
  const unconnectedPorts = isSelected
    ? inputPorts.filter((port) => !connectedPortNames.has(port.name))
    : [];

  if (connectedInputs.length === 0 && unconnectedPorts.length === 0) return null;

  return (
    <div className="ml-7 mt-1 flex flex-wrap gap-1">
      {connectedInputs.map(({ portName, sourceNodeId }) => {
        const sourceNode = allNodes.find((candidate) => candidate.id === sourceNodeId);
        const portLabel = getPortLabel(node, portName);

        return (
          <span
            key={`${node.id}:${portName}`}
            className="inline-flex min-w-0 max-w-full items-center overflow-hidden rounded border border-primary-300/20 bg-primary-500/10 text-[10px] text-primary-100 transition-colors hover:border-primary-300/45 hover:bg-primary-500/15"
            title={`${portLabel} connected to ${sourceNode?.name ?? 'Unknown'}`}
            onMouseEnter={() => onHoverNodeIds(sourceNode ? [sourceNode.id] : [])}
            onMouseLeave={() => onHoverNodeIds([])}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (sourceNode) {
                  onSelectNode(sourceNode.id);
                }
              }}
              className="inline-flex min-w-0 flex-1 items-center gap-1 px-1.5 py-0.5 text-left transition-colors hover:text-primary-50"
              aria-label={`Select ${sourceNode?.name ?? 'connected source'}`}
            >
              <Icons.Link className="h-3 w-3 shrink-0 text-primary-300" />
              <span className="max-w-[5.5rem] truncate text-primary-200/80">{portLabel}</span>
              <span className="text-primary-200/40">&larr;</span>
              <span className="max-w-[7rem] truncate">{sourceNode?.name ?? 'Unknown'}</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDisconnect(node.id, portName);
              }}
              className="mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-primary-200/60 hover:bg-primary-300/15 hover:text-primary-50"
              title={`Cut ${portLabel} input`}
              aria-label={`Cut ${portLabel} input`}
            >
              <Icons.XMark className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {unconnectedPorts.map((port) => {
        const isAwaitingConnection =
          pendingConnection?.nodeId === node.id && pendingConnection?.portName === port.name;

        return (
          <button
            key={`${node.id}:${port.name}:open`}
            onClick={(event) => {
              event.stopPropagation();
              onConnectPort?.(node.id, port.name);
            }}
            className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-all ${
              isAwaitingConnection
                ? 'border-primary-400/80 bg-primary-900/40 text-primary-300 ring-1 ring-primary-400/50 cursor-default'
                : 'border-gray-700/70 bg-gray-950/45 text-gray-500 hover:border-gray-600 hover:bg-gray-900/60 cursor-pointer'
            }`}
            title={
              isAwaitingConnection
                ? `Click a node to connect to ${port.label}`
                : `Click to connect ${port.label}`
            }
            type="button"
          >
            <Icons.Minus className="h-3 w-3 shrink-0" />
            <span className="max-w-[8rem] truncate">{port.label}</span>
            <span className={isAwaitingConnection ? 'text-primary-400/60' : 'text-gray-600'}>
              {isAwaitingConnection ? 'select source' : 'open'}
            </span>
          </button>
        );
      })}
    </div>
  );
};

interface NodeListProps {
  stacks: AnyNode[][];
  selectedStackIds: Set<string>;
  selectedNodeId: string | null;
  sceneNode: SceneNode;
  direction: 'bottom-up' | 'top-down';
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
}

interface PendingConnection {
  nodeId: string;
  portName: string;
}

const NodeList: React.FC<NodeListProps> = ({
  stacks: initialStacks,
  selectedStackIds,
  selectedNodeId,
  sceneNode,
  direction,
  viewerNodeId,
  viewerSlots,
}) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const {
    selectNode,
    toggleNodeVisibility,
    toggleNodeStacking,
    deleteNode,
    reorderNodes,
    disconnectNodeInput,
    connectNodeInput,
  } = useEditorActions();
  const { thumbnailMode } = usePreferences();

  const [localStacks, setLocalStacks] = useState(initialStacks);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [hoveredConnectionNodeIds, setHoveredConnectionNodeIds] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const measuredHeights = useRef<Map<string, number>>(new Map());
  const [layoutVersion, setLayoutVersion] = useState(0);

  // Sync local state with global state, unless a drag is active
  useEffect(() => {
    if (!dragState) {
      setLocalStacks(initialStacks);
    }
  }, [initialStacks, dragState]);

  const stacksInFlowOrder = useMemo(
    () => (direction === 'bottom-up' ? localStacks.slice().reverse() : localStacks),
    [direction, localStacks],
  );

  const visiblePipelineStacks = useMemo(
    () => stacksInFlowOrder.filter((stack) => !stack[0].detachedFromPipe),
    [stacksInFlowOrder],
  );

  const resizeObserver = useMemo(
    () =>
      new ResizeObserver(() => {
        setLayoutVersion((v) => v + 1);
      }),
    [],
  );

  useEffect(() => {
    const elementsToObserve = Array.from(itemRefs.current.values());
    elementsToObserve.forEach((el) => resizeObserver.observe(el));
    return () => {
      elementsToObserve.forEach((el) => resizeObserver.unobserve(el));
    };
  }, [localStacks, resizeObserver]);

  useLayoutEffect(() => {
    if (!listRef.current) return;

    let totalHeight = -SPACING;
    let currentY = 0;
    const newTops = new Map<string, number>();

    localStacks.forEach((stack) => {
      const id = stack[0].id;
      const el = itemRefs.current.get(id);
      if (el) {
        const height = el.offsetHeight;
        measuredHeights.current.set(id, height);
        newTops.set(id, currentY);
        totalHeight += height + SPACING;
        currentY += height + SPACING;
      }
    });

    listRef.current.style.height = `${totalHeight}px`;

    // Position rows with `top` instead of transforms so the floating
    // inspector's backdrop blur can sample them consistently.
    localStacks.forEach((stack) => {
      const id = stack[0].id;
      const el = itemRefs.current.get(id);
      if (el && (!dragState || dragState.id !== id)) {
        el.style.transform = 'none';
        el.style.top = `${newTops.get(id) ?? 0}px`;
      }
    });
  }, [localStacks, dragState, layoutVersion]);

  // Handle ESC key to cancel connection mode
  useEffect(() => {
    if (!pendingConnection) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingConnection(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pendingConnection]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, stack: AnyNode[]) => {
      e.preventDefault();
      e.stopPropagation();

      const id = stack[0].id;
      const el = itemRefs.current.get(id);
      if (!el) return;

      const currentIdx = localStacks.findIndex((s) => s[0].id === id);
      if (currentIdx === -1) return;

      el.setPointerCapture(e.pointerId);

      setDragState({
        id,
        yOffset: e.clientY - el.getBoundingClientRect().top,
        startIdx: currentIdx,
        currentIdx: currentIdx,
        element: el,
      });
    },
    [localStacks],
  );

  const handleSelectPortForConnection = useCallback((nodeId: string, portName: string) => {
    setPendingConnection({ nodeId, portName });
  }, []);

  const handleCompleteConnection = useCallback(
    (e: React.MouseEvent, sourceNodeId: string) => {
      e.stopPropagation();
      if (!pendingConnection) return;
      connectNodeInput(pendingConnection.nodeId, pendingConnection.portName, sourceNodeId);
      setPendingConnection(null);
    },
    [pendingConnection, connectNodeInput],
  );

  useEffect(() => {
    if (!dragState) return;

    const { id, yOffset, element } = dragState;

    const handlePointerMove = (e: PointerEvent) => {
      const listRect = listRef.current!.getBoundingClientRect();
      let y = e.clientY - listRect.top - yOffset;

      const listHeight = parseFloat(listRef.current!.style.height);
      const itemHeight = measuredHeights.current.get(id) || 0;
      const max_y = listHeight - itemHeight;
      y = Math.max(0, Math.min(max_y, y));

      element.style.transform = 'none';
      element.style.top = `${y}px`;

      // --- Calculate new index ---
      const relativeY = y;
      let newIdx = 0;
      let cumulativeHeight = 0;

      for (let i = 0; i < localStacks.length; i++) {
        const stackId = localStacks[i][0].id;
        const height = measuredHeights.current.get(stackId) || 0;
        const slotCenter = cumulativeHeight + height / 2;
        if (relativeY < slotCenter) {
          newIdx = i;
          break;
        }
        cumulativeHeight += height + SPACING;
        if (i === localStacks.length - 1) {
          newIdx = i;
        }
      }
      newIdx = Math.max(0, Math.min(localStacks.length - 1, newIdx));

      if (newIdx !== dragState.currentIdx) {
        setDragState((prev) => (prev ? { ...prev, currentIdx: newIdx } : null));
        setLocalStacks((current) => {
          const oldIdx = current.findIndex((s) => s[0].id === id);
          if (oldIdx === -1) return current;
          const newStacks = [...current];
          const [movedItem] = newStacks.splice(oldIdx, 1);
          newStacks.splice(newIdx, 0, movedItem);
          return newStacks;
        });
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      element.releasePointerCapture(e.pointerId);
      const finalState = { ...dragState }; // Capture state before reset
      setDragState(null);

      if (finalState.startIdx !== finalState.currentIdx) {
        // Convert local reversed indices back to original full-node indices
        const dragId = finalState.id;
        const originalDragIndex = nodes.findIndex((node) => node.id === dragId);

        // Determine the drop target based on the original order
        const originalTargetStack = initialStacks[finalState.currentIdx];
        const dropId = originalTargetStack[0].id;
        const originalDropIndex = nodes.findIndex((node) => node.id === dropId);

        if (originalDragIndex !== -1 && originalDropIndex !== -1) {
          reorderNodes(originalDragIndex, originalDropIndex);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, localStacks, reorderNodes, nodes, initialStacks]);

  const mergeModel = useMemo(() => buildMergeModel(stacksInFlowOrder), [stacksInFlowOrder]);
  const mergeInfo = mergeModel.info;
  const hoveredConnectionNodeIdSet = useMemo(
    () => new Set(hoveredConnectionNodeIds),
    [hoveredConnectionNodeIds],
  );
  const activeNodeJobMap = useMemo(() => getActiveNodeJobMap(backgroundJobs), [backgroundJobs]);

  return (
    <div ref={listRef} className="relative w-full">
      <PipelineRail
        listRef={listRef}
        itemRefs={itemRefs}
        stacks={visiblePipelineStacks}
        layoutVersion={layoutVersion}
      />
      {localStacks.map((stack) => {
        const baseNode = stack[0];
        const isDraggable = baseNode.type !== NodeType.SCENE;
        const isDragging = dragState?.id === baseNode.id;
        const isStackSelected = selectedStackIds.has(baseNode.id);
        const showMediaThumbnail = nodeHasMediaThumbnail(baseNode);

        const isBottomUp = direction === 'bottom-up';
        const stackContent = isBottomUp ? stack.slice().reverse() : stack;

        const mi = mergeInfo.get(baseNode.id);
        const isSecondarySource = mi?.isMergeSource ?? false;
        const isConnectionHoverTarget = stack.some((node) =>
          hoveredConnectionNodeIdSet.has(node.id),
        );
        const rowPositionClass = baseNode.detachedFromPipe
          ? 'absolute left-0 right-8'
          : 'absolute left-0 right-0';

        return (
          <div
            key={baseNode.id}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(baseNode.id, el);
              } else {
                itemRefs.current.delete(baseNode.id);
              }
            }}
            className={rowPositionClass}
            style={{
              transitionProperty: isDragging ? 'none' : 'top',
            }}
          >
            {isSecondarySource ? (
              /* --- Source merged over an earlier source: narrow source + merge badge --- */
              <div className="flex items-stretch gap-1">
                {/* Narrow source card */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    selectNode(baseNode.id);
                  }}
                  className={`group flex-1 min-w-0 text-gray-300 font-medium rounded-md transition-all duration-150 ease-out border ${
                    isConnectionHoverTarget
                      ? 'border-primary-300/60 bg-primary-950/35 ring-1 ring-inset ring-primary-300/30'
                      : isDragging
                        ? `z-10 shadow-lg !transition-none ${isStackSelected ? 'bg-primary-900/50 border-primary-500' : 'border-primary-500 bg-gray-700/50'}`
                        : isStackSelected
                          ? 'bg-primary-900/50 border-primary-500'
                          : 'border-transparent bg-gray-750/50 hover:bg-gray-700/50'
                  }`}
                >
                  {stackContent.map((node) => {
                    const isBase = node.id === baseNode.id;
                    const isSelectedNode = node.id === selectedNodeId;
                    const nodeIndexInAll = nodes.findIndex((n) => n.id === node.id);
                    const stackingAction = createStackingAction(
                      node,
                      nodeIndexInAll > 0,
                      toggleNodeStacking,
                    );
                    return (
                      <div
                        key={node.id}
                        onClick={(e) => {
                          if (pendingConnection) {
                            handleCompleteConnection(e, node.id);
                          } else {
                            e.stopPropagation();
                            selectNode(node.id);
                          }
                        }}
                        className={`relative flex items-center gap-1 overflow-hidden rounded-md p-1.5 text-xs transition-colors ${
                          hoveredConnectionNodeIdSet.has(node.id)
                            ? 'bg-primary-300/10 ring-1 ring-inset ring-primary-300/35'
                            : isSelectedNode
                              ? 'bg-primary-900/40 ring-1 ring-inset ring-primary-500/50'
                              : pendingConnection
                                ? 'hover:bg-gray-700/30 cursor-pointer'
                                : ''
                        }`}
                      >
                        <NodeProgressBackground job={activeNodeJobMap.get(node.id)} />
                        <div
                          onPointerDown={isBase ? (e) => handlePointerDown(e, stack) : undefined}
                          className={`relative flex-shrink-0 w-6 h-6 flex items-center justify-center ${isBase ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
                          title={isBase ? 'Drag to reorder' : ''}
                        >
                          {isBase ? (
                            <Icons.GripVertical className="h-5 w-5 text-gray-500 group-hover:text-gray-300" />
                          ) : (
                            <div className="w-6 h-6" />
                          )}
                        </div>
                        <div className="relative min-w-0 flex-1">
                          <div className="flex items-center gap-2 truncate">
                            {isBase && showMediaThumbnail ? (
                              <div className="flex-shrink-0 w-10 h-8 bg-gray-900 rounded overflow-hidden flex items-center justify-center text-gray-500">
                                {renderMediaThumbnail(stack, baseNode, sceneNode, thumbnailMode)}
                              </div>
                            ) : (
                              <NodeIcon node={node} />
                            )}
                            <span className="flex-1 truncate">{node.name}</span>
                            <ViewerSlotBadges
                              nodeId={node.id}
                              viewerNodeId={viewerNodeId}
                              viewerSlots={viewerSlots}
                            />
                            <ConnectionBadge
                              node={node}
                              allNodes={nodes}
                              onHoverNodeIds={setHoveredConnectionNodeIds}
                              onSelectNode={selectNode}
                            />
                          </div>
                          <NodeInputConnectionChips
                            node={node}
                            allNodes={nodes}
                            isSelected={isSelectedNode}
                            onDisconnect={disconnectNodeInput}
                            onConnectPort={handleSelectPortForConnection}
                            onSelectNode={selectNode}
                            onHoverNodeIds={setHoveredConnectionNodeIds}
                            pendingConnection={pendingConnection}
                          />
                        </div>
                        <div className="relative flex items-center flex-shrink-0">
                          <NodeActionMenu
                            actions={[
                              ...(stackingAction ? [stackingAction] : []),
                              {
                                id: 'visibility',
                                label: node.visible ? 'Hide' : 'Show',
                                icon: node.visible ? (
                                  <Icons.Eye className="h-4 w-4" />
                                ) : (
                                  <Icons.EyeSlash className="h-4 w-4" />
                                ),
                                iconClassName:
                                  'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded',
                                onClick: (e) => {
                                  e.stopPropagation();
                                  toggleNodeVisibility(node.id);
                                },
                              },
                            ]}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Connection wire from source to merge */}
                <div className="flex items-center flex-shrink-0 w-3">
                  <div className="w-full h-px bg-gray-500/60" />
                </div>

                {/* Merge badge */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const mId = mi?.mergeId;
                    if (mId) selectNode(mId);
                  }}
                  className={`flex-shrink-0 flex items-center gap-1 px-2 rounded-md border text-xs cursor-pointer transition-colors ${
                    mi?.mergeId && selectedNodeId === mi.mergeId
                      ? 'border-primary-500 bg-primary-900/50 text-primary-300 ring-1 ring-primary-500/50'
                      : 'border-gray-600/50 bg-gray-800/60 text-gray-400 hover:bg-gray-700/50'
                  }`}
                  title={`Merge (${getNodeBlendModeLabel(baseNode)})`}
                >
                  <Icons.Merge className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                    {getNodeBlendModeLabel(baseNode)}
                  </span>
                  {mi?.mergeId && (
                    <ViewerSlotBadges
                      nodeId={mi.mergeId}
                      viewerNodeId={viewerNodeId}
                      viewerSlots={viewerSlots}
                    />
                  )}
                  <VisibilityToggle
                    visible={baseNode.visible}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleNodeVisibility(baseNode.id);
                    }}
                  />
                </div>
              </div>
            ) : (
              /* --- Normal stack row (or the first source in the flow) --- */
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  selectNode(baseNode.id);
                }}
                className={`group text-gray-300 font-medium rounded-md transition-all duration-150 ease-out border ${
                  isConnectionHoverTarget
                    ? 'z-0 border-primary-300/60 bg-primary-950/35 ring-1 ring-inset ring-primary-300/30'
                    : isDragging
                      ? `z-10 shadow-lg !transition-none ${isStackSelected ? 'bg-primary-900/50 border-primary-500' : 'border-primary-500 bg-gray-700/50'}`
                      : isStackSelected
                        ? 'z-0 bg-primary-900/50 border-primary-500'
                        : 'z-0 border-transparent bg-gray-750/50 hover:bg-gray-700/50'
                }`}
              >
                {stackContent.map((node) => {
                  const isBase = node.id === baseNode.id;
                  const isScene = node.type === NodeType.SCENE;

                  const nodeIndexInAll = nodes.findIndex((n) => n.id === node.id);
                  const stackingAction = createStackingAction(
                    node,
                    nodeIndexInAll > 0,
                    toggleNodeStacking,
                  );
                  const isSelectedNode = node.id === selectedNodeId;

                  return (
                    <div
                      key={node.id}
                      onClick={(e) => {
                        if (pendingConnection) {
                          handleCompleteConnection(e, node.id);
                        } else {
                          e.stopPropagation();
                          selectNode(node.id);
                        }
                      }}
                      className={`relative flex items-center gap-1 overflow-hidden rounded-md p-1.5 text-xs transition-colors ${
                        hoveredConnectionNodeIdSet.has(node.id)
                          ? 'bg-primary-300/10 ring-1 ring-inset ring-primary-300/35'
                          : isSelectedNode
                            ? 'bg-primary-900/40 ring-1 ring-inset ring-primary-500/50'
                            : pendingConnection
                              ? 'hover:bg-gray-700/30 cursor-pointer'
                              : ''
                      }`}
                    >
                      <NodeProgressBackground job={activeNodeJobMap.get(node.id)} />
                      <div
                        onPointerDown={
                          isDraggable && isBase ? (e) => handlePointerDown(e, stack) : undefined
                        }
                        className={`relative flex-shrink-0 w-6 h-6 flex items-center justify-center ${isDraggable && isBase ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
                        title={isDraggable && isBase ? 'Drag to reorder' : ''}
                      >
                        {isDraggable && isBase ? (
                          <Icons.GripVertical className="h-5 w-5 text-gray-500 group-hover:text-gray-300" />
                        ) : (
                          <div className="w-6 h-6" />
                        )}
                      </div>
                      <div className="relative min-w-0 flex-1">
                        <div className="flex items-center gap-2 truncate">
                          {isBase && showMediaThumbnail ? (
                            <div className="flex-shrink-0 w-10 h-8 bg-gray-900 rounded overflow-hidden flex items-center justify-center text-gray-500">
                              {renderMediaThumbnail(stack, baseNode, sceneNode, thumbnailMode)}
                            </div>
                          ) : (
                            <NodeIcon node={node} />
                          )}
                          <span className="flex-1 truncate">{node.name}</span>
                          <ViewerSlotBadges
                            nodeId={node.id}
                            viewerNodeId={viewerNodeId}
                            viewerSlots={viewerSlots}
                          />
                          <ConnectionBadge
                            node={node}
                            allNodes={nodes}
                            onHoverNodeIds={setHoveredConnectionNodeIds}
                            onSelectNode={selectNode}
                          />
                        </div>
                        <NodeInputConnectionChips
                          node={node}
                          allNodes={nodes}
                          isSelected={isSelectedNode}
                          onDisconnect={disconnectNodeInput}
                          onConnectPort={handleSelectPortForConnection}
                          onSelectNode={selectNode}
                          onHoverNodeIds={setHoveredConnectionNodeIds}
                          pendingConnection={pendingConnection}
                        />
                      </div>
                      <div className="relative flex items-center flex-shrink-0">
                        {isScene ? (
                          <div className="w-6 h-6" />
                        ) : (
                          <NodeActionMenu
                            actions={[
                              ...(stackingAction ? [stackingAction] : []),
                              ...(isBase && isDraggable
                                ? [
                                    {
                                      id: 'delete',
                                      label: 'Delete Stack',
                                      icon: <Icons.Trash className="h-4 w-4" />,
                                      iconClassName:
                                        'w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-gray-600/50 transition-colors',
                                      onClick: (e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        deleteNode(node.id);
                                      },
                                    } as NodeAction,
                                  ]
                                : []),
                              {
                                id: 'visibility',
                                label: node.visible ? 'Hide' : 'Show',
                                icon: node.visible ? (
                                  <Icons.Eye className="h-4 w-4" />
                                ) : (
                                  <Icons.EyeSlash className="h-4 w-4" />
                                ),
                                iconClassName:
                                  'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded',
                                onClick: (e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  toggleNodeVisibility(node.id);
                                },
                              },
                            ]}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default NodeList;
