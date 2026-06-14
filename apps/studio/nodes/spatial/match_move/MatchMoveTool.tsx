import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '@/nodes/NodeToolButton';

export function MatchMoveTool() {
  return <NodeToolButton nodeType={NodeType.MATCH_MOVE} />;
}
