import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const PixelateTool = () => {
  return <NodeToolButton nodeType={NodeType.PIXELATE} />;
};
