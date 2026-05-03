import { AnyNode } from '@blackboard/types';
import { effectRegistry } from '@/effects/effectRegistry';

export interface NodeItemsPanelProps {
  node?: AnyNode;
  inspectorLevel?: string;
  onInspectorLevelChange?: (level: string) => void;
}

export function getNodeItemsComponent(node?: AnyNode) {
  if (!node) {
    return null;
  }

  return effectRegistry.get(node.type)?.ItemsComponent ?? null;
}

const NodeItemsPanel = ({ node, inspectorLevel, onInspectorLevelChange }: NodeItemsPanelProps) => {
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

export default NodeItemsPanel;
