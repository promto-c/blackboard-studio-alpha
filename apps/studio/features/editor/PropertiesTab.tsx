import { useCallback, useEffect, useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, ComfyNode, NodeType, RotoNode, Scene3DNode } from '@blackboard/types';
import { InspectorStack } from '@/components/InspectorStack';
import {
  InspectorBreadcrumb,
  type InspectorBreadcrumbSegment,
} from '@/components/InspectorBreadcrumb';
import { useSceneNode, useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { useNodeInspectorState } from '@/hooks/useNodeInspectorState';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { ScrollArea } from '@blackboard/ui';
import MergePropertiesPanel from '@/features/nodes/MergeAdjustments';
import { RenderSettingsPanel } from '@/features/viewport/RenderSettingsPanel';
import SubPanelHeader from './SubPanelHeader';
import RotoBatchAdjustments from '@/nodes/builtin/roto/RotoBatchAdjustments';
import {
  getComfyInspectorBreadcrumbItems,
  getRotoInspectorBreadcrumbItems,
  getScene3DInspectorBreadcrumbItems,
} from '@/utils/inspectorBreadcrumbs';

import type { RotoInspectorLevel } from '@/hooks/useAutoSyncRotoInspectorLevel';

interface PropertiesTabProps {
  rotoInspectorLevel: RotoInspectorLevel;
  onRotoInspectorLevelChange: (level: RotoInspectorLevel) => void;
}

const PropertiesTab = ({
  rotoInspectorLevel,
  onRotoInspectorLevelChange: setRotoInspectorLevel,
}: PropertiesTabProps) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorSelector((s) => s.selectedNodeIds ?? []);
  const hierarchySelections = useEditorSelector((s) => s.hierarchySelections);
  const selectedNode = useSelectedEditorNode();
  const sceneNode = useSceneNode();
  const isOutputNodeSelected = selectedNodeId === OUTPUT_NODE_ID;
  const isMergeNodeSelected = selectedNode?.type === NodeType.MERGE;

  const allSelectedAreRoto = useMemo(() => {
    if (selectedNodeIds.length <= 1) return false;
    return selectedNodeIds.every((id) => nodes.find((n) => n.id === id)?.type === NodeType.ROTO);
  }, [nodes, selectedNodeIds]);
  const { renderComponentForNode, selectedRotoPath, selectedStack } = useNodeInspectorState({
    nodes,
    selectedNode,
    hierarchySelections,
    selectedNodeId,
    inspectorLevel: rotoInspectorLevel,
    onInspectorLevelChange: setRotoInspectorLevel,
  });
  const hierarchySelection = hierarchySelections[selectedNodeId ?? ''] ?? {
    layerIds: [] as string[],
    itemIds: [] as string[],
  };
  const selectedRotoLayerId =
    hierarchySelection.layerIds.length === 1 ? hierarchySelection.layerIds[0] : null;

  useEffect(() => {
    if (selectedNode?.type !== NodeType.ROTO || (!selectedRotoPath && !selectedRotoLayerId)) {
      setRotoInspectorLevel('node');
    }
  }, [selectedNode, selectedRotoPath, selectedRotoLayerId, setRotoInspectorLevel]);

  const { setHierarchySelection, updateNode } = useEditorActions();

  const title = isOutputNodeSelected
    ? 'Output'
    : isMergeNodeSelected
      ? 'Merge'
      : selectedNode
        ? selectedNode.name
        : 'Properties';
  const displayStack = selectedNode
    ? selectedNode.type === NodeType.SCENE
      ? [selectedNode]
      : selectedStack
    : [];
  const isStackedInspector =
    !isOutputNodeSelected && !isMergeNodeSelected && displayStack.length > 1;
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

  const handleComfyRootClick = useCallback(
    (comfyNodeId: string) => {
      setHierarchySelection(comfyNodeId, [], []);
      updateNode(comfyNodeId, { selectedViewportPromptRegionId: undefined }, false);
    },
    [setHierarchySelection, updateNode],
  );

  const createInspectorBreadcrumb = useCallback(
    (node: AnyNode): React.ReactNode | null => {
      if (node.id !== selectedNodeId) return null;

      if (node.type === NodeType.ROTO) {
        const rotoNode = node as RotoNode;
        const items = getRotoInspectorBreadcrumbItems({
          node: rotoNode,
          selectedLayerId: selectedRotoLayerId,
          selectedPath: selectedRotoPath,
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

      if (node.type === NodeType.COMFY) {
        const comfyNode = node as ComfyNode;
        const items = getComfyInspectorBreadcrumbItems({
          node: comfyNode,
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
      }

      if (node.type === NodeType.SCENE_3D) {
        const scene3DNode = node as Scene3DNode;
        const items = getScene3DInspectorBreadcrumbItems({
          node: scene3DNode,
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

      return null;
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

  const headerTitle = selectedNode ? (createInspectorBreadcrumb(selectedNode) ?? title) : title;
  const headerActions = (
    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">
      Properties
    </span>
  );

  const getNodeHeaderTitle = (node: AnyNode) => createInspectorBreadcrumb(node) ?? node.name;

  return (
    <ScrollArea fill axis="y" contentClassName="flex min-h-full flex-col">
      <div data-text-selection-scope className="flex min-h-full flex-col">
        {!isStackedInspector && !allSelectedAreRoto ? (
          <SubPanelHeader title={headerTitle} actions={headerActions} />
        ) : null}
        <div className={`flex flex-1 flex-col ${isStackedInspector ? 'p-1' : ''}`}>
          {allSelectedAreRoto ? (
            <RotoBatchAdjustments nodeIds={selectedNodeIds} />
          ) : (
            <InspectorStack
              selectedNode={selectedNode}
              selectedNodeId={selectedNodeId ?? null}
              nodes={displayStack}
              isOutputSelected={isOutputNodeSelected}
              outputContent={<RenderSettingsPanel />}
              isMergeSelected={isMergeNodeSelected && Boolean(selectedNodeId)}
              mergeContent={
                selectedNodeId ? <MergePropertiesPanel nodeId={selectedNodeId} /> : null
              }
              emptyState={
                <div className="flex h-full items-center justify-center p-3 text-center text-[11px] text-gray-500">
                  <p>
                    {sceneNode
                      ? 'Select a node or the Output node to edit properties.'
                      : 'Project is empty.'}
                  </p>
                </div>
              }
              wrapSingle={false}
              renderNode={(node) =>
                isStackedInspector ? (
                  <div className="pb-1">{renderComponentForNode(node)}</div>
                ) : (
                  renderComponentForNode(node)
                )
              }
              renderCardHeader={(node) =>
                isStackedInspector ? (
                  <SubPanelHeader
                    sticky={false}
                    title={getNodeHeaderTitle(node)}
                    actions={headerActions}
                  />
                ) : null
              }
              getCardClassName={(_node, isSelected) =>
                `glass-component min-w-0 overflow-hidden rounded-lg border bg-gray-900/45 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/28 transition-colors ${
                  isSelected
                    ? 'border-primary-500/50 ring-1 ring-inset ring-primary-500/25'
                    : 'border-white/10'
                }`
              }
            />
          )}
        </div>
      </div>
    </ScrollArea>
  );
};

export default PropertiesTab;
