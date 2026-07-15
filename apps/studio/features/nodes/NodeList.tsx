import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import {
  AnyNode,
  EditorTab,
  NodeType,
  type NoteNode,
  SceneNode,
  ViewerSlotAssignments,
  BlendMode,
} from '@blackboard/types';
import { LiveThumbnail, ConnectionBadge, ViewerSlotBadges } from '@/components';
import { usePreferences } from '@/state/preferencesContext';
import type { ThumbnailMode } from '@/state/preferences';
import * as Icons from '@blackboard/icons';
import { NodeActionMenu, NodeAction } from './NodeActionMenu';
import { createExecutionAction, createStackingAction } from './nodeActionFactories';
import NodeIcon from './NodeIcon';
import { nodeFlags } from '@/nodes/helpers';
import { getActiveNodeJobMap, NodeProgressBackground } from './NodeProgressBackground';
import { requestRegisteredNodeExecution } from '@/utils/nodeExecutionRegistry';
import { PipelineRail } from './NodeListRail';
import { NodeInputConnectionChips } from './NodeInputConnectionChips';
import { DirectMergeInlineNode } from './DirectMergeInlineNode';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { NodeListDragController } from './NodeListDragController';
import { computePreviewEntry, findPreviewInsertIndex } from './previewPlaceholder';
import { collectUpstreamNodeIds, getPrimaryPipelineNodeIds } from '@/utils/flowTopology';

const SPACING = 4; // Reduced spacing from 8 to 4 for compactness
const FLOATING_ROW_RAIL_GUTTER_CLASS = 'right-8';

/** Render the thumbnail for a media node stack based on the current thumbnail mode. */
function renderMediaThumbnail(
  stack: AnyNode[],
  sceneNode: SceneNode,
  thumbnailMode: ThumbnailMode,
) {
  if (thumbnailMode === 'live') {
    return <LiveThumbnail stack={stack} sceneNode={sceneNode} />;
  }
  if (thumbnailMode === 'static') {
    return <LiveThumbnail stack={stack} sceneNode={sceneNode} staticFrame={0} />;
  }

  return null;
}

/** Payload passed from the pointer-down handler to `onDragStart` via a ref. */
interface PointerDownPayload {
  pointerId: number;
  el: HTMLElement;
  id: string;
  currentIdx: number;
  clientY: number;
}

const getNotePreview = (content: string): string =>
  content
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isNoteNode = (node: AnyNode): node is NoteNode => node.type === NodeType.NOTE;

interface NodeListProps {
  stacks: AnyNode[][];
  selectedStackIds: Set<string>;
  selectedNodeId: string | null;
  sceneNode: SceneNode | undefined;
  direction: 'bottom-up' | 'top-down';
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
}

interface PendingConnection {
  nodeId: string;
  portName: string;
}

function NodeList({
  stacks: initialStacks,
  selectedStackIds,
  selectedNodeId,
  sceneNode,
  direction,
  viewerNodeId,
  viewerSlots,
}: NodeListProps) {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedNodeIds = useEditorSelector((s) => s.selectedNodeIds ?? []);
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const previewNodeType = useEditorSelector((s) => s.previewNodeType);
  const activeTab = useEditorSelector((s) => s.activeTab);
  const activeFlow = useEditorSelector((s) => {
    const flowId = s.activeFlowId ?? s.rootFlowId;
    return flowId ? s.flows[flowId] : null;
  });
  const {
    selectNode,
    toggleNodeSelection,
    toggleNodeEnabled,
    toggleNodeStacking,
    deleteNode,
    reorderNodes,
    disconnectNodeInput,
    connectNodeInput,
    openGroupNode,
  } = useEditorActions();
  const { thumbnailMode } = usePreferences();

  // Use shared pointer drag hook for consistent DnD plumbing (immediate-start mode)
  const { handleRowPointerDown: hookHandlePointerDown } = usePointerDrag({
    startImmediately: true,
    onDragStart: (_row, clientY) => {
      const payload = dragInitRef.current;
      if (!payload) return false;

      const { pointerId, el, id, currentIdx, clientY: storedClientY } = payload;
      const clientYToUse = clientY !== undefined ? clientY : storedClientY;

      el.setPointerCapture(pointerId);

      // Collect all selected stacks when dragging a selected stack
      let dragIds: string[];
      if (selectedStackIds.has(id)) {
        dragIds = displayedStacks.filter((s) => selectedStackIds.has(s[0].id)).map((s) => s[0].id);
        dragIds = dragIds.filter((did) => did !== id);
        dragIds.unshift(id);
      } else {
        dragIds = [id];
      }

      // Store initial top positions for all dragged elements
      const listRect = listRef.current!.getBoundingClientRect();
      const initialTops = new Map<string, number>();
      for (const did of dragIds) {
        const dragEl = itemRefs.current.get(did);
        if (dragEl) {
          initialTops.set(did, dragEl.getBoundingClientRect().top - listRect.top);
        }
      }
      dragInitialTopsRef.current = initialTops;

      // Track which ids are being dragged (for visual feedback)
      setDraggedIds(dragIds);

      // Delegate imperative drag lifecycle to the controller
      const controller = dragControllerRef.current;
      if (controller) {
        controller.callbacks = dragCallbacksRef.current;
        controller.start(dragIds, el, clientYToUse - el.getBoundingClientRect().top, currentIdx);
      }

      return true;
    },
  });

  // Stable ref for drag callbacks (updated each render to avoid stale closures)
  const dragCallbacksRef = useRef<NodeListDragController['callbacks']>(null);
  dragCallbacksRef.current = {
    onLocalReorder: (_ids, newIdx) => {
      setLocalStacks((current) => {
        const visibleStacks = current.filter((stack) => !hiddenMergeIds.has(stack[0].id));
        const hiddenStacks = current.filter((stack) => hiddenMergeIds.has(stack[0].id));
        const hiddenStackBySourceId = new Map<string, AnyNode[]>();
        for (const hiddenStack of hiddenStacks) {
          const sourceNodeId = hiddenStack[0].inputs?.source;
          if (sourceNodeId) {
            hiddenStackBySourceId.set(sourceNodeId, hiddenStack);
          }
        }

        const draggedIdSet = new Set(_ids);
        const draggedStacks = visibleStacks.filter((s) => draggedIdSet.has(s[0].id));
        const nonDraggedStacks = visibleStacks.filter((s) => !draggedIdSet.has(s[0].id));

        const draggedBeforeNewIdx = visibleStacks
          .slice(0, newIdx)
          .filter((s) => draggedIdSet.has(s[0].id)).length;
        const adjustedInsertIdx = Math.max(0, newIdx - draggedBeforeNewIdx);
        nonDraggedStacks.splice(adjustedInsertIdx, 0, ...draggedStacks);

        const mergedStacks: AnyNode[][] = [];
        const addedHiddenIds = new Set<string>();
        for (const stack of nonDraggedStacks) {
          mergedStacks.push(stack);
          const linkedHiddenStack = hiddenStackBySourceId.get(stack[0].id);
          if (linkedHiddenStack) {
            mergedStacks.push(linkedHiddenStack);
            addedHiddenIds.add(linkedHiddenStack[0].id);
          }
        }
        for (const hiddenStack of hiddenStacks) {
          if (!addedHiddenIds.has(hiddenStack[0].id)) {
            mergedStacks.push(hiddenStack);
          }
        }
        return mergedStacks;
      });
    },
    onCommit: (startIdx, currentIdx, ids) => {
      if (startIdx === currentIdx) return;

      const dragIdList = ids;
      const originalDragIndices = dragIdList
        .map((did) => nodes.findIndex((n) => n.id === did))
        .filter((idx) => idx !== -1)
        .sort((a, b) => a - b);

      const originalTargetStack = displayedInitialStacks[currentIdx];
      if (!originalTargetStack) return;
      const dropId = originalTargetStack[0].id;
      const originalDropIndex = nodes.findIndex((n) => n.id === dropId);

      if (originalDragIndices.length > 0 && originalDropIndex !== -1) {
        reorderNodes(originalDragIndices, originalDropIndex);
      }
    },
    onDragEnd: () => {
      setDraggedIds(null);
    },
  };

  const [localStacks, setLocalStacks] = useState(initialStacks);
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [hoveredConnectionNodeIds, setHoveredConnectionNodeIds] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const measuredHeights = useRef<Map<string, number>>(new Map());
  const dragInitialTopsRef = useRef<Map<string, number>>(new Map());
  const dragInitRef = useRef<PointerDownPayload | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  // Drag controller (persistent class instance, no React deps)
  const dragControllerRef = useRef<NodeListDragController | null>(null);
  if (!dragControllerRef.current) {
    dragControllerRef.current = new NodeListDragController({
      listElFactory: () => listRef.current,
      itemRefsFactory: () => itemRefs.current,
      measuredHeightsFactory: () => measuredHeights.current,
      dragInitialTopsFactory: () => dragInitialTopsRef.current,
      displayedStacksFactory: () => displayedStacks,
    });
  }

  // Sync local state with global state, unless a drag is active
  useEffect(() => {
    if (!draggedIds) {
      setLocalStacks(initialStacks);
    }
  }, [initialStacks, draggedIds]);

  const stacksInFlowOrder = useMemo(
    () => (direction === 'bottom-up' ? localStacks.slice().reverse() : localStacks),
    [direction, localStacks],
  );

  const directMergeBySourceId = useMemo<Map<string, AnyNode>>(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const primaryPipelineNodeIds = new Set(getPrimaryPipelineNodeIds(activeFlow));
    const next = new Map<string, AnyNode>();

    for (const node of nodes) {
      if (node.type !== NodeType.MERGE) continue;
      const sourceNodeId = node.inputs?.source;
      if (!sourceNodeId) continue;
      const sourceNode = nodeById.get(sourceNodeId);
      if (!sourceNode || primaryPipelineNodeIds.has(sourceNodeId)) {
        continue;
      }
      next.set(sourceNodeId, node);
    }

    return next;
  }, [activeFlow, nodes]);

  const hiddenMergeIds = useMemo(() => {
    const next = new Set<string>();
    for (const node of directMergeBySourceId.values()) {
      next.add(node.id);
    }
    return next;
  }, [directMergeBySourceId]);

  // ── Preview placeholder stacks ──────────────────────────────────────
  // Show a ghost row(s) when hovering over a tool button.
  const previewEntry = useMemo(
    () =>
      computePreviewEntry(
        previewNodeType,
        localStacks,
        activeFlow
          ? collectUpstreamNodeIds(activeFlow.edges, activeFlow.outputNodeId)
          : new Set<string>(),
      ),
    [activeFlow, previewNodeType, localStacks],
  );

  const previewStacks = useMemo<AnyNode[][]>(() => {
    // Generic placeholder when tools tab is active but no tool is hovered
    if (!previewEntry) {
      if (activeTab === EditorTab.Tools && localStacks.length > 0) {
        const placeholderNode: AnyNode = {
          id: '__preview__placeholder',
          type: NodeType.SCENE,
          name: 'Add Node',
          enabled: true,
        } as AnyNode;
        return [[placeholderNode]];
      }
      return [];
    }

    const previewId = `__preview__${previewEntry.nodeType}`;
    const previewNode: AnyNode = {
      id: previewId,
      type: previewEntry.nodeType,
      name: previewEntry.name,
      enabled: true,
    } as AnyNode;

    const stacks: AnyNode[][] = [[previewNode]];

    if (previewEntry.isMerge) {
      const mergeNode: AnyNode = {
        id: `__preview__merge`,
        type: NodeType.MERGE,
        name: 'Merge',
        enabled: true,
        opacity: 100,
        operator: BlendMode.OVER,
      } as AnyNode;
      stacks.push([mergeNode]);
    }

    return stacks;
  }, [previewEntry, activeTab, localStacks.length]);

  // Insert preview placeholder stacks after the selected node's stack, or at end.
  const displayedStacks = useMemo(() => {
    const base = localStacks.filter((stack) => !hiddenMergeIds.has(stack[0].id));
    if (previewStacks.length === 0) return base;

    const insertAt = findPreviewInsertIndex(base, selectedNodeId);
    const next = [...base];
    next.splice(insertAt, 0, ...previewStacks);
    return next;
  }, [localStacks, hiddenMergeIds, previewStacks, selectedNodeId]);

  const displayedInitialStacks = useMemo(
    () => initialStacks.filter((stack) => !hiddenMergeIds.has(stack[0].id)),
    [hiddenMergeIds, initialStacks],
  );

  const primaryPipelineNodeIds = useMemo(
    () => new Set(getPrimaryPipelineNodeIds(activeFlow)),
    [activeFlow],
  );

  const visiblePipelineStacks = useMemo(
    () =>
      stacksInFlowOrder.filter(
        (stack) =>
          (primaryPipelineNodeIds.has(stack[0].id) || directMergeBySourceId.has(stack[0].id)) &&
          !hiddenMergeIds.has(stack[0].id),
      ),
    [directMergeBySourceId, hiddenMergeIds, primaryPipelineNodeIds, stacksInFlowOrder],
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

    displayedStacks.forEach((stack) => {
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
    displayedStacks.forEach((stack) => {
      const id = stack[0].id;
      const el = itemRefs.current.get(id);
      if (el && (!draggedIds || !draggedIds.includes(id))) {
        el.style.transform = 'none';
        el.style.top = `${newTops.get(id) ?? 0}px`;
      }
    });
  }, [displayedStacks, draggedIds, layoutVersion]);

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

  // Wraps usePointerDrag's handleRowPointerDown to inject NodeList-specific
  // event interception and store drag-init data in a ref for onDragStart.
  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, stack: AnyNode[]) => {
      e.preventDefault();
      e.stopPropagation();

      const id = stack[0].id;
      const el = itemRefs.current.get(id);
      if (!el) return;

      const currentIdx = displayedStacks.findIndex((s) => s[0].id === id);
      if (currentIdx === -1) return;

      dragInitRef.current = {
        pointerId: e.pointerId,
        el,
        id,
        currentIdx,
        clientY: e.clientY,
      };

      hookHandlePointerDown(e, { key: id });
    },
    [displayedStacks, hookHandlePointerDown],
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

  // Cleanup: stop drag session on unmount to prevent listener leaks
  useEffect(() => {
    const controller = dragControllerRef.current;
    return () => controller?.stop();
  }, []);

  const hoveredConnectionNodeIdSet = useMemo(
    () => new Set(hoveredConnectionNodeIds),
    [hoveredConnectionNodeIds],
  );
  const activeNodeJobMap = useMemo(() => getActiveNodeJobMap(backgroundJobs), [backgroundJobs]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
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
  const handleExecuteNode = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      requestRegisteredNodeExecution(nodeId);
    },
    [selectNode],
  );
  const getNodeActions = useCallback(
    (node: AnyNode, isBase: boolean, isDraggable: boolean): NodeAction[] => {
      const nodeIndexInAll = nodes.findIndex((candidate) => candidate.id === node.id);
      const stackingAction = createStackingAction(node, nodeIndexInAll > 0, toggleNodeStacking);
      const executionAction = createExecutionAction(node, handleExecuteNode);

      return [
        ...(stackingAction ? [stackingAction] : []),
        ...(executionAction ? [executionAction] : []),
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
          id: 'enabled',
          label: node.enabled ? 'Disable' : 'Enable',
          icon: node.enabled ? (
            <Icons.Power className="h-4 w-4" />
          ) : (
            <Icons.PowerOff className="h-4 w-4" />
          ),
          iconClassName:
            'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded',
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            toggleNodeEnabled(node.id);
          },
        },
      ];
    },
    [deleteNode, handleExecuteNode, nodes, toggleNodeEnabled, toggleNodeStacking],
  );

  return (
    <div ref={listRef} className="relative w-full">
      <PipelineRail
        listRef={listRef}
        itemRefs={itemRefs}
        stacks={visiblePipelineStacks}
        layoutVersion={layoutVersion}
      />
      {displayedStacks.map((stack) => {
        const isPreview = stack[0].id.startsWith('__preview__');
        const baseNode = stack[0];
        const directMergeNode = isPreview ? null : (directMergeBySourceId.get(baseNode.id) ?? null);
        const isDraggable = !isPreview && baseNode.type !== NodeType.SCENE;
        const isDragging = draggedIds?.includes(baseNode.id) ?? false;
        const isStackSelected = !isPreview && selectedStackIds.has(baseNode.id);
        const isDirectMergeSelected =
          !isPreview &&
          !!directMergeNode &&
          (directMergeNode.id === selectedNodeId || selectedNodeIdSet.has(directMergeNode.id));
        const showMediaThumbnail =
          !isPreview && thumbnailMode !== 'off' && !!nodeFlags(baseNode.type).hasThumbnail;
        const directMergeActions = directMergeNode
          ? getNodeActions(directMergeNode, true, true)
          : [];

        const isBottomUp = direction === 'bottom-up';
        const stackContent = isBottomUp ? stack.slice().reverse() : stack;

        const isConnectionHoverTarget =
          !isPreview && stack.some((node) => hoveredConnectionNodeIdSet.has(node.id));
        const isFloating =
          !isPreview && !primaryPipelineNodeIds.has(baseNode.id) && !directMergeNode;
        const rowPositionClass = isPreview
          ? 'absolute left-0 right-0'
          : isFloating
            ? `absolute left-0 ${FLOATING_ROW_RAIL_GUTTER_CLASS}`
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
            <div
              onClick={
                isPreview
                  ? undefined
                  : (e) => {
                      e.stopPropagation();
                      selectNodeFromPointer(e, baseNode.id);
                    }
              }
              onDoubleClick={
                isPreview
                  ? undefined
                  : (e) => {
                      if (baseNode.type !== NodeType.GROUP) return;
                      e.stopPropagation();
                      openGroupNode(baseNode.id);
                    }
              }
              className={`group text-gray-300 font-medium rounded-md transition-all duration-150 ease-out border ${
                isPreview
                  ? 'z-0 border-dashed border-primary-400/25 bg-primary-950/20 animate-pulse opacity-60 pointer-events-none select-none'
                  : isConnectionHoverTarget
                    ? 'z-0 border-primary-300/60 bg-primary-950/35 ring-1 ring-inset ring-primary-300/30'
                    : isDragging
                      ? `z-10 shadow-lg !transition-none ${isStackSelected ? 'bg-primary-900/50 border-primary-500' : 'border-primary-500 bg-gray-700/50'}`
                      : isStackSelected
                        ? 'z-0 bg-primary-900/50 border-primary-500'
                        : 'z-0 border-transparent bg-gray-750/50 hover:bg-gray-700/50'
              } ${directMergeNode ? 'mr-32' : ''} ${!baseNode.enabled ? 'opacity-40' : ''}`}
            >
              {isPreview
                ? // Simple ghost placeholder for preview nodes
                  stackContent.map((node) => (
                    <div
                      key={node.id}
                      className="relative flex items-center gap-1 overflow-hidden rounded-md p-1.5 text-xs opacity-60"
                    >
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                        <NodeIcon node={node} />
                      </div>
                      <span className="flex-1 truncate text-primary-200/70">{node.name}</span>
                      {node.type === NodeType.MERGE ? (
                        <span className="text-[10px] text-primary-300/50 px-1 py-0.5 rounded border border-dashed border-primary-300/20">
                          merge
                        </span>
                      ) : null}
                    </div>
                  ))
                : stackContent.map((node) => {
                    const isBase = node.id === baseNode.id;
                    const isScene = node.type === NodeType.SCENE;

                    const isSelectedNode =
                      node.id === selectedNodeId || selectedNodeIdSet.has(node.id);
                    const isPendingSourceCandidate =
                      !!pendingConnection && pendingConnection.nodeId !== node.id;
                    const nodeActions = getNodeActions(node, isBase, isDraggable);

                    return (
                      <div
                        key={node.id}
                        onClick={(e) => {
                          if (pendingConnection) {
                            handleCompleteConnection(e, node.id);
                          } else {
                            e.stopPropagation();
                            selectNodeFromPointer(e, node.id);
                          }
                        }}
                        onDoubleClick={(e) => {
                          if (node.type !== NodeType.GROUP) return;
                          e.stopPropagation();
                          openGroupNode(node.id);
                        }}
                        className={`relative flex items-center gap-1 overflow-hidden rounded-md p-1.5 text-xs transition-colors ${
                          hoveredConnectionNodeIdSet.has(node.id)
                            ? 'bg-primary-300/10 ring-1 ring-inset ring-primary-300/35'
                            : isSelectedNode
                              ? 'bg-primary-900/40 ring-1 ring-inset ring-primary-500/50'
                              : isPendingSourceCandidate
                                ? 'cursor-crosshair bg-primary-500/[0.04] ring-1 ring-inset ring-primary-400/15 hover:bg-primary-500/10 hover:ring-primary-300/45 hover:shadow-[0_0_18px_rgba(45,212,191,0.14)]'
                                : pendingConnection
                                  ? 'cursor-default opacity-70'
                                  : ''
                        } ${!node.enabled ? 'opacity-40' : ''}`}
                      >
                        {isPendingSourceCandidate ? (
                          <span className="pointer-events-none absolute inset-0 animate-pulse rounded-md border border-primary-300/35 shadow-[0_0_16px_rgba(45,212,191,0.12)]" />
                        ) : null}
                        <NodeProgressBackground job={activeNodeJobMap.get(node.id)} />
                        <div
                          onPointerDown={
                            isDraggable && isBase
                              ? (e) => handleDragPointerDown(e, stack)
                              : undefined
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
                            {isBase && showMediaThumbnail && sceneNode ? (
                              <div className="flex-shrink-0 w-10 h-8 bg-gray-900 rounded overflow-hidden flex items-center justify-center text-gray-500">
                                {renderMediaThumbnail(stack, sceneNode, thumbnailMode)}
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
                            onCancelConnection={() => setPendingConnection(null)}
                            pendingConnection={pendingConnection}
                          />
                          {isNoteNode(node) ? (
                            <div
                              className="mt-1 truncate text-[10px] font-normal text-primary-100/55"
                              title={node.content}
                            >
                              {getNotePreview(node.content) || 'Empty note'}
                            </div>
                          ) : null}
                        </div>
                        <div className="relative flex items-center flex-shrink-0">
                          {isScene ? (
                            <div className="w-6 h-6" />
                          ) : (
                            <NodeActionMenu actions={nodeActions} />
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
            {directMergeNode ? (
              <DirectMergeInlineNode
                mergeNode={directMergeNode}
                isSelected={isDirectMergeSelected}
                onSelect={selectNodeFromPointer}
                actions={directMergeActions}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default NodeList;
