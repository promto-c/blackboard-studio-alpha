import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const TextTool = () => {
  return <NodeToolButton nodeType={NodeType.TEXT} />;
};
