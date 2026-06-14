import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export function OnnxTool() {
  return <NodeToolButton nodeType={NodeType.ONNX_MODEL} iconClassName="h-5 w-5" />;
}
