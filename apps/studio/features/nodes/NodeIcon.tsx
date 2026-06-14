import { AnyNode, NodeType } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import * as Icons from '@blackboard/icons';

function NodeIcon({ node }: { node: AnyNode }) {
  if (node.type === NodeType.GROUP) {
    return <Icons.FolderOpen className="h-4 w-4 text-gray-400" />;
  }

  const Icon = nodeRegistry.get(node.type)?.IconComponent ?? Icons.Cog;

  return <Icon className="h-4 w-4 text-gray-400" />;
}

export default NodeIcon;
