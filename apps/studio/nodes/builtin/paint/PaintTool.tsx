import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

function PaintTool() {
  return <NodeToolButton nodeType={NodeType.PAINT} />;
}

export default PaintTool;
