import { useCallback, useEffect, useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, NodeType, RotoNode } from '@blackboard/types';
import InspectorStack from '@/components/InspectorStack';
import { useSceneNode, useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { useNodeInspectorState } from '@/hooks/useNodeInspectorState';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { isMergeNodeId } from '@/utils/mergeNodes';
import { getRotoLayerMap, getRotoPathParentLayerId } from '@/utils/rotoHierarchy';
import { ScrollArea } from '@blackboard/ui';
import MergePropertiesPanel from '@/features/nodes/MergeAdjustments';
import OutputPropertiesPanel from '@/features/viewport/OutputAdjustments';
import SubPanelHeader from './SubPanelHeader';

interface PropertiesTabProps {
  rotoInspectorLevel: 'node' | 'shape' | 'layer';
  onRotoInspectorLevelChange: (level: 'node' | 'shape' | 'layer') => void;
}

const PropertiesTab = ({
  rotoInspectorLevel,
  onRotoInspectorLevelChange: setRotoInspectorLevel,
}: PropertiesTabProps) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedRotoLayerIds = useEditorSelector((s) => s.selectedRotoLayerIds);
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
  const selectedNode = useSelectedEditorNode();
  const sceneNode = useSceneNode();
  const isOutputNodeSelected = selectedNodeId === OUTPUT_NODE_ID;
  const isMergeNodeSelected = isMergeNodeId(selectedNodeId);
  const { renderComponentForNode, selectedRotoPath, selectedStack } = useNodeInspectorState({
    nodes,
    selectedNode,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    inspectorLevel: rotoInspectorLevel,
    onInspectorLevelChange: setRotoInspectorLevel,
  });
  const selectedRotoLayerId = selectedRotoLayerIds.length === 1 ? selectedRotoLayerIds[0] : null;

  useEffect(() => {
    if (selectedNode?.type !== NodeType.ROTO || (!selectedRotoPath && !selectedRotoLayerId)) {
      setRotoInspectorLevel('node');
    }
  }, [selectedNode, selectedRotoPath, selectedRotoLayerId, setRotoInspectorLevel]);

  const { setSelectedRotoLayerIds, setSelectedRotoPathIds } = useEditorActions();

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
  type BreadcrumbItem = {
    id: string;
    name: string;
    type: 'layer' | 'shape';
  };

  const getLayerChain = useCallback(
    (rotoNode: RotoNode, layerId: string | null): BreadcrumbItem[] => {
      if (!layerId) return [];
      const layerMap = getRotoLayerMap(rotoNode);
      const items: BreadcrumbItem[] = [];
      let currentLayer = layerMap.get(layerId);
      while (currentLayer) {
        items.unshift({ id: currentLayer.id, name: currentLayer.name, type: 'layer' });
        if (!currentLayer.parentLayerId) break;
        currentLayer = layerMap.get(currentLayer.parentLayerId);
      }
      return items;
    },
    [],
  );

  const breadcrumbItems: BreadcrumbItem[] = useMemo(() => {
    if (!selectedNode || selectedNode.type !== NodeType.ROTO) return [];
    const rotoNode = selectedNode as RotoNode;
    const items: BreadcrumbItem[] = [];

    if (selectedRotoLayerId) {
      items.push(...getLayerChain(rotoNode, selectedRotoLayerId));
    }

    if (selectedRotoPath) {
      const parentLayerId = getRotoPathParentLayerId(rotoNode, selectedRotoPath);
      if (parentLayerId) {
        items.push(...getLayerChain(rotoNode, parentLayerId));
      }
      items.push({
        id: selectedRotoPath.id,
        name: selectedRotoPath.name,
        type: 'shape',
      });
    }

    return items;
  }, [selectedNode, selectedRotoLayerId, selectedRotoPath, getLayerChain]);

  const MAX_BREADCRUMB_ITEMS = 4;

  const breadcrumbRenderItems = useMemo(() => {
    if (breadcrumbItems.length <= MAX_BREADCRUMB_ITEMS) return breadcrumbItems;
    const first = breadcrumbItems[0];
    const last = breadcrumbItems[breadcrumbItems.length - 1];
    const secondLast = breadcrumbItems[breadcrumbItems.length - 2];
    return [first, { id: '__ellipsis__', name: '…', type: 'layer' }, secondLast, last];
  }, [breadcrumbItems]);

  const handleBreadcrumbClick = useCallback(
    (item: (typeof breadcrumbItems)[number]) => {
      if (!selectedNode || selectedNode.type !== NodeType.ROTO) return;
      if (item.id === '__ellipsis__') return;
      if (item.type === 'layer') {
        setSelectedRotoLayerIds([item.id]);
        setSelectedRotoPathIds([]);
        setRotoInspectorLevel('layer');
      } else {
        setSelectedRotoPathIds([item.id]);
        setSelectedRotoLayerIds([]);
        setRotoInspectorLevel('shape');
      }
    },
    [selectedNode, setRotoInspectorLevel, setSelectedRotoLayerIds, setSelectedRotoPathIds],
  );

  const headerMeta =
    breadcrumbRenderItems.length > 0 ? (
      <div className="flex min-w-0 items-center gap-1 text-xs font-medium">
        <span className="text-gray-600">›</span>
        <div className="flex min-w-0 items-center gap-1 truncate">
          {breadcrumbRenderItems.map((item, index) => (
            <span key={item.id} className="flex items-center gap-1 truncate">
              {item.id === '__ellipsis__' ? (
                <span className="px-1 text-gray-600">…</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(item)}
                  className={`truncate text-left transition-colors ${
                    (item.type === 'layer' &&
                      rotoInspectorLevel === 'layer' &&
                      selectedRotoLayerId === item.id) ||
                    (item.type === 'shape' &&
                      rotoInspectorLevel === 'shape' &&
                      selectedRotoPath?.id === item.id)
                      ? 'text-gray-100'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  title={`Show properties for ${item.name}`}
                >
                  {item.name}
                </button>
              )}
              {index < breadcrumbRenderItems.length - 1 ? (
                <span className="px-1 text-gray-600">›</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    ) : null;
  const headerTitle =
    selectedNode?.type === NodeType.ROTO ? (
      <button
        onClick={() => setRotoInspectorLevel('node')}
        className={`text-left transition-colors ${
          rotoInspectorLevel === 'node' ? 'text-gray-100' : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Show node-level Roto properties"
      >
        Roto
      </button>
    ) : (
      title
    );
  const headerActions = (
    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">
      Properties
    </span>
  );

  const getNodeHeaderMeta = (node: AnyNode) =>
    node.id === selectedNodeId && node.type === NodeType.ROTO ? headerMeta : null;

  const getNodeHeaderTitle = (node: AnyNode) =>
    node.id === selectedNodeId && node.type === NodeType.ROTO ? (
      <button
        onClick={() => setRotoInspectorLevel('node')}
        className={`text-left transition-colors ${
          rotoInspectorLevel === 'node' ? 'text-gray-100' : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Show node-level Roto properties"
      >
        Roto
      </button>
    ) : (
      node.name
    );

  return (
    <ScrollArea fill axis="y" contentClassName="flex min-h-full flex-col">
      <div data-text-selection-scope className="flex min-h-full flex-col">
        {!isStackedInspector ? (
          <SubPanelHeader title={headerTitle} meta={headerMeta} actions={headerActions} />
        ) : null}
        <div
          className={`flex flex-1 flex-col ${isStackedInspector ? 'p-1.5' : 'px-1.5 pt-1 pb-1.5'}`}
        >
          <InspectorStack
            selectedNode={selectedNode}
            selectedNodeId={selectedNodeId ?? null}
            nodes={displayStack}
            isOutputSelected={isOutputNodeSelected}
            outputContent={<OutputPropertiesPanel />}
            isMergeSelected={isMergeNodeSelected && Boolean(selectedNodeId)}
            mergeContent={selectedNodeId ? <MergePropertiesPanel mergeId={selectedNodeId} /> : null}
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
                  meta={getNodeHeaderMeta(node)}
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
        </div>
      </div>
    </ScrollArea>
  );
};

export default PropertiesTab;
