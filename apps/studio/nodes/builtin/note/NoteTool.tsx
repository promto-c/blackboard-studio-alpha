import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

function NoteTool() {
  return <NodeToolButton nodeType={NodeType.NOTE} />;
}

export default NoteTool;
