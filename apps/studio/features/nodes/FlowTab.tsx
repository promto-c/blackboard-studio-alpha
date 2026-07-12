import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ComfyNode, ComfyWorkflow, NodeType, RotoNode, Scene3DNode } from '@blackboard/types';
import { useSceneNode, useSelectedEditorNode } from '@/hooks/useEditorNodes';
import useDeviceLayout, { LayoutMode } from '@/hooks/useDeviceLayout';
import MediaSourceImportToolButton from '@/nodes/builtin/media_source/MediaSourceImportToolButton';
import ImageSequenceToolButton from '@/nodes/builtin/image_sequence/ImageSequenceToolButton';
import { usePreferences } from '@/state/preferencesContext';
import {
  useAutoSyncRotoInspectorLevel,
  type RotoInspectorLevel,
} from '@/hooks/useAutoSyncRotoInspectorLevel';
import { useNodeInspectorState } from '@/hooks/useNodeInspectorState';
import * as Icons from '@blackboard/icons';
import { InspectorStack } from '@/components/InspectorStack';
import {
  InspectorBreadcrumb,
  type InspectorBreadcrumbSegment,
} from '@/components/InspectorBreadcrumb';
import { NodeItemsPanel, getNodeItemsComponent } from '@/components/NodeItemsPanel';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { buildNodeStacks } from '@/utils/nodeStacks';
import { ScrollArea, SplitterHandle } from '@blackboard/ui';
import NodeList from './NodeList';
import NodeIcon from './NodeIcon';
import MergePropertiesPanel from './MergeAdjustments';
import { RenderSettingsPanel } from '@/features/viewport/RenderSettingsPanel';
import NodeView from '@/features/nodeview/NodeView';
import ComfyWorkflowGraphView, {
  type ComfyGraphPathItem,
} from '@/features/nodeview/ComfyWorkflowGraphView';
import { useHotkeyScope } from '@/hotkeys';
import {
  getComfyInspectorBreadcrumbItems,
  getRotoInspectorBreadcrumbItems,
  getScene3DInspectorBreadcrumbItems,
} from '@/utils/inspectorBreadcrumbs';
import { useInAppMediaDrop } from '@/hooks/useInAppMediaDrop';
import { hasInAppMediaDrag, readInAppMediaDrag } from '@/utils/inAppMediaDrag';

interface FlowTabProps {
  showPropertiesSection?: boolean;
  graphFitInsetRight?: number;
  activeComfyGraph?: ActiveComfyGraph | null;
  onActiveComfyGraphChange?: (activeGraph: ActiveComfyGraph | null) => void;
}

export interface ActiveComfyGraph {
  nodeId: string;
  workflowId: string;
  subgraphPath?: ComfyGraphPathItem[];
  /** -1 means Studio Flow root, 0 means workflow root, higher values mean subgraph depth. */
  subgraphDepth?: number;
}

const FlowTab = ({
  showPropertiesSection = true,
  graphFitInsetRight = 0,
  activeComfyGraph: controlledActiveComfyGraph,
  onActiveComfyGraphChange,
}: FlowTabProps) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorSelector((s) => s.selectedNodeIds ?? []);
  const hierarchySelections = useEditorSelector((s) => s.hierarchySelections);
  const viewerNodeId = useEditorSelector((s) => s.viewerNodeId);
  const viewerSlots = useEditorSelector((s) => s.viewerSlots);
  const { selectNode, setHierarchySelection, updateNode } = useEditorActions();
  const selectedNode = useSelectedEditorNode();
  const layoutMode = useDeviceLayout();
  const isMobilePortrait = layoutMode === LayoutMode.MobilePortrait;
  const { flowPanelHeight, setPreferences, flowListDirection, flowViewMode } = usePreferences();
  const [isPropertiesView, setIsPropertiesView] = useState(false);
  const [rotoInspectorLevel, setRotoInspectorLevel] = useState<RotoInspectorLevel>('node');
  const [localActiveComfyGraph, setLocalActiveComfyGraph] = useState<ActiveComfyGraph | null>(null);
  const isActiveComfyGraphControlled = controlledActiveComfyGraph !== undefined;
  const activeComfyGraph = isActiveComfyGraphControlled
    ? controlledActiveComfyGraph
    : localActiveComfyGraph;
  const setActiveComfyGraph = onActiveComfyGraphChange ?? setLocalActiveComfyGraph;
  const flowRootRef = useRef<HTMLDivElement>(null);
  const flowListRef = useRef<HTMLDivElement>(null);
  const rootBreadcrumbContextRef = useRef<string | null>(null);
  const viewMode = flowViewMode;
  const sceneNode = useSceneNode();
  const otherNodes = useMemo(() => nodes.filter((node) => node.type !== NodeType.SCENE), [nodes]);
  const isSceneSelected = selectedNodeId === sceneNode?.id;
  const isOutputNodeSelected =
    selectedNodeId === OUTPUT_NODE_ID || selectedNodeIds.includes(OUTPUT_NODE_ID);

  const nodeStacks = useMemo(() => buildNodeStacks(otherNodes), [otherNodes]);

  const reversedStacks = useMemo(() => nodeStacks.slice().reverse(), [nodeStacks]);

  useEffect(() => {
    // Navigate to properties view when a node is selected on mobile
    if (isMobilePortrait && selectedNodeId && selectedNodeId !== sceneNode?.id) {
      setIsPropertiesView(true);
    }
    // Exit properties view when switching to desktop layout
    if (!isMobilePortrait) {
      setIsPropertiesView(false);
    }
  }, [selectedNodeId, isMobilePortrait, sceneNode]);

  const isMergeNodeSelected = selectedNode?.type === NodeType.MERGE;
  const { renderComponentForNode, selectedRotoPath, selectedStack } = useNodeInspectorState({
    nodes,
    selectedNode,
    hierarchySelections,
    selectedNodeId,
    inspectorLevel: rotoInspectorLevel,
    onInspectorLevelChange: setRotoInspectorLevel,
  });
  const propertyStack = selectedNode
    ? selectedNode.type === NodeType.SCENE
      ? [selectedNode]
      : selectedStack
    : [];
  useAutoSyncRotoInspectorLevel({
    selectedNode,
    hierarchySelections,
    selectedNodeId,
    setRotoInspectorLevel,
  });
  const hierarchySelection = hierarchySelections[selectedNodeId ?? ''] ?? {
    layerIds: [] as string[],
    itemIds: [] as string[],
  };
  const selectedRotoLayerId =
    selectedNode?.type === NodeType.ROTO && hierarchySelection.layerIds.length === 1
      ? hierarchySelection.layerIds[0]
      : null;
  const selectedComfyRegionId =
    selectedNode?.type === NodeType.COMFY &&
    hierarchySelection.layerIds.length === 1 &&
    hierarchySelection.itemIds.length === 0
      ? hierarchySelection.layerIds[0]
      : null;
  const selectedComfyOutputId =
    selectedNode?.type === NodeType.COMFY && hierarchySelection.itemIds.length === 1
      ? hierarchySelection.itemIds[0]
      : null;
  const selectedScene3DItemId =
    selectedNode?.type === NodeType.SCENE_3D && hierarchySelection.itemIds.length === 1
      ? hierarchySelection.itemIds[0]
      : null;
  useEffect(() => {
    if (selectedNode?.type !== NodeType.ROTO || (!selectedRotoPath && !selectedRotoLayerId)) {
      setRotoInspectorLevel('node');
    }
  }, [selectedNode, selectedRotoLayerId, selectedRotoPath]);

  const handleComfyRootClick = useCallback(
    (nodeId: string) => {
      setHierarchySelection(nodeId, [], []);
      updateNode(nodeId, { selectedViewportPromptRegionId: undefined }, false);
    },
    [setHierarchySelection, updateNode],
  );

  const createInspectorBreadcrumb = useCallback(
    (node: ComfyNode | RotoNode | Scene3DNode): React.ReactNode | null => {
      if (node.id !== selectedNodeId) return null;

      if (node.type === NodeType.ROTO) {
        const items = getRotoInspectorBreadcrumbItems({
          node,
          selectedLayerId: node.id === selectedNodeId ? selectedRotoLayerId : null,
          selectedPath: node.id === selectedNodeId ? selectedRotoPath : null,
        });
        return (
          <InspectorBreadcrumb
            root={{
              id: `${node.id}:root`,
              label: 'Roto',
              active: rotoInspectorLevel === 'node',
              title: 'Show node-level Roto properties',
              onClick: () => setRotoInspectorLevel('node'),
            }}
            items={items.map<InspectorBreadcrumbSegment>((item) => ({
              id: `${item.target}:${item.id}`,
              label: item.label,
              active:
                (item.target === 'layer' &&
                  rotoInspectorLevel === 'layer' &&
                  selectedRotoLayerId === item.id) ||
                (item.target === 'shape' &&
                  rotoInspectorLevel === 'shape' &&
                  selectedRotoPath?.id === item.id),
              title: `Show properties for ${item.label}`,
              onClick: () => {
                if (item.target === 'layer') {
                  setHierarchySelection(node.id, [item.id], []);
                  setRotoInspectorLevel('layer');
                  return;
                }
                setHierarchySelection(node.id, [], [item.id]);
                setRotoInspectorLevel('shape');
              },
            }))}
          />
        );
      }

      if (node.type === NodeType.SCENE_3D) {
        const items = getScene3DInspectorBreadcrumbItems({
          node,
          selectedItemId: selectedScene3DItemId,
        });
        return (
          <InspectorBreadcrumb
            root={{
              id: `${node.id}:root`,
              label: node.name || 'Scene 3D',
              active: items.length === 0,
              title: 'Show node-level Scene 3D properties',
              onClick: () => setHierarchySelection(node.id, [], []),
            }}
            items={items.map<InspectorBreadcrumbSegment>((item) => ({
              id: `${item.target}:${item.id}`,
              label: item.label,
              active: true,
              title: `Show properties for ${item.label}`,
              onClick: () => setHierarchySelection(node.id, [], [item.id]),
            }))}
          />
        );
      }

      const items = getComfyInspectorBreadcrumbItems({
        node,
        selectedRegionId: node.id === selectedNodeId ? selectedComfyRegionId : null,
        selectedOutputId: node.id === selectedNodeId ? selectedComfyOutputId : null,
      });
      return (
        <InspectorBreadcrumb
          root={{
            id: `${node.id}:root`,
            label: node.name || 'Comfy',
            active: items.length === 0,
            title: 'Show node-level Comfy properties',
            onClick: () => handleComfyRootClick(node.id),
          }}
          items={items.map<InspectorBreadcrumbSegment>((item) => ({
            id: `${item.target}:${item.id}`,
            label: item.label,
            active: true,
            title: `Show properties for ${item.label}`,
            onClick: () => {
              if (item.target === 'output') {
                setHierarchySelection(node.id, [], [item.id]);
              } else {
                setHierarchySelection(node.id, [item.id], []);
              }
              updateNode(node.id, { selectedViewportPromptRegionId: item.id }, false);
            },
          }))}
        />
      );
    },
    [
      handleComfyRootClick,
      rotoInspectorLevel,
      selectedComfyRegionId,
      selectedComfyOutputId,
      selectedScene3DItemId,
      selectedNodeId,
      selectedRotoLayerId,
      selectedRotoPath,
      setHierarchySelection,
      setRotoInspectorLevel,
      updateNode,
    ],
  );

  const selectedComfyWorkflow = useMemo((): {
    node: ComfyNode;
    workflow: ComfyWorkflow;
  } | null => {
    if (!selectedNode || selectedNode.type !== NodeType.COMFY) return null;
    const comfyNode = selectedNode as ComfyNode;
    const workflow =
      comfyNode.workflows.find((candidate) => candidate.id === comfyNode.selectedWorkflowId) ??
      null;
    if (!workflow?.sourceGraph) return null;
    return { node: comfyNode, workflow };
  }, [selectedNode]);

  const activeComfyWorkflow = useMemo((): {
    node: ComfyNode;
    workflow: ComfyWorkflow;
  } | null => {
    if (!activeComfyGraph) return null;
    const comfyNode = nodes.find(
      (node): node is ComfyNode =>
        node.id === activeComfyGraph.nodeId && node.type === NodeType.COMFY,
    );
    const workflow =
      comfyNode?.workflows.find((candidate) => candidate.id === activeComfyGraph.workflowId) ??
      null;
    if (!comfyNode || !workflow?.sourceGraph) return null;
    return { node: comfyNode, workflow };
  }, [activeComfyGraph, nodes]);
  const activeComfySubgraphPath = activeComfyGraph?.subgraphPath ?? [];
  const activeComfySubgraphDepth = Math.min(
    activeComfyGraph?.subgraphDepth ?? activeComfySubgraphPath.length,
    activeComfySubgraphPath.length,
  );
  const currentComfyGraphDepth = Math.max(-1, activeComfySubgraphDepth);
  const isComfyWorkflowGraphActive = activeComfyWorkflow && currentComfyGraphDepth >= 0;
  const addInAppMediaToFlow = useInAppMediaDrop();
  const [isInAppMediaDragOver, setIsInAppMediaDragOver] = useState(false);
  const canDropInAppMediaInList =
    !isComfyWorkflowGraphActive && (viewMode === 'list' || isMobilePortrait);
  const handleInAppMediaDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!canDropInAppMediaInList || !hasInAppMediaDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setIsInAppMediaDragOver(true);
    },
    [canDropInAppMediaInList],
  );
  const handleInAppMediaDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!isInAppMediaDragOver) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
      setIsInAppMediaDragOver(false);
    },
    [isInAppMediaDragOver],
  );
  const handleInAppMediaDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!canDropInAppMediaInList) return;
      const payload = readInAppMediaDrag(event.dataTransfer);
      if (!payload) return;
      event.preventDefault();
      event.stopPropagation();
      setIsInAppMediaDragOver(false);
      addInAppMediaToFlow(payload);
    },
    [addInAppMediaToFlow, canDropInAppMediaInList],
  );
  const currentActiveComfySubgraphPath =
    currentComfyGraphDepth > 0 ? activeComfySubgraphPath.slice(0, currentComfyGraphDepth) : [];
  const rootFlowContextKey = selectedComfyWorkflow
    ? `comfy:${selectedComfyWorkflow.node.id}:${selectedComfyWorkflow.workflow.id}`
    : `selection:${selectedNodeId ?? ''}`;

  useEffect(() => {
    if (activeComfyGraph && !activeComfyWorkflow) {
      setActiveComfyGraph(null);
    }
  }, [activeComfyGraph, activeComfyWorkflow, setActiveComfyGraph]);

  useEffect(() => {
    if (!activeComfyGraph || currentComfyGraphDepth !== -1) {
      rootBreadcrumbContextRef.current = null;
      return;
    }

    if (rootBreadcrumbContextRef.current === null) {
      rootBreadcrumbContextRef.current = rootFlowContextKey;
      return;
    }

    if (rootBreadcrumbContextRef.current !== rootFlowContextKey) {
      setActiveComfyGraph(null);
      rootBreadcrumbContextRef.current = null;
    }
  }, [activeComfyGraph, currentComfyGraphDepth, rootFlowContextKey, setActiveComfyGraph]);

  useEffect(() => {
    if (viewMode !== 'graph' && activeComfyGraph) {
      setActiveComfyGraph(null);
    }
  }, [activeComfyGraph, setActiveComfyGraph, viewMode]);

  const setActiveComfySubgraphPath = useCallback(
    (subgraphPath: ComfyGraphPathItem[]) => {
      if (!activeComfyGraph) return;
      setActiveComfyGraph({
        ...activeComfyGraph,
        subgraphPath,
        subgraphDepth: subgraphPath.length,
      });
    },
    [activeComfyGraph, setActiveComfyGraph],
  );

  const renderProperties = () => {
    return (
      <InspectorStack
        selectedNode={selectedNode}
        selectedNodeId={selectedNodeId ?? null}
        nodes={propertyStack}
        isOutputSelected={isOutputNodeSelected}
        outputContent={<RenderSettingsPanel />}
        isMergeSelected={isMergeNodeSelected && Boolean(selectedNodeId)}
        mergeContent={selectedNodeId ? <MergePropertiesPanel nodeId={selectedNodeId} /> : null}
        emptyState={
          <div className="p-3 text-center text-gray-500 text-xs h-full flex items-center justify-center">
            <p>Select a node or the Output node to adjust properties.</p>
          </div>
        }
        wrapSingle
        renderNode={renderComponentForNode}
        renderCardHeader={(node) => {
          if (propertyStack.length <= 1) return null;
          const breadcrumb =
            node.type === NodeType.ROTO ||
            node.type === NodeType.COMFY ||
            node.type === NodeType.SCENE_3D
              ? createInspectorBreadcrumb(node as RotoNode | ComfyNode | Scene3DNode)
              : null;

          return (
            <div
              className={`px-2 pt-1 pb-0.5 truncate ${
                breadcrumb
                  ? 'text-xs font-medium'
                  : 'text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-400'
              }`}
            >
              {breadcrumb ?? node.name}
            </div>
          );
        }}
        getCardClassName={(_node, isSelected) =>
          `glass-component min-w-0 rounded-lg border bg-gray-900/35 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/24 transition-colors ${
            isSelected
              ? 'border-primary-500/50 bg-primary-900/10 ring-1 ring-inset ring-primary-500/25'
              : 'border-white/10'
          }`
        }
      />
    );
  };

  const renderItemsPanel = () => {
    if (!selectedNode || !getNodeItemsComponent(selectedNode)) return null;
    return (
      <div className="glass-component rounded-lg border border-white/10 bg-gray-800/40 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/28 overflow-hidden">
        <NodeItemsPanel
          node={selectedNode}
          inspectorLevel={rotoInspectorLevel}
          onInspectorLevelChange={setRotoInspectorLevel}
        />
      </div>
    );
  };

  useHotkeyScope({ id: 'flow', ref: flowRootRef });
  useHotkeyScope({ id: 'flow.list', parentId: 'flow', ref: flowListRef });

  const selectedStackIds = useMemo(() => {
    const ids = new Set<string>();
    const selectedNodeIdSet = new Set(selectedNodeIds);
    for (const stack of nodeStacks) {
      if (stack.some((node) => selectedNodeIdSet.has(node.id))) {
        stack.forEach((node) => ids.add(node.id));
      }
    }
    if (selectedNode && selectedNode.type !== NodeType.SCENE) {
      selectedStack.forEach((node) => ids.add(node.id));
    }
    return ids;
  }, [nodeStacks, selectedNode, selectedNodeIds, selectedStack]);

  // Mobile: Properties View
  if (isMobilePortrait && isPropertiesView && selectedNodeId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 p-3 pb-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPropertiesView(false)}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors p-1 -ml-1"
              aria-label="Back to flow"
            >
              <Icons.ChevronLeft className="h-4 w-4" />
              Flow
            </button>
            <span className="text-gray-600">/</span>
            <span className="text-sm font-medium text-white truncate">
              {isOutputNodeSelected ? 'Output' : selectedNode?.name}
            </span>
          </div>
        </div>
        <ScrollArea rootClassName="flex-1 min-h-0" className="h-full overflow-y-auto px-3 pb-3">
          <div className="pt-2 space-y-2">
            {renderProperties()}
            {renderItemsPanel()}
          </div>
        </ScrollArea>
      </div>
    );
  }

  const isBottomUp = flowListDirection === 'bottom-up';
  const stacksForList = isBottomUp ? reversedStacks : nodeStacks;

  const outputNode = (borderClass: string) =>
    sceneNode && (
      <div
        onClick={(e) => {
          e.stopPropagation();
          selectNode(OUTPUT_NODE_ID);
        }}
        className={`flex items-center p-2 text-xs cursor-pointer ${borderClass} border-gray-700/50 transition-colors ${
          isOutputNodeSelected ? 'bg-primary-900/30' : 'hover:bg-gray-700/50'
        }`}
      >
        <div className="flex items-center gap-2 font-medium text-gray-300">
          <Icons.ArrowDownTray className="h-4 w-4" />
          <span>Output</span>
        </div>
      </div>
    );

  const sceneNodeCard = (borderClass: string) =>
    sceneNode && (
      <div
        onClick={(e) => {
          e.stopPropagation();
          selectNode(sceneNode.id);
        }}
        className={`flex items-center justify-between p-2 text-xs cursor-pointer ${borderClass} border-gray-700/50 transition-colors ${
          isSceneSelected ? 'bg-primary-900/30' : 'hover:bg-gray-700/50'
        }`}
      >
        <div className="flex items-center gap-2 font-medium text-gray-300">
          <NodeIcon node={sceneNode} />
          <span>{sceneNode.name}</span>
        </div>
        <span className="font-mono text-gray-400">
          {sceneNode.width}x{sceneNode.height}
        </span>
      </div>
    );

  const layerListNode = (
    <div className="p-2">
      {otherNodes.length > 0 ? (
        <NodeList
          stacks={stacksForList}
          selectedStackIds={selectedStackIds}
          selectedNodeId={selectedNodeId ?? null}
          sceneNode={sceneNode}
          direction={flowListDirection}
          viewerNodeId={viewerNodeId}
          viewerSlots={viewerSlots}
        />
      ) : (
        <div className="px-4 flex  gap-2">
          <MediaSourceImportToolButton />
          <ImageSequenceToolButton />
        </div>
      )}
    </div>
  );

  const layerListContent = (
    <div
      className={`glass-component rounded-lg border bg-gray-800/50 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/28 transition-colors ${
        isSceneSelected || isOutputNodeSelected ? 'border-primary-500' : 'border-gray-700/50'
      }`}
    >
      {sceneNode ? (
        isBottomUp ? (
          <>
            {outputNode('border-b')}
            {layerListNode}
            {sceneNodeCard('border-t')}
          </>
        ) : (
          <>
            {sceneNodeCard('border-b')}
            {layerListNode}
            {outputNode('border-t')}
          </>
        )
      ) : (
        <>
          {layerListNode}
          {outputNode('border-t')}
        </>
      )}
    </div>
  );

  // Desktop View with split scroll
  if (!isMobilePortrait) {
    const desktopFlowContent = (
      <>
        <div
          className="relative min-h-0 flex-1"
          onClick={() => selectNode(null)}
          onDragOver={handleInAppMediaDragOver}
          onDragLeave={handleInAppMediaDragLeave}
          onDrop={handleInAppMediaDrop}
        >
          {isComfyWorkflowGraphActive ? (
            <ComfyWorkflowGraphView
              workflow={activeComfyWorkflow.workflow}
              subgraphPath={currentActiveComfySubgraphPath}
              onSubgraphPathChange={setActiveComfySubgraphPath}
            />
          ) : viewMode === 'list' ? (
            <ScrollArea
              ref={flowListRef}
              rootClassName="h-full min-h-0"
              className="h-full overflow-y-auto px-3 pb-3"
            >
              {layerListContent}
            </ScrollArea>
          ) : (
            <NodeView
              sceneNode={sceneNode}
              nodeStacks={nodeStacks}
              selectedStackIds={selectedStackIds}
              selectedNodeId={selectedNodeId ?? null}
              selectedNodeIds={selectedNodeIds}
              isSceneSelected={isSceneSelected}
              isOutputNodeSelected={isOutputNodeSelected}
              viewerNodeId={viewerNodeId}
              viewerSlots={viewerSlots}
              fitInsetRight={graphFitInsetRight}
            />
          )}
          {isInAppMediaDragOver ? (
            <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border border-dashed border-primary-300/60 bg-primary-300/10 text-sm font-medium text-primary-100 backdrop-blur-sm">
              Drop media into Flow
            </div>
          ) : null}
        </div>
      </>
    );

    if (!showPropertiesSection) {
      return (
        <div ref={flowRootRef} className="h-full flex flex-col" data-hotkey-zone="flow-view">
          {desktopFlowContent}
        </div>
      );
    }

    return (
      <div ref={flowRootRef} className="h-full flex flex-col">
        {/* Flow Section */}
        <div
          className="flex flex-col"
          data-hotkey-zone="flow-view"
          style={{ height: `${flowPanelHeight}%`, minHeight: '150px' }}
        >
          {desktopFlowContent}
        </div>

        {/* Resizer */}
        <SplitterHandle
          axis="y"
          label="Inspector"
          title="Resize flow and inspector"
          value={flowPanelHeight}
          min={25}
          max={75}
          defaultValue={50}
          valueType="percent"
          measurementRef={flowRootRef}
          onChange={(nextHeight) => setPreferences({ flowPanelHeight: nextHeight })}
        />

        {/* Properties Section */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-1.5 flex-shrink-0 flex items-center gap-2 border-b border-white/10">
            <div className="min-w-0 flex items-center gap-1 text-xs font-medium">
              {selectedNode?.type === NodeType.ROTO ||
              selectedNode?.type === NodeType.COMFY ||
              selectedNode?.type === NodeType.SCENE_3D ? (
                (createInspectorBreadcrumb(selectedNode as RotoNode | ComfyNode | Scene3DNode) ?? (
                  <span className="truncate text-gray-300">{selectedNode.name}</span>
                ))
              ) : (
                <span className="truncate text-gray-300">
                  {isOutputNodeSelected
                    ? 'Output'
                    : isMergeNodeSelected
                      ? 'Merge'
                      : selectedNode
                        ? selectedNode.name
                        : 'Properties'}
                </span>
              )}
            </div>
            <span className="ml-auto text-xs font-medium text-gray-600">Properties</span>
          </div>
          <ScrollArea
            rootClassName="flex-1 min-h-0"
            className="h-full overflow-y-auto px-3 pb-3 space-y-2"
          >
            {renderProperties()}
            {renderItemsPanel()}
          </ScrollArea>
        </div>
      </div>
    );
  }

  // Mobile Flow View
  return (
    <ScrollArea
      ref={flowRootRef}
      rootClassName="relative h-full"
      className="p-3 space-y-4 h-full overflow-y-auto"
      data-hotkey-zone="flow-view"
      onClick={() => selectNode(null)}
      onDragOver={handleInAppMediaDragOver}
      onDragLeave={handleInAppMediaDragLeave}
      onDrop={handleInAppMediaDrop}
    >
      <div ref={flowListRef} className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Flow</h3>
        {layerListContent}
      </div>
      {!selectedNodeId && isMobilePortrait && (
        <div className="p-4 text-center text-gray-500 text-xs">
          <p>Select a node to edit its properties.</p>
        </div>
      )}
      {isInAppMediaDragOver ? (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border border-dashed border-primary-300/60 bg-primary-300/10 text-sm font-medium text-primary-100 backdrop-blur-sm">
          Drop media into Flow
        </div>
      ) : null}
    </ScrollArea>
  );
};

export default FlowTab;
