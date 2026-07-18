import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const MergeTool = () => {
  return <NodeToolButton nodeType={NodeType.MERGE} />;
};

export const MaskedMergeTool = () => {
  return <NodeToolButton nodeType={NodeType.MASKED_MERGE} />;
};
