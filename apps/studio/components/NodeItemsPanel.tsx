import { AnyNode } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import type { RotoInspectorLevel } from '@/hooks/useAutoSyncRotoInspectorLevel';

export interface NodeItemsPanelProps {
  node?: AnyNode;
  inspectorLevel?: string;
  onInspectorLevelChange?: (level: RotoInspectorLevel) => void;
}

export function getNodeItemsComponent(node?: AnyNode) {
  if (!node) {
    return null;
  }

  return nodeRegistry.get(node.type)?.ItemsComponent ?? null;
}

export const NodeItemsPanel = ({
  node,
  inspectorLevel,
  onInspectorLevelChange,
}: NodeItemsPanelProps) => {
  const ItemsComponent = getNodeItemsComponent(node);
  if (!ItemsComponent) {
    return null;
  }

  return (
    <ItemsComponent
      node={node}
      inspectorLevel={inspectorLevel}
      onInspectorLevelChange={onInspectorLevelChange}
    />
  );
};
