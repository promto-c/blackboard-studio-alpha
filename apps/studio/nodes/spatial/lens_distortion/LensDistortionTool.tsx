import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const LensDistortionTool = () => {
  return <NodeToolButton nodeType={NodeType.LENS_DISTORTION} />;
};
