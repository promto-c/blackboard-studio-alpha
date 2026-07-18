import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export function PremultiplyTool() {
  return <NodeToolButton nodeType={NodeType.PREMULTIPLY} />;
}

export function UnpremultiplyTool() {
  return <NodeToolButton nodeType={NodeType.UNPREMULTIPLY} />;
}
