import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const BlurTool = () => {
  return <NodeToolButton nodeType={NodeType.BLUR} />;
};
