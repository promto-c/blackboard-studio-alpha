import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export function KeyerTool() {
  return <NodeToolButton nodeType={NodeType.KEYER} />;
}
