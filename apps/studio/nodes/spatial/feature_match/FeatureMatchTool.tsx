import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '@/nodes/NodeToolButton';

export function FeatureMatchTool() {
  return <NodeToolButton nodeType={NodeType.FEATURE_MATCH} />;
}
