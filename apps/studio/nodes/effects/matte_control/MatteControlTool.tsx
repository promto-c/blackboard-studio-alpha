import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export function MatteControlTool() {
  return <NodeToolButton nodeType={NodeType.MATTE_CONTROL} />;
}
