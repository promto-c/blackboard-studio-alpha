import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const GradeTool = () => {
  return <NodeToolButton nodeType={NodeType.GRADE} />;
};
