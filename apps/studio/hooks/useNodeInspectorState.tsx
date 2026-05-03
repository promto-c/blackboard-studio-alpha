import React, { useCallback, useMemo } from 'react';
import { AnyNode, NodeType, RotoNode } from '@blackboard/types';
import { effectRegistry } from '@/effects/effectRegistry';
import { isStackedAdjustmentNode } from '@/utils/nodePredicates';

export type NodeInspectorLevel = 'node' | 'shape' | 'layer';

type PropertyComponentProps = {
  node?: AnyNode;
  inspectorLevel?: NodeInspectorLevel;
  onInspectorLevelChange?: (level: NodeInspectorLevel) => void;
};

interface UseNodeInspectorStateOptions {
  nodes: AnyNode[];
  selectedNode: AnyNode | undefined;
  selectedRotoLayerIds: string[];
  selectedRotoPathIds: string[];
  inspectorLevel: NodeInspectorLevel;
  onInspectorLevelChange: (level: NodeInspectorLevel) => void;
}

export function useNodeInspectorState({
  nodes,
  selectedNode,
  selectedRotoLayerIds,
  selectedRotoPathIds,
  inspectorLevel,
  onInspectorLevelChange,
}: UseNodeInspectorStateOptions) {
  const selectedStack = useMemo(() => {
    if (!selectedNode || selectedNode.type === NodeType.SCENE) {
      return selectedNode ? [selectedNode] : [];
    }

    const selectedIndex = nodes.findIndex((node) => node.id === selectedNode.id);
    if (selectedIndex === -1) {
      return [selectedNode];
    }

    let baseIndex = selectedIndex;
    while (baseIndex > 0 && isStackedAdjustmentNode(nodes[baseIndex])) {
      baseIndex -= 1;
    }

    const stack: AnyNode[] = [];
    for (let index = baseIndex; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (index === baseIndex || isStackedAdjustmentNode(node)) {
        stack.push(node);
        continue;
      }
      break;
    }

    return stack;
  }, [nodes, selectedNode]);

  const selectedRotoPath = useMemo(() => {
    if (
      !selectedNode ||
      selectedNode.type !== NodeType.ROTO ||
      selectedRotoLayerIds.length > 0 ||
      selectedRotoPathIds.length !== 1
    ) {
      return null;
    }

    const rotoNode = selectedNode as RotoNode;
    return rotoNode.paths.find((path) => path.id === selectedRotoPathIds[0]) ?? null;
  }, [selectedNode, selectedRotoLayerIds.length, selectedRotoPathIds]);

  const renderComponentForNode = useCallback(
    (node: AnyNode) => {
      const definition = effectRegistry.get(node.type);
      if (definition) {
        const PropertyComponent =
          definition.AdjustmentComponent as React.ComponentType<PropertyComponentProps>;
        return (
          <PropertyComponent
            node={node}
            inspectorLevel={node.type === NodeType.ROTO ? inspectorLevel : undefined}
            onInspectorLevelChange={
              node.type === NodeType.ROTO ? onInspectorLevelChange : undefined
            }
          />
        );
      }

      return <p className="p-3 text-xs text-gray-500">This node has no adjustable properties.</p>;
    },
    [inspectorLevel, onInspectorLevelChange],
  );

  return {
    renderComponentForNode,
    selectedRotoPath,
    selectedStack,
  };
}
