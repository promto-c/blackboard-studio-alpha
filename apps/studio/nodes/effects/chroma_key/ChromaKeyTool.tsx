import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const ChromaKeyTool = () => {
  return <NodeToolButton nodeType={NodeType.CHROMA_KEY} />;
};
