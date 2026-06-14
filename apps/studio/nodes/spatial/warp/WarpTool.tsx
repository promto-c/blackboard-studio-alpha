import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const WarpTool = () => {
  return <NodeToolButton nodeType={NodeType.WARP} />;
};
