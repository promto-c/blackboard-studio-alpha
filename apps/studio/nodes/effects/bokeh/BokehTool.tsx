import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const BokehTool = () => {
  return <NodeToolButton nodeType={NodeType.BOKEH_BLUR} />;
};
