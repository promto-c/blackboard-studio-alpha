import { useEffect, useRef } from 'react';
import { AnyNode, NodeType, RotoNode } from '@blackboard/types';

type RotoInspectorLevel = 'node' | 'shape' | 'layer';

interface UseAutoSyncRotoInspectorLevelOptions {
  selectedNode?: AnyNode;
  selectedRotoLayerIds: string[];
  selectedRotoPathIds: string[];
  setRotoInspectorLevel: (level: RotoInspectorLevel) => void;
}

export const useAutoSyncRotoInspectorLevel = ({
  selectedNode,
  selectedRotoLayerIds,
  selectedRotoPathIds,
  setRotoInspectorLevel,
}: UseAutoSyncRotoInspectorLevelOptions) => {
  const lastSelectionRef = useRef<{
    selectedNodeId: string | null;
    selectedRotoLayerIdsRef: string[];
    selectedRotoPathIdsRef: string[];
  } | null>(null);

  useEffect(() => {
    const selectedNodeId = selectedNode?.id ?? null;
    if (
      lastSelectionRef.current?.selectedNodeId === selectedNodeId &&
      lastSelectionRef.current?.selectedRotoLayerIdsRef === selectedRotoLayerIds &&
      lastSelectionRef.current?.selectedRotoPathIdsRef === selectedRotoPathIds
    ) {
      return;
    }

    lastSelectionRef.current = {
      selectedNodeId,
      selectedRotoLayerIdsRef: selectedRotoLayerIds,
      selectedRotoPathIdsRef: selectedRotoPathIds,
    };

    if (!selectedNode || selectedNode.type !== NodeType.ROTO) {
      setRotoInspectorLevel('node');
      return;
    }

    const rotoNode = selectedNode as RotoNode;
    const hasSingleSelectedLayer =
      selectedRotoLayerIds.length === 1 && selectedRotoPathIds.length === 0;
    const hasSingleSelectedPath =
      selectedRotoLayerIds.length === 0 &&
      selectedRotoPathIds.length === 1 &&
      rotoNode.paths.some((path) => path.id === selectedRotoPathIds[0]);

    if (hasSingleSelectedLayer) {
      setRotoInspectorLevel('layer');
    } else if (hasSingleSelectedPath) {
      setRotoInspectorLevel('shape');
    } else {
      setRotoInspectorLevel('node');
    }
  }, [selectedNode, selectedRotoLayerIds, selectedRotoPathIds, setRotoInspectorLevel]);
};
