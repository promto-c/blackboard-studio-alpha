import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const CustomShaderTool = () => {
  return <NodeToolButton nodeType={NodeType.CUSTOM_SHADER} />;
};
