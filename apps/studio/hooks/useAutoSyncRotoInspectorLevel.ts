import { useEffect, useRef } from 'react';
import { AnyNode, NodeType, RotoNode } from '@blackboard/types';

export type RotoInspectorLevel = 'node' | 'shape' | 'layer';

interface UseAutoSyncRotoInspectorLevelOptions {
  selectedNode?: AnyNode;
  hierarchySelections: Record<string, { layerIds: string[]; itemIds: string[] }>;
  selectedNodeId: string | null;
  setRotoInspectorLevel: (level: RotoInspectorLevel) => void;
}

export const useAutoSyncRotoInspectorLevel = ({
  selectedNode,
  hierarchySelections,
  selectedNodeId,
  setRotoInspectorLevel,
}: UseAutoSyncRotoInspectorLevelOptions) => {
  const lastSelectionRef = useRef<{
    selectedNodeId: string | null;
    hierarchySelectionsRef: Record<string, { layerIds: string[]; itemIds: string[] }>;
  } | null>(null);

  useEffect(() => {
    const nodeId = selectedNode?.id ?? null;
    if (
      lastSelectionRef.current?.selectedNodeId === nodeId &&
      lastSelectionRef.current?.hierarchySelectionsRef === hierarchySelections
    ) {
      return;
    }

    lastSelectionRef.current = {
      selectedNodeId: nodeId,
      hierarchySelectionsRef: hierarchySelections,
    };

    if (!selectedNode || selectedNode.type !== NodeType.ROTO) {
      setRotoInspectorLevel('node');
      return;
    }

    const sel = hierarchySelections[selectedNodeId ?? ''] ?? { layerIds: [], itemIds: [] };
    const rotoNode = selectedNode as RotoNode;
    const hasSingleSelectedLayer = sel.layerIds.length === 1 && sel.itemIds.length === 0;
    const hasSingleSelectedPath =
      sel.layerIds.length === 0 &&
      sel.itemIds.length === 1 &&
      rotoNode.paths.some((path) => path.id === sel.itemIds[0]);

    if (hasSingleSelectedLayer) {
      setRotoInspectorLevel('layer');
    } else if (hasSingleSelectedPath) {
      setRotoInspectorLevel('shape');
    } else {
      setRotoInspectorLevel('node');
    }
  }, [selectedNode, hierarchySelections, selectedNodeId, setRotoInspectorLevel]);
};
